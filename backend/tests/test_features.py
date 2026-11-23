"""Generate tools, answer styles, scoped chat, daily budget, chat cap and upload guards."""
import io
import json
import zipfile

import pytest
from conftest import FakeEmbeddings, FakeTranscriber, FakeWeb, H, Script, new_notebook, upload, wait_ready
from langchain_core.runnables import RunnableLambda

from app.config import Settings
from app.db import Repo
from app.factory import create_app
from app.generate import sample_evenly


def events_of(resp):
    return [json.loads(x[6:]) for x in resp.get_data(as_text=True).split("\n\n") if x.startswith("data: ")]


def add_note(client, sid, name="notes.md", text=b"# Closures\nA closure remembers variables from its outer scope. " * 3):
    r = upload(client, sid, name, text)
    doc = wait_ready(client, sid, r.get_json()["document"]["id"])
    assert doc["status"] == "ready"
    return doc["id"]


def generate(client, sid, kind, **extra):
    return client.post("/api/generate", headers=H(sid), json={"kind": kind, **extra})


# ------------------------------------------------------------------ Studio tools
@pytest.mark.parametrize("kind,expected", [
    ("briefing", "Briefing of the material [S1]."),
    ("study_guide", "Study guide for the material [S1]."),
    ("faq", "**What is a closure?** A function with memory [S1]."),
    ("timeline", "- **Step 1** - closures are created [S1]"),
])
def test_markdown_tools_stream_and_are_saved(client, sid, kind, expected):
    add_note(client, sid)
    ev = events_of(generate(client, sid, kind))
    assert [e["step"]["id"] for e in ev if "step" in e] == ["read", kind]
    assert "".join(e.get("token", "") for e in ev) == expected
    done = ev[-1]
    assert done["done"] and done["sources"][0]["title"] == "notes.md" and done["sources"][0]["text"]
    saved = done["output"]
    assert saved["kind"] == kind and saved["content"]["markdown"] == expected
    assert client.get("/api/notebook", headers=H(sid)).get_json()["outputs"][0]["id"] == saved["id"]


def test_quiz_drops_invalid_questions(client, sid):
    add_note(client, sid)
    ev = events_of(generate(client, sid, "quiz"))
    quiz = next(e["quiz"] for e in ev if "quiz" in e)
    assert [q["question"] for q in quiz["questions"]] == ["What do closures capture?"]
    assert quiz["questions"][0]["answer_index"] == 0 and ev[-1]["output"]["content"]["quiz"] == quiz


def test_flashcards_and_mindmap_are_cleaned(client, sid):
    add_note(client, sid)
    cards = next(e["flashcards"] for e in events_of(generate(client, sid, "flashcards")) if "flashcards" in e)
    assert cards == [{"front": "Closure", "back": "A function plus its outer scope."}]
    tree = next(e["mindmap"] for e in events_of(generate(client, sid, "mindmap")) if "mindmap" in e)
    assert tree == {"title": "Closures", "branches": [{"label": "Scope", "children": ["lexical", "outer"]}]}


def test_suggested_questions_are_cleaned_and_not_saved(client, sid):
    add_note(client, sid)
    ev = events_of(generate(client, sid, "questions"))
    assert next(e["questions"] for e in ev if "questions" in e) == ["What is a closure?", "Why use recursion?"]
    assert "output" not in ev[-1]
    assert client.get("/api/notebook", headers=H(sid)).get_json()["outputs"] == []


def test_output_can_be_deleted(client, sid):
    add_note(client, sid)
    out = events_of(generate(client, sid, "briefing"))[-1]["output"]
    assert client.delete(f"/api/outputs/{out['id']}", headers=H(sid)).status_code == 200
    assert client.delete(f"/api/outputs/{out['id']}", headers=H(sid)).status_code == 404


def test_note_can_be_created_edited_and_reopened(client, sid):
    created = client.post("/api/notes", headers=H(sid), json={"markdown": "# Outline"})
    assert created.status_code == 201
    note = created.get_json()["output"]
    assert note["kind"] == "note" and note["title"] == "Untitled note"
    path = f"/api/notes/{note['id']}"
    body = {"title": "Revision notes", "markdown": "**Lexical scope**"}
    other = new_notebook(client)
    assert client.patch(path, headers=H(other), json=body).status_code == 404
    edited = client.patch(path, headers=H(sid), json=body).get_json()["output"]
    assert edited["title"] == body["title"] and edited["content"]["markdown"] == body["markdown"]
    assert client.get("/api/notebook", headers=H(sid)).get_json()["outputs"] == [edited]


def test_note_saved_from_chat_keeps_its_citations(client, sid, repo):
    add_note(client, sid)
    answer = client.post("/api/chat", headers=H(sid), json={"question": "What is a closure?"}).get_json()
    assert answer["sources"]
    body = {"message_id": answer["meta"]["message_id"]}
    assert client.post("/api/notes", headers=H(new_notebook(client)), json=body).status_code == 404
    note = client.post("/api/notes", headers=H(sid), json=body).get_json()["output"]
    assert note["content"] == {"markdown": answer["answer"], "sources": answer["sources"]}
    edited = client.patch(f"/api/notes/{note['id']}", headers=H(sid),
                          json={"title": "Summary", "markdown": "Revised [S1]"}).get_json()["output"]
    assert edited["content"]["sources"] == answer["sources"]
    for i in range(35):
        repo.add_output(sid, "briefing", f"Briefing {i}", {"markdown": "Generated"}, keep=2)
    assert {output["id"] for output in client.get("/api/notebook", headers=H(sid)).get_json()["outputs"]} >= {note["id"]}


def test_generate_validation(client, sid):
    assert generate(client, sid, "poem").get_json()["error"]["code"] == "bad_kind"
    assert generate(client, sid, "briefing").get_json()["error"]["code"] == "empty_library"
    assert client.post("/api/generate", json={"kind": "briefing"}).status_code == 401


def test_generate_can_be_limited_to_selected_documents(client, sid, script):
    a = add_note(client, sid, "a.md", b"# Alpha\nAlpha facts about closures. " * 4)
    add_note(client, sid, "b.md", b"# Beta\nBeta facts about recursion. " * 4)
    events_of(generate(client, sid, "briefing", doc_ids=[a]))  # consume the stream
    seen = script.calls_of("briefing")[0]
    assert "Alpha" in seen["sources"] and "Beta" not in seen["sources"] and seen["titles"] == "a.md"


def test_studio_focus_reaches_model_and_is_saved(client, sid, script):
    doc_id = add_note(client, sid)
    done = events_of(generate(client, sid, "study_guide", doc_ids=[doc_id], focus="  lexical scope  "))[-1]
    assert done["output"]["content"]["focus"] == "lexical scope"
    seen = script.calls_of("study_guide")[0]
    assert seen["titles"] == "notes.md\nRequested focus: lexical scope"
    assert "A closure remembers variables" in seen["sources"]
    saved = client.get("/api/notebook", headers=H(sid)).get_json()["outputs"]
    assert saved[0]["content"]["focus"] == "lexical scope"
    assert generate(client, sid, "study_guide", focus=[]).get_json()["error"]["code"] == "bad_focus"


def test_studio_retries_empty_markdown_before_saving(client, sid, monkeypatch):
    add_note(client, sid)
    chains = client.application.extensions["rag"].generate._chains
    responses = iter(("  ", "## Overview\nA closure remembers scope. 【S1】"))
    monkeypatch.setattr(chains, "briefing", RunnableLambda(lambda _: next(responses)))

    events = events_of(generate(client, sid, "briefing"))
    assert [e["step"]["id"] for e in events if "step" in e] == ["read", "briefing", "retry"]
    assert events[-1]["output"]["content"]["markdown"].startswith("## Overview")
    assert [source["id"] for source in events[-1]["output"]["content"]["sources"]] == ["S1"]


def test_studio_reports_unusable_output_without_saving(client, sid, monkeypatch):
    add_note(client, sid)
    chains = client.application.extensions["rag"].generate._chains
    monkeypatch.setattr(chains, "quiz", RunnableLambda(lambda _: {"questions": []}))

    events = events_of(generate(client, sid, "quiz"))
    assert "Couldn't create a usable quiz" in events[-1]["error"]
    assert not any("done" in event for event in events)
    assert client.get("/api/notebook", headers=H(sid)).get_json()["outputs"] == []


def test_sample_evenly_keeps_whole_range():
    from langchain_core.documents import Document
    passages = [Document(page_content=f"{i:03d}" + "x" * 97) for i in range(100)]  # 10,000 chars
    picked = sample_evenly(passages, 2500)
    assert 20 <= len(picked) <= 26
    assert picked[0].page_content.startswith("000") and int(picked[-1].page_content[:3]) >= 90
    assert sample_evenly(passages, 50_000) == passages


# ------------------------------------------------------------------ answer styles + scoped chat
def test_style_reaches_the_prompt_and_is_validated(client, sid, script):
    add_note(client, sid)
    client.post("/api/chat", headers=H(sid), json={"question": "What is a closure?", "mode": "exam"})
    assert "exam-revision" in script.calls_of("generate")[0]["style"]
    client.post("/api/chat", headers=H(sid), json={"question": "What is a closure again?"})
    assert script.calls_of("generate")[1]["style"] == ""
    bad = client.post("/api/chat", headers=H(sid), json={"question": "q", "mode": "pirate"})
    assert bad.get_json()["error"]["code"] == "bad_mode"


def test_chat_can_be_limited_to_selected_documents(client, sid):
    a = add_note(client, sid, "a.md", b"# Alpha\nClosures capture scope. " * 4)
    add_note(client, sid, "b.md", b"# Beta\nClosures also matter here. " * 4)
    r = client.post("/api/chat", headers=H(sid), json={"question": "closures", "doc_ids": [a]})
    assert {s["title"] for s in r.get_json()["sources"]} == {"a.md"}


def test_regenerate_replaces_latest_answer_in_saved_chat(client, sid, script):
    add_note(client, sid)
    script.generate_texts = ["First answer [S1].", "Updated answer [S1].", "Follow-up answer [S1]."]
    question = {"question": "What is a closure?"}
    initial = events_of(client.post("/api/chat/stream", headers=H(sid), json=question))[-1]
    answer_id = initial["meta"]["message_id"]
    retry = {**question, "replace_answer_id": answer_id}
    updated = events_of(client.post("/api/chat/stream", headers=H(sid), json=retry))[-1]
    assert updated["done"] and updated["meta"]["message_id"] == answer_id
    messages = client.get("/api/notebook", headers=H(sid)).get_json()["messages"]
    assert [m["message"] for m in messages] == [question["question"], "Updated answer [S1]."]
    client.post("/api/chat", headers=H(sid), json={"question": "What is lexical scope?"})
    assert client.post("/api/chat/stream", headers=H(sid), json=retry).status_code == 409


# ------------------------------------------------------------------ guards
def make_client(script, **overrides):
    settings = Settings(rate_limit_enabled=False, **overrides)
    app = create_app(settings, embeddings=FakeEmbeddings(), chains=script.chains(settings),
                     web=FakeWeb(), transcriber=FakeTranscriber(), repo=Repo("sqlite://"))
    return app.test_client()


def test_daily_budget_stops_chat_and_generate():
    client = make_client(Script(), daily_chat_limit=1, daily_generate_limit=1)
    sid = new_notebook(client)
    add_note(client, sid)
    ok = client.post("/api/chat", headers=H(sid), json={"question": "closures?"})
    assert ok.status_code == 200
    blocked = client.post("/api/chat", headers=H(sid), json={"question": "closures again?"})
    assert blocked.status_code == 429 and blocked.get_json()["error"]["code"] == "daily_limit"
    assert generate(client, sid, "briefing").status_code == 200
    assert generate(client, sid, "quiz").status_code == 429


def test_zip_bomb_docx_is_rejected(client, sid):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", b"0" * (210 * 1024 * 1024))  # compresses to ~200 KB
    r = upload(client, sid, "bomb.docx", buf.getvalue())
    doc = wait_ready(client, sid, r.get_json()["document"]["id"])
    assert doc["status"] == "error" and "too large" in doc["message"]


def test_root_and_health(client):
    assert client.get("/").get_json()["status"] == "ok"
    assert client.get("/api/config").get_json()["generate"] == [
        "briefing", "study_guide", "faq", "timeline", "mindmap", "flashcards", "quiz", "questions"]


def test_oversize_file_is_rejected_before_queueing():
    client = make_client(Script(), max_upload_mb=1)
    sid = new_notebook(client)
    result = upload(client, sid, "large.txt", b"x" * (1024 * 1024 + 1))
    assert result.status_code == 413
    assert client.get("/api/notebook", headers=H(sid)).get_json()["documents"] == []


def test_non_object_json_is_rejected(client, sid):
    assert client.post("/api/notes", headers=H(sid), json=[]).status_code == 400


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://169.254.169.254/latest", "ftp://example.com/x", "http://["])
def test_private_and_non_http_urls_are_rejected(client, sid, url):
    r = client.post("/api/library/url", headers=H(sid), json={"url": url})
    assert r.status_code == 400
