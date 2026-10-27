"""Embeddings via Cloudflare Workers AI (BGE-M3)."""
from __future__ import annotations

import logging

import numpy as np
import requests
from langchain_core.embeddings import Embeddings
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .errors import UserError

log = logging.getLogger(__name__)

BATCH = 32
MAX_CHARS = 8000


class EmbeddingClient:
    def __init__(self, settings, session: requests.Session | None = None) -> None:
        self._s = settings
        self._url = (
            f"https://api.cloudflare.com/client/v4/accounts/{settings.cf_account_id}"
            f"/ai/run/{settings.embedding_model}"
        )
        if session is None:
            session = requests.Session()
            retry = Retry(
                total=4,
                backoff_factor=1.0,
                status_forcelist=(429, 500, 502, 503, 504),
                allowed_methods=frozenset({"POST"}),
                respect_retry_after_header=True,
            )
            session.mount("https://", HTTPAdapter(max_retries=retry))
        self._http = session

    def _call(self, texts: list[str]) -> np.ndarray:
        if not self._s.cf_account_id or not self._s.cf_api_token:
            raise UserError("Embedding service is not configured on the server.")
        try:
            r = self._http.post(
                self._url,
                headers={"Authorization": f"Bearer {self._s.cf_api_token}"},
                json={"text": [t[:MAX_CHARS] for t in texts]},
                timeout=60,
            )
        except requests.RequestException:
            log.exception("embedding request failed")
            raise UserError("Embedding service is unreachable. Try again shortly.")
        if r.status_code != 200:
            log.error("embedding HTTP %s: %s", r.status_code, r.text[:300])
            raise UserError("Embedding service error. Try again shortly.")
        body = r.json()
        result = body.get("result", body)
        data = result.get("data")
        if not data or len(data) != len(texts):
            log.error("unexpected embedding response shape")
            raise UserError("Embedding service returned an unexpected response.")
        return np.asarray(data, dtype=np.float32)

    def embed(self, texts: list[str]) -> np.ndarray:
        parts = [self._call(texts[i : i + BATCH]) for i in range(0, len(texts), BATCH)]
        mat = np.vstack(parts)
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        return mat / np.clip(norms, 1e-12, None)

    def embed_query(self, text: str) -> np.ndarray:
        return self.embed([text])[0]


class BGEEmbeddings(Embeddings):
    """LangChain `Embeddings` backed by Cloudflare Workers AI BGE-M3 (normalised vectors)."""

    def __init__(self, client: EmbeddingClient) -> None:
        self.client = client

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self.client.embed(texts).tolist()

    def embed_query(self, text: str) -> list[float]:
        return self.client.embed_query(text).tolist()
