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
| Workspace → projects (migration 0003) | Client asked for a Relume/Figma-style flow where a workspace holds many projects, each running Brief → Pillars → Content → Visual stepwise. `projects` carries `tenant_id` + FORCE RLS with no admin bypass; `project_id` groups rows within a tenant. The brief is per project (a new project can copy another's brief) — note this relaxes "brand defined once" from one-per-workspace to one-per-project. |
| Stepwise gating in `projects.stage` | Steps unlock in order and never skip (`unlockStage`); pages show a locked state instead of empty screens. |
| Visual step = templated sets, not image-model output | Brief §09 default: real text overlay avoids misspelt carousels. Rows go to `image_assets` with `model='template'`; model backgrounds can be added later. |
| Monochrome UI, no gradients (supersedes the vermilion accent in AGENTS.md §3.5) | Client direction 2026-09-21: black, white and neutral grey only, to feel more professional. The `--accent` token now equals ink; status colours are grey and meaning comes from icons and weight. Tenant branding can still override tokens. Client palettes still colour their own visuals. |
| Slow route transitions via React `<ViewTransition>` | Client asked for page transitions that are "not fast and snappy". One `PageTransition` component keyed by path: the old page fades out in 420ms, the new one rises in over 900ms, and the persistent chrome (sidebar, top bar) stays still. `default="none"` means server-action refreshes such as star or rename never animate. Browsers without the View Transitions API simply navigate. Timings are CSS tokens in `globals.css`. |
| Light / dark view as a first-class control | Client asked for a themes feature with light and dark views. `ThemeProvider` (in the root layout, seeded from the `huemen_theme` cookie so the first paint is correct) swaps `<html data-theme>` on the client with no reload, crossfades the whole screen over 750ms and saves the cookie in the background (`saveThemeAction`, no revalidate). Controls: a Light/Dark switch in the home sidebar, a sun/moon toggle in the editor tool rail and on the landing and sign-in pages, and Dark/Light/System preview cards in Settings. Artboards stay light in both views. |
| Editable canvas (inline text, drag, undo) | Client asked for the canvas to be editable. Double-click any text on the Pillars map, Content wireframes or Visual artboards to edit it in place (Enter / Cmd+Enter saves, Esc cancels). Drag the grip to reorder pillars (`reorderPillars`, `sort_order`) and drag a post by its label to another pillar. Delete removes the selection after a confirm, and Cmd/Ctrl+Z / Cmd+Shift+Z undo and redo for the open canvas (history lives in the page, as in Figma). Visual edits write back to the post copy (`patchContent`), so there is one source of truth. Changing copy marks a post "edited", so an approved post needs approving again; moving it keeps its status. `patchContent` refuses a pillar from another project; tested. Shared pieces live in `components/canvas-edit.tsx`. |
| Permanent project delete | Client asked for a delete button next to Archive. It is in the card ⋯ menu (active and archived projects) and the editor file menu, and you must type the project name to confirm, with "Archive instead" as the reversible option. `deleteProject` removes the project row, and ON DELETE CASCADE takes its brief, pillars, content and history, visuals, ideas, calendar and offers. Stored files are then removed best effort. `generation_logs` rows stay (content link nulled) so workspace usage and the audit trail stay accurate. Another tenant cannot delete it; tested. |
| Auth pages: passwordless, invite-only | Client asked for all the auth pages the app needs. Following brief §02 there is no public sign-up and no password, so there are no register or forgot-password pages. Sign in (`/login`, with `?next=` return-to) emails a one-time link and shows `/login/check-email`. `/auth/verify` checks it and starts the session. `/auth/link-expired` covers expired, used and broken links, with a resend. `/invite/[token]` shows who invited you, to which workspace and in what role, and accepting it activates the account. Also `/auth/disabled` (account off or workspace archived), `/signed-out`, and branded `not-found` and `error` pages. `proxy.ts` sends signed-out visitors to sign in and back. Links are HMAC-signed and purpose-bound; sign-in links expire in 15 minutes and are single-use via `last_seen_at`; invites last 7 days and are single-use via status. Admins copy pending invite links from Workspaces & access. The dev driver prints the mail and shows a "dev inbox" link; production mail goes through the managed provider in `lib/mail.ts`. Tests in `tests/auth-links.test.ts`. |
