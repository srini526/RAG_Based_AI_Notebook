import json

from conftest import OTHER_OWNER, OWNER, H, new_notebook, upload, wait_ready


def events_of(resp):
    return [json.loads(l[6:]) for l in resp.get_data(as_text=True).split("\n\n") if l.startswith("data: ")]


def test_health_and_headers(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.get_json()["status"] == "ok"
    assert r.get_json()["configured"]["web_search"] is False
    assert r.headers["X-Content-Type-Options"] == "nosniff"


def test_requires_key_and_known_notebook(client, sid):
    r = client.get("/api/library")
    assert r.status_code == 401 and r.get_json()["error"]["code"] == "key_required"
    r = client.get("/api/library", headers=H("0" * 32))
    assert r.status_code == 404 and r.get_json()["error"]["code"] == "not_found"
    assert client.get("/api/library", headers=H(sid, owner=OTHER_OWNER)).status_code == 404


def test_full_flow_text_and_chat(client, sid, script):
    r = upload(client, sid, "notes.md", b"# Closures\nA closure remembers variables from its outer scope. " * 3)
    assert r.status_code == 202
    doc = wait_ready(client, sid, r.get_json()["document"]["id"])
    assert doc["status"] == "ready" and doc["chunks"] >= 1

    r = client.post("/api/chat", headers=H(sid), json={"question": "What is a closure?"})
    body = r.get_json()
    assert r.status_code == 200 and "[S1]" in body["answer"]
    assert body["sources"][0]["title"] == "notes.md" and body["sources"][0]["locator"] == "Closures"
    assert [s["id"] for s in body["steps"]][:3] == ["analyze", "retrieve", "grade"]
    gen_in = script.calls_of("generate")[0]
    assert "closure" in gen_in["sources"].lower() and "What is a closure?" == gen_in["question"]


def test_stream_chat_emits_steps_tokens_done(client, sid):
    r = upload(client, sid, "a.txt", b"Mitochondria produce ATP for the cell. " * 5)
    wait_ready(client, sid, r.get_json()["document"]["id"])
    r = client.post("/api/chat/stream", headers=H(sid), json={"question": "What produces ATP?", "chat_id": "c1"})
    assert r.mimetype == "text/event-stream"
    ev = events_of(r)
    steps = [e["step"]["id"] for e in ev if "step" in e]
    assert steps == ["analyze", "retrieve", "grade", "generate", "self_check"]
    assert "".join(e.get("token", "") for e in ev) == "Answer from docs [S1]."
    assert ev[-1]["done"] and ev[-1]["sources"][0]["id"] == "S1" and ev[-1]["meta"]["mode"] == "library"


def test_chat_memory_lives_in_the_notebook_and_can_be_cleared(client, sid, script):
    r = upload(client, sid, "a.txt", b"Closures remember scope. " * 10)
    wait_ready(client, sid, r.get_json()["document"]["id"])

    def ask(q):
        return client.post("/api/chat", headers=H(sid), json={"question": q})

    ask("first question about closures")
    ask("and the second one")
    assert [len(i["history"]) for i in script.calls_of("analyze")] == [0, 2]
    assert client.delete("/api/chat", headers=H(sid)).status_code == 200
    ask("a fresh start")
    assert len(script.calls_of("analyze")[-1]["history"]) == 0
    assert [m["message"] for m in client.get("/api/notebook", headers=H(sid)).get_json()["messages"]][::2] == ["a fresh start"]


def test_video_upload_gets_timestamps(client, sid):
    r = upload(client, sid, "lecture.mp4", b"\x00\x00fake")
    d = wait_ready(client, sid, r.get_json()["document"]["id"])
    assert d["status"] == "ready" and d["kind"] == "video"
    out = client.post("/api/chat", headers=H(sid), json={"question": "closure scope"}).get_json()
    assert out["sources"][0]["locator"] == "0:00 – 0:11"


def test_chat_needs_documents(client, sid):
    r = client.post("/api/chat", headers=H(sid), json={"question": "hi"})
    assert r.status_code == 400 and r.get_json()["error"]["code"] == "empty_library"


def test_validation(client, sid):
    assert upload(client, sid, "evil.exe", b"MZ").status_code == 415
    assert client.post("/api/library/file", headers=H(sid)).status_code == 400
    assert client.post("/api/chat", headers=H(sid), json={"question": " "}).status_code == 400
    assert client.post("/api/chat", headers=H(sid), json={"question": "x" * 2001}).status_code == 400
    assert client.post("/api/chat", headers=H(sid), json={"question": "q", "chat_id": "../x"}).status_code in (400,)


def test_ssrf_url_rejected(client, sid):
    for url in ("http://127.0.0.1:5000/", "http://169.254.169.254/", "file:///etc/passwd"):
        r = client.post("/api/library/url", headers=H(sid), json={"url": url})
        assert r.status_code == 400, url


def test_bad_file_reports_error_status(client, sid):
    r = upload(client, sid, "broken.pdf", b"nope")
    d = wait_ready(client, sid, r.get_json()["document"]["id"])
    assert d["status"] == "error" and d["message"]


def test_delete_and_clear_and_limit(client, sid):
    ids = []
    for i in range(4):
        r = upload(client, sid, f"n{i}.txt", f"unique text number {i} ".encode() * 20)
        ids.append(r.get_json()["document"]["id"])
    assert upload(client, sid, "n5.txt", b"x").get_json()["error"]["code"] == "library_full"
    assert client.delete(f"/api/library/{ids[0]}", headers=H(sid)).status_code == 200
    assert client.delete(f"/api/library/{ids[0]}", headers=H(sid)).status_code == 404
    assert client.delete("/api/library", headers=H(sid)).status_code == 200
    assert client.get("/api/library", headers=H(sid)).get_json()["documents"] == []


def test_notebooks_are_isolated(client):
    a, b = new_notebook(client), new_notebook(client)
    other = new_notebook(client, owner=OTHER_OWNER)
    wait_ready(client, a, upload(client, a, "a.txt", b"secret alpha " * 20).get_json()["document"]["id"])
    assert client.get("/api/library", headers=H(b)).get_json()["documents"] == []
    assert client.post("/api/chat", headers=H(b), json={"question": "alpha"}).status_code == 400
    assert client.get("/api/library", headers=H(a, owner=OTHER_OWNER)).status_code == 404
    assert len(client.get("/api/notebooks", headers={"X-Owner-Key": OWNER}).get_json()["notebooks"]) == 2
    assert [n["id"] for n in client.get("/api/notebooks", headers={"X-Owner-Key": OTHER_OWNER}).get_json()["notebooks"]] == [other]
