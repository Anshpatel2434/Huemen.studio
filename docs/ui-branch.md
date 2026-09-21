# The `ui` branch: guide and rollbacks

The `ui` branch is the Relume/Figma-style rebuild of the Huemen.studio interface.
`main` is untouched: it is still Ansh's last commit (`069b244`), so the old app is
always one command away.

| Name | Points at | Meaning |
|---|---|---|
| `main` | `069b244` | The app before the UI rebuild. Never modified by this work. |
| tag `pre-ui` | `069b244` | A fixed marker for the same point, in case `main` moves later. |
| branch `ui` | latest UI work | Where UI work continues. |
| tag `ui-v1` | first UI commit | The reviewed, working state of the rebuild. |

Every later milestone gets its own tag (`ui-v2`, `ui-v3`, …), so there is always a
known-good point to return to (§6).

---

## 1. What's on this branch

- **Workspace → projects.** A workspace holds many projects. Each runs Brief →
  Pillars → Content → Visual, and steps unlock in order (migrations 0003–0005).
- **Figma-style home and editor.** File-browser home (recents, starred, grid/list,
  archive, delete) and a canvas editor with a stepper, layers, and the Add and Agent panels.
- **Editable canvas.** Double-click any text on Pillars, Content or Visual to edit it
  in place; drag to reorder pillars or move posts between pillars; Delete; ⌘Z / ⌘⇧Z.
- **Light / dark view.** Sidebar switch, editor rail toggle and Settings → Appearance.
  Dark is the default.
- **Monochrome design.** Black, white and grey only, no gradients.
- **Slow page transitions** (React `<ViewTransition>`).
- **Auth pages.** Passwordless, invite-only sign-in with a one-time link, check
  email, expired link, accept invite, access paused, signed out, and branded 404
  and error pages. There is no public sign-up, per brief §02.

Design decisions and their reasons are in `docs/decisions.md`.

## 2. Get it running

```bash
git fetch origin
git switch ui
npm ci
cp .env.example .env        # first time only; fill in values
npm run db:up               # or start your local Postgres 18
```

**Back up the database before migrating**, because the branch adds three migrations (§5):

```bash
pg_dump "$DATABASE_ADMIN_URL" -Fc -f huemen-before-ui.dump
npm run db:migrate          # applies 0003–0005; re-running is a no-op
npm run db:seed             # optional: demo workspace and accounts
npx next dev -p 3120        # http://localhost:3120
```

Sign in at `/login`. Locally (`AUTH_DRIVER=dev`) no email is sent: either click a
**dev account**, or enter an email and use the **Dev inbox** link on the
"Check your email" page.

## 3. Using it (quick tour)

1. **Home.** Click **New project**, **From a brief** or **Paste notes**. The ⋯ menu on a
   card has Open, Star, Rename, New project from this brief, Archive and Delete.
2. **Brief.** Intake, then the brief questions. Answering them unlocks Pillars.
3. **Pillars.** Generate from the right panel, or edit the map directly: double-click
   names and descriptions, drag the grip to reorder, **Add pillar**.
4. **Content.** Generate from pillars. Double-click the hook, body or CTA on a post to
   edit it; drag a post by its label to another pillar; click a post for variants,
   steers and **Approve**.
5. **Visual.** Pick a scheme and generate. The artboard text is editable and writes
   back to the post.
6. **Export.** Brand health and a Markdown export.

Shortcuts on any canvas: **V** select · **H** or hold **Space** for hand · **⇧1**
zoom to fit · **⌘/Ctrl+scroll** zoom · **⌘/Ctrl+Z** undo · **⌘⇧Z / Ctrl+Y** redo ·
**Delete** removes the selection.

Admins invite people from **Settings → Workspaces & access**. A pending invite
shows a copyable link (valid 7 days) until a mail provider is connected in
`src/lib/mail.ts`.

## 4. Before merging or deploying

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

`npm test` needs the database running. If it is down, the DB tests skip and the
run can look green without testing anything. Merge through a pull request
`ui → main`, and don't push directly to `main`.

---

## 5. Database changes and how to undo them

The branch adds `projects` (0003), `projects.starred` (0004) and a smarter
`updated_at` trigger (0005). Existing data is kept: each workspace's current
brief, pillars and content are moved into one "Personal brand" project.

**Rollback option A (preferred): restore the backup** taken in §2:

```bash
pg_restore --clean --if-exists -d "$DATABASE_ADMIN_URL" huemen-before-ui.dump
```

This returns the database to exactly how it was, but anything created after the
backup is lost.

**Rollback option B (no backup): run the down script.**

```bash
psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0003-0005_projects.down.sql
```

This removes `projects` and every `project_id` column and keeps all rows: briefs,
pillars, content and so on stay in their workspace. It runs in one transaction,
and `npm run db:migrate` re-applies 0003–0005 afterwards if you change your mind.
Both directions were tested on a copy of the dev database (2026-09-21).

## 6. Rollbacks: pick the smallest one that fixes the problem

**Level 1: undo one change.** Every change after `ui-v1` is its own commit:

```bash
git log --oneline ui-v1..ui          # find it
git revert <commit>                  # new commit that undoes it; history is kept
```

For something inside `ui-v1` itself, these are the entry points to switch off:

| Feature | Where it lives | Switching it off |
|---|---|---|
| Page transitions | `components/page-transition.tsx` | Render `{children}` instead of `<PageTransition>` in the 4 layouts. |
| Light/dark switch | `components/theme.tsx` | Remove `<ThemeSwitch>` and `<ThemeToggle>`; the cookie default (dark) still applies. |
| Canvas editing | `components/canvas-edit.tsx` | Make `EditableText` return its plain text (no double-click); the boards become view-only again. |
| Project delete | `components/delete-project-modal.tsx`, `deleteProjectAction` | Remove the two "Delete" menu items. |
| Signed-out redirect | `src/proxy.ts` | Delete the file; pages still redirect to `/login` themselves. |

**Level 2: go back to an earlier UI state** (e.g. `ui-v1`), without losing later work:

```bash
git switch -c ui-rollback ui-v1      # new branch at the old state; `ui` is untouched
```

Only if you really mean to move `ui` itself back (this discards the later commits
from `ui`, so push a backup branch first):

```bash
git branch ui-backup ui && git switch ui && git reset --hard ui-v1
```

**Level 3: the whole rebuild off.** Run the old app:

```bash
git switch main                      # or: git switch --detach pre-ui
```

`main` does not know about projects. Also roll the database back (§5, option A
or B). Otherwise rows created in the new UI keep a `project_id` that the old app
ignores. That's harmless, but untested with the old code.

## 7. Conventions on this branch

- Tag each reviewed milestone: `git tag -a ui-v2 -m "what changed"`, then
  `git push origin ui --tags`.
- Any schema change ships with its `migrations/rollback/*.down.sql` and a line in §5.
- Record product and design decisions in `docs/decisions.md`, in the same commit.
