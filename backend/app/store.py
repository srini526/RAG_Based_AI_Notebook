"""Notebooks in memory: documents + a FAISS index per notebook, loaded from the database on demand.

The database (db.py) is the source of truth. This module is a cache: idle notebooks are unloaded
and rebuilt from stored passages and embeddings the next time they are opened.
"""
from __future__ import annotations

import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings

from .faiss_store import FaissStore


@dataclass
class LibraryDoc:
    id: str
    name: str
    kind: str  # pdf | docx | pptx | text | audio | video | youtube | web
    source: str = ""  # original URL, if any
    status: str = "queued"  # queued | processing | ready | error
    message: str = ""
    n_chunks: int = 0
    created_at: float = field(default_factory=time.time)
    meta: dict = field(default_factory=dict)
    guide: dict | None = None  # {"summary": str, "topics": [str], "questions": [str]}

    def public(self) -> dict:
        return {
            "id": self.id, "name": self.name, "kind": self.kind, "source": self.source,
            "status": self.status, "message": self.message, "chunks": self.n_chunks,
            "guide": self.guide,
        }


class Library:
    """One notebook's sources + a FAISS index of their passages. Saves changes through `repo`."""

    def __init__(self, embeddings: Embeddings, nid: str = "", repo=None) -> None:
        self.lock = threading.RLock()
        self.nid = nid
        self.repo = repo
        self.docs: "OrderedDict[str, LibraryDoc]" = OrderedDict()
        self.index = FaissStore(embeddings)
        self._chunk_ids: dict[str, list[str]] = {}
        self.last_access = time.time()

    def new_doc(self, name: str, kind: str, source: str = "", **meta) -> LibraryDoc:
        doc = LibraryDoc(id=uuid.uuid4().hex[:12], name=name, kind=kind, source=source, meta=meta)
        with self.lock:
            self.docs[doc.id] = doc
        return doc

    def add_chunks(self, doc_id: str, documents: list[Document], vectors: np.ndarray) -> None:
        with self.lock:
            doc = self.docs.get(doc_id)
            if doc is None:  # deleted while processing
                return
            for d in documents:
                d.metadata["doc_id"] = doc_id
            if self.repo:  # save first: if the database fails, nothing half-exists in memory
                self.repo.save_source(self.nid, doc, documents, vectors)
            self._chunk_ids[doc_id] = self.index.add_embedded(documents, vectors)
            doc.n_chunks = len(documents)

    def set_guide(self, doc_id: str, guide: dict) -> None:
        with self.lock:
            doc = self.docs.get(doc_id)
            if doc is None:
                return
            doc.guide = guide
            if self.repo:
                self.repo.set_guide(doc_id, guide)

    def restore(self, stored: dict) -> None:
        """Rebuild one source from its database row (see Repo.load_sources)."""
        doc = LibraryDoc(id=stored["id"], name=stored["name"], kind=stored["kind"], source=stored["url"],
                         status="ready", n_chunks=len(stored["passages"]), created_at=stored["created_at"],
                         meta=stored["meta"], guide=stored["guide"])
        passages = [Document(page_content=t, metadata={"loc": loc, "doc_id": doc.id})
                    for t, loc, _ in stored["passages"]]
        with self.lock:
            self.docs[doc.id] = doc
            if passages:
                vectors = np.stack([v for _, _, v in stored["passages"]])
                self._chunk_ids[doc.id] = self.index.add_embedded(passages, vectors)

    def remove_doc(self, doc_id: str) -> bool:
        with self.lock:
            if self.docs.pop(doc_id, None) is None:
                return False
            ids = self._chunk_ids.pop(doc_id, [])
            if ids:
                self.index.delete(ids)
            if self.repo:
                self.repo.delete_source(doc_id)
            return True

    def clear(self) -> None:
        with self.lock:
            self.docs.clear()
            self._chunk_ids.clear()
            self.index.delete(None)
            if self.repo:
                self.repo.clear_sources(self.nid)

    def chunks(self, doc_ids: set[str] | None = None) -> list[Document]:
        """Passages of all ready documents (optionally only `doc_ids`), in reading order."""
        with self.lock:
            out: list[Document] = []
            for did, doc in self.docs.items():
                if doc.status != "ready" or (doc_ids and did not in doc_ids):
                    continue
                for cid in self._chunk_ids.get(did, []):
                    passage = self.index.get(cid)
                    if passage is not None:
                        out.append(passage)
            return out

    def ready_count(self) -> int:
        return sum(1 for d in self.docs.values() if d.status == "ready")

    def busy(self) -> bool:
        return any(d.status in ("queued", "processing") for d in self.docs.values())

    def chunk_total(self) -> int:
        return len(self.index)

    def search(self, query: str, k: int, doc_ids: set[str] | None = None):
        """Cosine search. Returns [(langchain Document, score)]."""
        flt = (lambda md: md.get("doc_id") in doc_ids) if doc_ids else None
        return self.index.similarity_search_with_score(query, k=k, filter=flt)


class NotebookStore:
    """LRU cache of loaded notebooks. Evicting only frees memory; data stays in the database."""

    def __init__(self, embeddings: Embeddings, repo, idle_minutes: int = 60, max_loaded: int = 30,
                 on_evict: Callable[[str], None] | None = None) -> None:
        self._emb = embeddings
        self._repo = repo
        self._idle = idle_minutes * 60
        self._max = max_loaded
        self._on_evict = on_evict
        self._items: "OrderedDict[str, Library]" = OrderedDict()
        self._lock = threading.Lock()

    def _evict(self, nid: str) -> None:
        self._items.pop(nid, None)
        if self._on_evict:
            try:
                self._on_evict(nid)
            except Exception:  # cleanup must never break requests
                pass

    def _make_room(self) -> None:
        now = time.time()
        for nid, lib in list(self._items.items()):
            if now - lib.last_access > self._idle and not lib.busy():
                self._evict(nid)
        for nid, lib in list(self._items.items()):  # least recently used first
            if len(self._items) < self._max:
                break
            if not lib.busy():
                self._evict(nid)

    def get(self, nid: str) -> Library:
        with self._lock:
            lib = self._items.get(nid)
            if lib is None:
                self._make_room()
                lib = Library(self._emb, nid=nid, repo=self._repo)
                for stored in self._repo.load_sources(nid):
                    lib.restore(stored)
                self._items[nid] = lib
            lib.last_access = time.time()
            self._items.move_to_end(nid)
            return lib

    def drop(self, nid: str) -> None:
        """Forget a notebook (e.g. it was deleted)."""
        with self._lock:
            self._evict(nid)

    def __len__(self) -> int:
        return len(self._items)
