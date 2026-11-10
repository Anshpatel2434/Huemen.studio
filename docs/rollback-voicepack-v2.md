# Rollback: Voice Pack v2 gap work

Everything before this work is frozen at the tag **`pre-voicepack-v2`** (commit `917acb7`, branch `voice-pack-v2`). The work happens on `voice-pack-v2` only. `main` is untouched at `ef0f3f7`.

Each finished phase gets its own commit and tag, so you can roll back one phase or all of them:

| Tag | What it adds |
|---|---|
| `pre-voicepack-v2` | The starting point (Gmail read once, "What we noticed", the bug fixes from the 06 Oct test pass) |
| `vp2-phase1` | Answers reach the AI, re-scans keep edits, privacy fixes, per-platform blocks and measuring, per-task loading, platform checks and new formats, paste splitting |
| `vp2-phase2` | Voice meter, typical benchmarks, derived self-check and hard rules, then Ansh's `design-system-v1` merged in |
| `vp2-phase3` | The missing questions, benchmark notes, the anti-sample, the editable self-check, the "ready to write" checklist, the eight-file export, new sources (Facebook, YouTube community, Outlook, Teams, PDF and Word), the WhatsApp cap, link consent on the server, payoff fixes, aspiration in the check |

To undo only the last phase, reset to the tag before it (for example `git reset --hard vp2-phase2`).
`vp2-phase3` also adds two packages (`unpdf`, `fflate`); after a reset, run `npm install` so `node_modules` matches.

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
