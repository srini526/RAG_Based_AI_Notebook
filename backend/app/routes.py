from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import tempfile

from flask import Blueprint, Response, jsonify, request, stream_with_context

from .errors import ApiError, UserError
from .generate import KINDS, TITLES
from .ingest import ALLOWED_EXTENSIONS
from .prompts import STYLES

log = logging.getLogger(__name__)
HEX32 = re.compile(r"^[0-9a-f]{32}$")
MAX_QUESTION = 2000
MAX_TITLE = 120


def _display_name(filename: str) -> str:
    name = os.path.basename(filename or "file")
    name = re.sub(r"[\x00-\x1f]", "", name).strip()
    return (name or "file")[:120]


def _doc_ids(raw) -> set[str] | None:
    ids = {x for x in raw if isinstance(x, str)} if isinstance(raw, list) else set()
    return ids or None


def _sse_response(events) -> Response:
    """Turn an iterator of event dicts into a Server-Sent Events response."""
    def encode(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    @stream_with_context
    def body():
        try:
            for event in events:
                yield encode(event)
        except UserError as e:
            yield encode({"error": str(e)})
        except Exception:
            log.exception("stream failed")
            yield encode({"error": "The AI service had a problem. Please try again."})

    return Response(body(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
    })


def make_blueprint(svc, limiter) -> Blueprint:
    bp = Blueprint("api", __name__, url_prefix="/api")
    s = svc.settings

    def owner_hash() -> str:
        key = request.headers.get("X-Owner-Key", "")
        if not HEX32.fullmatch(key):
            raise ApiError("key_required", "Missing or invalid device key.", 401)
        return hashlib.sha256(key.encode()).hexdigest()

    def current():
        """The notebook named in X-Notebook-Id, if it belongs to this device key."""
        owner = owner_hash()
        nid = request.headers.get("X-Notebook-Id", "")
        if not HEX32.fullmatch(nid) or svc.repo.get_notebook(nid, owner) is None:
            raise ApiError("not_found", "Notebook not found.", 404)
        return nid, svc.store.get(nid)

    def clean_title(raw) -> str:
        title = re.sub(r"\s+", " ", str(raw or "")).strip()[:MAX_TITLE]
        return title or "Untitled notebook"

    # ---------------------------------------------------------------- misc
    @bp.get("/health")
    @limiter.exempt
    def health():
        return jsonify(status="ok", configured={
            "groq": bool(s.groq_api_key),
            "cloudflare": bool(s.cf_account_id and s.cf_api_token),
            "web_search": svc.web.available,
        })

    @bp.get("/config")
    def config():
        return jsonify(
            allowed_extensions=sorted(ALLOWED_EXTENSIONS),
            max_upload_mb=s.max_upload_mb,
            max_docs=s.max_docs_per_session,
            max_notebooks=s.max_notebooks_per_owner,
            web_fallback=svc.web.available,
            styles=sorted(STYLES),
            generate=list(KINDS),
        )

    # ------------------------------------------------------------ notebooks
    @bp.get("/notebooks")
    def list_notebooks():
        return jsonify(notebooks=svc.repo.list_notebooks(owner_hash()))

    @bp.post("/notebooks")
    @limiter.limit("30 per hour")
    def create_notebook():
        owner = owner_hash()
        if svc.repo.count_notebooks(owner) >= s.max_notebooks_per_owner:
            raise ApiError("too_many_notebooks",
                           f"You can have up to {s.max_notebooks_per_owner} notebooks. Delete one first.", 400)
        title = clean_title((request.get_json(silent=True) or {}).get("title"))
        for old in svc.repo.purge_older_than(s.notebook_retention_days):
            svc.store.drop(old)
        return jsonify(notebook=svc.repo.create_notebook(owner, title)), 201

    @bp.patch("/notebooks/<nid>")
    def rename_notebook(nid):
        if not HEX32.fullmatch(nid) or svc.repo.get_notebook(nid, owner_hash()) is None:
            raise ApiError("not_found", "Notebook not found.", 404)
        svc.repo.rename_notebook(nid, clean_title((request.get_json(silent=True) or {}).get("title")))
        return jsonify(ok=True)

    @bp.delete("/notebooks/<nid>")
    def delete_notebook(nid):
        if not HEX32.fullmatch(nid) or svc.repo.get_notebook(nid, owner_hash()) is None:
            raise ApiError("not_found", "Notebook not found.", 404)
        svc.store.drop(nid)
        svc.repo.delete_notebook(nid)
        return jsonify(ok=True)

    @bp.get("/notebook")
    def notebook_detail():
        nid, lib = current()
        nb = svc.repo.get_notebook(nid, owner_hash())
        return jsonify(notebook=nb, documents=[d.public() for d in lib.docs.values()],
                       messages=svc.repo.list_messages(nid), outputs=svc.repo.list_outputs(nid))

    # ------------------------------------------------------------- library
    @bp.get("/library")
    def library():
        _, lib = current()
        return jsonify(documents=[d.public() for d in lib.docs.values()])

    def check_capacity(lib):
        if len(lib.docs) >= s.max_docs_per_session:
            raise ApiError("library_full",
                           f"You can add up to {s.max_docs_per_session} sources per notebook.", 400)

    @bp.post("/library/file")
    @limiter.limit(s.rate_limit_ingest)
    def add_file():
        _, lib = current()
        check_capacity(lib)
        f = request.files.get("file")
        if f is None or not f.filename:
            raise ApiError("no_file", "No file was uploaded.", 400)
        ext = os.path.splitext(f.filename)[1].lower().lstrip(".")
        if ext not in ALLOWED_EXTENSIONS:
            raise ApiError("unsupported_type", f"Unsupported file type: .{ext or '?'}", 415)
        svc.budget.spend("ingest")
        workdir = tempfile.mkdtemp(prefix="rag_")
        try:
            path = os.path.join(workdir, f"upload.{ext}")
            f.save(path)
            doc = svc.ingest.submit_file(lib, path, workdir, _display_name(f.filename), ext)
            svc.repo.touch(lib.nid)
        except Exception:
            shutil.rmtree(workdir, ignore_errors=True)
            raise
        return jsonify(document=doc.public()), 202

    @bp.post("/library/url")
    @limiter.limit(s.rate_limit_ingest)
    def add_url():
        _, lib = current()
        check_capacity(lib)
        data = request.get_json(silent=True) or {}
        url = str(data.get("url", "")).strip()
        if not url or len(url) > 2000:
            raise ApiError("bad_url", "Please provide a valid link.", 400)
        if any(d.source == url for d in lib.docs.values()):
            raise ApiError("duplicate", "That link is already in this notebook.", 409)
        svc.budget.spend("ingest")
        workdir = tempfile.mkdtemp(prefix="rag_")
        try:
            doc = svc.ingest.submit_url(lib, url, workdir)
        except Exception:
            shutil.rmtree(workdir, ignore_errors=True)
            raise
        return jsonify(document=doc.public()), 202

    @bp.delete("/library/<doc_id>")
    def delete_doc(doc_id):
        _, lib = current()
        if not lib.remove_doc(doc_id):
            raise ApiError("not_found", "Item not found.", 404)
        return jsonify(ok=True)

    @bp.delete("/library")
    def clear_library():
        _, lib = current()
        lib.clear()
        return jsonify(ok=True)

    # ---------------------------------------------------------------- chat
    def prepare():
        nid, lib = current()
        data = request.get_json(silent=True) or {}
        question = str(data.get("question", "")).strip()
        if not question:
            raise ApiError("empty_question", "Question cannot be empty.", 400)
        if len(question) > MAX_QUESTION:
            raise ApiError("question_too_long", f"Keep questions under {MAX_QUESTION} characters.", 400)
        if lib.ready_count() == 0:
            raise ApiError("empty_library", "Add a source first.", 400)
        style = str(data.get("mode") or "normal")
        if style not in STYLES:
            raise ApiError("bad_mode", "Unknown answer style.", 400)
        svc.budget.spend("chat")
        history = None
        if not svc.chat.has_thread(nid):  # memory was unloaded: re-seed it from the saved messages
            history = [(m["sender"], m["message"]) for m in svc.repo.list_messages(nid, 10)]
        return lib, nid, question, _doc_ids(data.get("doc_ids")), style, history

    def save_turn(nid: str, question: str, answer: str, ev: dict) -> None:
        try:
            svc.repo.add_messages(nid, [
                ("user", question, {}),
                ("bot", answer, {"sources": ev.get("sources", []), "meta": ev.get("meta", {})})])
        except Exception:
            log.exception("could not save chat messages")

    def saving_chat(events, nid: str, question: str):
        answer = ""
        for ev in events:
            if ev.get("reset"):
                answer = ""
            answer += ev.get("token", "")
            if ev.get("done"):
                save_turn(nid, question, answer, ev)
            yield ev

    @bp.post("/chat")
    @limiter.limit(s.rate_limit_chat)
    def chat():
        args = prepare()
        result = svc.chat.invoke(*args)
        save_turn(args[1], args[2], result["answer"], result)
        return jsonify(result)

    @bp.post("/chat/stream")
    @limiter.limit(s.rate_limit_chat)
    def chat_stream():
        args = prepare()
        return _sse_response(saving_chat(svc.chat.stream(*args), args[1], args[2]))

    @bp.delete("/chat")
    def clear_chat():
        nid, _ = current()
        svc.repo.clear_messages(nid)
        svc.chat.forget(nid)
        return jsonify(ok=True)

    # ------------------------------------------------------------ Studio
    def saving_output(events, nid: str, kind: str):
        text: list[str] = []
        content: dict = {}
        for ev in events:
            text.append(ev.get("token", ""))
            for key in ("quiz", "flashcards", "mindmap"):
                if key in ev:
                    content[key] = ev[key]
            if ev.get("done") and kind != "questions":
                if any(text):
                    content["markdown"] = "".join(text)
                    content["sources"] = ev.get("sources", [])
                try:
                    ev = {**ev, "output": svc.repo.add_output(nid, kind, TITLES[kind], content)}
                except Exception:
                    log.exception("could not save Studio output")
            yield ev

    @bp.post("/generate")
    @limiter.limit(s.rate_limit_chat)
    def generate():
        nid, lib = current()
        data = request.get_json(silent=True) or {}
        kind = str(data.get("kind", ""))
        if kind not in KINDS:
            raise ApiError("bad_kind", "Unknown tool.", 400)
        if lib.ready_count() == 0:
            raise ApiError("empty_library", "Add a source first.", 400)
        svc.budget.spend("generate")
        events = svc.generate.stream(lib, kind, _doc_ids(data.get("doc_ids")))
        return _sse_response(saving_output(events, nid, kind))

    @bp.delete("/outputs/<output_id>")
    def delete_output(output_id):
        nid, _ = current()
        if not svc.repo.delete_output(nid, output_id):
            raise ApiError("not_found", "Output not found.", 404)
        return jsonify(ok=True)

    return bp
