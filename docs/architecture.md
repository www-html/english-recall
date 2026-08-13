# English Recall architecture

## Dependency direction

Dependencies point inward toward stable domain contracts:

```text
app / future features
  ├── learning-engine ──> domain, shared
  └── persistence ──────> learning-engine types, domain, shared

domain ─────────────────> Zod, shared
shared ─────────────────> no application dependencies
```

The React layer may coordinate the engine and repositories, but domain and
engine modules must not import React. Persistence contracts describe behavior;
browser storage, IndexedDB, remote sync, and test fakes belong in future
adapter modules.

## Source structure

```text
src/
  app/                 Composition root, app lifecycle, audio, and styling
  data/                Bundled JSON lesson packs
  domain/              Lesson pack schema and domain types
  features/            Home, Learning, Pause, and Summary UI slices
  learning-engine/     State model and framework-independent contracts
  persistence/         Async contracts and IndexedDB adapter
  shared/              Small cross-cutting TypeScript primitives
```

## State ownership

- Lesson pack content is validated at the input boundary with
  `lessonPackSchema` before entering the engine.
- `LearningEngineState` is the authoritative in-session state machine.
- React holds only view/composition state and subscribes to the engine.
- Repositories persist validated packs, settings, review schedules, and at most
  one resumable session. Components never access storage APIs directly.
- Timestamps cross boundaries as ISO-8601 strings; adapters create and parse
  platform-specific dates.

## Lesson pack versioning

`schemaVersion` controls the data shape and is independent from the pack's
semantic `version`. A future incompatible data shape requires a new schema
version and an explicit migration at the import boundary. Unknown fields are
rejected so misspelled authoring fields fail early.

Supported item kinds in schema version 1 are `flashcard`, `typing`, and
`multiple-choice`. `typing` powers Fill Words and `multiple-choice` powers Word
Choice. New kinds require schema, engine response, tests, and pack documentation
changes together.

## Runtime flow

1. The app parses bundled or imported JSON with Zod.
2. The composition root loads packs, progress, settings, and any active session
   through `PersistenceProvider`.
3. `DefaultLearningEngine` owns question, feedback, pause, and completion
   transitions. React renders the current state and sends typed commands.
4. `BasicReviewScheduler` updates due date, interval, ease, repetitions, and
   lapses after every answer.
5. The app writes each session snapshot and schedule update to IndexedDB. A
   completed session clears the resumable snapshot and updates aggregate stats.
6. The service worker caches the app shell and same-origin runtime assets for
   later offline use.

## Deferred decisions

Authentication, remote sync, backend APIs, pack export, and advanced adaptive
scheduling are intentionally outside the current local-first scope.
