"""Agentic RAG as a LangGraph state machine.

    START -> analyze --direct--> answer_direct ----------------------------+
                |                                                          |
                +--library--> retrieve -> grade --relevant--> rerank -> generate -> self_check --ok--> finalize -> END
                                 ^           |                             ^               |retry (max 1)
                                 |           +--none, tries left--> rewrite +---------------+
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
import re
from dataclasses import dataclass
from typing import Annotated, Iterator, TypedDict

from langchain_core.documents import Document
from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, RemoveMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.runtime import Runtime
from langgraph.types import StreamWriter

from . import prompts
from .answer import build_sources, cited_only, format_context, invalid_citations
from .chains import STUDIO_TOOLS, Analysis, Chains, Grades, GroundingCheck
from .errors import UserError
from .generate import TITLES
from .store import Library
from .studio_intent import detect_studio_request

log = logging.getLogger(__name__)

WEB_PREFIX = "> 🌐 *Nothing relevant in your library, so this answer comes from a web search.*\n\n"
WARN_FOOTER = "\n\n> ⚠️ *Some details may not be fully supported by the sources above. Please verify.*"

STEP_LABELS = {
    "analyze": "Understanding your question",
    "retrieve": "Searching your library",
    "retrieve_again": "Searching again with a new query",
    "grade": "Checking which passages are relevant",
    "rerank": "Reranking relevant passages",
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
    style: str          # normal | simple | exam | deep
    standalone: str
    query: str
    tried: list[str]
    attempts: int
    route: str
    tool: str           # Studio tool asked for in chat (route == studio)
    focus: str          # optional topic for that tool
    docs: list[Document]
    relevant: list[Document]
    mode: str           # library | web | direct | studio | none
    context: str
    answer: str
    sources: list[dict]
    regen: int
    issues: str
    verdict: str        # ok | retry | flagged


_SMALL_TALK = re.compile(
    r"^\s*(hi|hello|hey|hola|namaste|thanks|thank you|thx|ok|okay|cool|bye|good (morning|evening|night)"
    r"|who are you|what can you do|help)\b[\s!.?]*$", re.I)


def _is_small_talk(text: str) -> bool:
    return len(text) <= 40 and bool(_SMALL_TALK.match(text))


def _describe(content: dict) -> str:
    """A few words on what was made, e.g. " with 8 questions"."""
    if content.get("quiz"):
        return f" with {len(content['quiz']['questions'])} questions"
    if content.get("flashcards"):
        return f" with {len(content['flashcards'])} cards"
    if content.get("mindmap"):
        return f" with {len(content['mindmap']['branches'])} branches"
    words = len(content.get("markdown", "").split())
    return f" (about {words} words)" if words else ""


def _history(messages: list[AnyMessage], limit: int) -> list[AnyMessage]:
    turns = [m for m in messages if isinstance(m, (HumanMessage, AIMessage)) and m.content]
    return turns[-limit:] if limit else []


def _titles(lib: Library) -> str:
    names = [d.name for d in lib.docs.values() if d.status == "ready"]
    return ", ".join(names)[:600] or "(nothing yet)"


def build_chat_graph(settings, chains: Chains, web, checkpointer, generator=None, budget=None, reranker=None):
    """`generator` (the Studio generator) lets chat hand "make me a quiz" to the Studio model."""
    s = settings

    # ---------------------------------------------------------------- nodes
    def analyze(state: ChatState, runtime: Runtime[ChatContext], writer: StreamWriter):
        writer(_step("analyze"))
        question = state["question"]
        lib = runtime.context.lib
        past = _history(state["messages"][:-1], s.max_history_messages)
        tool = focus = ""
        intent = detect_studio_request(question) if generator else None
        if intent:  # "make me a quiz on X": no router call needed
            tool, focus = intent
            res = Analysis(route="studio", query=focus, tool=tool)
        elif s.fast_router and (not past or _is_small_talk(question)):
            # First message has no references to resolve, so no router call is needed.
            res = Analysis(route="direct" if _is_small_talk(question) else "library", query=question)
        else:
            res = chains.safe(
                chains.analyze,
                {"history": past, "question": question, "library_titles": _titles(lib)},
                Analysis(route="library", query=question),
            )
            if isinstance(res, dict):
                res = Analysis(**res)
            if res.route == "studio":  # the router may spot requests the keyword check missed
                if generator and res.tool in STUDIO_TOOLS:
                    tool, focus = res.tool, (res.query or "").strip()
                else:
                    res = Analysis(route="library", query=question)
        query = (res.query or "").strip() or question
        return {
            "route": res.route, "tool": tool, "focus": focus, "standalone": query, "query": query, "tried": [query],
            "attempts": 0, "docs": [], "relevant": [], "mode": "library", "context": "",
            "answer": "", "sources": [], "regen": 0, "issues": "", "verdict": "",
        }

    def retrieve(state: ChatState, runtime: Runtime[ChatContext], writer: StreamWriter):
        again = state.get("attempts", 0) > 0
        writer(_step("retrieve", "retrieve_again" if again else "retrieve", attempt=state.get("attempts", 0)))
        ids = set(state.get("doc_ids") or []) or None

        # Step 2: Retrieval candidate expansion
        candidate_k = (
            max(s.top_k, s.reranker_candidate_k)
            if reranker is not None and s.reranker_enabled
            else s.top_k
        )

        docs = []
        for d, score in runtime.context.lib.search(state["query"], candidate_k, ids):
            md = dict(d.metadata)
            md["score"] = score
            docs.append(Document(page_content=d.page_content, metadata=md))
        return {"docs": docs}

    def grade(state: ChatState, writer: StreamWriter):
        docs = state["docs"]
        if not docs:
            return {"relevant": []}
        if s.grade_mode == "off":
            return {"relevant": docs}
        if s.grade_mode == "score":
            # Step 3: Bypass early score filtering when reranker is active
            if reranker is not None and s.reranker_enabled:
                return {"relevant": docs}
            scores = [round(d.metadata.get("score", 0), 3) for d in docs]
            keep = [d for d in docs if d.metadata.get("score", 0) >= s.min_score]
            log.debug("grade(score): min=%s scores=%s kept=%d", s.min_score, scores, len(keep))
            return {"relevant": keep}
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

    def rerank(state: ChatState, writer: StreamWriter):
        # Step 4: Reranker node definition
        docs = state["relevant"]
        if not reranker or not docs:
            return {}
        writer(_step("rerank"))
        try:
            ranked_docs = reranker.rerank(
                state["query"],
                docs,
                top_k=s.top_k,
            )
            return {"relevant": ranked_docs}
        except Exception:
            log.exception("Reranking failed; using original retrieval order")
            return {"relevant": docs[:s.top_k]}

    def after_grade(state: ChatState) -> str:
        if state["relevant"]:
            return "rerank"
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
        answer = state["answer"].removeprefix(WEB_PREFIX)
        regen = state.get("regen", 0)

        # 1) free, deterministic check: every [S#] must point at a passage the model was given
        bad = invalid_citations(answer, state["sources"])
        if bad:
            log.warning("answer cites unknown sources: %s", bad)
            issues = (f"The answer cites {', '.join(bad)}, which do not exist. "
                      f"Only {', '.join(x['id'] for x in state['sources'])} are available.")
            if regen < 1:
                writer(_step("self_check"))
                return {"verdict": "retry", "issues": issues, "regen": regen + 1}

        # 2) LLM fact-check, only where it pays off: web answers and longer answers
        worth = state["mode"] == "web" or len(answer) >= s.self_check_min_chars
        if not s.self_check or not worth:
            return {"verdict": "ok", "issues": ""}
        writer(_step("self_check"))
        res = chains.safe(
            chains.check,
            {"sources": state["context"], "answer": answer},
            GroundingCheck(grounded=True),
        )
        if isinstance(res, dict):
            res = GroundingCheck(**res)
        if res.grounded:
            return {"verdict": "ok", "issues": ""}
        if regen < 1:
            return {"verdict": "retry", "issues": res.issues, "regen": regen + 1}
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

    def studio(state: ChatState, runtime: Runtime[ChatContext], writer: StreamWriter):
        """Hand the request to the Studio generator (its own model) and save the result as a Studio item."""
        kind = state["tool"]
        title = TITLES[kind]
        ids = set(state.get("doc_ids") or []) or None
        writer({"step": {"id": "studio", "label": f"Creating your {title.lower()} in Studio"}})
        content: dict = {}
        text: list[str] = []
        sources: list[dict] = []
        try:
            if budget:
                budget.spend("generate")
            for ev in generator.stream(runtime.context.lib, kind, ids, state.get("focus", "")):
                if "step" in ev:
                    writer(ev)
                text.append(ev.get("token", ""))
                for key in ("quiz", "flashcards", "mindmap"):
                    if key in ev:
                        content[key] = ev[key]
                if ev.get("done"):
                    sources = ev.get("sources", [])
        except UserError as e:
            msg = f"I couldn't create that {title.lower()}. {e}"
            writer({"token": msg})
            return {"answer": msg, "sources": [], "mode": "none"}
        if any(text):
            content["markdown"] = "".join(text)
            content["sources"] = sources
        msg = f"I've created your **{title}**{_describe(content)}. Open it in Studio to read or study it."
        writer({"token": msg})
        writer({"studio_result": {"kind": kind, "content": content}})
        return {"answer": msg, "sources": [], "mode": "studio"}

    def not_found(state: ChatState, writer: StreamWriter):
        tail = ", and a web search didn't turn up anything usable" if web.available else ""
        msg = (f"I couldn't find anything about that in your library{tail}.\n\n"
               "Try rephrasing the question, or add a document, video or link that covers it.")
        writer({"token": msg})
        return {"answer": msg, "sources": [], "mode": "none"}

    def finalize(state: ChatState, writer: StreamWriter):
        answer = state["answer"]
        sources = cited_only(answer, state["sources"]) if state["sources"] else []
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
                     ("rerank", rerank), ("rewrite", rewrite), ("web_search", web_search),
                     ("generate", generate), ("self_check", self_check),
                     ("answer_direct", answer_direct), ("studio", studio),
                     ("not_found", not_found), ("finalize", finalize)]:
        g.add_node(name, fn)

    g.add_edge(START, "analyze")
    g.add_conditional_edges("analyze", lambda st: {"direct": "answer_direct", "studio": "studio"}.get(st["route"], "retrieve"),
                            ["answer_direct", "studio", "retrieve"])
    g.add_edge("retrieve", "grade")
    g.add_conditional_edges("grade", after_grade, ["rerank", "rewrite", "web_search", "not_found"])
    g.add_edge("rerank", "generate")
    g.add_edge("rewrite", "retrieve")
    g.add_conditional_edges("web_search", after_web, ["generate", "not_found"])
    g.add_edge("generate", "self_check")
    g.add_conditional_edges("self_check", after_check, ["generate", "finalize"])
    for terminal in ("answer_direct", "studio", "not_found"):
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
        studio_result = None
        for ev in self.stream(lib, thread_id, question, doc_ids, style, history):
            if "token" in ev:
                answer.append(ev["token"])
            elif ev.get("reset"):
                answer.clear()
            elif "step" in ev:
                steps.append(ev["step"])
            elif "studio_result" in ev:
                studio_result = ev["studio_result"]
            elif ev.get("done"):
                done = ev
        result = {"answer": "".join(answer), "sources": done.get("sources", []),
                  "meta": done.get("meta", {}), "steps": steps}
        if studio_result:
            result["studio_result"] = studio_result
        return result

    def forget(self, thread_id: str) -> None:
        """Free a thread's in-memory conversation (the database keeps the messages)."""
        try:
            self.checkpointer.delete_thread(thread_id)
        except Exception:
            log.debug("could not delete thread %s", thread_id, exc_info=True)