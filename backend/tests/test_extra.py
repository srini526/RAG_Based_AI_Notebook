from conftest import FakeEmbeddings, FakeTranscriber, FakeWeb, H, Script, new_notebook, wait_ready

from app import webpage
from app.config import Settings
from app.db import Repo
from app.factory import create_app

ARTICLE = ("<html><head><title>Closures explained</title></head><body><article>"
           + "".join(f"<p>Paragraph {i}: a closure is a function that remembers variables from the scope "
            f"where it was defined, which is example number {i} of this idea in JavaScript.</p>" for i in range(8))
           + "</article></body></html>").encode()


def test_web_page_ingest(client, sid, monkeypatch):
    monkeypatch.setattr("app.ingest.assert_public_url", lambda u: u)
    monkeypatch.setattr(webpage, "fetch", lambda url: (ARTICLE, "text/html", url, "utf-8"))
    r = client.post("/api/library/url", headers=H(sid), json={"url": "https://example.com/closures"})
    assert r.status_code == 202
    d = wait_ready(client, sid, r.get_json()["document"]["id"])
    assert d["status"] == "ready" and d["name"] == "Closures explained", d
    out = client.post("/api/chat", headers=H(sid), json={"question": "what is a closure"}).get_json()
    assert out["sources"][0]["url"] == "https://example.com/closures"
    dup = client.post("/api/library/url", headers=H(sid), json={"url": "https://example.com/closures"})
    assert dup.status_code == 409


def test_youtube_captions_path(client, sid, monkeypatch):
    segs = [(i * 4.0, i * 4.0 + 4, f"caption line {i} about recursion and base cases") for i in range(60)]
    monkeypatch.setattr("app.ingest_graph.fetch_captions", lambda vid, proxy="": segs)
    monkeypatch.setattr("app.ingest_graph.fetch_title", lambda vid, proxy="": "Recursion 101")
    r = client.post("/api/library/url", headers=H(sid),
                    json={"url": "https://youtu.be/dQw4w9WgXcQ"})
    d = wait_ready(client, sid, r.get_json()["document"]["id"])
    assert d["status"] == "ready" and d["name"] == "Recursion 101" and d["chunks"] >= 2
    src = client.post("/api/chat", headers=H(sid), json={"question": "recursion base cases"}).get_json()["sources"][0]
    assert src["url"].startswith("https://www.youtube.com/watch?v=dQw4w9WgXcQ")


def test_youtube_falls_back_to_audio(client, sid, monkeypatch):
    called = {}
    monkeypatch.setattr("app.ingest_graph.fetch_captions", lambda vid, proxy="": None)
    monkeypatch.setattr("app.ingest_graph.fetch_title", lambda vid, proxy="": "No captions")
    monkeypatch.setattr("app.ingest_graph.download_audio", lambda vid, wd, s: called.setdefault("dl", "/x.mp3"))
    r = client.post("/api/library/url", headers=H(sid), json={"url": "https://youtu.be/dQw4w9WgXcQ"})
    d = wait_ready(client, sid, r.get_json()["document"]["id"])
    assert called["dl"] and d["status"] == "ready"


def test_rate_limit_and_cors():
    st = Settings(rate_limit_chat="2 per minute", allowed_origins=("https://app.example.com",))
    app = create_app(st, embeddings=FakeEmbeddings(), chains=Script().chains(st), web=FakeWeb(),
                     transcriber=FakeTranscriber(), repo=Repo("sqlite://"))
    c = app.test_client()
    sid = new_notebook(c)
    codes = [c.post("/api/chat", headers=H(sid), json={"question": "q"}).status_code for _ in range(4)]
    assert codes[:2] == [400, 400] and codes[2:] == [429, 429]  # 400 = empty library, then throttled
    ok = c.get("/api/health", headers={"Origin": "https://app.example.com"})
    bad = c.get("/api/health", headers={"Origin": "https://evil.example"})
    assert ok.headers.get("Access-Control-Allow-Origin") == "https://app.example.com"
    assert "Access-Control-Allow-Origin" not in bad.headers
