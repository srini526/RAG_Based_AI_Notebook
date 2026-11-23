from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import tempfile
import uuid

from flask import Blueprint, Response, jsonify, request, stream_with_context

from .errors import ApiError, UserError
from .generate import KINDS, TITLES
from .ingest import ALLOWED_EXTENSIONS, validate_source_url
from .prompts import STYLES

log = logging.getLogger(__name__)
HEX32 = re.compile(r"^[0-9a-f]{32}$")
MAX_QUESTION = 2000
MAX_TITLE = 120
MAX_NOTE_CHARS = 30_000


def _json_object() -> dict:
    data = request.get_json(silent=True)
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ApiError("bad_json", "Send a JSON object.", 400)
    return data


def _message_id(value) -> int:
    if type(value) is not int or not 0 < value < 2**53:
        raise ApiError("bad_message", "Invalid answer ID.", 400)
    return value


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
        except (UserError, ApiError) as e:  # e.g. the daily limit reached while a chat turn was running
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

    def note_fields(data: dict) -> tuple[str, str]:
        title = data.get("title", "")
        markdown = data.get("markdown", "")
        if not isinstance(title, str) or not isinstance(markdown, str):
            raise ApiError("bad_note", "A note needs a text title and body.", 400)
        title = re.sub(r"\s+", " ", title).strip()[:MAX_TITLE] or "Untitled note"
        if len(markdown) > MAX_NOTE_CHARS:
            raise ApiError("note_too_long", f"Keep notes under {MAX_NOTE_CHARS:,} characters.", 400)
        return title, markdown.strip()

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
        title = clean_title(_json_object().get("title"))
        for old in svc.repo.purge_older_than(s.notebook_retention_days):
            svc.store.drop(old)
        return jsonify(notebook=svc.repo.create_notebook(owner, title)), 201

    @bp.patch("/notebooks/<nid>")
    def rename_notebook(nid):
        if not HEX32.fullmatch(nid) or svc.repo.get_notebook(nid, owner_hash()) is None:
            raise ApiError("not_found", "Notebook not found.", 404)
        svc.repo.rename_notebook(nid, clean_title(_json_object().get("title")))
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
        return jsonify(notebook=nb, documents=lib.public_docs(),
                       messages=svc.repo.list_messages(nid), outputs=svc.repo.list_outputs(nid))

    # ------------------------------------------------------------- library
    @bp.get("/library")
    def library():
        _, lib = current()
        return jsonify(documents=lib.public_docs())

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
        workdir = tempfile.mkdtemp(prefix="rag_")
        try:
            path = os.path.join(workdir, f"upload.{ext}")
            f.save(path)
            if os.path.getsize(path) > s.max_upload_mb * 1024 * 1024:
                raise ApiError("too_large", f"File is too large (limit {s.max_upload_mb} MB).", 413)
            with lib.lock:
                check_capacity(lib)
                svc.budget.spend("ingest")
                svc.repo.touch(lib.nid)
                doc = svc.ingest.submit_file(lib, path, workdir, _display_name(f.filename), ext)
        except Exception:
            shutil.rmtree(workdir, ignore_errors=True)
            raise
        return jsonify(document=doc.public()), 202

    @bp.post("/library/url")
    @limiter.limit(s.rate_limit_ingest)
    def add_url():
        _, lib = current()
        check_capacity(lib)
        data = _json_object()
        url = str(data.get("url", "")).strip()
        if not url or len(url) > 2000:
            raise ApiError("bad_url", "Please provide a valid link.", 400)
        video_id = validate_source_url(url)
        workdir = tempfile.mkdtemp(prefix="rag_")
        try:
            with lib.lock:
                check_capacity(lib)
                if any(d.source == url for d in lib.docs.values()):
                    raise ApiError("duplicate", "That link is already in this notebook.", 409)
                svc.budget.spend("ingest")
                doc = svc.ingest.submit_url(lib, url, workdir, video_id)
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
        data = _json_object()
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
        replacement = None
        thread = nid
        history = None
        if "replace_answer_id" in data:
            replacement = _message_id(data["replace_answer_id"])
            recent = svc.repo.list_messages(nid, 12)
            if (len(recent) < 2 or recent[-1]["id"] != replacement or recent[-1]["sender"] != "bot"
                    or recent[-2]["sender"] != "user" or recent[-2]["message"] != question):
                raise ApiError("stale_answer", "This is no longer the last answer. Reload the notebook and try again.", 409)
            thread = f"{nid}:retry:{uuid.uuid4().hex}"
            history = [(m["sender"], m["message"]) for m in recent[:-2]]
        elif not svc.chat.has_thread(nid):  # memory was unloaded: re-seed it from the saved messages
            history = [(m["sender"], m["message"]) for m in svc.repo.list_messages(nid, 10)]
        svc.budget.spend("chat")
        return (lib, thread, question, _doc_ids(data.get("doc_ids")), style, history), replacement

    def save_turn(nid: str, question: str, answer: str, ev: dict, replacement=None) -> int | None:
        extra = {"sources": ev.get("sources", []), "meta": ev.get("meta", {})}
        if replacement is not None:
            if not answer.strip():
                raise UserError("The model returned an empty answer. The previous answer was kept.")
            if not svc.repo.replace_latest_answer(nid, replacement, answer, extra):
                raise ApiError("stale_answer", "A newer answer was saved. Reload the notebook and try again.", 409)
            svc.chat.forget(nid)
            return replacement
        try:
            return svc.repo.add_messages(nid, [("user", question, {}), ("bot", answer, extra)])
        except Exception:
            log.exception("could not save chat messages")
            return None

    def save_studio_result(nid: str, result: dict) -> dict | None:
        """A Studio tool asked for in chat becomes a normal saved Studio item."""
        try:
            return svc.repo.add_output(nid, result["kind"], TITLES[result["kind"]], result["content"])
        except Exception:
            log.exception("could not save Studio output made from chat")
            return None

    def studio_ref(output: dict) -> dict:
        return {"id": output["id"], "kind": output["kind"], "title": output["title"]}

    def saving_chat(events, nid: str, question: str, replacement):
        answer = ""
        output = None
        for ev in events:
            if "studio_result" in ev:
                output = save_studio_result(nid, ev["studio_result"])
                if output:
                    yield {"studio_output": output}  # the client adds it to the Studio list
                continue
            if ev.get("reset"):
                answer = ""
            answer += ev.get("token", "")
            if ev.get("done"):
                if output:
                    ev = {**ev, "meta": {**ev.get("meta", {}), "studio": studio_ref(output)}}
                message_id = save_turn(nid, question, answer, ev, replacement)
                if message_id is not None:
                    ev = {**ev, "meta": {**ev.get("meta", {}), "message_id": message_id}}
            yield ev

    @bp.post("/chat")
    @limiter.limit(s.rate_limit_chat)
    def chat():
        args, replacement = prepare()
        nid = args[0].nid
        try:
            result = svc.chat.invoke(*args)
            if "studio_result" in result:
                output = save_studio_result(nid, result.pop("studio_result"))
                if output:
                    result["meta"] = {**result.get("meta", {}), "studio": studio_ref(output)}
                    result["output"] = output
            message_id = save_turn(nid, args[2], result["answer"], result, replacement)
            if message_id is not None:
                result["meta"] = {**result.get("meta", {}), "message_id": message_id}
        finally:
            if replacement is not None:
                svc.chat.forget(args[1])
        return jsonify(result)

    @bp.post("/chat/stream")
    @limiter.limit(s.rate_limit_chat)
    def chat_stream():
        args, replacement = prepare()

        def stream():
            try:
                yield from saving_chat(svc.chat.stream(*args), args[0].nid, args[2], replacement)
            finally:
                if replacement is not None:
                    svc.chat.forget(args[1])

        return _sse_response(stream())

    @bp.delete("/chat")
    def clear_chat():
        nid, _ = current()
        svc.repo.clear_messages(nid)
        svc.chat.forget(nid)
        return jsonify(ok=True)

    # ------------------------------------------------------------ Studio
    def saving_output(events, nid: str, kind: str, focus: str):
        text: list[str] = []
        content: dict = {"focus": focus} if focus else {}
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
                except Exception as exc:
                    log.exception("could not save Studio output")
                    raise UserError("The output was created but couldn't be saved. Try again.") from exc
            yield ev

    @bp.post("/generate")
    @limiter.limit(s.rate_limit_chat)
    def generate():
        nid, lib = current()
        data = _json_object()
        kind = str(data.get("kind", ""))
        if kind not in KINDS:
            raise ApiError("bad_kind", "Unknown tool.", 400)
        if lib.ready_count() == 0:
            raise ApiError("empty_library", "Add a source first.", 400)
        focus = data.get("focus", "")
        if not isinstance(focus, str):
            raise ApiError("bad_focus", "The focus topic must be text.", 400)
        focus = focus.strip()[:160]
        svc.budget.spend("generate")
        events = svc.generate.stream(lib, kind, _doc_ids(data.get("doc_ids")), focus)
        return _sse_response(saving_output(events, nid, kind, focus))

    @bp.delete("/outputs/<output_id>")
    def delete_output(output_id):
        nid, _ = current()
        if not svc.repo.delete_output(nid, output_id):
            raise ApiError("not_found", "Output not found.", 404)
        return jsonify(ok=True)

    @bp.post("/notes")
    def create_note():
        nid, _ = current()
        data = _json_object()
        title, markdown = note_fields(data)
        content = {"markdown": markdown}
        if "message_id" in data:
            answer = svc.repo.get_answer(nid, _message_id(data["message_id"]))
            if answer is None:
                raise ApiError("not_found", "Answer not found.", 404)
            title = "Saved answer"
            content = {"markdown": answer["message"], "sources": answer.get("sources", [])}
        if not content["markdown"]:
            raise ApiError("empty_note", "Write something before saving the note.", 400)
        return jsonify(output=svc.repo.add_output(nid, "note", title, content)), 201

    @bp.patch("/notes/<output_id>")
    def edit_note(output_id):
        nid, _ = current()
        title, markdown = note_fields(_json_object())
        if not markdown:
            raise ApiError("empty_note", "Write something before saving the note.", 400)
        output = svc.repo.update_note(nid, output_id, title, markdown)
        if output is None:
            raise ApiError("not_found", "Note not found.", 404)
        return jsonify(output=output)

    return bp
