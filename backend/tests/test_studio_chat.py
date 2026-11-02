"""Asking for a Studio tool in chat is handed to the Studio generator and saved as a Studio item."""

import pytest
from conftest import H, Script
from langgraph.checkpoint.memory import InMemorySaver
from test_features import add_note, events_of
from test_graph import final, make_lib, run, step_ids, text_of

from app.chains import Analysis
from app.chat_graph import ChatService, build_chat_graph
from app.config import Settings
from app.generate import Generator
from app.studio_intent import detect_studio_request


# ------------------------------------------------------------------ intent detection
@pytest.mark.parametrize("text,expected", [
    ("make me a quiz", ("quiz", "")),
    ("Create a mind map of this", ("mindmap", "")),
    ("generate flashcards on closures", ("flashcards", "closures")),
    ("quiz me on chapter 2", ("quiz", "chapter 2")),
    ("I want a study guide for the exam on recursion", ("study_guide", "the exam on recursion")),
    ("can you build a timeline of the events?", ("timeline", "the events")),
    ("give me an FAQ about scope", ("faq", "scope")),
    ("write a briefing doc from my notes", ("briefing", "")),
    ("make flashcards from my documents", ("flashcards", "")),
])
def test_requests_for_a_tool_are_detected(text, expected):
    assert detect_studio_request(text) == expected


@pytest.mark.parametrize("text", [
    "what is a mind map?",
    "explain flashcards to me",
    "why do quizzes help learning",
    "how does a closure work",
    "summarize my notes",
    "",
])
def test_questions_are_not_tool_requests(text):
    assert detect_studio_request(text) is None


# ------------------------------------------------------------------ chat graph
def studio_service(script=None, **overrides):
    settings = Settings(rate_limit_enabled=False, fast_router=False, grade_mode="llm",
                        self_check_min_chars=0, **overrides)
    script = script or Script()
    chains = script.chains(settings)
    cp = InMemorySaver()
    graph = build_chat_graph(settings, chains, __import__("conftest").FakeWeb(), cp, Generator(settings, chains))
    return ChatService(graph, cp, settings), script


def test_quiz_request_uses_studio_generator_not_rag():
    svc, script = studio_service()
    ev = run(svc, make_lib()[0], "make me a quiz on closures")
    assert step_ids(ev)[:2] == ["analyze", "studio"]
    result = next(e["studio_result"] for e in ev if "studio_result" in e)
    assert result["kind"] == "quiz" and len(result["content"]["quiz"]["questions"]) == 1
    assert "Quiz" in text_of(ev) and "1 questions" in text_of(ev)
    assert final(ev)["meta"]["mode"] == "studio"
    # no router call, no retrieval/answer chain: only the Studio chain ran
    assert script.calls_of("analyze") == [] and script.calls_of("generate") == []
    assert "closures" in script.calls_of("quiz")[0]["titles"]


@pytest.mark.parametrize("kind,text", [
    ("mindmap", "create a mind map"), ("flashcards", "generate flashcards"),
    ("briefing", "write a briefing document"), ("study_guide", "make a study guide"),
    ("faq", "build an FAQ"), ("timeline", "make a timeline"),
])
def test_every_studio_tool_works_from_chat(kind, text):
    svc, script = studio_service()
    ev = run(svc, make_lib()[0], text)
    result = next(e["studio_result"] for e in ev if "studio_result" in e)
    assert result["kind"] == kind and result["content"]
    assert script.calls_of(kind) and not script.calls_of("generate")


def test_router_llm_can_send_a_follow_up_to_studio():
    script = Script()
    svc, _ = studio_service(script)
    orig = script.chains

    def chains(settings):
        c = orig(settings)
        c.analyze = __import__("langchain_core.runnables", fromlist=["RunnableLambda"]).RunnableLambda(
            lambda inp: Analysis(route="studio", tool="flashcards", query="scope"))
        return c

    script.chains = chains
    svc, _ = studio_service(script)
    lib = make_lib()[0]
    run(svc, lib, "what is a closure?")  # first turn so the router is used on the follow-up
    ev = run(svc, lib, "turn that into something I can revise with")
    assert next(e["studio_result"] for e in ev if "studio_result" in e)["kind"] == "flashcards"


def test_chat_without_generator_still_answers_normally():
    settings = Settings(rate_limit_enabled=False, fast_router=False, grade_mode="llm", self_check_min_chars=0)
    script = Script()
    cp = InMemorySaver()
    svc = ChatService(build_chat_graph(settings, script.chains(settings), __import__("conftest").FakeWeb(), cp),
                      cp, settings)
    ev = run(svc, make_lib()[0], "make me a quiz")
    assert not any("studio_result" in e for e in ev) and "generate" in step_ids(ev)


# ------------------------------------------------------------------ API
def chat_stream(client, sid, question):
    return events_of(client.post("/api/chat/stream", headers=H(sid), json={"question": question}))


def test_chat_request_is_saved_as_a_studio_item_and_linked_from_the_message(client, sid):
    add_note(client, sid)
    ev = chat_stream(client, sid, "make a mind map")
    out = next(e["studio_output"] for e in ev if "studio_output" in e)
    done = ev[-1]
    assert out["kind"] == "mindmap" and out["content"]["mindmap"]["branches"]
    assert done["meta"]["studio"] == {"id": out["id"], "kind": "mindmap", "title": "Mind map"}

    nb = client.get("/api/notebook", headers=H(sid)).get_json()
    assert [o["id"] for o in nb["outputs"]] == [out["id"]]
    assert nb["messages"][-1]["meta"]["studio"]["id"] == out["id"]  # still linked after a reload


def test_non_streaming_chat_also_saves_the_studio_item(client, sid):
    add_note(client, sid)
    r = client.post("/api/chat", headers=H(sid), json={"question": "give me flashcards"}).get_json()
    assert r["output"]["kind"] == "flashcards" and r["meta"]["studio"]["id"] == r["output"]["id"]
    assert "studio_result" not in r


def test_daily_generate_budget_applies_to_chat_requests(tmp_path):
    from conftest import FakeEmbeddings, FakeTranscriber, FakeWeb, new_notebook

    from app.db import Repo
    from app.factory import create_app

    st = Settings(rate_limit_enabled=False, fast_router=False, grade_mode="llm", self_check_min_chars=0,
                  daily_generate_limit=1, database_url="sqlite://")
    app = create_app(st, embeddings=FakeEmbeddings(), chains=Script().chains(st), web=FakeWeb(),
                     transcriber=FakeTranscriber(), repo=Repo("sqlite://"))
    c = app.test_client()
    sid = new_notebook(c)
    add_note(c, sid)
    first = chat_stream(c, sid, "make a quiz")
    assert any("studio_output" in e for e in first)
    second = chat_stream(c, sid, "make a quiz")
    assert any("daily limit" in e.get("error", "") for e in second)
