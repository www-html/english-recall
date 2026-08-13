import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { LessonPack } from '../domain/lesson-pack.schema.ts'
import type { LearningSessionSnapshot } from '../learning-engine/index.ts'
import {
  createInitialProgress,
  defaultAppSettings,
  MAX_DIAGNOSTIC_EVENTS,
  type DiagnosticEvent,
} from './contracts.ts'
import {
  BACKUP_SCHEMA_VERSION,
  IndexedDbPersistenceProvider,
} from './indexed-db.ts'

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
  continuationExcludedReviewKeys: ['persistence-pack::thanks'],
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

function diagnosticEvent(index: number): DiagnosticEvent {
  return {
    timestamp: new Date(Date.UTC(2026, 7, 13, 12, 0, index)).toISOString(),
    appVersion: '0.1.0',
    level: 'info',
    event: index % 2 === 0 ? 'target_presented' : 'learning_state_saved',
    sessionId: 'session-one',
    targetId: `target-${index}`,
  }
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
    const request = indexedDB.open('english-recall', 2)
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
    const request = indexedDB.open('english-recall', 2)
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

  it('enforces pack downgrade and same-version conflict policy at storage', async () => {
    const policyPack = { ...pack, id: 'policy-pack' }
    const upgraded = { ...policyPack, version: '2.1.0' }
    expect(await provider.lessonPacks.save(upgraded)).toMatchObject({ ok: true })
    expect(await provider.lessonPacks.save(policyPack)).toMatchObject({
      ok: false,
      error: { code: 'invalid-data' },
    })
    expect(
      await provider.lessonPacks.save({
        ...upgraded,
        title: 'Changed without version bump',
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid-data' } })
    expect(await provider.lessonPacks.get(policyPack.id)).toMatchObject({
      ok: true,
      value: { version: '2.1.0', title: policyPack.title },
    })
    await provider.lessonPacks.remove(policyPack.id)
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
    await provider.lessonPacks.remove('obsolete-pack')
  })

  it('keeps invalid stored packs quarantined during backup export', async () => {
    await provider.lessonPacks.save(pack)
    await writeRawPack({ id: 'quarantined-pack', schemaVersion: 1 })

    const exported = await provider.backup.export()
    expect(exported).toMatchObject({
      ok: true,
      value: { lessonPacks: [{ id: pack.id }] },
    })
    if (exported.ok) {
      expect(exported.value.lessonPacks).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'quarantined-pack' })]),
      )
    }
    await provider.lessonPacks.remove('quarantined-pack')
  })

  it('losslessly upgrades a stored v2 lesson pack during backup export', async () => {
    const version2Pack = {
      ...pack,
      schemaVersion: 2,
      lexemes: pack.lexemes.map(({ lemma, ...lexeme }) => ({
        ...lexeme,
        text: lemma,
      })),
      lessons: pack.lessons.map((lesson) => ({
        ...lesson,
        sentences: lesson.sentences.map((sentence) => ({
          ...sentence,
          targets: sentence.targets.map(({ surfaceText: _surfaceText, distractors, ...target }) => ({
            ...target,
            distractorLexemeIds: distractors.map(({ lexemeId }) => lexemeId),
          })),
        })),
      })),
    }
    await writeRawPack(version2Pack)

    const exported = await provider.backup.export()
    if (!exported.ok) throw new Error('Expected migrated backup')
    expect(exported.value.lessonPacks[0]).toMatchObject({
      schemaVersion: 3,
      lexemes: expect.arrayContaining([expect.objectContaining({ lemma: 'hello' })]),
    })
    expect(await provider.backup.restore(exported.value)).toMatchObject({ ok: true })
    expect(await provider.lessonPacks.get(pack.id)).toEqual({
      ok: true,
      value: exported.value.lessonPacks[0],
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

  it('serializes rapid progress and session writes so the newest snapshot wins', async () => {
    const progressWrites = Array.from({ length: 25 }, (_, index) => ({
      ...createInitialProgress(),
      sessionsCompleted: index,
      totalAnswers: index,
      correctAnswers: index,
    }))
    const sessionWrites = Array.from({ length: 25 }, (_, index) => ({
      ...session,
      updatedAt: `2026-08-12T12:00:${String(index).padStart(2, '0')}.000Z`,
    }))

    const pendingWrites = [
      ...progressWrites.map((value) => provider.progress.saveProgress(value)),
      ...sessionWrites.map((value) => provider.progress.saveActiveSession(value)),
    ]
    const pendingProgressReload = provider.progress.loadProgress()
    const pendingSessionReload = provider.progress.loadActiveSession()
    const results = await Promise.all(pendingWrites)

    expect(results.every((result) => result.ok)).toBe(true)
    expect(await pendingProgressReload).toEqual({
      ok: true,
      value: progressWrites.at(-1),
    })
    expect(await pendingSessionReload).toEqual({
      ok: true,
      value: sessionWrites.at(-1),
    })
  })

  it('atomically saves the newest progress and resumable session together', async () => {
    const states = Array.from({ length: 20 }, (_, index) => ({
      progress: {
        ...createInitialProgress(),
        sessionsCompleted: index,
        totalAnswers: index,
        correctAnswers: index,
      },
      activeSession: {
        ...session,
        updatedAt: `2026-08-12T12:01:${String(index).padStart(2, '0')}.000Z`,
      },
    }))

    const writes = states.map(({ progress, activeSession }) =>
      provider.progress.saveLearningState(progress, activeSession),
    )
    expect((await Promise.all(writes)).every((result) => result.ok)).toBe(true)
    const newest = states.at(-1)!
    expect(await provider.progress.loadProgress()).toEqual({
      ok: true,
      value: newest.progress,
    })
    expect(await provider.progress.loadActiveSession()).toEqual({
      ok: true,
      value: newest.activeSession,
    })
  })

  it('backs up a valid session when a supporting target precedes the active target', async () => {
    const mixedSession: LearningSessionSnapshot = {
      ...session,
      currentTargetIndex: 1,
      currentTargetId: 'target-active',
      activeTargetIdsBySentenceId: { 'sentence-one': ['target-active'] },
      reviewableOccurrenceKeys: ['sentence-one::target-active'],
      wrongChoiceIdsByOccurrenceKey: {},
      attemptsByLexemeId: {},
      attemptHistory: [],
      schedulesByLexemeId: {},
    }
    const mixedPack: LessonPack = {
      ...pack,
      id: 'mixed-target-pack',
      lessons: [
        {
          ...pack.lessons[0]!,
          sentences: [
            {
              ...pack.lessons[0]!.sentences[0]!,
              displayText: 'Hello goodbye.',
              speechText: 'Hello goodbye.',
              targets: [
                pack.lessons[0]!.sentences[0]!.targets[0]!,
                {
                  ...pack.lessons[0]!.sentences[0]!.targets[0]!,
                  id: 'target-active',
                  lexemeId: 'goodbye',
                  start: 6,
                  end: 13,
                  surfaceText: 'goodbye',
                  distractors: [
                    { lexemeId: 'hello', surfaceText: 'hello' },
                    { lexemeId: 'thanks', surfaceText: 'thanks' },
                    { lexemeId: 'welcome', surfaceText: 'welcome' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const compatibleSession = {
      ...mixedSession,
      packId: mixedPack.id,
      continuationExcludedReviewKeys: [`${mixedPack.id}::thanks`],
    }
    await provider.lessonPacks.save(mixedPack)
    await provider.progress.saveActiveSession(compatibleSession)
    expect(await provider.backup.export()).toMatchObject({ ok: true })
    await provider.lessonPacks.remove(mixedPack.id)
    await provider.progress.clearActiveSession()
  })

  it('exports and atomically restores all durable application data', async () => {
    const progress = {
      ...createInitialProgress(),
      sessionsCompleted: 7,
      totalAnswers: 18,
      correctAnswers: 15,
      schedulesByLexemeReviewKey: {
        'persistence-pack::hello': session.schedulesByLexemeId.hello!,
      },
    }
    const settings = {
      ...defaultAppSettings,
      learningMode: 'fill-words' as const,
      autoAdvance: true,
      speechRate: 1.1,
    }
    await provider.lessonPacks.remove(pack.id)
    await provider.lessonPacks.save(pack)
    await provider.progress.saveProgress(progress)
    await provider.progress.saveActiveSession(session)
    await provider.settings.save(settings)

    const exported = await provider.backup.export()
    expect(exported).toMatchObject({
      ok: true,
      value: {
        format: 'english-recall-backup',
        schemaVersion: BACKUP_SCHEMA_VERSION,
        lessonPacks: [{ id: pack.id }],
        progress,
        activeSession: session,
        settings,
      },
    })
    if (!exported.ok) throw new Error('Expected a backup')

    await provider.lessonPacks.remove(pack.id)
    await provider.progress.saveProgress(createInitialProgress())
    await provider.progress.clearActiveSession()
    await provider.settings.save(defaultAppSettings)

    expect(await provider.backup.restore(exported.value)).toEqual({
      ok: true,
      value: undefined,
    })
    expect(await provider.lessonPacks.get(pack.id)).toEqual({ ok: true, value: pack })
    expect(await provider.progress.loadProgress()).toEqual({ ok: true, value: progress })
    expect(await provider.progress.loadActiveSession()).toEqual({
      ok: true,
      value: session,
    })
    expect(await provider.settings.load()).toEqual({ ok: true, value: settings })
  })

  it('rejects corrupted or unsupported backups without changing existing data', async () => {
    const before = await provider.backup.export()
    if (!before.ok) throw new Error('Expected a backup')

    const corrupted = {
      ...before.value,
      progress: {
        ...before.value.progress,
        schedulesByLexemeReviewKey: {
          'missing-pack::missing-lexeme': session.schedulesByLexemeId.hello,
        },
      },
    }
    expect(await provider.backup.restore(corrupted)).toMatchObject({
      ok: false,
      error: { code: 'invalid-data' },
    })
    expect(await provider.backup.restore({
      ...before.value,
      activeSession: before.value.activeSession
        ? { ...before.value.activeSession, currentTargetId: 'missing-target' }
        : session,
    })).toMatchObject({
      ok: false,
      error: { code: 'invalid-data' },
    })
    expect(await provider.backup.restore({
      ...before.value,
      schemaVersion: 99,
    })).toMatchObject({
      ok: false,
      error: { code: 'unsupported-version' },
    })

    const after = await provider.backup.export()
    expect(after).toMatchObject({
      ok: true,
      value: {
        lessonPacks: before.value.lessonPacks,
        progress: before.value.progress,
        activeSession: before.value.activeSession,
        settings: before.value.settings,
      },
    })
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

  it('rejects legacy progress rather than applying a lossy SRS migration', async () => {
    await writeRawKey('learner-progress', {
      schedulesByReviewKey: { 'old-pack::old-item': session.schedulesByLexemeId.hello },
      sessionsCompleted: 3,
      totalAnswers: 20,
      correctAnswers: 15,
      lastStudiedAt: '2026-08-01T00:00:00.000Z',
    })

    expect(await provider.progress.loadProgress()).toMatchObject({
      ok: false,
      error: { code: 'invalid-data' },
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
    expect(await unavailableProvider.backup.export()).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    })
    vi.unstubAllGlobals()
  })

  it('writes, reads, exports and clears structured diagnostics separately', async () => {
    await provider.diagnostics.clear()
    const event = diagnosticEvent(1)
    expect(await provider.diagnostics.append(event)).toEqual({
      ok: true,
      value: undefined,
    })
    expect(await provider.diagnostics.list()).toEqual({ ok: true, value: [event] })
    expect(await provider.diagnostics.export()).toMatchObject({
      ok: true,
      value: {
        format: 'english-recall-diagnostics',
        schemaVersion: 1,
        events: [event],
      },
    })

    await provider.progress.saveProgress(createInitialProgress())
    await provider.progress.clearActiveSession()
    await provider.settings.save(defaultAppSettings)
    const normalBackup = await provider.backup.export()
    expect(normalBackup).toMatchObject({ ok: true })
    if (normalBackup.ok) {
      expect(normalBackup.value).not.toHaveProperty('diagnostics')
    }

    expect(await provider.diagnostics.clear()).toEqual({
      ok: true,
      value: undefined,
    })
    expect(await provider.diagnostics.list()).toEqual({ ok: true, value: [] })
  })

  it('caps diagnostic history at the newest 3000 events', async () => {
    await provider.diagnostics.clear()
    for (let index = 0; index <= MAX_DIAGNOSTIC_EVENTS; index += 1) {
      const saved = await provider.diagnostics.append(diagnosticEvent(index))
      if (!saved.ok) throw new Error(saved.error.message)
    }

    const listed = await provider.diagnostics.list()
    if (!listed.ok) throw new Error(listed.error.message)
    expect(listed.value).toHaveLength(MAX_DIAGNOSTIC_EVENTS)
    expect(listed.value[0]?.targetId).toBe('target-1')
    expect(listed.value.at(-1)?.targetId).toBe(`target-${MAX_DIAGNOSTIC_EVENTS}`)
  })

  it('surfaces quota errors from durable writes', async () => {
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(() => {
        throw new DOMException('Storage is full', 'QuotaExceededError')
      })
    const quotaProvider = new IndexedDbPersistenceProvider()

    expect(await quotaProvider.settings.save(defaultAppSettings)).toMatchObject({
      ok: false,
      error: { code: 'quota-exceeded' },
    })
    put.mockRestore()
  })
})
