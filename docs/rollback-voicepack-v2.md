# Rollback: Voice Pack v2 gap work

Everything before this work is frozen at the tag **`pre-voicepack-v2`** (commit `917acb7`, branch `voice-pack-v2`). The work happens on `voice-pack-v2` only. `main` is untouched at `ef0f3f7`.

Each finished phase gets its own commit and tag, so you can roll back one phase or all of them:

| Tag | What it adds |
|---|---|
| `pre-voicepack-v2` | The starting point (Gmail read once, "What we noticed", the bug fixes from the 06 Oct test pass) |
| `vp2-phase1` | Answers reach the AI, re-scans keep edits, privacy fixes, rule order, paste splitting, clean-up |
| `vp2-phase2` | Per-platform blocks and measuring, per-task loading, platform checks and formats |
| `vp2-phase3` | Anti-sample, notes, self-check, missing questions, new sources, Voice Pack export |

## Roll back the code

Throw away everything after a tag (uncommitted work too):

```bash
git checkout voice-pack-v2
git reset --hard pre-voicepack-v2
```

Or keep the work and just look at the old version:

```bash
git checkout pre-voicepack-v2
```

`main` never moved, so `git checkout main` is always the version from before all of this.

## Roll back the database

The local database was backed up before any change:
`C:\Users\Yash\huemen-studio-backups\huemen-pre-voicepack-v2-20261007-1523.dump`

Restore it (PowerShell, Postgres running):

```powershell
$env:PGPASSWORD = 'postgres'
& "C:\Users\Yash\scoop\apps\postgresql\current\bin\pg_restore.exe" -U postgres -h localhost -d huemen --clean --if-exists "C:\Users\Yash\huemen-studio-backups\huemen-pre-voicepack-v2-20261007-1523.dump"
```

Voice Pack data lives in JSON columns, so this work is planned without new migrations. If one turns out to be needed, it ships with its own `migrations/rollback/*.down.sql` and is listed here.
