import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import type { LessonPack } from '../domain/lesson-pack.schema.ts'
import type { LearningSessionSnapshot } from '../learning-engine/index.ts'
import {
  createInitialProgress,
  defaultAppSettings,
} from './contracts.ts'
import { IndexedDbPersistenceProvider } from './indexed-db.ts'

const pack: LessonPack = {
  schemaVersion: 1,
  id: 'persistence-pack',
  version: '1.0.0',
  title: 'Persistence pack',
  sourceLanguage: 'vi',
  targetLanguage: 'en',
  lessons: [
    {
      id: 'lesson-one',
      title: 'Lesson one',
      items: [
        {
          id: 'item-one',
          kind: 'typing',
          prompt: 'Type hello',
          acceptedAnswers: ['hello'],
          caseSensitive: false,
          tags: [],
        },
      ],
    },
  ],
}

const session: LearningSessionSnapshot = {
  id: 'session-one',
  packId: pack.id,
  lessonId: 'lesson-one',
  itemQueue: ['item-one'],
  currentIndex: 0,
  phase: 'question',
  attemptsByItemId: {},
  schedulesByItemId: {},
  startedAt: '2026-08-12T12:00:00.000Z',
  updatedAt: '2026-08-12T12:00:00.000Z',
}

function deleteTestDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('english-recall')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

describe('IndexedDbPersistenceProvider', () => {
  const provider = new IndexedDbPersistenceProvider()

  beforeAll(async () => {
    await deleteTestDatabase()
  })

  it('round-trips lesson packs and summaries', async () => {
    expect(await provider.lessonPacks.save(pack)).toMatchObject({ ok: true })
    expect(await provider.lessonPacks.get(pack.id)).toMatchObject({
      ok: true,
      value: { title: 'Persistence pack' },
    })
    expect(await provider.lessonPacks.list()).toMatchObject({
      ok: true,
      value: [{ lessonCount: 1, itemCount: 1 }],
    })
  })

  it('round-trips progress and settings', async () => {
    const progress = {
      ...createInitialProgress(),
      sessionsCompleted: 2,
    }
    const settings = { ...defaultAppSettings, autoMode: true }

    await provider.progress.saveProgress(progress)
    await provider.settings.save(settings)

    expect(await provider.progress.loadProgress()).toEqual({ ok: true, value: progress })
    expect(await provider.settings.load()).toEqual({ ok: true, value: settings })
  })

  it('round-trips and clears the active session', async () => {
    await provider.progress.saveActiveSession(session)
    expect(await provider.progress.loadActiveSession()).toEqual({
      ok: true,
      value: session,
    })

    await provider.progress.clearActiveSession()
    expect(await provider.progress.loadActiveSession()).toEqual({
      ok: true,
      value: null,
    })
  })
})
