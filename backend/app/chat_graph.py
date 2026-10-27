"""Agentic RAG as a LangGraph state machine.

    START -> analyze --direct--> answer_direct ----------------------------+
                |                                                          |
                +--library--> retrieve -> grade --relevant--> generate -> self_check --ok--> finalize -> END
                                 ^           |                   ^             |retry (max 1)
                                 |           +--none, tries left--> rewrite    +-------------+
                                 +---------------------------------+
                                             |none, out of tries
                                             +--> web_search --results--> generate
                                             +--> not_found ------------------------> finalize

Every node reports progress through LangGraph's custom stream writer, which the API turns into
Server-Sent Events: {"step"}, {"token"}, {"reset"} and {"done"}. Conversation memory is the
`messages` channel persisted by a checkpointer, one thread per chat.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Annotated, Iterator, TypedDict

from langchain_core.documents import Document
from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, RemoveMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.runtime import Runtime
from langgraph.types import StreamWriter

from . import prompts
from .answer import build_sources, cited_only, format_context
from .chains import Analysis, Chains, Grades, GroundingCheck
from .store import Library

log = logging.getLogger(__name__)

WEB_PREFIX = "> 🌐 *Nothing relevant in your library, so this answer comes from a web search.*\n\n"
WARN_FOOTER = "\n\n> ⚠️ *Some details may not be fully supported by the sources above. Please verify.*"

STEP_LABELS = {
    "analyze": "Understanding your question",
    "retrieve": "Searching your library",
    "retrieve_again": "Searching again with a new query",
    "grade": "Checking which passages are relevant",
    "rewrite": "Rephrasing the question",
    "web_search": "Nothing found in your library, searching the web",
    "generate": "Writing the answer",
    "regenerate": "Rewriting to fix unsupported claims",
    "self_check": "Double-checking against the sources",
    "direct": "Replying",
}


def _step(node: str, label_key: str | None = None, **extra) -> dict:
    key = label_key or node
    return {"step": {"id": node, "label": STEP_LABELS[key], **extra}}


@dataclass
class ChatContext:
    lib: Library


class ChatState(TypedDict, total=False):
    # conversation memory (persisted per thread by the checkpointer)
    messages: Annotated[list[AnyMessage], add_messages]
    # per-turn working state (reset by `analyze`)
    question: str
    doc_ids: list[str]
    style: str         # normal | simple | exam | deep
    standalone: str
    query: str
    tried: list[str]
    attempts: int
    route: str
    docs: list[Document]
    relevant: list[Document]
    mode: str          # library | web | direct | none
    context: str
    answer: str
    sources: list[dict]
    regen: int
    issues: str
    verdict: str       # ok | retry | flagged


def _history(messages: list[AnyMessage], limit: int) -> list[AnyMessage]:
    turns = [m for m in messages if isinstance(m, (HumanMessage, AIMessage)) and m.content]
    return turns[-limit:] if limit else []


def _titles(lib: Library) -> str:
    names = [d.name for d in lib.docs.values() if d.status == "ready"]
    return ", ".join(names)[:600] or "(nothing yet)"


def build_chat_graph(settings, chains: Chains, web, checkpointer):
    s = settings

    # ---------------------------------------------------------------- nodes
    def analyze(state: ChatState, runtime: Runtime[ChatContext], writer: StreamWriter):
        writer(_step("analyze"))
        question = state["question"]
        lib = runtime.context.lib
        res = chains.safe(
            chains.analyze,
            {"history": _history(state["messages"][:-1], s.max_history_messages),
             "question": question, "library_titles": _titles(lib)},
            Analysis(route="library", query=question),
        )
        if isinstance(res, dict):
            res = Analysis(**res)
        query = (res.query or "").strip() or question
        return {
            "route": res.route, "standalone": query, "query": query, "tried": [query],
            "attempts": 0, "docs": [], "relevant": [], "mode": "library", "context": "",
            "answer": "", "sources": [], "regen": 0, "issues": "", "verdict": "",
        }

    def retrieve(state: ChatState, runtime: Runtime[ChatContext], writer: StreamWriter):
        again = state.get("attempts", 0) > 0
        writer(_step("retrieve", "retrieve_again" if again else "retrieve", attempt=state.get("attempts", 0)))
        ids = set(state.get("doc_ids") or []) or None
        docs = []
        for d, score in runtime.context.lib.search(state["query"], s.top_k, ids):
            md = dict(d.metadata)
            md["score"] = score
            docs.append(Document(page_content=d.page_content, metadata=md))
        return {"docs": docs}

    def grade(state: ChatState, writer: StreamWriter):
        docs = state["docs"]
        if not docs:
            return {"relevant": []}
        if not s.grade_docs:
            return {"relevant": docs}
        writer(_step("grade"))
        passages = "\n\n".join(f"[{i}] {d.page_content[:700]}" for i, d in enumerate(docs, 1))
        res = chains.safe(
            chains.grade, {"question": state["standalone"], "passages": passages},
            Grades(relevant=list(range(1, min(3, len(docs)) + 1))),  # grader down: trust top 3
        )
        if isinstance(res, dict):
            res = Grades(**res)
        keep: list[int] = []
        for i in res.relevant:
            if 1 <= i <= len(docs) and i not in keep:
                keep.append(i)
        return {"relevant": [docs[i - 1] for i in keep]}

    def after_grade(state: ChatState) -> str:
        if state["relevant"]:
            return "generate"
        if state["attempts"] < s.max_rewrites:
            return "rewrite"
        return "web_search" if web.available else "not_found"

    def rewrite(state: ChatState, writer: StreamWriter):
        writer(_step("rewrite"))
        tried = state["tried"]
        q = chains.safe(
            chains.rewrite,
            {"question": state["standalone"], "tried": "\n".join(f"- {t}" for t in tried)}, "",
        )
        q = (q or "").strip().strip("\"'")[:300]
        if not q or q.lower() in {t.lower() for t in tried}:
            q = f"{state['standalone']} (explanation, definition, overview)"
        return {"query": q, "attempts": state["attempts"] + 1, "tried": tried + [q]}

    def web_search(state: ChatState, writer: StreamWriter):
        writer(_step("web_search", query=state["standalone"]))
        docs = [
            Document(page_content=r["content"][:1200],
                     metadata={"external": True, "title": r["title"], "url": r["url"]})
            for r in web.search(state["standalone"])
        ]
        return {"relevant": docs, "mode": "web"}

    def after_web(state: ChatState) -> str:
        return "generate" if state["relevant"] else "not_found"

    def generate(state: ChatState, runtime: Runtime[ChatContext], writer: StreamWriter):
        regen = state.get("regen", 0)
        writer(_step("generate", "regenerate" if regen else "generate"))
        if regen:
            writer({"reset": True})  # UI discards the draft and streams the revision
        lib_docs = dict(runtime.context.lib.docs)
        docs = [d for d in state["relevant"]
                if d.metadata.get("external") or d.metadata.get("doc_id") in lib_docs]
        sources = build_sources(docs, lib_docs)
        context = format_context(docs, sources)
        web_mode = state["mode"] == "web"
        prefix = WEB_PREFIX if web_mode else ""
        if prefix:
            writer({"token": prefix})
        feedback = ""
        if regen and state.get("issues"):
            feedback = (f"REVIEWER FEEDBACK on your previous draft: {state['issues']}\n"
                        "Rewrite the answer using only information supported by the sources; "
                        "remove or hedge anything unsupported.\n\n")
        parts: list[str] = []
        for tok in chains.generate.stream({
            "origin": prompts.ORIGIN_WEB if web_mode else prompts.ORIGIN_LIBRARY,
            "style": prompts.STYLES.get(state.get("style", "normal"), ""),
            "history": _history(state["messages"][:-1], s.max_history_messages),
            "sources": context, "feedback": feedback, "question": state["question"],
        }):
            if tok:
                parts.append(tok)
                writer({"token": tok})
        return {"answer": prefix + "".join(parts), "sources": sources, "context": context}

    def self_check(state: ChatState, writer: StreamWriter):
        if not s.self_check:
            return {"verdict": "ok"}
        writer(_step("self_check"))
        res = chains.safe(
            chains.check,
            {"sources": state["context"], "answer": state["answer"].removeprefix(WEB_PREFIX)},
            GroundingCheck(grounded=True),
        )
        if isinstance(res, dict):
            res = GroundingCheck(**res)
        if res.grounded:
            return {"verdict": "ok", "issues": ""}
        if state.get("regen", 0) < 1:
            return {"verdict": "retry", "issues": res.issues, "regen": state.get("regen", 0) + 1}
        writer({"token": WARN_FOOTER})
        return {"verdict": "flagged", "issues": res.issues, "answer": state["answer"] + WARN_FOOTER}

    def after_check(state: ChatState) -> str:
        return "generate" if state["verdict"] == "retry" else "finalize"

    def answer_direct(state: ChatState, runtime: Runtime[ChatContext], writer: StreamWriter):
        writer(_step("direct"))
        parts: list[str] = []
        for tok in chains.chat.stream({
            "history": _history(state["messages"][:-1], s.max_history_messages),
            "question": state["question"], "library_titles": _titles(runtime.context.lib),
        }):
            if tok:
                parts.append(tok)
                writer({"token": tok})
        return {"answer": "".join(parts), "sources": [], "mode": "direct"}

    def not_found(state: ChatState, writer: StreamWriter):
        tail = ", and a web search didn't turn up anything usable" if web.available else ""
        msg = (f"I couldn't find anything about that in your library{tail}.\n\n"
               "Try rephrasing the question, or add a document, video or link that covers it.")
        writer({"token": msg})
        return {"answer": msg, "sources": [], "mode": "none"}

    def finalize(state: ChatState, writer: StreamWriter):
        answer = state["answer"]
        sources = cited_only(answer, state["sources"]) if state["sources"] else []
        # keep conversation memory bounded: drop the oldest messages
        keep = max(2, s.max_history_messages * 2)
        old = state["messages"][:-keep] if len(state["messages"]) > keep else []
        writer({"done": True, "sources": sources, "meta": {
            "mode": state["mode"], "rewrites": state.get("attempts", 0),
            "web": state["mode"] == "web", "flagged": state.get("verdict") == "flagged",
        }})
        return {"messages": [AIMessage(content=answer)] + [RemoveMessage(id=m.id) for m in old]}

    # ---------------------------------------------------------------- graph
    g = StateGraph(ChatState, context_schema=ChatContext)
    for name, fn in [("analyze", analyze), ("retrieve", retrieve), ("grade", grade),
                     ("rewrite", rewrite), ("web_search", web_search), ("generate", generate),
                     ("self_check", self_check), ("answer_direct", answer_direct),
                     ("not_found", not_found), ("finalize", finalize)]:
        g.add_node(name, fn)

    g.add_edge(START, "analyze")
    g.add_conditional_edges("analyze", lambda st: "answer_direct" if st["route"] == "direct" else "retrieve",
                            ["answer_direct", "retrieve"])
    g.add_edge("retrieve", "grade")
    g.add_conditional_edges("grade", after_grade, ["generate", "rewrite", "web_search", "not_found"])
    g.add_edge("rewrite", "retrieve")
    g.add_conditional_edges("web_search", after_web, ["generate", "not_found"])
    g.add_edge("generate", "self_check")
    g.add_conditional_edges("self_check", after_check, ["generate", "finalize"])
    for terminal in ("answer_direct", "not_found"):
        g.add_edge(terminal, "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=checkpointer)


class ChatService:
    """Runs the graph for one chat turn and exposes it as an event stream."""

    def __init__(self, graph, checkpointer, settings) -> None:
        self.graph = graph
        self.checkpointer = checkpointer
        self.settings = settings

    def has_thread(self, thread_id: str) -> bool:
        return self.checkpointer.get_tuple({"configurable": {"thread_id": thread_id}}) is not None

    def stream(self, lib: Library, thread_id: str, question: str, doc_ids: set[str] | None = None,
               style: str = "normal", history: list[tuple[str, str]] | None = None) -> Iterator[dict]:
        """`history` ([(role, text)]) re-seeds the conversation when the thread's memory was unloaded."""
        config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 40}
        past = []
        if history and not self.has_thread(thread_id):
            past = [HumanMessage(content=t) if role == "user" else AIMessage(content=t) for role, t in history]
        inputs = {"messages": [*past, HumanMessage(content=question)], "question": question,
                  "doc_ids": sorted(doc_ids or []), "style": style}
        yield from self.graph.stream(inputs, config, context=ChatContext(lib=lib),
                                     stream_mode="custom")

    def invoke(self, lib: Library, thread_id: str, question: str,
               doc_ids: set[str] | None = None, style: str = "normal", history=None) -> dict:
        answer: list[str] = []
        steps: list[dict] = []
        done: dict = {}
        for ev in self.stream(lib, thread_id, question, doc_ids, style, history):
            if "token" in ev:
                answer.append(ev["token"])
            elif ev.get("reset"):
                answer.clear()
            elif "step" in ev:
                steps.append(ev["step"])
            elif ev.get("done"):
                done = ev
        return {"answer": "".join(answer), "sources": done.get("sources", []),
                "meta": done.get("meta", {}), "steps": steps}

    def forget(self, thread_id: str) -> None:
        """Free a thread's in-memory conversation (the database keeps the messages)."""
        try:
            self.checkpointer.delete_thread(thread_id)
        except Exception:
            log.debug("could not delete thread %s", thread_id, exc_info=True)
