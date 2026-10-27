"""In-memory FAISS vector store implementing LangChain's VectorStore interface.

Why not langchain_community.vectorstores.FAISS? That package is in sunset mode and has no
standalone replacement yet. This ~100-line adapter keeps the LangChain interface (Documents,
`as_retriever()`) on top of plain `faiss-cpu`, with exact metadata filtering and deletion.
Vectors are expected to be L2-normalised, so inner product == cosine similarity.
"""
from __future__ import annotations

import threading
import uuid
from typing import Any, Callable, Iterable

import faiss
import numpy as np
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_core.vectorstores import VectorStore

MetaFilter = Callable[[dict], bool]


class FaissStore(VectorStore):
    def __init__(self, embedding: Embeddings) -> None:
        self._embedding = embedding
        self._index: faiss.IndexFlatIP | None = None
        self._ids: list[str] = []
        self._docs: dict[str, Document] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------ properties
    @property
    def embeddings(self) -> Embeddings:
        return self._embedding

    def __len__(self) -> int:
        return len(self._ids)

    def get(self, doc_id: str) -> Document | None:
        return self._docs.get(doc_id)

    # ----------------------------------------------------------------- write
    def add_embedded(
        self,
        documents: list[Document],
        vectors: np.ndarray,
        ids: list[str] | None = None,
    ) -> list[str]:
        """Add documents whose embeddings were already computed."""
        vectors = np.ascontiguousarray(vectors, dtype=np.float32)
        if len(documents) != len(vectors):
            raise ValueError("documents and vectors must have the same length")
        ids = ids or [uuid.uuid4().hex for _ in documents]
        with self._lock:
            if self._index is None:
                self._index = faiss.IndexFlatIP(vectors.shape[1])
            self._index.add(vectors)
            self._ids.extend(ids)
            for i, d in zip(ids, documents):
                self._docs[i] = d
        return ids

    def add_texts(self, texts: Iterable[str], metadatas: list[dict] | None = None,
                  *, ids: list[str] | None = None, **kwargs: Any) -> list[str]:
        texts = list(texts)
        docs = [Document(page_content=t, metadata=(metadatas or [{}] * len(texts))[i])
                for i, t in enumerate(texts)]
        vecs = np.asarray(self._embedding.embed_documents(texts), dtype=np.float32)
        return self.add_embedded(docs, vecs, ids)

    def delete(self, ids: list[str] | None = None, **kwargs: Any) -> bool | None:
        with self._lock:
            if ids is None:
                self._index, self._ids, self._docs = None, [], {}
                return True
            drop = set(ids)
            positions = [i for i, x in enumerate(self._ids) if x in drop]
            if not positions:
                return False
            self._index.remove_ids(np.asarray(positions, dtype=np.int64))
            self._ids = [x for x in self._ids if x not in drop]
            for x in drop:
                self._docs.pop(x, None)
            if not self._ids:
                self._index = None
            return True

    # ------------------------------------------------------------------ read
    def search_by_vector(
        self, vector: np.ndarray, k: int = 4, filter: MetaFilter | None = None
    ) -> list[tuple[Document, float]]:
        with self._lock:
            if self._index is None or not self._ids:
                return []
            n = len(self._ids)
            # Exact filtering: libraries are small, so rank everything then filter.
            top = n if filter else min(k, n)
            scores, idx = self._index.search(
                np.ascontiguousarray(vector, dtype=np.float32).reshape(1, -1), top
            )
            out: list[tuple[Document, float]] = []
            for score, i in zip(scores[0], idx[0]):
                if i < 0:
                    continue
                doc = self._docs[self._ids[i]]
                if filter and not filter(doc.metadata):
                    continue
                out.append((doc, float(score)))
                if len(out) == k:
                    break
            return out

    def similarity_search_with_score(self, query: str, k: int = 4,
                                     filter: MetaFilter | None = None, **kwargs: Any):
        vec = np.asarray(self._embedding.embed_query(query), dtype=np.float32)
        return self.search_by_vector(vec, k, filter)

    def similarity_search(self, query: str, k: int = 4, **kwargs: Any) -> list[Document]:
        return [d for d, _ in self.similarity_search_with_score(query, k, **kwargs)]

    @classmethod
    def from_texts(cls, texts: list[str], embedding: Embeddings,
                   metadatas: list[dict] | None = None, **kwargs: Any) -> "FaissStore":
        store = cls(embedding)
        store.add_texts(texts, metadatas)
        return store
