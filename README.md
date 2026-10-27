# AI Study Assistant

A NotebookLM-style study app. Create **notebooks**, add sources (PDF, Word, slides, notes, audio/video, YouTube, web pages), then chat with citations and generate study material. Notebooks are saved on the server; there is no login (see *Device key*).

## What you get
- **Sources panel:** upload or paste links. Every source gets an automatic **source guide** (summary, key topics, starter questions). Tick sources to ask or create from only those.
- **Chat:** an agentic RAG graph (analyze → retrieve → grade → rewrite → answer → self-check) with live steps, web-search fallback (clearly labelled), answer styles, stop / regenerate / copy, and Markdown export. Answers cite sources as **clickable [1] chips that open the exact passage** (and the page or timestamp link when there is one).
- **Studio panel:** Briefing doc, Study guide, FAQ, Timeline, Mind map, Flashcards and Quiz. Outputs are saved with the notebook and cite their sources too.
- **Saved notebooks:** sources, source guides, chat history and Studio outputs persist in a database; embeddings are stored too, so reopening a notebook needs no re-processing.
- Light/dark theme, mobile tabs (Sources | Chat | Studio).

## Architecture
```
React (Vite, Tailwind)  ──SSE──▶  Flask API (gunicorn, 1 worker + threads)
                                    ├─ LangGraph chat graph   (route → retrieve → grade → rewrite → generate → self-check)
                                    ├─ LangGraph ingest graph (parse → chunk → embed → index → source guide)
                                    ├─ LangChain chains       (prompts + Groq LLM + structured output)
                                    ├─ FAISS (in memory)      one index per open notebook, rebuilt from the database
                                    ├─ SQLAlchemy             SQLite file locally, Postgres in production
                                    └─ Cloudflare Workers AI (BGE-M3 embeddings), Groq (LLM + Whisper), Tavily (optional)
```
LangChain is used for models, prompts and chains; LangGraph only for the two graphs.

**Device key (no login).** The browser creates a random key stored in `localStorage` and sends it with every request; the server stores only its hash. Notebooks belong to that key. Home → *Device key* shows it so you can copy it to another device. Clearing browser data without a copy loses access; anyone holding the key can open the notebooks.

## Run locally
```bash
# backend (Python 3.12, ffmpeg installed)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env        # add GROQ_API_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
python wsgi.py              # http://localhost:8000  (notebooks in backend/data/study_assistant.db)

# frontend (Node 20.19+ or 22)
cd frontend
npm install
npm run dev                 # http://localhost:5173
```
Or with Docker: `cp backend/.env.example backend/.env`, fill the keys, `docker compose up --build` → http://localhost:8080 (notebooks live in a Docker volume).

## Deploy
**Database first.** Free hosts wipe their disk on restart, so use a free hosted Postgres (Neon or Supabase) and copy its connection string into `DATABASE_URL`. Tables are created automatically.

**Backend → Hugging Face Space (Docker, free)**
1. Create a *Docker* Space. Secrets: `GROQ_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `DATABASE_URL`, `ALLOWED_ORIGINS` (your exact Vercel URL), optional `TAVILY_API_KEY`.
2. In GitHub add secret `HF_TOKEN` (write token) and variable `HF_SPACE` (`user/space-name`). Each push touching `backend/` syncs to the Space (`.github/workflows/deploy-hf.yml`).
3. Check `https://<space>.hf.space/api/health`. If per-user rate limits look shared, adjust `TRUST_PROXY_HOPS`.

**Frontend → Vercel**
1. Import the repo, root directory `frontend`. 2. Set `VITE_API_URL` to the Space URL (the build **fails on purpose** if it is missing). 3. `vercel.json` sets security headers; if you edit the inline theme script in `index.html`, recompute its sha256 in the CSP.

## Limits and safeguards
| Setting | Default |
|---|---|
| Notebooks per device key / sources per notebook | 10 / 10 |
| Upload size / media length | 100 MB / 120 min |
| Notebooks kept in memory / idle unload | 30 / 60 min (data stays in the database) |
| Inactive notebooks deleted after | 60 days (`NOTEBOOK_RETENTION_DAYS`, 0 = never) |
| Rate limits (per IP) | chat & Studio 20/min, ingest 20/hour |
| Global daily caps (all users) | 2000 chats, 300 Studio runs, 300 ingests |
| Material read by one Studio call | ~12,000 characters, sampled evenly across long sources |

Also: SSRF protection for links, zip-bomb check for DOCX/PPTX, strict security headers, non-root container. Run **one gunicorn worker** (already configured): open notebooks are cached in that process. A full notebook costs about 12 MB of memory and about 6 MB in the database (float16 embeddings).

## Configuration
Environment variables only; see `backend/.env.example`.

## API (all under `/api`; headers `X-Owner-Key`, and `X-Notebook-Id` for notebook routes)
`GET/POST /notebooks` · `PATCH/DELETE /notebooks/<id>` · `GET /notebook` (sources, chat, outputs) · `GET /library` · `POST /library/file` · `POST /library/url` · `DELETE /library/<id>` · `DELETE /library` · `POST /chat/stream` (SSE) · `POST /chat` · `DELETE /chat` · `POST /generate` (SSE; `kind`: briefing, study_guide, faq, timeline, mindmap, flashcards, quiz, questions) · `DELETE /outputs/<id>` · `GET /config` · `GET /health`

## Tests
```bash
cd backend && pytest -q      # no network needed
cd frontend && npm test      # API streaming + component tests (jsdom)
```

## Known limits
- Scanned (image-only) PDFs are rejected; there is no OCR.
- YouTube audio download is often blocked from cloud IPs; captions work for most videos. Set `YOUTUBE_PROXY_URL` if needed.
- Studio tools sample long sources, so fine detail may be missed; ask the chat for specifics.
- Retrieval is vector-only (no keyword/BM25 hybrid or reranker yet).
- Regenerate re-asks the question, so the saved chat keeps both versions.
- No Audio Overview yet.

MIT licensed.
