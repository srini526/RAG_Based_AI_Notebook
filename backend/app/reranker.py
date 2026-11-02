
"""Document reranking via Cloudflare Workers AI BGE Reranker."""
from __future__ import annotations

import logging

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .errors import UserError

log = logging.getLogger(__name__)

MODEL = "@cf/baai/bge-reranker-base"


class CloudflareReranker:
    def __init__(self, settings, session: requests.Session | None = None) -> None:
        self._settings = settings
        self._url = (
            f"https://api.cloudflare.com/client/v4/accounts/"
            f"{settings.cf_account_id}/ai/run/{MODEL}"
        )

        if session is None:
            session = requests.Session()
            retry = Retry(
                total=3,
                backoff_factor=1.0,
                status_forcelist=(429, 500, 502, 503, 504),
                allowed_methods=frozenset({"POST"}),
                respect_retry_after_header=True,
            )
            session.mount("https://", HTTPAdapter(max_retries=retry))

        self._http = session

    def rerank(
        self,
        query: str,
        documents: list,
        top_k: int = 6,
    ) -> list:
        """Return original documents ordered by reranker relevance."""

        if not documents:
            return []

        if not query.strip():
            return documents[:top_k]

        if not self._settings.cf_account_id or not self._settings.cf_api_token:
            raise UserError("Reranking service is not configured on the server.")

        contexts = [
            {"text": doc.page_content}
            for doc in documents
        ]

        try:
            response = self._http.post(
                self._url,
                headers={
                    "Authorization": f"Bearer {self._settings.cf_api_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "query": query,
                    "contexts": contexts,
                    "top_k": min(top_k, len(contexts)),
                },
                timeout=60,
            )
        except requests.RequestException:
            log.exception("Cloudflare reranker request failed")
            raise UserError("Reranking service is unreachable. Try again shortly.")

        if response.status_code != 200:
            log.error(
                "Reranker HTTP %s: %s",
                response.status_code,
                response.text[:500],
            )
            raise UserError("Reranking service returned an error.")

        try:
            body = response.json()
            result = body.get("result", body)
            rankings = result["response"]

            ranked = []
            seen = set()

            for item in rankings:
                idx = item["id"]
                score = float(item["score"])

                if not isinstance(idx, int) or not 0 <= idx < len(documents):
                    raise ValueError("Invalid document index")

                if idx in seen:
                    continue

                seen.add(idx)
                doc = documents[idx]

                # Preserve original metadata and attach reranker score.
                doc.metadata["rerank_score"] = score
                ranked.append(doc)

            if not ranked:
                raise ValueError("Empty reranker response")

            return ranked[:top_k]

        except (ValueError, KeyError, TypeError, IndexError):
            log.exception("Unexpected Cloudflare reranker response")
            raise UserError("Reranking service returned an unexpected response.")
