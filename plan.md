# RAG-Based AI Notebook — Development Plan

This roadmap separates the current implementation from suggested next steps. The current app already supports multi-format ingestion, persistent notebooks, device-key ownership, vector retrieval, source citations, agentic query rewriting, optional web fallback, self-checking, streamed chat, and the Study Studio tools described in [README.md](README.md).

## Product direction

Evolve the notebook into a more reliable, measurable, and secure source-grounded knowledge workspace without sacrificing its lightweight deployment model.

## Phase 1 — Reliability and correctness

**Goal:** make the current end-to-end workflows predictable and easier to debug.

- [ ] Run the full backend pytest suite and frontend Vitest suite in CI on every pull request.
- [ ] Add integration tests covering create notebook → ingest each supported source type → wait for ready state → retrieve → cite → persist → reload notebook.
- [ ] Add end-to-end tests for direct chat, library-grounded chat, web fallback, generation tools, and deletion flows.
- [ ] Add test cases for malformed provider responses, Cloudflare/Groq rate limits, empty extraction results, timeouts, and interrupted SSE streams.
- [ ] Verify that citations always reference a passage actually supplied to the answer model and that locators remain correct after chunk merging.
- [ ] Add tests that validate the configured upload, document, media-duration, daily-budget, and rate-limit boundaries.
- [ ] Document an operational recovery procedure for database backup, restore, and migration.

**Exit criteria:** critical workflows have automated regression coverage; provider or parsing failures return clear errors without corrupting saved notebook data.

## Phase 2 — Retrieval quality

**Goal:** improve answer relevance and reduce unsupported responses.

- [ ] Establish a small, versioned evaluation dataset of representative questions and expected source passages.
- [ ] Track retrieval metrics such as Recall@k, MRR, and citation coverage against that dataset.
- [ ] Experiment with hybrid retrieval combining FAISS vector similarity and keyword/BM25 retrieval.
- [ ] Evaluate a lightweight cross-encoder or model-based reranker before answer generation.
- [ ] Tune chunking by source type, document structure, tables, headings, slide boundaries, and timestamps.
- [ ] Add metadata filters for source, section, page range, and media time range where useful.
- [ ] Compare retrieval quality across embedding models before changing the current BGE-M3 default.
- [ ] Keep a conservative fallback when relevance grading or reranking providers fail.

**Exit criteria:** measurable improvement on the evaluation set without reducing citation accuracy or unacceptable increases in latency/cost.

## Phase 3 — Answer quality and transparency

**Goal:** make grounding behavior more observable and user-controllable.

- [ ] Expand grounding tests to check individual claims and citation-to-passage support.
- [ ] Show when the answer came from notebook sources, external web search, or general conversational knowledge.
- [ ] Make low-confidence or insufficient-evidence behavior explicit in the response UI.
- [ ] Add a user-visible explanation of why passages were selected.
- [ ] Add a clear distinction between retrieved evidence, model interpretation, and unanswered questions.
- [ ] Evaluate whether one self-check/regeneration cycle is sufficient on representative tasks.
- [ ] Capture structured quality events without storing unnecessary private source content in logs.

**Exit criteria:** users can understand the origin of an answer and recognize when the available evidence is insufficient.

## Phase 4 — Ingestion and source coverage

**Goal:** improve extraction quality for real-world documents and media.

- [ ] Add optional OCR support for scanned/image-only PDFs, with clear status and per-file limits.
- [ ] Expand parser tests for tables, malformed Office documents, large files, Unicode, and mixed-language content.
- [ ] Improve handling of webpage extraction failures, dynamic pages, redirects, and content that requires authentication.
- [ ] Add robust retry/backoff and provider error classification for transcription and embedding calls.
- [ ] Improve YouTube ingestion diagnostics for caption restrictions, proxy failures, and audio download blocks.
- [ ] Verify timestamp alignment and chunk locator behavior across segmented media files.
- [ ] Add ingestion cancellation and safe cleanup for abandoned jobs.
- [ ] Consider additional source formats only after the current supported formats have stable tests.

**Exit criteria:** ingestion reports actionable per-source status and preserves valid sources when another source fails.

## Phase 5 — Persistence, ownership, and security

**Goal:** make multi-user use and production operation safer.

- [ ] Review the device-key threat model and offer a safer account-backed ownership option if the product requires it.
- [ ] Add optional device-key rotation with recovery and explicit user confirmation.
- [ ] Evaluate key expiration, revocation, and recovery without exposing raw keys in server logs.
- [ ] Add database migrations instead of relying only on table creation.
- [ ] Test SQLite and PostgreSQL persistence behavior, including concurrent writes and restore paths.
- [ ] Add scheduled database backup/restore verification for hosted deployments.
- [ ] Review SSRF protections against DNS rebinding, redirects, IPv4/IPv6 edge cases, and metadata-service addresses.
- [ ] Review upload parsing and archive limits for resource exhaustion and malicious input.
- [ ] Revisit rate limits and daily budgets for multi-process or multi-instance deployments; current in-memory limits are process-local.
- [ ] Add a deployment readiness checklist for secrets, HTTPS, CORS, proxy hops, database, and worker count.

**Exit criteria:** ownership and deployment assumptions are explicit, testable, and suitable for the selected hosting model.

## Phase 6 — Performance and operational visibility

**Goal:** control latency, resource use, and provider cost as usage grows.

- [ ] Instrument ingestion, embedding, retrieval, grading, generation, and self-check durations.
- [ ] Record token usage and provider request counts where APIs expose them.
- [ ] Add structured logs with request/notebook correlation IDs while avoiding sensitive text.
- [ ] Benchmark memory use for loaded notebook indexes and tune cache eviction settings.
- [ ] Evaluate background job persistence and a shared job queue before scaling beyond one process.
- [ ] Add health checks for required services and distinguish application health from provider configuration.
- [ ] Review frontend accessibility, keyboard navigation, mobile layout, and streaming reconnect behavior.

**Exit criteria:** latency, errors, resource use, and model usage can be measured well enough to make informed deployment decisions.

## Suggested order

1. Phase 1 — Reliability and correctness
2. Phase 2 — Retrieval quality
3. Phase 3 — Answer transparency
4. Phase 4 — Ingestion improvements
5. Phase 5 — Ownership, persistence, and security
6. Phase 6 — Performance and operational visibility

Prioritize regression tests and a small retrieval evaluation set before introducing major retrieval or architecture changes.
