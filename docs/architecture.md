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
  features/            Home, Lessons, Saved, Progress, Settings, and session UI slices
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

1. The app parses bundled or imported JSON with Zod. Excel authoring rows are
   normalized into schema version 3, assigned deterministic ids and spans, then
   passed through the same production parser before persistence.
2. The composition root loads packs, progress, settings, saved sentences,
   session history, and any active session
   through `PersistenceProvider`.
3. `DefaultLearningEngine` owns question, target feedback, sentence completion,
   pause, resume, restart, and final completion transitions. Wrong answers stay
   on the current target and never expose the expected answer.
4. The planner selects new targets and scheduled targets whose `dueAt` is not
   later than now. Weakness raises priority only among already-due targets;
   future-due targets remain supporting context or practice-only content.
   Incorrect attempts are
   retained without touching SRS. `BasicReviewScheduler` updates a lexeme once
   when its target resolves: Good first try, Hard after retry, Again on skip.
   Adaptive Learn selects Choose the Word for new/weak lexemes, Type the Word
   for developing lexemes, and primarily Type the Word or Dictation for strong
   due lexemes, with deterministic Listen & Choose variation. Retry and restart
   keep the selected exercise stable. Exercise selection is independent from
   the `autoAdvance` setting.
5. The app writes each session snapshot and schedule update to IndexedDB. A
   completed session clears the resumable snapshot and updates aggregate stats.
6. The service worker caches the app shell and same-origin runtime assets for
   later offline use.

## Production durability

- Each session is bounded to 20 reviews and 5 new lexemes, with at most 25
  active targets. Selection order is overdue, already-due weak, due, then new.
- IndexedDB progress and active-session mutations share an ordered operation
  queue and the current learning state is committed in one transaction. Backup
  restore validates everything first and replaces local stores atomically.
- Learner-owned records are internally scoped by the stable local identity
  `default`. IndexedDB version 4 preserves the version 3 atomic migration of
  legacy unscoped progress, active-session, and settings records, and safely
  repairs missing additive Saved/history stores without changing learner data.
  Lesson packs remain shared content.
- Saved sentences use the compound identity learner + pack + sentence and are
  independent from SRS. Session-completion history stores only immutable facts
  needed for deterministic reports. `reviewedLexemeIds` contains unique real
  SRS commits (never practice, supporting, or wrong-only attempts);
  `newlyLearnedLexemeIds` had no pre-session schedule; `masteredLexemeIds`
  crossed from mastery below 70 to at least 70 in that session.
- Backup schema version 2 contains lesson packs and the complete `default`
  learner state, including saved sentences and session history. Strict version
  1 backups remain accepted and restore losslessly with empty collections for
  fields that did not exist in version 1. Restore validates everything first
  and replaces all participating stores in one atomic transaction.
- The Vite base path controls manifest, service-worker, icon, navigation, and
  asset URLs so root and subpath deployments use the same architecture.
- An application-level error boundary offers a safe reload without exposing
  stack traces in the production interface.
- Diagnostics use their own capped IndexedDB store and are not part of the
  learner backup or future sync snapshot. Logging is best-effort, local-only, and contains
  context identifiers rather than typed answers.
- Continue Learning starts a new bounded engine session. Review keys completed
  in the active continuation chain are excluded from later planners; Extra
  Practice is explicitly non-reviewable and never schedules SRS.
- Focused Listening, Shadowing, and Saved Recall are practice-only. They may
  reuse lesson sentences and the audio abstraction, but they do not update SRS,
  mastery, review counts, or session-completion history.
- Sync snapshot version 2 carries learner-owned state and lesson packs with a
  deterministic content hash. Merge helpers use timestamped values, append-only
  session IDs, compound Saved identities, explicit active-session conflicts,
  and revision-based compare-and-swap so stale state cannot silently overwrite
  newer state. Snapshot version 1 remains losslessly upgradable for the fields
  it originally contained.

## Deferred decisions

Authentication, a remote sync provider, backend APIs, pack export, and advanced
adaptive scheduling are intentionally outside the current local-first scope.
`SyncRepository`/`SyncProvider` now define a revisioned transport boundary for
learner state and content, but no provider, credentials, or network dependency
is selected; multi-device sync is therefore not operational until a real remote
implementation supplies pull and compare-and-swap push.
