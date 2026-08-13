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
IndexedDB and test fakes remain adapter concerns.

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

Schema version 3 separates reusable `lexemes` from sentence presentation. A
lexeme owns the stable `lemma`; a sentence target owns its contextual
`surfaceText`, so `go` and `went` share one mastery identity. A sentence owns
one to four target occurrences. A target id is local to its sentence; runtime
maps therefore use a composite `sentenceId::targetId` occurrence key. Every
target stores an exact UTF-16 `[start, end)` span and exactly three distractors,
each with a lexeme reference and context-appropriate surface text. The parser
rejects invalid references, duplicate ids, mismatched or overlapping spans, and
unknown fields. Valid schema v2 packs are upgraded losslessly at the parser;
unsupported versions are rejected.

Pack replacement is conservative: a matching `id` may be re-imported unchanged
or with a higher semantic `version`. A lower version, or changed content that
reuses the current version, is rejected. Existing mastery stays keyed to stable
`packId::lexemeId` values; no mapping is inferred for renamed lexemes. Built-in
content follows the same policy.

Mastery and SRS schedules are keyed by `packId::lexemeId`. A lexeme may appear
in many sentence contexts without fragmenting its learning history. Schema
version 1 generic items are rejected rather than guessed into a lossy context
model; migration requires an explicit authored mapping.

## Runtime flow

1. The app parses bundled or imported JSON with Zod.
2. The composition root loads packs, progress, settings, and any active session
   through `PersistenceProvider`.
3. `DefaultLearningEngine` owns question, target feedback, sentence completion,
   pause, resume, restart, and final completion transitions. Wrong answers stay
   on the current target and never expose the expected answer.
4. The planner selects new, due, or weak targets for active recall and leaves
   strong not-due targets visible as supporting context. Incorrect attempts are
   retained without touching SRS. `BasicReviewScheduler` updates a lexeme once
   when its target resolves: Good first try, Hard after retry, Again on skip.
   Auto learning selects Word Choice for weak,
   Fill Words for developing, and Listening Choice for established mastery. It
   is independent from the `autoAdvance` setting.
5. The app writes each session snapshot and schedule update to IndexedDB. A
   completed session clears the resumable snapshot and updates aggregate stats.
6. The service worker caches the app shell and same-origin runtime assets for
   later offline use.

## Production durability

- Daily sessions are bounded to 20 reviews and 5 new lexemes, with at most 25
  active targets. Selection order is overdue, weak, due, then new.
- IndexedDB progress and active-session mutations share an ordered operation
  queue and the current learning state is committed in one transaction. Backup
  restore validates everything first and replaces local stores atomically.
- Backup schema version 1 contains lesson packs, progress/SRS, settings, and an
  optional active session. Unsupported or malformed backups never partially
  mutate storage.
- The Vite base path controls manifest, service-worker, icon, navigation, and
  asset URLs so root and subpath deployments use the same architecture.
- An application-level error boundary offers a safe reload without exposing
  stack traces in the production interface.

## Deferred decisions

Authentication, remote sync, backend APIs, pack export, and advanced adaptive
scheduling are intentionally outside the current local-first scope.
