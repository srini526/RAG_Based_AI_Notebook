"""Ingestion as a LangGraph workflow.

    START -> (route by kind) -> load_pdf | load_docx | load_pptx | load_text
                                | load_media | load_youtube | load_web
          -> chunk -> index -> END            (any step can divert to `fail` -> END)
"""
from __future__ import annotations

import functools
import logging
from dataclasses import dataclass
from typing import Any, TypedDict

import numpy as np
from langchain_core.documents import Document
from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime

from . import webpage
from .chunking import merge_units
from .errors import UserError
from .parsers import parse_docx, parse_pdf, parse_pptx, parse_text
from .store import Library, LibraryDoc
from .youtube import download_audio, fetch_captions, fetch_title

log = logging.getLogger(__name__)
EMBED_BATCH = 32


@dataclass
class IngestContext:
    lib: Library
    doc: LibraryDoc
    workdir: str


class IngestState(TypedDict, total=False):
    kind: str
    ext: str
    path: str
    url: str
    units: list
    sep: str
    pieces: list
    error: str


def _time_units(segments):
    return [(t, {"kind": "time", "start": s, "end": e}) for s, e, t in segments]


def guarded(fn):
    """Turn user-facing errors into graph state so the workflow routes to `fail`."""
    @functools.wraps(fn)
    def wrapper(state, runtime: Runtime[IngestContext]):
        try:
            return fn(state, runtime)
        except UserError as e:
            return {"error": str(e)}
    return wrapper


LOADER_FOR_KIND = {
    "pdf": "load_pdf", "docx": "load_docx", "pptx": "load_pptx", "text": "load_text",
    "audio": "load_media", "video": "load_media", "youtube": "load_youtube", "web": "load_web",
}


def build_ingest_graph(settings, embeddings, transcriber, guide=None):
    def progress(runtime: Runtime[IngestContext], msg: str) -> None:
        runtime.context.doc.message = msg

    @guarded
    def load_pdf(state: IngestState, runtime: Runtime[IngestContext]):
        progress(runtime, "Reading PDF…")
        return {"units": parse_pdf(state["path"]), "sep": "\n"}

    @guarded
    def load_docx(state: IngestState, runtime: Runtime[IngestContext]):
        progress(runtime, "Reading document…")
        return {"units": parse_docx(state["path"]), "sep": "\n"}

    @guarded
    def load_pptx(state: IngestState, runtime: Runtime[IngestContext]):
        progress(runtime, "Reading slides…")
        return {"units": parse_pptx(state["path"]), "sep": "\n"}

    @guarded
    def load_text(state: IngestState, runtime: Runtime[IngestContext]):
        progress(runtime, "Reading text…")
        return {"units": parse_text(state["path"], markdown=state.get("ext") in ("md", "markdown")),
                "sep": "\n"}

    @guarded
    def load_media(state: IngestState, runtime: Runtime[IngestContext]):
        segs = transcriber.transcribe_media(state["path"], runtime.context.workdir,
                                            lambda m: progress(runtime, m))
        return {"units": _time_units(segs), "sep": " "}

    @guarded
    def load_youtube(state: IngestState, runtime: Runtime[IngestContext]):
        doc = runtime.context.doc
        vid = doc.meta["video_id"]
        proxy = settings.youtube_proxy_url
        doc.name = fetch_title(vid, proxy)
        progress(runtime, "Looking for captions…")
        segs = fetch_captions(vid, proxy)
        if segs is None:
            progress(runtime, "No captions found. Downloading audio…")
            audio = download_audio(vid, runtime.context.workdir, settings)
            segs = transcriber.transcribe_media(audio, runtime.context.workdir, lambda m: progress(runtime, m))
        return {"units": _time_units(segs), "sep": " "}

    @guarded
    def load_web(state: IngestState, runtime: Runtime[IngestContext]):
        progress(runtime, "Fetching page…")
        title, units = webpage.extract(state["url"])
        runtime.context.doc.name = title
        return {"units": units, "sep": "\n"}

    @guarded
    def chunk(state: IngestState, runtime: Runtime[IngestContext]):
        progress(runtime, "Splitting into passages…")
        pieces = merge_units(state["units"], max_chars=settings.chunk_chars, sep=state["sep"])
        if not pieces:
            raise UserError("No text could be extracted.")
        if runtime.context.lib.chunk_total() + len(pieces) > settings.max_chunks_per_session:
            raise UserError("Your library is full. Remove something and try again.")
        return {"pieces": pieces}

    @guarded
    def index(state: IngestState, runtime: Runtime[IngestContext]):
        pieces = state["pieces"]
        texts = [t for t, _ in pieces]
        vectors: list[Any] = []
        for i in range(0, len(texts), EMBED_BATCH):
            vectors.extend(embeddings.embed_documents(texts[i:i + EMBED_BATCH]))
            progress(runtime, f"Indexing {min(i + EMBED_BATCH, len(texts))}/{len(texts)}…")
        docs = [Document(page_content=t, metadata={"loc": loc}) for t, loc in pieces]
        ctx = runtime.context
        ctx.lib.add_chunks(ctx.doc.id, docs, np.asarray(vectors, dtype=np.float32))
        if guide:  # optional source guide; failures just mean no guide
            progress(runtime, "Writing source guide…")
            made = guide(ctx.doc.name, docs)
            if made:
                ctx.lib.set_guide(ctx.doc.id, made)
        ctx.doc.status, ctx.doc.message = "ready", ""
        return {}

    def fail(state: IngestState, runtime: Runtime[IngestContext]):
        runtime.context.doc.status, runtime.context.doc.message = "error", state.get("error", "Failed.")
        return {}

    def ok_or_fail(next_node: str):
        return lambda st: "fail" if st.get("error") else next_node

    g = StateGraph(IngestState, context_schema=IngestContext)
    loaders = {"load_pdf": load_pdf, "load_docx": load_docx, "load_pptx": load_pptx,
               "load_text": load_text, "load_media": load_media, "load_youtube": load_youtube,
               "load_web": load_web}
    for name, fn in loaders.items():
        g.add_node(name, fn)
    g.add_node("chunk", chunk)
    g.add_node("index", index)
    g.add_node("fail", fail)

    g.add_conditional_edges(START, lambda st: LOADER_FOR_KIND[st["kind"]], list(loaders))
    for name in loaders:
        g.add_conditional_edges(name, ok_or_fail("chunk"), ["chunk", "fail"])
    g.add_conditional_edges("chunk", ok_or_fail("index"), ["index", "fail"])
    g.add_conditional_edges("index", ok_or_fail(END), [END, "fail"])
    g.add_edge("fail", END)
    return g.compile()
