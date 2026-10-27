"""Runs the ingestion graph in a small thread pool, one job per uploaded item."""
from __future__ import annotations

import glob
import logging
import os
import shutil
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

from .ingest_graph import IngestContext, build_ingest_graph
from .security import assert_public_url
from .store import Library, LibraryDoc
from .youtube import extract_video_id

log = logging.getLogger(__name__)

EXT_KIND = {
    "pdf": "pdf", "docx": "docx", "pptx": "pptx",
    "txt": "text", "md": "text", "markdown": "text",
    "mp3": "audio", "wav": "audio", "m4a": "audio", "aac": "audio",
    "ogg": "audio", "flac": "audio", "mpga": "audio",
    "mp4": "video", "mkv": "video", "mov": "video", "webm": "video",
    "avi": "video", "m4v": "video", "mpeg": "video", "mpg": "video",
}
ALLOWED_EXTENSIONS = frozenset(EXT_KIND)


def sweep_stale_workdirs(max_age_seconds: int = 3600) -> None:
    """Remove leftover upload dirs from a crashed or restarted process."""
    now = time.time()
    for path in glob.glob(os.path.join(tempfile.gettempdir(), "rag_*")):
        try:
            if now - os.path.getmtime(path) > max_age_seconds:
                shutil.rmtree(path, ignore_errors=True)
        except OSError:
            pass


class IngestManager:
    def __init__(self, settings, embeddings, transcriber, guide=None) -> None:
        self._graph = build_ingest_graph(settings, embeddings, transcriber, guide)
        self._pool = ThreadPoolExecutor(max_workers=settings.ingest_workers,
                                        thread_name_prefix="ingest")

    def submit_file(self, lib: Library, path: str, workdir: str, display_name: str, ext: str) -> LibraryDoc:
        kind = EXT_KIND[ext]
        doc = lib.new_doc(display_name, kind)
        self._pool.submit(self._run, lib, doc, {"kind": kind, "ext": ext, "path": path}, workdir)
        return doc

    def submit_url(self, lib: Library, url: str, workdir: str) -> LibraryDoc:
        vid = extract_video_id(url)
        if vid:
            doc = lib.new_doc(f"YouTube {vid}", "youtube", source=url, video_id=vid)
            state = {"kind": "youtube", "url": url}
        else:
            assert_public_url(url)  # fail fast, before queueing
            doc = lib.new_doc(url[:80], "web", source=url)
            state = {"kind": "web", "url": url}
        self._pool.submit(self._run, lib, doc, state, workdir)
        return doc

    def _run(self, lib: Library, doc: LibraryDoc, state: dict, workdir: str) -> None:
        try:
            doc.status, doc.message = "processing", "Starting…"
            self._graph.invoke(state, context=IngestContext(lib=lib, doc=doc, workdir=workdir))
        except Exception:
            log.exception("ingest failed for %s (%s)", doc.name, doc.kind)
            doc.status, doc.message = "error", "Something went wrong while processing this item."
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
