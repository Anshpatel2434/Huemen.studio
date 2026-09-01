# Decisions log

The open decisions from brief §09, plus architecture decisions made during the
build. Record decisions here as they land (AGENTS.md §7). `Proposed` = default
carried from the brief, not yet confirmed with the client.

## §09 — Open decisions (settle in week one)

| # | Decision | Status | Value |
|---|----------|--------|-------|
| 1 | Carousel / quote-card rendering | Proposed (brief default) | **Templated canvas** — real text overlay + model-generated backgrounds. Image models misrender text; a typo on a client carousel is a brand failure. |
| 2 | Image model choice | **Open** | Evaluate on brand-consistency + aspect-ratio control (not benchmarks) once real assets arrive. Blocks Visual Studio tuning (Phase 2). |
| 3 | Text model routing | Proposed (brief default) | **Route by task** — strong model for drafting, cheap for hooks/tags. Implemented as config: `AI_TEXT_MODEL_STRONG` / `AI_TEXT_MODEL_CHEAP`, `route` param on `generateText`. |
| 4 | Fonts in generated images | **Open — needs asset licences** | Brand fonts may not be licensed for server-side embedding. Check when assets arrive day one; may force a fallback. Affects Visual Studio + the app display face (currently Inter/Newsreader substitutes for Borna). |
| 5 | Notion export | Proposed (brief default) | **Markdown export**, no Notion API integration in v1. |
| 6 | Multi-language | Proposed (brief default) | **English-only** in v1. Context object already carries `language` as a parameter (`buildBrandContext`) so i18n is additive later. |

## Build decisions

| Decision | Rationale |
|----------|-----------|
| Runtime connects as non-owner `huemen_app` + `FORCE RLS` | Guarantees RLS applies to all app queries; owner/migrations kept separate. |
| Tenant scope via transaction-local GUC (`set_config(...,true)`) | Safe parameterisation, auto-reset per transaction, keys RLS policies. |
| Admin bypass ONLY on management/log tables, never client content | Limits blast radius of an admin-code bug — cannot leak client content. |
| Dev cookie auth adapter behind a `Session` interface | App runs locally with no external accounts; managed provider swaps in without touching feature code. |
| Postgres-backed job queue (`jobs` table) for v1 | Handover-friendly (no extra infra); can swap to Redis via `QUEUE_DRIVER`. |
| Docker host port 5544 for local Postgres | Avoids collision with a machine's native Postgres on 5432. |
| Inter + Newsreader as font substitutes for Borna | Borna is a commercial licence (decision #4). Swap once confirmed. |
