# English Recall

A mobile-first React + Vite + TypeScript PWA for short English recall sessions.
It works without a backend and stores lesson packs, settings, active sessions,
and learning progress in IndexedDB.

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
npm run build
```

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

See [docs/architecture.md](docs/architecture.md) for module boundaries and data
flow. See [docs/them-du-lieu-hoc.md](docs/them-du-lieu-hoc.md) for a Vietnamese
step-by-step guide to creating and importing a lesson database.
