# English Recall

A mobile-first React + Vite + TypeScript PWA for short English recall sessions.
It works without a backend and stores lesson packs, settings, active sessions,
and learning progress in IndexedDB.

## Features

- Home, Learning, Pause, and Summary screens
- Word Choice with number shortcuts `1`–`4`
- Fill Words with `Space` to submit and `Esc` to clear
- Optional Auto learning with spoken prompts and auto-advance
- English speech controls with adjustable playback rate
- Versioned JSON lesson packs validated with Zod
- Basic spaced repetition, mastery, and due-review tracking
- Offline-capable PWA shell and local-only IndexedDB persistence
- Built-in starter pack with 18 exercises across three lessons

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
schema version 1 example. Packs can contain `multiple-choice`, `typing`, and
`flashcard` items. Every pack, lesson, item, and choice needs a stable id;
learning item ids must be unique across the pack.

See [docs/architecture.md](docs/architecture.md) for module boundaries and data
flow.
