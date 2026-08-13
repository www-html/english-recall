import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { LessonPack } from '../domain/lesson-pack.schema.ts'
import type { LearningSessionSnapshot } from '../learning-engine/index.ts'
import { createInitialProgress, defaultAppSettings } from './contracts.ts'
import { IndexedDbPersistenceProvider } from './indexed-db.ts'

const pack: LessonPack = {
  schemaVersion: 3,
  id: 'persistence-pack',
  version: '2.0.0',
  title: 'Persistence pack',
  sourceLanguage: 'vi',
  targetLanguage: 'en',
  lexemes: [
    { id: 'hello', lemma: 'hello', partOfSpeech: 'interjection', meaningVi: 'xin chào' },
    { id: 'goodbye', lemma: 'goodbye', partOfSpeech: 'interjection', meaningVi: 'tạm biệt' },
    { id: 'thanks', lemma: 'thanks', partOfSpeech: 'interjection', meaningVi: 'cảm ơn' },
    { id: 'welcome', lemma: 'welcome', partOfSpeech: 'interjection', meaningVi: 'chào mừng' },
  ],
  lessons: [
    {
      id: 'lesson-one',
      title: 'Lesson one',
      sentences: [
        {
          id: 'sentence-one',
          displayText: 'Hello there.',
          speechText: 'Hello there.',
          translationVi: 'Xin chào.',
          level: 'A1',
          topic: 'greetings',
          targets: [
            {
              id: 'target-hello',
              lexemeId: 'hello',
              start: 0,
              end: 5,
              surfaceText: 'Hello',
              distractors: [
                { lexemeId: 'goodbye', surfaceText: 'Goodbye' },
                { lexemeId: 'thanks', surfaceText: 'Thanks' },
                { lexemeId: 'welcome', surfaceText: 'Welcome' },
              ],
            },
          ],
        },
      ],
    },
  ],
}

const session: LearningSessionSnapshot = {
  id: 'session-one',
  packId: pack.id,
  lessonId: 'lesson-one',
  sentenceQueue: ['sentence-one'],
  currentSentenceIndex: 0,
  currentSentenceId: 'sentence-one',
  currentTargetIndex: 0,
  currentTargetId: 'target-hello',
  activeTargetIdsBySentenceId: { 'sentence-one': ['target-hello'] },
  reviewableOccurrenceKeys: ['sentence-one::target-hello'],
  scheduledOccurrenceKeys: [],
  isPracticeFallback: false,
  solvedTargetIds: [],
  phase: 'question',
  learningMode: 'auto',
  exerciseMode: 'word-choice',
  wrongChoiceIdsByOccurrenceKey: {
    'sentence-one::target-hello': ['goodbye'],
  },
  attemptsByLexemeId: {
    hello: {
      attempts: 1,
      correct: 0,
      incorrect: 1,
      skipped: 0,
      lastReviewedAt: '2026-08-12T12:00:00.000Z',
      lastRating: 'again',
    },
  },
  attemptHistory: [
    {
      lexemeId: 'hello',
      sentenceId: 'sentence-one',
      targetId: 'target-hello',
      exerciseMode: 'word-choice',
      outcome: 'incorrect',
      firstTry: false,
      wrongAttempts: 1,
      responseTimeMs: 1200,
      reviewedAt: '2026-08-12T12:00:00.000Z',
    },
  ],
  schedulesByLexemeId: {
    hello: {
      dueAt: '2026-08-12T12:10:00.000Z',
      intervalDays: 0,
      easeFactor: 2.1,
      repetitions: 0,
      lapses: 1,
    },
  },
  startedAt: '2026-08-12T11:59:00.000Z',
  questionStartedAt: '2026-08-12T12:00:00.000Z',
  updatedAt: '2026-08-12T12:00:00.000Z',
}

function deleteTestDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('english-recall')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

function writeRawKey(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('english-recall', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('key-value', 'readwrite')
      transaction.objectStore('key-value').put({ key, value })
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
    }
  })
}

function writeRawPack(value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('english-recall', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('lesson-packs', 'readwrite')
      transaction.objectStore('lesson-packs').put(value)
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
    }
  })
}

describe('IndexedDbPersistenceProvider', () => {
  const provider = new IndexedDbPersistenceProvider()

  beforeAll(async () => {
    await deleteTestDatabase()
  })

  it('returns missing records as null or not-found', async () => {
    expect(await provider.progress.loadProgress()).toEqual({ ok: true, value: null })
    expect(await provider.lessonPacks.get('missing')).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    })
  })

  it('round-trips lesson packs and summaries', async () => {
    expect(await provider.lessonPacks.save(pack)).toMatchObject({ ok: true })
    expect(await provider.lessonPacks.get(pack.id)).toMatchObject({
      ok: true,
      value: { title: 'Persistence pack' },
    })
    expect(await provider.lessonPacks.list()).toMatchObject({
      ok: true,
      value: {
        summaries: [{ lessonCount: 1, targetCount: 1 }],
        skipped: [],
      },
    })
  })

  it('keeps valid packs available when another stored pack is obsolete', async () => {
    await provider.lessonPacks.save(pack)
    await writeRawPack({ id: 'obsolete-pack', schemaVersion: 1 })

    const listed = await provider.lessonPacks.list()
    expect(listed).toMatchObject({ ok: true })
    if (!listed.ok) throw new Error('Expected lesson pack list')
    expect(listed.value.summaries.map(({ id }) => id)).toContain(pack.id)
    expect(listed.value.summaries.map(({ id }) => id)).not.toContain('obsolete-pack')
    expect(listed.value.skipped).toContainEqual({
      id: 'obsolete-pack',
      reason: 'invalid-or-unsupported',
    })
    expect(await provider.lessonPacks.get('obsolete-pack')).toMatchObject({
      ok: false,
      error: { code: 'invalid-data' },
    })
  })

  it('round-trips lexeme progress and separated learning settings', async () => {
    const progress = {
      ...createInitialProgress(),
      sessionsCompleted: 2,
      schedulesByLexemeReviewKey: {
        'persistence-pack::hello': session.schedulesByLexemeId.hello!,
      },
    }
    const settings = {
      ...defaultAppSettings,
      learningMode: 'fill-words' as const,
      autoAdvance: true,
    }

    await provider.progress.saveProgress(progress)
    await provider.settings.save(settings)

    expect(await provider.progress.loadProgress()).toEqual({ ok: true, value: progress })
    expect(await provider.settings.load()).toEqual({ ok: true, value: settings })
  })

  it('round-trips all resumable sentence and target state, then clears it', async () => {
    await provider.progress.saveActiveSession(session)
    expect(await provider.progress.loadActiveSession()).toEqual({
      ok: true,
      value: session,
    })

    await provider.progress.clearActiveSession()
    expect(await provider.progress.loadActiveSession()).toEqual({ ok: true, value: null })
  })

  it('round-trips Listening Choice settings and session mode', async () => {
    const listeningSettings = {
      ...defaultAppSettings,
      learningMode: 'listening-choice' as const,
    }
    const listeningSession: LearningSessionSnapshot = {
      ...session,
      learningMode: 'listening-choice',
      exerciseMode: 'listening-choice',
      attemptHistory: session.attemptHistory.map((attempt) => ({
        ...attempt,
        exerciseMode: 'listening-choice',
      })),
    }

    await provider.settings.save(listeningSettings)
    await provider.progress.saveActiveSession(listeningSession)
    expect(await provider.settings.load()).toEqual({
      ok: true,
      value: listeningSettings,
    })
    expect(await provider.progress.loadActiveSession()).toEqual({
      ok: true,
      value: listeningSession,
    })
    await provider.progress.clearActiveSession()
  })

  it('migrates legacy settings without conflating learning mode and auto advance', async () => {
    await writeRawKey('settings', {
      autoMode: true,
      audioEnabled: false,
      speechRate: 1.1,
    })

    expect(await provider.settings.load()).toEqual({
      ok: true,
      value: {
        learningMode: 'auto',
        autoAdvance: true,
        audioEnabled: false,
        speechRate: 1.1,
      },
    })
  })

  it('preserves aggregate progress while safely dropping unmappable v1 schedules', async () => {
    await writeRawKey('learner-progress', {
      schedulesByReviewKey: { 'old-pack::old-item': session.schedulesByLexemeId.hello },
      sessionsCompleted: 3,
      totalAnswers: 20,
      correctAnswers: 15,
      lastStudiedAt: '2026-08-01T00:00:00.000Z',
    })

    expect(await provider.progress.loadProgress()).toEqual({
      ok: true,
      value: {
        schedulesByLexemeReviewKey: {},
        sessionsCompleted: 3,
        totalAnswers: 20,
        correctAnswers: 15,
        lastStudiedAt: '2026-08-01T00:00:00.000Z',
      },
    })
  })

  it('clears an incompatible v1 active session instead of repeatedly failing resume', async () => {
    await writeRawKey('active-session', {
      id: 'old-session',
      itemQueue: ['old-item'],
      currentIndex: 0,
      phase: 'question',
    })

    expect(await provider.progress.loadActiveSession()).toEqual({ ok: true, value: null })
    expect(await provider.progress.loadActiveSession()).toEqual({ ok: true, value: null })
  })

  it('rejects malformed stored data', async () => {
    await writeRawKey('settings', { learningMode: 'magic' })
    expect(await provider.settings.load()).toMatchObject({
      ok: false,
      error: { code: 'invalid-data' },
    })
  })

  it('rejects malformed progress dates and counters', async () => {
    await writeRawKey('learner-progress', {
      schedulesByLexemeReviewKey: {
        'persistence-pack::hello': {
          ...session.schedulesByLexemeId.hello,
          dueAt: 'not-a-date',
        },
      },
      sessionsCompleted: -1,
      totalAnswers: 2,
      correctAnswers: 3,
      lastStudiedAt: 'yesterday',
    })

    expect(await provider.progress.loadProgress()).toMatchObject({
      ok: false,
      error: { code: 'invalid-data' },
    })
  })

  it('rejects malformed attempt timestamps in an active session', async () => {
    await writeRawKey('active-session', {
      ...session,
      attemptHistory: [
        { ...session.attemptHistory[0], reviewedAt: 'not-a-date' },
      ],
    })

    expect(await provider.progress.loadActiveSession()).toMatchObject({
      ok: false,
      error: { code: 'invalid-data' },
    })
  })

  it('rejects a malformed v2 session snapshot', async () => {
    await writeRawKey('active-session', {
      ...session,
      currentSentenceIndex: 99,
    })
    expect(await provider.progress.loadActiveSession()).toMatchObject({
      ok: false,
      error: { code: 'invalid-data' },
    })
  })

  it('reports unavailable IndexedDB as a write failure', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const unavailableProvider = new IndexedDbPersistenceProvider()
    expect(await unavailableProvider.settings.save(defaultAppSettings)).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    })
    vi.unstubAllGlobals()
  })
})
