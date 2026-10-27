from __future__ import annotations

import logging
import time
from types import SimpleNamespace

from flask import Flask, g, jsonify, request
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from langgraph.checkpoint.memory import InMemorySaver
from werkzeug.middleware.proxy_fix import ProxyFix

from .budget import DailyBudget
from .chains import Chains
from .chat_graph import ChatService, build_chat_graph
from .config import Settings
from .db import Repo
from .embeddings import BGEEmbeddings, EmbeddingClient
from .errors import ApiError, UserError
from .generate import Generator
from .ingest import IngestManager, sweep_stale_workdirs
from .routes import make_blueprint
from .store import NotebookStore
from .transcribe import Transcriber
from .websearch import WebSearch

log = logging.getLogger("app")


def create_app(settings: Settings | None = None, *, embeddings=None, chains=None, web=None,
               transcriber=None, repo=None) -> Flask:
    settings = settings or Settings.from_env()
    logging.basicConfig(level=settings.log_level,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = (settings.max_upload_mb + 5) * 1024 * 1024
    if settings.proxy_hops > 0:
        hops = settings.proxy_hops
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=1, x_host=1)
    sweep_stale_workdirs()

    allowed_origins = [
        origin.strip().rstrip("/")
        for origin in settings.allowed_origins
        if origin.strip()
    ]

    CORS(
        app,
        resources={r"/api/*": {"origins": allowed_origins}},
        allow_headers=[
            "Content-Type",
            "X-Owner-Key",
            "X-Notebook-Id",
            "Authorization",
        ],
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        max_age=600,
    )

    limiter = Limiter(get_remote_address, app=app, default_limits=[settings.rate_limit_default],
                      storage_uri="memory://", enabled=settings.rate_limit_enabled,
                      headers_enabled=True)

    embeddings = embeddings or BGEEmbeddings(EmbeddingClient(settings))
    chains = chains or Chains(settings)
    web = web or WebSearch(settings)
    transcriber = transcriber or Transcriber(settings)

    repo = repo or Repo(settings.database_url)
    for old in repo.purge_older_than(settings.notebook_retention_days):
        log.info("purged inactive notebook %s", old)

    # Short-term conversation memory lives in a LangGraph checkpointer (in memory); the saved
    # messages in the database re-seed it when a notebook is reopened.
    checkpointer = InMemorySaver()
    chat = ChatService(build_chat_graph(settings, chains, web, checkpointer), checkpointer, settings)
    generator = Generator(settings, chains)
    svc = SimpleNamespace(
        settings=settings,
        web=web,
        chat=chat,
        generate=generator,
        repo=repo,
        budget=DailyBudget({"chat": settings.daily_chat_limit,
                            "generate": settings.daily_generate_limit,
                            "ingest": settings.daily_ingest_limit}),
        store=NotebookStore(embeddings, repo, settings.idle_unload_minutes, settings.max_loaded_notebooks,
                            on_evict=chat.forget),
        ingest=IngestManager(settings, embeddings, transcriber, guide=generator.make_guide),
    )
    svc.limiter = limiter  # Flask-Limiter keeps only a weak reference; hold it here
    app.extensions["rag"] = svc
    app.register_blueprint(make_blueprint(svc, limiter))

    @app.get("/")
    def root():
        return jsonify(name="AI Study Assistant API", status="ok", health="/api/health")

    # ---------------------------------------------------------- hooks
    @app.before_request
    def _start():
        g.t0 = time.time()

    @app.after_request
    def _after(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.path.startswith("/api/"):
            resp.headers.setdefault("Cache-Control", "no-store")
            if request.path != "/api/health":
                log.info("%s %s -> %s (%.0f ms)", request.method, request.path,
                         resp.status_code, (time.time() - g.get("t0", time.time())) * 1000)
        return resp

    # ------------------------------------------------------- errors
    def err(code: str, message: str, status: int):
        return jsonify(error={"code": code, "message": message}), status

    @app.errorhandler(ApiError)
    def _api(e):
        return err(e.code, e.message, e.status)

    @app.errorhandler(UserError)
    def _user(e):
        return err("user_error", str(e), 400)

    @app.errorhandler(404)
    def _404(_):
        return err("not_found", "Not found.", 404)

    @app.errorhandler(405)
    def _405(_):
        return err("method_not_allowed", "Method not allowed.", 405)

    @app.errorhandler(413)
    def _413(_):
        return err("too_large", f"File is too large (limit {settings.max_upload_mb} MB).", 413)

    @app.errorhandler(429)
    def _429(_):
        return err("rate_limited", "Too many requests. Please slow down.", 429)

    @app.errorhandler(Exception)
    def _500(e):
        if hasattr(e, "code") and isinstance(e.code, int) and e.code < 500:
            return err("http_error", getattr(e, "description", "Request error."), e.code)
        log.exception("unhandled error")
        return err("server_error", "Something went wrong on our side.", 500)

    return app
