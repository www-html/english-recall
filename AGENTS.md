# Repository rules

## Commands

- Install exactly from the lockfile: `npm ci`
- Start development: `npm run dev`
- Type-check only: `npm run typecheck`
- Production build: `npm run build`
- Run tests once: `npm test`
- Run tests while developing: `npm run test:watch`
- Run static lint checks: `npm run lint`

Before handing off a change, run `npm run lint`, `npm run typecheck`,
`npm test`, and `npm run build`. Report any command that was not run or did not
pass.

## Architecture

- Keep dependencies pointing inward as documented in `docs/architecture.md`.
- Domain and learning-engine modules must remain independent of React, browser
  storage APIs, and UI components.
- Validate all external lesson packs with the Zod schema before use.
- Do not read or write `localStorage`, IndexedDB, or network APIs from React
  components. Add an adapter behind the persistence interfaces.
- Treat `LearningEngineState` as the authoritative session state. Do not create
  a second competing session model in UI code.
- Add feature UI as vertical slices under `src/features/<feature>` and compose
  it from `src/app`.
- Prefer explicit discriminated unions and immutable `readonly` state over
  booleans that can form contradictory states.
- Keep timestamps as ISO-8601 strings at module and persistence boundaries.
- Treat `lexemeId` as the mastery/SRS identity. Treat target ids as local to a
  sentence and use `sentenceId::targetId` when a globally unique occurrence key
  is required.
- Keep `learningMode` (exercise selection) independent from `autoAdvance`
  (navigation timing).

## Build and test rules

- TypeScript must remain strict; do not weaken compiler checks to make code
  pass.
- Every schema change needs valid and invalid fixture tests.
- Every engine transition implementation needs tests for success, invalid
  state, restore, completion, and error behavior.
- Persistence adapters need contract tests for missing data, invalid data,
  write failure, and round-trip behavior.
- UI features must cover loading, empty, error, and keyboard-accessible states
  relevant to that workflow.
- Do not commit generated `dist/`, local environment files, or credentials.
- When changing offline shell assets, bump the cache name in
  `public/service-worker.js` and verify a production preview.

## Scope and safety

- Make the smallest change that satisfies the requested feature.
- Do not add a router, global state library, backend, analytics, or remote sync
  without an explicit requirement.
- Preserve backward compatibility for released lesson pack schema versions only
  when it can be lossless. Otherwise reject the version explicitly and document
  the authored migration path.
