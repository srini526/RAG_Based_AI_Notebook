# RAG-Based AI Notebook

A source-grounded AI workspace for turning documents, lecture material, recordings, videos, and webpages into a searchable personal knowledge base. Create notebooks, add sources, ask questions with passage-level citations, and generate study material in a dedicated Studio.

The application is built around two LangGraph workflows: one for asynchronous source ingestion and indexing, and one for agentic retrieval and answer generation. A separate Cloudflare Workers AI model powers Studio generation, while notebook content and embeddings are persisted in SQLite or PostgreSQL.

[Live application](https://ragbasedainotebook.vercel.app/) · [Development roadmap](./plan.md)

---

## What it does

### Notebooks and source library

- Create, rename, open, and delete notebooks.
- Keep separate source libraries, conversations, and generated outputs for each notebook.
- Upload multiple files or add a public webpage, a PDF URL, or a YouTube link.
- View upload and ingestion progress, processing status, errors, and passage counts.
- Select specific sources to scope a chat question or Studio generation.
- See an automatically generated source guide with a short summary, key topics, and suggested starter questions.
- Remove one source or clear the complete library.

### Source-grounded chat

- Ask questions against all ready sources or only selected sources.
- Retrieve relevant passages from the notebook's FAISS index.
- Use an optional reranking stage to improve the ordering of retrieved candidates.
- Rewrite a search query when retrieval does not find useful evidence.
- Use Tavily as an optional web-search fallback when the notebook does not contain a useful answer.
- Cite source IDs inline and open the exact supporting passage from the UI.
- Preserve page, slide, section, and media timestamp locators where available.
- Choose an answer style: Standard, Explain simply, Exam notes, or Deep dive.
- See the live workflow steps, stop generation, regenerate the last answer, copy a response, and export a conversation as Markdown.

### Study Studio

The Studio panel provides seven user-facing generation tools:

| Tool | Output |
|---|---|
| Briefing document | Executive summary, key themes, and takeaways |
| Study guide | Organized revision notes, concepts, practice questions, and glossary |
| FAQ | Questions and concise answers grounded in the sources |
| Timeline | Chronological events, stages, or steps |
| Mind map | Interactive concept map with foldable branches, pan, and zoom |
| Flashcards | Flip cards with navigation and shuffle |
| Quiz | Interactive multiple-choice quiz with feedback, score, and retry |

You can generate from all ready sources or a selected subset. When a specific topic is supplied, Studio first searches for focused passages. Text-based outputs can be copied or exported as Markdown. Generated outputs are saved with the notebook and can be reopened or deleted.

The chat interface can also recognize requests such as “make me a quiz on closures” and route them directly to the Studio model. The generated item is saved in Studio and linked from the chat response. The API additionally exposes a non-persistent suggested-questions generation kind.

---

## Supported sources

| Source type | File extensions or URL | Processing |
|---|---|---|
| PDF | .pdf or a public PDF URL | Extract text and retain page numbers |
| Word | .docx | Extract headings, paragraphs, and tables |
| PowerPoint | .pptx | Extract slide text, tables, and speaker notes |
| Text | .txt | Read text content |
| Markdown | .md, .markdown | Read content and preserve heading-based sections |
| Audio | .mp3, .wav, .m4a, .aac, .ogg, .flac, .mpga | FFmpeg conversion and timestamped Groq Whisper transcription |
| Video | .mp4, .mkv, .mov, .webm, .avi, .m4v, .mpeg, .mpg | Extract audio with FFmpeg, then transcribe |
| YouTube | Public YouTube video URL | Try captions first; fall back to audio download and Whisper |
| Webpage | Public HTTP(S) URL | Fetch and extract readable page content using Trafilatura |

The current implementation extracts text; it does not OCR scanned/image-only PDFs. Web extraction can fail on pages that require JavaScript execution, authentication, or other browser-only behavior.

### Source locations and citations

Ingestion preserves source location metadata through chunking:

- PDF passages retain page numbers.
- PowerPoint passages retain slide numbers.
- Markdown and Word content can retain section context.
- Audio, video, and YouTube passages retain transcript time ranges.
- Web sources retain the original URL.

Answers cite sources using identifiers such as [S1]. The frontend turns those references into source chips that open the stored passage and show its locator. Web and YouTube sources can also link to the original URL; YouTube links can include the transcript start time.

---

## System architecture

~~~mermaid
flowchart TD
    UI[React 19 + Vite frontend] <-->|HTTP / JSON + SSE| API[Flask API]

    API --> NB[Notebook and ownership service]
    NB --> DB[(SQLAlchemy persistence)]
    NB --> CACHE[In-memory notebook cache]
    CACHE --> FAISS[Per-notebook FAISS index]

    API --> INGEST[LangGraph ingestion graph]
    INGEST --> PARSE[PDF / Office / Text / Web / Media loaders]
    PARSE --> CHUNK[Chunking and source locators]
    CHUNK --> EMBED[Cloudflare BGE-M3 embeddings]
    EMBED --> FAISS
    INGEST --> GUIDE[Optional source guide generation]
    GUIDE --> STUDIO_MODEL[Cloudflare Studio model]

    API --> CHAT[LangGraph chat graph]
    CHAT --> ROUTE[Intent and query analysis]
    ROUTE --> RETRIEVE[FAISS candidate retrieval]
    RETRIEVE --> GRADE[Relevance grading]
    GRADE --> RERANK[Optional BGE reranker]
    RERANK --> ANSWER[Groq answer generation]
    GRADE --> REWRITE[Query rewrite]
    REWRITE --> RETRIEVE
    GRADE --> WEB[Optional Tavily fallback]
    WEB --> ANSWER
    ANSWER --> CHECK[Citation validation and grounding check]
    CHECK --> STREAM[Stream response and source references]
    STREAM --> UI

    API --> STUDIO[Studio generator]
    STUDIO --> STUDIO_MODEL
    STUDIO --> DB
~~~

### Backend components

| Module | Responsibility |
|---|---|
| app/factory.py | Flask application factory, provider wiring, CORS, rate limiting, service initialization, error handlers |
| app/routes.py | Notebook, library, chat, generation, and output API routes |
| app/config.py | Environment-backed settings and resource limits |
| app/ingest_graph.py | LangGraph workflow for loading, chunking, embedding, indexing, and source guides |
| app/ingest.py | Bounded thread pool for ingestion jobs and temporary-file cleanup |
| app/parsers.py | PDF, DOCX, PPTX, text, and Markdown parsing |
| app/transcribe.py | FFmpeg audio extraction and Groq Whisper transcription |
| app/youtube.py | YouTube ID parsing, caption retrieval, and audio-download fallback |
| app/webpage.py | Public webpage/PDF fetching and text extraction |
| app/chat_graph.py | Query routing, retrieval, grading, rewriting, reranking, generation, and answer checks |
| app/studio_intent.py | Detects requests to create a Studio tool directly from chat |
| app/generate.py | Study Studio generators and source-guide generation |
| app/chains.py | Separate Groq RAG chains and Cloudflare Studio chains |
| app/embeddings.py | Cloudflare BGE-M3 embedding client |
| app/reranker.py | Cloudflare BGE reranker client |
| app/faiss_store.py | In-memory FAISS adapter implementing LangChain's vector-store interface |
| app/store.py | Notebook library objects and in-memory LRU cache |
| app/db.py | SQLAlchemy Core persistence for notebooks, sources, chunks, chat, and outputs |
| app/security.py | Public URL validation and SSRF protections |
| app/budget.py | In-memory daily request budgets |

### Ingestion pipeline

The ingestion graph selects a loader based on the source type, then follows this lifecycle:

1. **Load:** extract document text, page/slide content, webpage text, or timestamped transcript segments.
2. **Chunk:** split extracted content into retrieval-sized passages while retaining location metadata.
3. **Embed:** request normalized vectors from Cloudflare Workers AI BGE-M3 in batches.
4. **Index:** add passages to the notebook's FAISS index.
5. **Persist:** store the source, passages, locators, and embeddings in the configured database.
6. **Guide:** optionally generate a short source guide using the Studio model.

Each source has a queued, processing, ready, or error status. The frontend polls the library while ingestion is in progress. A bounded thread pool prevents the API from creating an unbounded number of ingestion workers.

### Agentic chat pipeline

The chat workflow is a LangGraph state machine:

1. **Analyze the request:** direct small talk can bypass retrieval; a first substantive message can skip an unnecessary router call; follow-up questions can be rewritten into standalone queries.
2. **Detect Studio intent:** requests to create a quiz, mind map, flashcards, briefing, study guide, FAQ, or timeline can go directly to the Studio generator.
3. **Retrieve candidates:** search the selected source scope or the whole notebook using vector similarity.
4. **Grade relevance:** use a configurable similarity threshold, an LLM relevance grader, or no grading.
5. **Rerank:** when enabled, send the candidate passages to the Cloudflare BGE reranker and keep the highest-ranked results. If reranking fails, the graph falls back to the original retrieval order.
6. **Rewrite if needed:** retry retrieval with a rewritten query up to the configured rewrite limit.
7. **Web fallback:** if no relevant notebook passages are found and Tavily is configured, search the web and clearly label the answer as web-sourced.
8. **Generate:** stream an answer from the Groq RAG model using the selected source passages and answer style.
9. **Check:** validate citation IDs deterministically. For web answers and sufficiently long answers, optionally run an LLM grounding check. The graph can regenerate once and flag remaining unsupported claims.

The graph distinguishes direct, library, web, Studio, and no-result routes. Source IDs and source metadata are constructed by the application; the answer model is asked to cite only the supplied source IDs.

### Vector retrieval and reranking

The project uses a small custom FaissStore adapter over faiss-cpu rather than LangChain Community's FAISS wrapper. The adapter implements the LangChain vector-store interface, supports metadata filtering and deletion, and searches normalized vectors using inner product (cosine similarity).

When reranking is enabled, the chat graph retrieves an expanded candidate set (20 by default), then uses Cloudflare's BGE reranker model, @cf/baai/bge-reranker-base, to select the final passages (6 by default). Reranker failures are logged and fall back to the original retrieval order. Set RERANKER_ENABLED=false to disable it.

### Separate model roles

RAG, fast routing/checks, Studio, embeddings, and reranking are configured as distinct provider roles:

| Role | Provider | Default model |
|---|---|---|
| Main RAG answer and direct chat | Groq | openai/gpt-oss-120b |
| Fast router, rewrite, and structured grading/checks | Groq | openai/gpt-oss-20b |
| Studio text and structured generation | Cloudflare Workers AI | @cf/openai/gpt-oss-120b |
| Embeddings | Cloudflare Workers AI | @cf/baai/bge-m3 |
| Reranking | Cloudflare Workers AI | @cf/baai/bge-reranker-base |
| Audio/video transcription | Groq | whisper-large-v3 |
| Optional web search | Tavily | Provider-managed search |

The fast Groq model falls back to the main RAG model if it is not configured. Studio generation uses its own Cloudflare model configuration and does not use the main RAG answer model.

---

## Data model and notebook ownership

### Persistence

SQLAlchemy Core stores:

- Notebook IDs, owner hashes, titles, and timestamps.
- Source metadata, source URLs, and source guides.
- Text passages, original locators, and float16 embedding vectors.
- Chat messages and their source/citation metadata.
- Generated Studio outputs.

SQLite is the default local database. PostgreSQL is supported through psycopg. On loading a notebook, stored passages and embeddings are restored into an in-memory FAISS index; reopening a notebook does not require re-embedding its sources.

The database is the durable source of truth. The in-memory notebook cache is an LRU cache and can unload idle notebook indexes. LangGraph's conversation checkpointer is process-local; saved chat messages are used to reseed conversation history when a notebook is reopened or unloaded.

### Device-key ownership (no account login)

There is no email/password login or account system in this version.

- The browser creates a random 32-character hexadecimal owner key and stores it in localStorage.
- Requests send the key in the X-Owner-Key header.
- The backend stores a SHA-256 hash of the key, not the raw key.
- Notebook-scoped requests also send X-Notebook-Id.
- The UI's **Device key & other devices** section lets you copy the key or restore one from another browser.

Keep the key private and store a backup somewhere safe. Anyone with the key can access its notebooks. If browser storage is cleared and the key was not backed up, access to those notebooks may be lost. This is a device-key ownership mechanism, not a conventional user-authentication system.

---

## Technology stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS 4 |
| UI and rendering | React Icons, React Markdown, remark-gfm, rehype-highlight, Highlight.js |
| Frontend state and tests | React hooks, Vitest, Testing Library, jsdom |
| Backend | Python 3.12, Flask 3, Gunicorn, Flask-CORS, Flask-Limiter |
| Orchestration | LangGraph for ingestion and chat; LangChain Core for prompts and runnables |
| RAG models | Groq ChatGroq |
| Studio model | Cloudflare Workers AI ChatCloudflareWorkersAI |
| Embeddings | Cloudflare Workers AI BGE-M3 |
| Reranking | Cloudflare Workers AI BGE Reranker |
| Vector search | FAISS (faiss-cpu) |
| Database | SQLAlchemy Core, SQLite, PostgreSQL, psycopg |
| Media | FFmpeg, ffprobe, Groq Whisper, yt-dlp, YouTube Transcript API |
| Document extraction | pypdf, python-docx, python-pptx, Trafilatura |
| Web search | LangChain Tavily integration |
| Backend quality | pytest, Ruff, pip-audit |
| Frontend quality | Oxlint, Vitest, npm audit |
| Deployment | Docker, Docker Compose, Nginx, Hugging Face Spaces, Vercel, GitHub Actions |

---

## Repository layout

~~~text
RAG_Based_AI_Notebook/
├── .github/
│   ├── dependabot.yml
│   └── workflows/
│       ├── ci.yml                 # Backend and frontend CI checks
│       └── deploy-hf.yml          # Sync backend to Hugging Face Space
├── backend/
│   ├── app/
│   │   ├── answer.py              # Source records and citation validation
│   │   ├── budget.py              # Daily usage budgets
│   │   ├── chains.py              # RAG and Studio model chains
│   │   ├── chat_graph.py          # Agentic RAG and chat-to-Studio routing
│   │   ├── chunking.py            # Chunking and locator utilities
│   │   ├── config.py              # Runtime configuration
│   │   ├── db.py                  # SQLAlchemy persistence
│   │   ├── embeddings.py          # BGE-M3 embeddings
│   │   ├── factory.py             # Flask application factory
│   │   ├── faiss_store.py         # FAISS vector-store adapter
│   │   ├── generate.py            # Studio generation
│   │   ├── ingest.py              # Background ingestion manager
│   │   ├── ingest_graph.py        # LangGraph ingestion workflow
│   │   ├── parsers.py             # PDF, Office, text, Markdown parsing
│   │   ├── prompts.py             # Chat, grading, check, and Studio prompts
│   │   ├── reranker.py            # Cloudflare BGE reranker
│   │   ├── routes.py              # HTTP API endpoints
│   │   ├── security.py            # URL validation / SSRF protection
│   │   ├── store.py               # Notebook library and cache
│   │   ├── studio_intent.py       # Chat-to-Studio intent detection
│   │   ├── transcribe.py          # FFmpeg + Whisper transcription
│   │   ├── webpage.py             # Webpage / PDF extraction
│   │   ├── websearch.py           # Optional Tavily search
│   │   └── youtube.py             # YouTube captions and audio fallback
│   ├── tests/                     # Backend unit and integration tests
│   ├── .env.example
│   ├── Dockerfile
│   ├── gunicorn.conf.py
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── ruff.toml
│   └── wsgi.py
├── deploy/
│   └── hf-space-README.md
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/            # Notebook, source, chat, and Studio UI
│   │   ├── hooks/                 # Chat, source, Studio, route, and theme state
│   │   ├── services/              # API client and stream handling
│   │   ├── utils/                 # Chat export
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── .env.example
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── vercel.json
│   └── vite.config.js
├── docker-compose.yml
├── LICENSE
├── plan.md
└── README.md
~~~

---

## Getting started

### Prerequisites

- Python 3.12.
- Node.js 20.19 or newer (Node 22 is used in CI and the frontend Docker build).
- FFmpeg and ffprobe available on the backend PATH for local audio/video processing.
- A Groq API key.
- A Cloudflare account ID and Workers AI API token with the required Workers AI permissions.
- Optional Tavily API key for web-search fallback.

### 1. Clone the repository

~~~bash
git clone https://github.com/srini526/RAG_Based_AI_Notebook.git
cd RAG_Based_AI_Notebook
~~~

### 2. Configure and start the backend

~~~bash
cd backend
python -m venv .venv
~~~

Activate the virtual environment:

**Windows PowerShell**

~~~powershell
.\\.venv\\Scripts\\Activate.ps1
~~~

**macOS / Linux**

~~~bash
source .venv/bin/activate
~~~

Install the development dependencies (this includes the runtime requirements):

~~~bash
pip install -r requirements-dev.txt
~~~

Install FFmpeg separately using your operating system's package manager, then confirm that both ffmpeg and ffprobe are on PATH.

Copy the environment template:

**Windows PowerShell**

~~~powershell
Copy-Item .env.example .env
~~~

**macOS / Linux**

~~~bash
cp .env.example .env
~~~

At minimum, configure:

~~~env
GROQ_API_KEY=your_groq_api_key
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_API_TOKEN=your_cloudflare_workers_ai_token
ALLOWED_ORIGINS=http://localhost:5173

# Optional: enables web-search fallback when notebook retrieval is insufficient
TAVILY_API_KEY=your_tavily_api_key
~~~

See backend/.env.example for the full configuration surface, including model choices, notebook limits, rate limits, daily usage caps, retention, and YouTube options.

Start the development API from the backend directory:

~~~bash
flask --app wsgi:app run --debug --port 8000
~~~

The local API is available at http://localhost:8000; its health endpoint is http://localhost:8000/api/health.

For a production-style local server, use the configured Gunicorn entry point:

~~~bash
gunicorn -c gunicorn.conf.py wsgi:app
~~~

### 3. Configure and start the frontend

In a second terminal, from the repository root:

~~~bash
cd frontend
~~~

Copy the frontend environment template and set the API URL:

~~~env
VITE_API_URL=http://localhost:8000
~~~

Install packages and start Vite:

~~~bash
npm ci
npm run dev
~~~

Open http://localhost:5173.

For a production build, VITE_API_URL must point to the deployed backend URL. The Vite configuration intentionally fails a production build when the variable is missing, rather than silently shipping a frontend that calls localhost.

**Windows PowerShell production build**

~~~powershell
$env:VITE_API_URL="https://your-backend.example.com"
npm run build
~~~

**macOS / Linux production build**

~~~bash
VITE_API_URL=https://your-backend.example.com npm run build
~~~

---

## Docker Compose

Docker Compose starts the Flask API and Nginx-served React frontend.

From the repository root:

~~~bash
cp backend/.env.example backend/.env
~~~

Add the required provider credentials to backend/.env, then run:

~~~bash
docker compose up --build
~~~

- Frontend: http://localhost:8080
- Backend: http://localhost:8000
- SQLite data: the named study-data Docker volume mounted at /app/data

The backend image uses Python 3.12 slim, installs FFmpeg, and runs Gunicorn as a non-root user. The frontend image builds with Node 22 and serves the static Vite output with Nginx.

---

## API reference

All API routes are prefixed with /api.

Notebook ownership headers:

- X-Owner-Key: required 32-character hexadecimal device key.
- X-Notebook-Id: required on notebook-scoped routes.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /api/health | Health and provider-configuration status |
| GET | /api/config | Allowed file types, limits, answer styles, and generation kinds |
| GET | /api/notebooks | List notebooks owned by the supplied device key |
| POST | /api/notebooks | Create a notebook |
| PATCH | /api/notebooks/<id> | Rename a notebook |
| DELETE | /api/notebooks/<id> | Delete notebook, sources, messages, and outputs |
| GET | /api/notebook | Load notebook details, sources, chat history, and saved outputs |
| GET | /api/library | List a notebook's sources and processing status |
| POST | /api/library/file | Upload a supported file; returns 202 while ingestion runs |
| POST | /api/library/url | Add a webpage, PDF URL, or YouTube URL; returns 202 |
| DELETE | /api/library/<doc_id> | Delete one source |
| DELETE | /api/library | Clear all sources from a notebook |
| POST | /api/chat | Run a chat turn and return the completed answer |
| POST | /api/chat/stream | Stream chat progress and answer tokens using SSE |
| DELETE | /api/chat | Clear saved chat history for a notebook |
| POST | /api/generate | Stream a Studio generation using SSE |
| DELETE | /api/outputs/<output_id> | Delete a saved Studio output |

### Chat request

POST /api/chat and POST /api/chat/stream accept JSON fields:

| Field | Required | Description |
|---|---|---|
| question | Yes | User question; maximum 2,000 characters |
| mode | No | normal, simple, exam, or deep |
| doc_ids | No | Source IDs to scope retrieval; omit or pass an empty list to use all ready sources |

The streaming endpoints emit SSE events for workflow steps, answer tokens, stream resets, saved Studio outputs, completion metadata, and errors.

### Studio generation kinds

POST /api/generate accepts a kind and optional doc_ids. Supported API kinds are briefing, study_guide, faq, timeline, mindmap, flashcards, quiz, and questions. The last kind returns suggested follow-up questions and is not stored as a regular Studio output. The frontend exposes the other seven tools.

---

## Configuration

Runtime settings are defined in backend/app/config.py and can be overridden with environment variables. backend/.env.example documents the full set of options.

### Models and retrieval

| Variable | Default | Purpose |
|---|---|---|
| LLM_MODEL | openai/gpt-oss-120b | Main Groq model for grounded answers and direct chat |
| FAST_LLM_MODEL | openai/gpt-oss-20b | Faster Groq model for routing, rewriting, and structured checks |
| STUDIO_LLM_MODEL | @cf/openai/gpt-oss-120b | Cloudflare Workers AI model for Studio and source guides |
| WHISPER_MODEL | whisper-large-v3 | Groq audio transcription model |
| WHISPER_LANGUAGE | Auto-detect | Optional transcription language, e.g. en or hi |
| TOP_K | 6 | Final passage count used for answer generation |
| RERANKER_ENABLED | true | Enable Cloudflare BGE reranking |
| RERANKER_CANDIDATE_K | 20 | Candidate passages fetched before reranking |
| GRADE_MODE | score | score, llm, or off relevance handling |
| MIN_SCORE | 0.35 | Similarity threshold when score grading is active without reranking |
| MAX_REWRITES | 2 | Maximum query rewrites before web fallback or no-result response |
| FAST_ROUTER | true | Skip the router model call for first substantive messages and small talk |
| SELF_CHECK | true | Enable LLM grounding checks when applicable |
| SELF_CHECK_MIN_CHARS | 500 | Minimum library-answer length for an LLM grounding check; web answers are checked |
| WEB_FALLBACK | true | Allow Tavily fallback when configured |
| MAX_WEB_RESULTS | 4 | Maximum web-search results |
| MAX_HISTORY_MESSAGES | 10 | Conversation messages supplied as context |
| STUDIO_FOCUS_K | 14 | Passage count for topic-focused Studio generation |
| GEN_CONTEXT_CHARS | 12000 | Studio source-context character budget |
| SOURCE_GUIDES | true | Generate a guide when a new source is indexed |

The legacy GRADE_DOCS=false setting is still recognized as an alias for GRADE_MODE=off.

### Storage, resource limits, and quotas

| Variable | Default | Purpose |
|---|---:|---|
| DATABASE_URL | sqlite:///data/study_assistant.db | SQLite or PostgreSQL connection URL |
| MAX_NOTEBOOKS_PER_OWNER | 10 | Notebooks allowed per device key |
| NOTEBOOK_RETENTION_DAYS | 60 | Delete inactive notebooks after this many days; 0 disables purging |
| MAX_UPLOAD_MB | 100 | Maximum uploaded file size |
| MAX_MEDIA_MINUTES | 120 | Maximum audio/video/YouTube media length |
| MAX_DOCS_PER_SESSION | 10 | Maximum sources per notebook |
| MAX_CHUNKS_PER_SESSION | 3000 | Maximum indexed passages per notebook |
| MAX_LOADED_NOTEBOOKS | 30 | Maximum notebooks held in the in-memory cache |
| IDLE_UNLOAD_MINUTES | 60 | Unload an idle notebook from memory after this period |
| INGEST_WORKERS | 2 | Concurrent ingestion workers |
| DAILY_CHAT_LIMIT | 2000 | Global daily chat request cap |
| DAILY_GENERATE_LIMIT | 300 | Global daily Studio generation cap |
| DAILY_INGEST_LIMIT | 300 | Global daily ingestion cap |

### Web, proxy, and rate limits

| Variable | Default | Purpose |
|---|---|---|
| ALLOWED_ORIGINS | http://localhost:5173 | Comma-separated frontend origins allowed by CORS |
| TRUST_PROXY_HOPS | 1 | Number of trusted reverse-proxy hops for client IP handling |
| RATE_LIMIT_ENABLED | true | Enable Flask-Limiter |
| RATE_LIMIT_DEFAULT | 240 per minute | Default API rate limit |
| RATE_LIMIT_CHAT | 20 per minute | Chat and generation rate limit |
| RATE_LIMIT_INGEST | 20 per hour | File and URL ingestion rate limit |
| TAVILY_API_KEY | Empty | Enables Tavily when web fallback is enabled |
| YOUTUBE_PROXY_URL | Empty | Optional proxy for YouTube metadata/captions/downloads |
| YTDLP_COOKIES_FILE | Empty | Optional cookie file for yt-dlp |
| LOG_LEVEL | INFO | Backend log level |

Daily budgets and Flask-Limiter currently use in-memory storage. They are process-local, not shared across multiple backend instances.

---

## Security and operational safeguards

The current code includes:

- Device-key ownership checks and hashed owner-key storage.
- HTTP(S)-only URL ingestion with public-IP validation, standard-port restrictions, and redirect revalidation to reduce SSRF risk.
- File type allowlisting and upload-size limits.
- DOCX/PPTX archive-size checks to reduce zip-bomb risk.
- PDF page, text file, media duration, and chunk-count limits.
- API rate limits and global daily request budgets.
- CORS origin allowlisting.
- Security headers including X-Content-Type-Options and Referrer-Policy.
- No-store cache headers for API responses.
- A non-root user in the backend container.
- Automatic cleanup of abandoned ingestion working directories.

### Important deployment constraint: one Gunicorn worker

Run the backend with **one Gunicorn worker** using the supplied backend/gunicorn.conf.py. The active notebook cache and LangGraph checkpointer are in process memory. Multiple workers or horizontally scaled instances do not share those objects and can produce inconsistent notebook/chat behavior. The configured Gunicorn worker uses threads to serve concurrent requests.

For production persistence on hosts with ephemeral local storage, configure DATABASE_URL to a managed PostgreSQL database and keep database backups. The code creates tables automatically; it does not currently include a database migration framework.

---

## Tests and quality checks

### Backend

From backend/:

~~~bash
ruff check .
pytest -q --ignore=tests/test_reranker_manual.py
~~~

The automated backend tests cover API validation, device-key ownership, notebook isolation, ingestion, parsing, chunking, vector retrieval, chat routing, query rewriting, reranking fallback behavior, citations, Studio generation, persistence across app restarts, and resource limits. Most test paths use fake embeddings, scripted chains, and mocked external services.

**Manual reranker check:** backend/tests/test_reranker_manual.py is a live Cloudflare API exercise. It loads credentials and calls the actual reranker at module import, so do not include it in a credential-free test run. Run it deliberately from backend/ when Cloudflare credentials and network access are available.

The current .github/workflows/ci.yml runs plain pytest -q, which discovers that manual test file. The backend CI job may therefore require a follow-up isolation or exclusion of that manual check before it can run without Cloudflare credentials.

### Frontend

From frontend/:

~~~bash
npm ci
npm test
npm run lint
npm run build
~~~

The frontend CI uses Node 22 and runs Vitest, Oxlint, a production Vite build, and an npm audit check.

---

## Deployment

### Hugging Face Spaces backend + Vercel frontend

The repository includes a GitHub Actions workflow to synchronize the backend directory to a Docker-based Hugging Face Space.

1. Create a Docker Space.
2. Add a GitHub Actions secret named HF_TOKEN with write access to the Space.
3. Add a repository variable named HF_SPACE with the value account-name/space-name.
4. Configure the Space secrets: GROQ_API_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, DATABASE_URL, and ALLOWED_ORIGINS. Add TAVILY_API_KEY if web fallback is required.
5. Point DATABASE_URL at persistent PostgreSQL because the Space's local disk can be reset when the container restarts.
6. Push a change under backend/ to main, or run the workflow manually. The workflow syncs the backend files to the Space.
7. Check the backend at the Space URL followed by /api/health.

For the frontend:

1. Import the repository into Vercel.
2. Set the project root directory to frontend.
3. Set VITE_API_URL to the backend Space URL.
4. Add the exact deployed Vercel origin to backend ALLOWED_ORIGINS.
5. Deploy the frontend.

The frontend's vercel.json configures SPA routing and security headers. The Content Security Policy includes a hash for the inline theme bootstrap script in frontend/index.html; update the CSP hash if that script changes.

### Docker Compose deployment

For a local machine or VPS with persistent storage, Docker Compose runs both services and mounts a named volume for SQLite data. For a hosted environment with ephemeral disk, use PostgreSQL and configure DATABASE_URL.

---

## Known limitations and out-of-scope features

- There is no conventional user login, account recovery, or server-side device-key revocation.
- Device-key loss can mean loss of access to a notebook.
- Scanned/image-only PDFs are not OCR processed.
- Webpages that require JavaScript execution, login, or browser interaction may not be extractable.
- YouTube captions may be unavailable, and yt-dlp downloads can be blocked from some cloud IP ranges. Proxy and cookie settings are available, but do not guarantee access.
- Studio generation samples long sources to stay within the configured context budget; small details can be missed.
- Retrieval is vector-based; there is no BM25/keyword hybrid retrieval stage.
- Audio Overview is not implemented.
- Background ingestion and request budgets are in-process; there is no durable distributed job queue or shared rate-limit store.
- The repository does not currently contain an MCP server or MCP API integration; the commented MCP dependency reference in requirements.txt is not an implemented feature.

---

## Roadmap

See [plan.md](./plan.md) for the planned reliability, retrieval-quality, source-ingestion, security, and performance improvements.

## License

This project is licensed under the [MIT License](./LICENSE).
