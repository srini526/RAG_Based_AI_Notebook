"""Notebooks survive restarts: sources, guides, chat, Studio outputs; ownership and limits."""
import numpy as np
from conftest import (
    OTHER_OWNER,
    OWNER,
    FakeEmbeddings,
    FakeTranscriber,
    FakeWeb,
    H,
    Script,
    new_notebook,
    upload,
    wait_ready,
)
from langchain_core.documents import Document

from app.config import Settings
from app.db import Repo, normalise_url
from app.factory import create_app
from app.store import Library, NotebookStore

OK = {"X-Owner-Key": OWNER}


def boot(repo, script=None, **settings):
    """A fresh app process on top of an existing database."""
    st = Settings(rate_limit_enabled=False, **settings)
    app = create_app(st, embeddings=FakeEmbeddings(), chains=(script or Script()).chains(st),
                     web=FakeWeb(), transcriber=FakeTranscriber(), repo=repo)
    return app.test_client()


def sse(resp):
    import json
    return [json.loads(x[6:]) for x in resp.get_data(as_text=True).split("\n\n") if x.startswith("data: ")]


def test_source_guide_is_written_on_ingest(client, sid):
    r = upload(client, sid, "notes.md", b"# Closures\nA closure remembers variables from its outer scope. " * 3)
    doc = wait_ready(client, sid, r.get_json()["document"]["id"])
    assert doc["guide"] == {"summary": "A short guide.", "topics": ["closures", "scope"],
                            "questions": ["What is a closure?"]}


def test_guide_failure_does_not_break_ingest(client, sid, script):
    script.fail.add("guide")
    r = upload(client, sid, "notes.md", b"# Closures\nA closure remembers variables. " * 3)
    doc = wait_ready(client, sid, r.get_json()["document"]["id"])
    assert doc["status"] == "ready" and doc["guide"] is None


def test_everything_survives_a_restart():
    repo = Repo("sqlite://")
    first = boot(repo)
    nid = new_notebook(first)
    r = upload(first, nid, "notes.md", b"# Closures\nA closure remembers variables from its outer scope. " * 3)
    wait_ready(first, nid, r.get_json()["document"]["id"])
    first.post("/api/chat", headers=H(nid), json={"question": "What is a closure?"})
    sse(first.post("/api/generate", headers=H(nid), json={"kind": "briefing"}))

    second = boot(repo)  # new process: empty memory, same database
    detail = second.get("/api/notebook", headers=H(nid)).get_json()
    assert [d["name"] for d in detail["documents"]] == ["notes.md"] and detail["documents"][0]["status"] == "ready"
    assert detail["documents"][0]["guide"]["summary"] == "A short guide."
    assert [m["sender"] for m in detail["messages"]] == ["user", "bot"]
    assert detail["messages"][1]["sources"][0]["text"]
    assert detail["outputs"][0]["kind"] == "briefing"

    # retrieval works again without re-embedding (vectors came from the database)
    answer = second.post("/api/chat", headers=H(nid), json={"question": "closure scope"}).get_json()
    assert answer["sources"][0]["title"] == "notes.md"


def test_conversation_memory_is_reseeded_after_restart():
    repo = Repo("sqlite://")
    first = boot(repo)
    nid = new_notebook(first)
    wait_ready(first, nid, upload(first, nid, "a.txt", b"Closures remember scope. " * 10).get_json()["document"]["id"])
    first.post("/api/chat", headers=H(nid), json={"question": "what is a closure?"})

    script = Script()
    second = boot(repo, script)
    second.post("/api/chat", headers=H(nid), json={"question": "and why does it matter?"})
    assert len(script.calls_of("analyze")[0]["history"]) == 2


def test_delete_source_and_notebook_remove_stored_data(client, repo, sid):
    doc_id = upload(client, sid, "a.txt", b"Closures remember scope. " * 10).get_json()["document"]["id"]
    wait_ready(client, sid, doc_id)
    assert len(repo.load_sources(sid)) == 1
    client.delete(f"/api/library/{doc_id}", headers=H(sid))
    assert repo.load_sources(sid) == []
    client.post("/api/chat", headers=H(sid), json={"question": "x"})
    assert client.delete(f"/api/notebooks/{sid}", headers=H(sid)).status_code == 200
    assert client.get("/api/library", headers=H(sid)).status_code == 404
    assert repo.list_messages(sid) == [] and repo.list_outputs(sid) == []


def test_notebook_crud_ownership_and_limit(client):
    nid = new_notebook(client, title="  My   notes ")
    nbs = client.get("/api/notebooks", headers=OK).get_json()["notebooks"]
    assert nbs[0]["title"] == "My notes" and nbs[0]["sources"] == 0
    assert client.patch(f"/api/notebooks/{nid}", headers=OK, json={"title": "Biology"}).status_code == 200
    assert client.get("/api/notebook", headers=H(nid)).get_json()["notebook"]["title"] == "Biology"
    other = {"X-Owner-Key": OTHER_OWNER}
    assert client.patch(f"/api/notebooks/{nid}", headers=other, json={"title": "hacked"}).status_code == 404
    assert client.delete(f"/api/notebooks/{nid}", headers=other).status_code == 404
    assert client.get("/api/notebooks").status_code == 401
    assert client.post("/api/notebooks", headers={"X-Owner-Key": "not-hex"}, json={}).status_code == 401


def test_notebook_limit_per_owner(repo):
    client = boot(repo, max_notebooks_per_owner=2)
    new_notebook(client), new_notebook(client)
    r = client.post("/api/notebooks", headers=OK, json={"title": "third"})
    assert r.status_code == 400 and r.get_json()["error"]["code"] == "too_many_notebooks"


def test_inactive_notebooks_are_purged(repo):
    old = repo.create_notebook("x" * 64, "old")["id"]
    fresh = repo.create_notebook("x" * 64, "fresh")["id"]
    repo.add_messages(old, [("user", "hi", {})])
    from sqlalchemy import update

    from app.db import notebooks
    with repo.engine.begin() as c:
        c.execute(update(notebooks).where(notebooks.c.id == old).values(updated_at=1.0))
    assert repo.purge_older_than(60) == [old]
    assert repo.get_notebook(old, "x" * 64) is None and repo.get_notebook(fresh, "x" * 64)
    assert repo.list_messages(old) == [] and repo.purge_older_than(0) == []


def test_repo_roundtrip_keeps_vectors_close_and_normalised():
    repo = Repo("sqlite://")
    nid = repo.create_notebook("o", "t")["id"]
    emb = FakeEmbeddings()
    lib = Library(emb, nid=nid, repo=repo)
    doc = lib.new_doc("a.md", "text")
    texts = ["closures capture scope", "mitochondria produce ATP"]
    vecs = np.asarray(emb.embed_documents(texts), dtype=np.float32)
    lib.add_chunks(doc.id, [Document(page_content=t, metadata={"loc": {"kind": "section", "section": "S"}})
                            for t in texts], vecs)
    stored = repo.load_sources(nid)[0]
    assert [t for t, _, _ in stored["passages"]] == texts
    for (_, loc, v), original in zip(stored["passages"], vecs):
        assert loc["section"] == "S" and abs(np.linalg.norm(v) - 1) < 1e-4 and float(v @ original) > 0.999


def test_database_url_normalisation():
    assert normalise_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalise_url("postgresql://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalise_url("sqlite:///x.db") == "sqlite:///x.db"


def test_store_restores_notebook_from_database():
    repo = Repo("sqlite://")
    nid = repo.create_notebook("o", "t")["id"]
    emb = FakeEmbeddings()
    lib = Library(emb, nid=nid, repo=repo)
    doc = lib.new_doc("a.md", "text")
    lib.add_chunks(doc.id, [Document(page_content="closures capture scope", metadata={"loc": {}})],
                   np.asarray(emb.embed_documents(["closures capture scope"]), dtype=np.float32))
    reloaded = NotebookStore(emb, repo).get(nid)
    assert reloaded.ready_count() == 1 and reloaded.search("closures", 1)[0][0].page_content == "closures capture scope"
