"""Persistence for notebooks: SQLAlchemy Core, works on SQLite (default) and Postgres.

Stored: notebooks, sources (+ guide), passages with embeddings, chat messages, Studio outputs.
Embeddings are stored as float16 blobs and re-normalised on load, so reopening a notebook
needs no re-embedding.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
import uuid

import numpy as np
from sqlalchemy import (
    Column,
    Float,
    Integer,
    LargeBinary,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    delete,
    event,
    func,
    insert,
    select,
    update,
)

meta = MetaData()
notebooks = Table(
    "notebooks", meta,
    Column("id", String(32), primary_key=True),
    Column("owner", String(64), index=True, nullable=False),
    Column("title", String(200), nullable=False),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
)
sources = Table(
    "sources", meta,
    Column("id", String(32), primary_key=True),
    Column("notebook_id", String(32), index=True, nullable=False),
    Column("name", String(300), nullable=False),
    Column("kind", String(20), nullable=False),
    Column("url", Text, nullable=False, default=""),
    Column("meta", Text, nullable=False, default="{}"),
    Column("guide", Text),
    Column("n_chunks", Integer, nullable=False, default=0),
    Column("created_at", Float, nullable=False),
)
chunks = Table(
    "chunks", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("source_id", String(32), index=True, nullable=False),
    Column("pos", Integer, nullable=False),
    Column("text", Text, nullable=False),
    Column("loc", Text, nullable=False),
    Column("emb", LargeBinary, nullable=False),
)
messages = Table(
    "messages", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("notebook_id", String(32), index=True, nullable=False),
    Column("role", String(10), nullable=False),  # user | bot
    Column("content", Text, nullable=False),
    Column("extra", Text, nullable=False, default="{}"),
    Column("created_at", Float, nullable=False),
)
outputs = Table(
    "outputs", meta,
    Column("id", String(32), primary_key=True),
    Column("notebook_id", String(32), index=True, nullable=False),
    Column("kind", String(20), nullable=False),
    Column("title", String(200), nullable=False),
    Column("content", Text, nullable=False),
    Column("created_at", Float, nullable=False),
)


def normalise_url(url: str) -> str:
    """Hosted Postgres providers hand out postgres:// or postgresql:// URLs; use the psycopg 3 driver."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def _new_id() -> str:
    return uuid.uuid4().hex


class Repo:
    def __init__(self, url: str) -> None:
        url = normalise_url(url)
        if url in ("sqlite://", "sqlite:///:memory:"):
            # throw-away database (tests): a real temp file, because one shared in-memory
            # connection is not safe to use from several threads
            handle, path = tempfile.mkstemp(prefix="rag_test_", suffix=".db")
            os.close(handle)
            url = f"sqlite:///{path}"
        elif url.startswith("sqlite:///"):
            folder = os.path.dirname(url[len("sqlite:///"):])
            if folder:
                os.makedirs(folder, exist_ok=True)
        self.engine = create_engine(url, pool_pre_ping=True)
        if self.engine.dialect.name == "sqlite":
            @event.listens_for(self.engine, "connect")
            def _sqlite_pragmas(conn, _record):  # several threads read and write: WAL + wait on locks
                cur = conn.cursor()
                cur.execute("PRAGMA journal_mode=WAL")
                cur.execute("PRAGMA synchronous=NORMAL")
                cur.execute("PRAGMA busy_timeout=30000")
                cur.close()
        meta.create_all(self.engine)

    # ------------------------------------------------------------- notebooks
    def count_notebooks(self, owner: str) -> int:
        with self.engine.connect() as c:
            return c.execute(select(func.count()).select_from(notebooks)
                             .where(notebooks.c.owner == owner)).scalar_one()

    def create_notebook(self, owner: str, title: str) -> dict:
        now = time.time()
        row = {"id": _new_id(), "owner": owner, "title": title, "created_at": now, "updated_at": now}
        with self.engine.begin() as c:
            c.execute(insert(notebooks).values(**row))
        return {"id": row["id"], "title": title, "sources": 0, "updated_at": now}

    def list_notebooks(self, owner: str) -> list[dict]:
        count = (select(func.count()).select_from(sources)
                 .where(sources.c.notebook_id == notebooks.c.id).scalar_subquery())
        q = (select(notebooks.c.id, notebooks.c.title, notebooks.c.updated_at, count.label("n"))
             .where(notebooks.c.owner == owner).order_by(notebooks.c.updated_at.desc()))
        with self.engine.connect() as c:
            return [{"id": r.id, "title": r.title, "sources": r.n, "updated_at": r.updated_at}
                    for r in c.execute(q)]

    def get_notebook(self, nid: str, owner: str) -> dict | None:
        with self.engine.connect() as c:
            r = c.execute(select(notebooks).where(notebooks.c.id == nid,
                                                  notebooks.c.owner == owner)).first()
        return {"id": r.id, "title": r.title, "updated_at": r.updated_at} if r else None

    def rename_notebook(self, nid: str, title: str) -> None:
        with self.engine.begin() as c:
            c.execute(update(notebooks).where(notebooks.c.id == nid).values(title=title))

    def touch(self, nid: str) -> None:
        with self.engine.begin() as c:
            c.execute(update(notebooks).where(notebooks.c.id == nid).values(updated_at=time.time()))

    def delete_notebook(self, nid: str) -> None:
        with self.engine.begin() as c:
            sids = select(sources.c.id).where(sources.c.notebook_id == nid)
            c.execute(delete(chunks).where(chunks.c.source_id.in_(sids)))
            for t in (sources, messages, outputs):
                c.execute(delete(t).where(t.c.notebook_id == nid))
            c.execute(delete(notebooks).where(notebooks.c.id == nid))

    def purge_older_than(self, days: int) -> list[str]:
        """Delete notebooks untouched for `days` days (keeps free-tier databases small)."""
        if days <= 0:
            return []
        cutoff = time.time() - days * 86400
        with self.engine.connect() as c:
            old = [r.id for r in c.execute(select(notebooks.c.id).where(notebooks.c.updated_at < cutoff))]
        for nid in old:
            self.delete_notebook(nid)
        return old

    # --------------------------------------------------------------- sources
    def save_source(self, nid: str, doc, passages, vectors: np.ndarray) -> None:
        """Persist one ready source with its passages. `doc` is a LibraryDoc."""
        emb = np.asarray(vectors, dtype=np.float16)
        rows = [{"source_id": doc.id, "pos": i, "text": p.page_content,
                 "loc": json.dumps(p.metadata.get("loc", {})), "emb": emb[i].tobytes()}
                for i, p in enumerate(passages)]
        with self.engine.begin() as c:
            c.execute(delete(chunks).where(chunks.c.source_id == doc.id))
            c.execute(delete(sources).where(sources.c.id == doc.id))
            c.execute(insert(sources).values(
                id=doc.id, notebook_id=nid, name=doc.name[:300], kind=doc.kind, url=doc.source,
                meta=json.dumps(doc.meta), guide=json.dumps(doc.guide) if doc.guide else None,
                n_chunks=len(passages), created_at=doc.created_at))
            if rows:
                c.execute(insert(chunks), rows)
            c.execute(update(notebooks).where(notebooks.c.id == nid).values(updated_at=time.time()))

    def set_guide(self, source_id: str, guide: dict) -> None:
        with self.engine.begin() as c:
            c.execute(update(sources).where(sources.c.id == source_id).values(guide=json.dumps(guide)))

    def delete_source(self, source_id: str) -> None:
        with self.engine.begin() as c:
            c.execute(delete(chunks).where(chunks.c.source_id == source_id))
            c.execute(delete(sources).where(sources.c.id == source_id))

    def clear_sources(self, nid: str) -> None:
        with self.engine.begin() as c:
            sids = select(sources.c.id).where(sources.c.notebook_id == nid)
            c.execute(delete(chunks).where(chunks.c.source_id.in_(sids)))
            c.execute(delete(sources).where(sources.c.notebook_id == nid))

    def load_sources(self, nid: str) -> list[dict]:
        """Sources of a notebook with passages: [{..source fields.., 'passages': [(text, loc, vec)]}]."""
        out = []
        with self.engine.connect() as c:
            for s in c.execute(select(sources).where(sources.c.notebook_id == nid)
                               .order_by(sources.c.created_at)):
                rows = c.execute(select(chunks).where(chunks.c.source_id == s.id)
                                 .order_by(chunks.c.pos)).all()
                passages = []
                for r in rows:
                    vec = np.frombuffer(r.emb, dtype=np.float16).astype(np.float32)
                    norm = np.linalg.norm(vec)
                    passages.append((r.text, json.loads(r.loc), vec / norm if norm else vec))
                out.append({"id": s.id, "name": s.name, "kind": s.kind, "url": s.url,
                            "meta": json.loads(s.meta or "{}"),
                            "guide": json.loads(s.guide) if s.guide else None,
                            "created_at": s.created_at, "passages": passages})
        return out

    # -------------------------------------------------------------- messages
    def add_messages(self, nid: str, rows: list[tuple[str, str, dict]]) -> None:
        now = time.time()
        with self.engine.begin() as c:
            c.execute(insert(messages), [
                {"notebook_id": nid, "role": role, "content": text, "extra": json.dumps(extra),
                 "created_at": now + i * 1e-3} for i, (role, text, extra) in enumerate(rows)])
            c.execute(update(notebooks).where(notebooks.c.id == nid).values(updated_at=now))

    def list_messages(self, nid: str, limit: int = 200) -> list[dict]:
        q = (select(messages).where(messages.c.notebook_id == nid)
             .order_by(messages.c.id.desc()).limit(limit))
        with self.engine.connect() as c:
            rows = list(reversed(c.execute(q).all()))
        out = []
        for r in rows:
            item = {"sender": r.role, "message": r.content}
            item.update(json.loads(r.extra or "{}"))
            out.append(item)
        return out

    def clear_messages(self, nid: str) -> None:
        with self.engine.begin() as c:
            c.execute(delete(messages).where(messages.c.notebook_id == nid))

    # --------------------------------------------------------------- outputs
    def add_output(self, nid: str, kind: str, title: str, content: dict, keep: int = 30) -> dict:
        row = {"id": _new_id(), "notebook_id": nid, "kind": kind, "title": title[:200],
               "content": json.dumps(content), "created_at": time.time()}
        with self.engine.begin() as c:
            c.execute(insert(outputs).values(**row))
            old = [r.id for r in c.execute(
                select(outputs.c.id).where(outputs.c.notebook_id == nid)
                .order_by(outputs.c.created_at.desc()).offset(keep))]
            if old:
                c.execute(delete(outputs).where(outputs.c.id.in_(old)))
            c.execute(update(notebooks).where(notebooks.c.id == nid).values(updated_at=row["created_at"]))
        return {"id": row["id"], "kind": kind, "title": row["title"], "created_at": row["created_at"],
                "content": content}

    def list_outputs(self, nid: str) -> list[dict]:
        q = select(outputs).where(outputs.c.notebook_id == nid).order_by(outputs.c.created_at.desc())
        with self.engine.connect() as c:
            return [{"id": r.id, "kind": r.kind, "title": r.title, "created_at": r.created_at,
                     "content": json.loads(r.content)} for r in c.execute(q)]

    def delete_output(self, nid: str, output_id: str) -> bool:
        with self.engine.begin() as c:
            res = c.execute(delete(outputs).where(outputs.c.id == output_id,
                                                  outputs.c.notebook_id == nid))
        return res.rowcount > 0
