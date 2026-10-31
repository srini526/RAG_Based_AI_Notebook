"""Behaviour of the agentic RAG graph, driven by scripted chains (no network)."""
import numpy as np
import pytest
from conftest import FakeEmbeddings, FakeWeb, Script
from langchain_core.documents import Document
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda
from langgraph.checkpoint.memory import InMemorySaver

from app.chains import Chains
from app.chat_graph import WARN_FOOTER, WEB_PREFIX, ChatService, build_chat_graph
from app.config import Settings
from app.db import Repo
from app.store import Library, NotebookStore

TEXTS = ["Closures capture variables from the surrounding scope.",
         "Mitochondria produce ATP inside the cell.",
         "Recursion needs a base case to terminate."]


def make_lib():
    emb = FakeEmbeddings()
    lib = Library(emb)
    d = lib.new_doc("notes.md", "text")
    d.status = "ready"
    docs = [Document(page_content=t, metadata={"loc": {"kind": "section", "section": f"S{i}"}})
            for i, t in enumerate(TEXTS)]
    lib.add_chunks(d.id, docs, np.asarray(emb.embed_documents(TEXTS), dtype=np.float32))
    return lib, d


def make_service(script=None, web=None, **overrides):
    settings = Settings(**{"rate_limit_enabled": False, **overrides})
    script = script or Script()
    cp = InMemorySaver()
    graph = build_chat_graph(settings, script.chains(settings), web or FakeWeb(), cp)
    return ChatService(graph, cp, settings), script, cp


def run(svc, lib, question, thread="t", **kw):
    return list(svc.stream(lib, thread, question, **kw))


def step_ids(events):
    return [e["step"]["id"] for e in events if "step" in e]


def final(events):
    return next(e for e in events if e.get("done"))


def text_of(events):
    out = ""
    for e in events:
        if e.get("reset"):
            out = ""
        out += e.get("token", "")
    return out


def test_happy_path():
    svc, script, _ = make_service()
    lib, _ = make_lib()
    ev = run(svc, lib, "what are closures?")
    assert step_ids(ev) == ["analyze", "retrieve", "grade", "generate", "self_check"]
    assert text_of(ev) == "Answer from docs [S1]."
    done = final(ev)
    assert done["sources"][0]["title"] == "notes.md" and done["meta"] == {
        "mode": "library", "rewrites": 0, "web": False, "flagged": False}


def test_rewrite_then_success():
    script = Script(); script.grade_plan = [[], [1]]
    svc, _, _ = make_service(script)
    lib, _ = make_lib()
    ev = run(svc, lib, "closures?")
    assert step_ids(ev) == ["analyze", "retrieve", "grade", "rewrite", "retrieve", "grade",
                            "generate", "self_check"]
    labels = [e["step"]["label"] for e in ev if e.get("step", {}).get("id") == "retrieve"]
    assert labels == ["Searching your library", "Searching again with a new query"]
    assert final(ev)["meta"]["rewrites"] == 1
    assert script.calls_of("rewrite")[0]["tried"].startswith("- closures?")


def test_web_fallback_after_max_rewrites():
    script = Script(); script.grade_plan = [[], [], []]
    web = FakeWeb(True, [{"title": "MDN Closures", "url": "https://mdn.dev/c", "content": "A closure is..."}])
    svc, _, _ = make_service(script, web, max_rewrites=2)
    lib, _ = make_lib()
    ev = run(svc, lib, "what is a closure?")
    assert step_ids(ev).count("rewrite") == 2 and "web_search" in step_ids(ev)
    assert text_of(ev).startswith(WEB_PREFIX)
    done = final(ev)
    assert done["meta"]["web"] and done["sources"][0]["external"] and done["sources"][0]["url"] == "https://mdn.dev/c"
    assert "WEB SEARCH" in script.calls_of("generate")[0]["origin"]


def test_not_found_when_web_unavailable_or_empty():
    for web in (FakeWeb(False), FakeWeb(True, [])):
        script = Script(); script.grade_plan = [[], [], []]
        svc, _, _ = make_service(script, web)
        ev = run(svc, make_lib()[0], "quantum chromodynamics")
        assert "couldn't find anything" in text_of(ev) and final(ev)["sources"] == []
        assert script.calls_of("generate") == []


def test_self_check_retry_resets_stream_and_passes_feedback():
    script = Script(); script.check_plan = [False, True]
    script.generate_texts = ["Bad draft [S1].", "Fixed answer [S1]."]
    svc, _, _ = make_service(script)
    ev = run(svc, make_lib()[0], "closures")
    assert any(e.get("reset") for e in ev)
    assert text_of(ev) == "Fixed answer [S1]."
    labels = [e["step"]["label"] for e in ev if "step" in e]
    assert "Rewriting to fix unsupported claims" in labels
    assert "claim X is unsupported" in script.calls_of("generate")[1]["feedback"]
    assert final(ev)["meta"]["flagged"] is False


def test_self_check_flagged_after_one_retry():
    script = Script(); script.check_plan = [False, False]
    svc, _, _ = make_service(script)
    ev = run(svc, make_lib()[0], "closures")
    assert len(script.calls_of("generate")) == 2 and len(script.calls_of("check")) == 2
    assert text_of(ev).endswith(WARN_FOOTER) and final(ev)["meta"]["flagged"] is True


def test_self_check_can_be_disabled():
    svc, script, _ = make_service(self_check=False)
    ev = run(svc, make_lib()[0], "closures")
    assert "self_check" not in step_ids(ev) and script.calls_of("check") == []


def test_grading_can_be_disabled():
    svc, script, _ = make_service(grade_docs=False)
    ev = run(svc, make_lib()[0], "closures")
    assert "grade" not in step_ids(ev) and script.calls_of("grade") == []


def test_direct_route_skips_retrieval():
    svc, script, _ = make_service()
    ev = run(svc, make_lib()[0], "hello there")
    assert step_ids(ev) == ["analyze", "direct"] and text_of(ev) == "Hello! Ask me anything."
    assert final(ev)["sources"] == [] and final(ev)["meta"]["mode"] == "direct"


def test_failing_llm_calls_degrade_gracefully():
    script = Script(); script.fail = {"analyze", "grade", "check"}
    svc, _, _ = make_service(script)
    ev = run(svc, make_lib()[0], "closures")  # router, grader and checker down
    assert text_of(ev) == "Answer from docs [S1]."
    assert final(ev)["sources"]  # top-3 fallback kept the library path alive


def test_memory_per_thread_and_bounded():
    svc, script, cp = make_service(max_history_messages=2)
    lib, _ = make_lib()
    for i in range(6):
        run(svc, lib, f"question {i} about closures", thread="A")
    run(svc, lib, "other chat", thread="B")
    hist = [len(i["history"]) for i in script.calls_of("analyze")]
    assert hist[:4] == [0, 2, 2, 2] and hist[-1] == 0          # window of 2 messages, B isolated
    msgs = svc.graph.get_state({"configurable": {"thread_id": "A"}}).values["messages"]
    assert len(msgs) <= 5                                       # pruned, not growing forever
    svc.forget("A")
    assert svc.graph.get_state({"configurable": {"thread_id": "A"}}).values == {}
    assert not svc.has_thread("A") and svc.has_thread("B")


def test_history_reseeds_a_forgotten_thread():
    svc, script, _ = make_service()
    lib, _ = make_lib()
    saved = [("user", "what is a closure?"), ("bot", "A function with memory [S1].")]
    run(svc, lib, "and why does it matter?", thread="N", history=saved)
    assert len(script.calls_of("analyze")[0]["history"]) == 2
    run(svc, lib, "one more", thread="N", history=saved)         # thread exists now: no double seeding
    assert len(script.calls_of("analyze")[1]["history"]) == 4


def test_notebook_eviction_drops_thread_but_keeps_data():
    svc, _, _ = make_service()
    repo = Repo("sqlite://")
    store = NotebookStore(FakeEmbeddings(), repo, max_loaded=1, on_evict=svc.forget)
    a = repo.create_notebook("o", "A")["id"]
    b = repo.create_notebook("o", "B")["id"]
    run(svc, store.get(a), "hello", thread=a)
    assert svc.graph.get_state({"configurable": {"thread_id": a}}).values
    store.get(b)  # cache holds one notebook: A is unloaded
    assert svc.graph.get_state({"configurable": {"thread_id": a}}).values == {}
    assert store.get(a).nid == a


def test_doc_filter_restricts_retrieval():
    svc, script, _ = make_service()
    lib, d1 = make_lib()
    emb = FakeEmbeddings()
    d2 = lib.new_doc("other.md", "text"); d2.status = "ready"
    lib.add_chunks(d2.id, [Document(page_content="Photosynthesis uses light", metadata={"loc": {}})],
                   np.asarray(emb.embed_documents(["Photosynthesis uses light"]), dtype=np.float32))
    run(svc, lib, "closures", doc_ids={d2.id})
    assert "Photosynthesis" in script.calls_of("generate")[0]["sources"]
    assert "Closures capture" not in script.calls_of("generate")[0]["sources"]


# ---- the real LCEL chains: prompt variables line up with the graph's inputs ---------------
class StubLLM(GenericFakeChatModel):
    structured: dict = {}

    def with_structured_output(self, schema, **kwargs):
        return RunnableLambda(lambda _x: schema(**self.structured[schema.__name__]))


def test_real_chains_wiring():
    llm = StubLLM(messages=iter([AIMessage(content="closures keep scope"),
                                 AIMessage(content="Because of scope [S1]."),
                                 AIMessage(content="Hi there"),
                                 AIMessage(content="B [S1]."), AIMessage(content="G [S1]."),
                                 AIMessage(content="F [S1]."), AIMessage(content="T [S1].")]),
                  structured={"Analysis": {"route": "library", "query": "closure scope"},
                              "Grades": {"relevant": [2]},
                              "GroundingCheck": {"grounded": False, "issues": "bad"},
                              "Quiz": {"questions": [{"question": "Q?", "options": ["a", "b"], "answer_index": 1}]},
                              "SuggestedQuestions": {"questions": ["What is X?"]},
                              "MindMap": {"title": "M", "branches": [{"label": "b", "children": ["c"]}]},
                              "Flashcards": {"cards": [{"front": "f", "back": "b"}]},
                              "SourceGuide": {"summary": "s", "topics": ["t"], "questions": ["q?"]}})
    chains = Chains(Settings(), llm=llm, studio_llm=llm)
    hist = [AIMessage(content="earlier")]
    assert chains.analyze.invoke({"history": hist, "question": "q", "library_titles": "a.pdf"}).query == "closure scope"
    assert chains.grade.invoke({"question": "q", "passages": "[1] x"}).relevant == [2]
    assert chains.check.invoke({"sources": "[S1] x", "answer": "a"}).grounded is False
    assert chains.rewrite.invoke({"question": "q", "tried": "- q"}) == "closures keep scope"
    out = "".join(chains.generate.stream({"origin": "o", "history": hist, "sources": "s",
                                          "feedback": "", "question": "q", "style": ""}))
    assert out.strip() == "Because of scope [S1]."
    assert "".join(chains.chat.stream({"history": hist, "question": "hi", "library_titles": "-"})).strip() == "Hi there"
    gen = {"sources": "[S1] x", "titles": "a.pdf"}
    for name, text in [("briefing", "B"), ("study_guide", "G"), ("faq", "F"), ("timeline", "T")]:
        assert "".join(getattr(chains, name).stream(gen)).strip() == f"{text} [S1]."
    assert chains.mindmap.invoke(gen).branches[0].children == ["c"]
    assert chains.flashcards.invoke(gen).cards[0].front == "f"
    assert chains.guide.invoke(gen).topics == ["t"]
    assert chains.quiz.invoke(gen).questions[0].answer_index == 1
    assert chains.suggest.invoke(gen).questions == ["What is X?"]


def test_unconfigured_chains_raise_user_error():
    from app.errors import UserError
    with pytest.raises(UserError):
        Chains(Settings()).generate.invoke({})
