import { describe, expect, it } from 'vitest'
import type { LessonPack } from '../domain/lesson-pack.schema.ts'
import type { LearningSessionSnapshot } from '../learning-engine/index.ts'
import {
  createInitialProgress,
  DEFAULT_LEARNER_ID,
  defaultAppSettings,
  type LearnerSyncSnapshotV1,
  type LearnerSyncSnapshotV2,
  type SessionCompletionRecord,
} from './contracts.ts'
import {
  createLessonPackContentHash,
  createSyncedLessonPack,
  mergeLearnerSyncSnapshots,
  upgradeLearnerSyncSnapshotV1,
} from './sync.ts'

const earlier = '2026-08-14T10:00:00.000Z'
const later = '2026-08-14T11:00:00.000Z'

const pack: LessonPack = {
  schemaVersion: 3,
  id: 'sync-pack',
  version: '1.0.0',
  title: 'Sync pack',
  sourceLanguage: 'vi',
  targetLanguage: 'en',
  lexemes: [
    { id: 'one', lemma: 'one', partOfSpeech: 'other', meaningVi: 'một' },
    { id: 'two', lemma: 'two', partOfSpeech: 'other', meaningVi: 'hai' },
    { id: 'three', lemma: 'three', partOfSpeech: 'other', meaningVi: 'ba' },
    { id: 'four', lemma: 'four', partOfSpeech: 'other', meaningVi: 'bốn' },
  ],
  lessons: [{
    id: 'numbers',
    title: 'Numbers',
    sentences: [{
      id: 'count-one',
      displayText: 'One.',
      speechText: 'One.',
      translationVi: 'Một.',
      level: 'A1',
      topic: 'numbers',
      targets: [{
        id: 'target-one',
        lexemeId: 'one',
        start: 0,
        end: 3,
        surfaceText: 'One',
        distractors: [
          { lexemeId: 'two', surfaceText: 'Two' },
          { lexemeId: 'three', surfaceText: 'Three' },
          { lexemeId: 'four', surfaceText: 'Four' },
        ],
      }],
    }],
  }],
}

function snapshot(
  overrides: Partial<LearnerSyncSnapshotV2> = {},
): LearnerSyncSnapshotV2 {
  return {
    schemaVersion: 2,
    learnerId: DEFAULT_LEARNER_ID,
    capturedAt: earlier,
    lessonPacks: [],
    progress: { value: createInitialProgress(), updatedAt: earlier },
    activeSession: { value: null, updatedAt: earlier },
    settings: { value: defaultAppSettings, updatedAt: earlier },
    savedSentences: [],
    sessionHistory: [],
    ...overrides,
  }
}

function history(sessionId: string): SessionCompletionRecord {
  return {
    learnerId: DEFAULT_LEARNER_ID,
    sessionId,
    packId: pack.id,
    lessonId: 'numbers',
    startedAt: earlier,
    completedAt: later,
    reviewedLexemeIds: ['one'],
    newlyLearnedLexemeIds: ['one'],
    masteredLexemeIds: [],
    difficultLexemeIds: [],
    correctAnswers: 1,
    incorrectAnswers: 0,
    skippedTargets: 0,
  }
}

describe('provider-neutral learner sync', () => {
  it('creates a deterministic identity for complete lesson-pack content', () => {
    const reordered = {
      title: pack.title,
      schemaVersion: pack.schemaVersion,
      version: pack.version,
      id: pack.id,
      targetLanguage: pack.targetLanguage,
      sourceLanguage: pack.sourceLanguage,
      lessons: pack.lessons,
      lexemes: pack.lexemes,
    } as LessonPack

    expect(createLessonPackContentHash(reordered)).toBe(
      createLessonPackContentHash(pack),
    )
  })

  it('makes lesson content authored on either device available after merge', () => {
    const secondPack = { ...pack, id: 'second-pack', title: 'Second pack' }
    const result = mergeLearnerSyncSnapshots(
      snapshot({ lessonPacks: [createSyncedLessonPack(pack)] }),
      snapshot({ lessonPacks: [createSyncedLessonPack(secondPack)] }),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.lessonPacks.map(({ pack: item }) => item.id)).toEqual([
        'second-pack',
        'sync-pack',
      ])
    }
  })

  it('reports same-id same-version content conflicts without returning an overwrite', () => {
    const conflictingPack = { ...pack, title: 'Different content' }
    const result = mergeLearnerSyncSnapshots(
      snapshot({ lessonPacks: [createSyncedLessonPack(pack)] }),
      snapshot({ lessonPacks: [createSyncedLessonPack(conflictingPack)] }),
    )

    expect(result).toMatchObject({
      ok: false,
      conflicts: [{
        code: 'lesson-pack-content',
        identity: 'sync-pack@1.0.0',
      }],
    })
  })

  it('does not let a stale progress snapshot overwrite newer SRS state', () => {
    const oldProgress = createInitialProgress()
    const newProgress = {
      ...oldProgress,
      sessionsCompleted: 2,
      totalAnswers: 4,
      correctAnswers: 3,
      lastStudiedAt: later,
    }
    const result = mergeLearnerSyncSnapshots(
      snapshot({ progress: { value: newProgress, updatedAt: later } }),
      snapshot({ progress: { value: oldProgress, updatedAt: earlier } }),
    )

    expect(result).toMatchObject({
      ok: true,
      value: { progress: { value: newProgress, updatedAt: later } },
    })
  })

  it('reports independent progress edits when both changed from the same base', () => {
    const base = snapshot()
    const local = snapshot({
      progress: {
        value: { ...createInitialProgress(), totalAnswers: 1 },
        updatedAt: later,
      },
    })
    const remote = snapshot({
      progress: {
        value: { ...createInitialProgress(), sessionsCompleted: 1 },
        updatedAt: later,
      },
    })

    expect(mergeLearnerSyncSnapshots(local, remote, base)).toMatchObject({
      ok: false,
      conflicts: [{ code: 'progress-concurrent-update' }],
    })
  })

  it('merges history append-only and saved sentences by compound identity/time', () => {
    const oldSaved = {
      learnerId: DEFAULT_LEARNER_ID,
      packId: pack.id,
      sentenceId: 'count-one',
      savedAt: earlier,
    }
    const newSaved = { ...oldSaved, savedAt: later }
    const result = mergeLearnerSyncSnapshots(
      snapshot({ savedSentences: [oldSaved], sessionHistory: [history('one')] }),
      snapshot({ savedSentences: [newSaved], sessionHistory: [history('two')] }),
    )

    expect(result).toMatchObject({
      ok: true,
      value: {
        savedSentences: [newSaved],
        sessionHistory: [{ sessionId: 'one' }, { sessionId: 'two' }],
      },
    })
  })

  it('uses deterministic last-write-wins settings and blocks active-session races', () => {
    const fillSettings = { ...defaultAppSettings, learningMode: 'fill-words' as const }
    const settingsResult = mergeLearnerSyncSnapshots(
      snapshot({ settings: { value: defaultAppSettings, updatedAt: earlier } }),
      snapshot({ settings: { value: fillSettings, updatedAt: later } }),
    )
    expect(settingsResult).toMatchObject({
      ok: true,
      value: { settings: { value: fillSettings, updatedAt: later } },
    })

    const first = { id: 'first', updatedAt: later } as LearningSessionSnapshot
    const second = { id: 'second', updatedAt: later } as LearningSessionSnapshot
    expect(mergeLearnerSyncSnapshots(
      snapshot({ activeSession: { value: first, updatedAt: later } }),
      snapshot({ activeSession: { value: second, updatedAt: later } }),
    )).toMatchObject({
      ok: false,
      conflicts: [{ code: 'active-session-concurrent-update' }],
    })
  })

  it('upgrades V1 learner data without inventing lesson content or diagnostics', () => {
    const legacy: LearnerSyncSnapshotV1 = {
      schemaVersion: 1,
      learnerId: DEFAULT_LEARNER_ID,
      capturedAt: earlier,
      progress: createInitialProgress(),
      activeSession: null,
      settings: defaultAppSettings,
      savedSentences: [],
      sessionHistory: [],
    }
    const upgraded = upgradeLearnerSyncSnapshotV1(legacy)

    expect(upgraded).toMatchObject({
      schemaVersion: 2,
      learnerId: DEFAULT_LEARNER_ID,
      lessonPacks: [],
      progress: { value: legacy.progress, updatedAt: earlier },
    })
    expect(upgraded).not.toHaveProperty('diagnostics')
  })
})
