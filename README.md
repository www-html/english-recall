# English Recall

A mobile-first React + Vite + TypeScript PWA for short English recall sessions.
It works without a backend and stores lesson packs, settings, active sessions,
and learning progress in IndexedDB.

Current release candidate: `0.1.0`. The application version in `package.json`
is the single release source of truth and is injected into production builds.

## Features

- Home, Learning, Pause, and Summary screens
- Word Choice with number shortcuts `1`–`4`
- Fill Words with `Space` to submit and `Esc` to clear
- Listening Choice with automatic sentence audio and `1`–`4` shortcuts
- Auto learning mode that selects Word Choice, Fill Words, or Listening Choice
  from lexeme mastery
- Optional sentence auto-advance, configured separately from learning mode
- English speech controls with adjustable playback rate
- Versioned JSON lesson packs validated with Zod
- Basic spaced repetition, mastery, and due-review tracking
- Offline-capable PWA shell and local-only IndexedDB persistence
- Built-in starter pack with reusable lexemes and inflected sentence contexts

## Run

```bash
npm ci
npm run dev
```

Production preview:

```bash
npm run build
npm run preview
```

Quality checks:

```bash
npm run lint
npm run typecheck
npm test
npm run validate:content
npm run build
```

Supported Node.js: `^20.19.0`, `^22.12.0`, or `>=24.0.0`.

To verify a subpath deployment such as GitHub Pages, build with:

```bash
VITE_BASE_PATH=/english-recall/ npm run build
npm run preview
```

The same build pipeline supports `/` when `VITE_BASE_PATH` is omitted. Preview
is a production smoke test, not the deployment server.

## JSON lesson packs

Use [src/data/starter-pack.json](src/data/starter-pack.json) as the canonical
schema version 3 example. Packs define reusable lemma-level `lexemes`, then
lessons contain
sentence contexts with one to four target occurrences. Each target points to a
lexeme, stores its contextual `surfaceText`, an exact `[start, end)` span in
`displayText`, and exactly three distractors with contextual surface forms.
Mastery and SRS are keyed by `lexemeId`, so forms such as `go` and `went` share
one learning history. Valid schema v2 packs are upgraded losslessly on import.

Schema version 1 generic quiz packs are intentionally rejected: their items do
not contain enough sentence semantics for a lossless automatic migration.

## Local data and updates

IndexedDB is local to the current browser profile. Progress and the active
session are saved together in one transaction, and mutations are serialized so
rapid answers cannot let an older snapshot replace a newer one. Storage
failures are shown in the app; learning remains usable without a white screen.

Home provides a versioned JSON backup containing imported packs, settings,
progress, schedules, and an optional resumable session. Restore validates the
complete backup before one atomic IndexedDB transaction; malformed or
unsupported backups leave current data unchanged.

No account is required in v0.1.0: one browser profile and its IndexedDB data
represent one local learner. Refreshing or reopening the installed PWA restores
the exact active target. Backup/Restore is the manual portability path between
browsers and devices; the app uses no identity cookies, fingerprinting, cloud
sync, or telemetry.

Local Diagnostics records a bounded set of structured lifecycle IDs and status
codes for troubleshooting. It never records typed answers by default, stays on
the device, retains only the newest 3,000 events, and is deliberately excluded
from learner backups. Home can export diagnostics as JSON or clear them after a
confirmation.

Lesson-pack `schemaVersion`, pack `id`, and semantic content `version` are
independent. Re-importing the same `id` requires the same content or a higher
semantic version; downgrades and same-version content conflicts are rejected.
Mastery is preserved automatically for unchanged `packId::lexemeId` keys, and
renamed lexemes are never guessed or remapped.

The service worker caches the generated app shell and hashed assets for offline
reload. Its paths are relative to the configured Vite base, so production works
at both the domain root and a subpath. Installing an update changes cached app
assets only; active learning state remains in IndexedDB.

Session limits are per session, not per day. Summary starts a new bounded
Continue Learning session while eligible work remains. Once that chain is
exhausted, Extra Practice creates a non-reviewable session that cannot modify
SRS.

See [docs/architecture.md](docs/architecture.md) for module boundaries and data
flow. See [docs/them-du-lieu-hoc.md](docs/them-du-lieu-hoc.md) for a Vietnamese
step-by-step guide to creating and importing a lesson database.
