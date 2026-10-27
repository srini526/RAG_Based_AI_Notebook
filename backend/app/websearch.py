"""Tavily web search (LangChain tool) used as the last-resort fallback."""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)


class WebSearch:
    def __init__(self, settings, tool=None) -> None:
        self._s = settings
        self._tool = tool

    @property
    def available(self) -> bool:
        return bool(self._s.web_fallback and (self._tool is not None or self._s.tavily_api_key))

    def search(self, query: str) -> list[dict]:
        """Return [{title, url, content}] (empty on any failure)."""
        if not self.available:
            return []
        try:
            if self._tool is None:
                from langchain_tavily import TavilySearch

                self._tool = TavilySearch(max_results=self._s.max_web_results,
                                          tavily_api_key=self._s.tavily_api_key)
            raw = self._tool.invoke({"query": query})
            results = raw.get("results", []) if isinstance(raw, dict) else []
            return [
                {"title": (r.get("title") or r.get("url") or "Web result")[:150],
                 "url": r.get("url", ""), "content": (r.get("content") or "").strip()}
                for r in results if r.get("content")
            ][: self._s.max_web_results]
        except Exception:
            log.warning("web search failed", exc_info=True)
            return []
