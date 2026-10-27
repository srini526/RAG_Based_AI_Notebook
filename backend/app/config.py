from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    # --- external services ---
    groq_api_key: str = ""
    cf_account_id: str = ""
    cf_api_token: str = ""
    llm_model: str = "openai/gpt-oss-120b"
    whisper_model: str = "whisper-large-v3"
    whisper_language: str = ""  # empty = auto-detect
    embedding_model: str = "@cf/baai/bge-m3"

    # --- retrieval ---
    top_k: int = 6
    chunk_chars: int = 1000

    # --- agentic RAG (LangGraph) ---
    max_rewrites: int = 2          # query rewrites before falling back
    grade_docs: bool = True        # LLM relevance grading of retrieved passages
    self_check: bool = True        # verify the answer against its sources
    web_fallback: bool = True      # Tavily web search when the library has nothing
    tavily_api_key: str = ""
    max_web_results: int = 4
    max_history_messages: int = 10  # conversation memory fed to the LLM

    # --- Studio tools (briefing, study guide, FAQ, timeline, mind map, flashcards, quiz) ---
    gen_context_chars: int = 12000  # how much material one Studio call may read
    source_guides: bool = True      # write a short guide for every new source (1 extra LLM call)

    # --- database (notebooks are saved here). SQLite file by default; use a Postgres URL in production ---
    database_url: str = "sqlite:///data/study_assistant.db"
    max_notebooks_per_owner: int = 10
    notebook_retention_days: int = 60  # delete notebooks untouched this long (0 = keep forever)

    # --- web ---
    allowed_origins: tuple = ("http://localhost:5173",)
    proxy_hops: int = 1  # reverse proxies in front of the app (0 = none); used for client IPs
    log_level: str = "INFO"

    # --- limits (protect the free tiers) ---
    max_upload_mb: int = 100
    idle_unload_minutes: int = 60   # unload idle notebooks from memory (they stay in the database)
    max_loaded_notebooks: int = 30
    max_docs_per_session: int = 10  # sources per notebook
    max_chunks_per_session: int = 3000  # passages per notebook
    max_media_minutes: int = 120
    ingest_workers: int = 2

    # --- global daily caps, so a public demo cannot burn the free-tier quotas (0 = unlimited) ---
    daily_chat_limit: int = 2000
    daily_generate_limit: int = 300
    daily_ingest_limit: int = 300

    # --- rate limits (flask-limiter syntax) ---
    rate_limit_enabled: bool = True
    rate_limit_default: str = "240 per minute"
    rate_limit_chat: str = "20 per minute"
    rate_limit_ingest: str = "20 per hour"

    # --- YouTube ---
    youtube_proxy_url: str = ""
    ytdlp_cookies_file: str = ""

    @classmethod
    def from_env(cls) -> "Settings":
        origins = tuple(
            o.strip().rstrip("/")
            for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
            if o.strip()
        )
        return cls(
            groq_api_key=os.getenv("GROQ_API_KEY", ""),
            cf_account_id=os.getenv("CLOUDFLARE_ACCOUNT_ID", ""),
            cf_api_token=os.getenv("CLOUDFLARE_API_TOKEN", ""),
            llm_model=os.getenv("LLM_MODEL", cls.llm_model),
            whisper_model=os.getenv("WHISPER_MODEL", cls.whisper_model),
            whisper_language=os.getenv("WHISPER_LANGUAGE", ""),
            top_k=_int("TOP_K", cls.top_k),
            max_rewrites=_int("MAX_REWRITES", cls.max_rewrites),
            grade_docs=_bool("GRADE_DOCS", True),
            self_check=_bool("SELF_CHECK", True),
            web_fallback=_bool("WEB_FALLBACK", True),
            tavily_api_key=os.getenv("TAVILY_API_KEY", ""),
            max_web_results=_int("MAX_WEB_RESULTS", cls.max_web_results),
            max_history_messages=_int("MAX_HISTORY_MESSAGES", cls.max_history_messages),
            allowed_origins=origins,
            proxy_hops=_int("TRUST_PROXY_HOPS", cls.proxy_hops),
            gen_context_chars=_int("GEN_CONTEXT_CHARS", cls.gen_context_chars),
            daily_chat_limit=_int("DAILY_CHAT_LIMIT", cls.daily_chat_limit),
            daily_generate_limit=_int("DAILY_GENERATE_LIMIT", cls.daily_generate_limit),
            daily_ingest_limit=_int("DAILY_INGEST_LIMIT", cls.daily_ingest_limit),
            log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
            max_upload_mb=_int("MAX_UPLOAD_MB", cls.max_upload_mb),
            idle_unload_minutes=_int("IDLE_UNLOAD_MINUTES", cls.idle_unload_minutes),
            max_loaded_notebooks=_int("MAX_LOADED_NOTEBOOKS", cls.max_loaded_notebooks),
            database_url=os.getenv("DATABASE_URL", cls.database_url),
            max_notebooks_per_owner=_int("MAX_NOTEBOOKS_PER_OWNER", cls.max_notebooks_per_owner),
            notebook_retention_days=_int("NOTEBOOK_RETENTION_DAYS", cls.notebook_retention_days),
            source_guides=_bool("SOURCE_GUIDES", cls.source_guides),
            max_docs_per_session=_int("MAX_DOCS_PER_SESSION", cls.max_docs_per_session),
            max_chunks_per_session=_int("MAX_CHUNKS_PER_SESSION", cls.max_chunks_per_session),
            max_media_minutes=_int("MAX_MEDIA_MINUTES", cls.max_media_minutes),
            ingest_workers=_int("INGEST_WORKERS", cls.ingest_workers),
            rate_limit_enabled=_bool("RATE_LIMIT_ENABLED", True),
            rate_limit_default=os.getenv("RATE_LIMIT_DEFAULT", cls.rate_limit_default),
            rate_limit_chat=os.getenv("RATE_LIMIT_CHAT", cls.rate_limit_chat),
            rate_limit_ingest=os.getenv("RATE_LIMIT_INGEST", cls.rate_limit_ingest),
            youtube_proxy_url=os.getenv("YOUTUBE_PROXY_URL", ""),
            ytdlp_cookies_file=os.getenv("YTDLP_COOKIES_FILE", ""),
        )
