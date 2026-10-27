from __future__ import annotations

import re

from langchain_core.documents import Document

from .chunking import locator_label
from .youtube import watch_url

TEXT_MAX = 1500  # passage text kept on each source so the UI can show it
_CITE = re.compile(r"\[S(\d+)\]")


def build_sources(documents: list[Document], lib_docs: dict) -> list[dict]:
    """Numbered source cards (S1, S2, ...) for the passages given to the LLM."""
    out = []
    for i, d in enumerate(documents, 1):
        md = d.metadata
        snippet = d.page_content[:220] + ("…" if len(d.page_content) > 220 else "")
        if md.get("external"):  # web search result
            out.append({"id": f"S{i}", "doc_id": "", "title": md.get("title", "Web result"),
                        "kind": "web", "locator": "", "url": md.get("url", ""),
                        "snippet": snippet, "text": d.page_content[:TEXT_MAX], "score": 0, "external": True})
            continue
        doc = lib_docs.get(md.get("doc_id"))
        if doc is None:
            continue
        loc = md.get("loc", {})
        url = ""
        if doc.kind == "youtube":
            url = watch_url(doc.meta.get("video_id", ""), loc.get("start"))
        elif doc.kind == "web":
            url = doc.source
        out.append({"id": f"S{i}", "doc_id": doc.id, "title": doc.name, "kind": doc.kind,
                    "locator": locator_label(loc), "url": url, "snippet": snippet,
                    "text": d.page_content[:TEXT_MAX],
                    "score": round(float(md.get("score", 0)), 3), "external": False})
    return out


def cited_only(answer: str, sources: list[dict]) -> list[dict]:
    """Keep only sources the model actually cited; fall back to all."""
    cited = {f"S{n}" for n in _CITE.findall(answer)}
    picked = [s for s in sources if s["id"] in cited]
    return picked or sources


def format_context(docs: list[Document], sources: list[dict]) -> str:
    """Numbered SOURCES block handed to the LLM ([S1] ... ). `docs` and `sources` line up 1:1."""
    blocks = []
    for d, s in zip(docs, sources):
        head = f"[{s['id']}] {s['title']}" + (f" ({s['locator']})" if s["locator"] else "")
        blocks.append(f"{head}\n{d.page_content}")
    return "\n\n---\n\n".join(blocks)
