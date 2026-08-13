import {
  lessonPackSchema,
  type LessonPack,
} from '../domain/lesson-pack.schema.ts'
import type {
  LearningSessionSnapshot,
  ReviewSchedule,
} from '../learning-engine/index.ts'
import type { Result } from '../shared/types.ts'
import type {
  AppSettings,
  LearnerProgress,
  LessonPackRepository,
  LessonPackSummary,
  PersistenceError,
  PersistenceErrorCode,
  PersistenceProvider,
  ProgressRepository,
  SettingsRepository,
} from './contracts.ts'

const databaseName = 'english-recall'
const databaseVersion = 1
const packStore = 'lesson-packs'
const keyValueStore = 'key-value'
const progressKey = 'learner-progress'
const sessionKey = 'active-session'
const settingsKey = 'settings'

interface StoredValue {
  readonly key: string
  readonly value: unknown
}

function ok<T>(value: T): Result<T, PersistenceError> {
  return { ok: true, value }
}

function toError(error: unknown, fallbackMessage: string): PersistenceError {
  const isQuotaError = error instanceof DOMException && error.name === 'QuotaExceededError'
  const code: PersistenceErrorCode = isQuotaError ? 'quota-exceeded' : 'unknown'
  return { code, message: fallbackMessage, cause: error }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}

function isReviewSchedule(value: unknown): value is ReviewSchedule {
  if (!value || typeof value !== 'object') return false
  const schedule = value as Record<string, unknown>
  return (
    typeof schedule.dueAt === 'string' &&
    typeof schedule.intervalDays === 'number' &&
    typeof schedule.easeFactor === 'number' &&
    typeof schedule.repetitions === 'number' &&
    typeof schedule.lapses === 'number'
  )
}

function isLearnerProgress(value: unknown): value is LearnerProgress {
  if (!value || typeof value !== 'object') return false
  const progress = value as Record<string, unknown>
  const schedules = progress.schedulesByReviewKey

  return (
    Boolean(schedules) &&
    typeof schedules === 'object' &&
    Object.values(schedules as Record<string, unknown>).every(isReviewSchedule) &&
    typeof progress.sessionsCompleted === 'number' &&
    typeof progress.totalAnswers === 'number' &&
    typeof progress.correctAnswers === 'number' &&
    (progress.lastStudiedAt === undefined || typeof progress.lastStudiedAt === 'string')
  )
}

function isSessionSnapshot(value: unknown): value is LearningSessionSnapshot {
  if (!value || typeof value !== 'object') return false
  const session = value as Record<string, unknown>

  return (
    typeof session.id === 'string' &&
    typeof session.packId === 'string' &&
    typeof session.lessonId === 'string' &&
    Array.isArray(session.itemQueue) &&
    session.itemQueue.every((item) => typeof item === 'string') &&
    typeof session.currentIndex === 'number' &&
    (session.phase === 'question' || session.phase === 'feedback') &&
    typeof session.startedAt === 'string' &&
    typeof session.updatedAt === 'string'
  )
}

function isSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== 'object') return false
  const settings = value as Record<string, unknown>
  return (
    typeof settings.autoMode === 'boolean' &&
    typeof settings.audioEnabled === 'boolean' &&
    typeof settings.speechRate === 'number'
  )
}

class IndexedDbConnection {
  private databasePromise: Promise<IDBDatabase> | undefined

  get(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB is not available'))
    }

    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion)

      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(packStore)) {
          database.createObjectStore(packStore, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(keyValueStore)) {
          database.createObjectStore(keyValueStore, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('IndexedDB upgrade was blocked'))
    })

    return this.databasePromise
  }
}

async function getStoredValue(
  connection: IndexedDbConnection,
  key: string,
): Promise<unknown> {
  const database = await connection.get()
  const transaction = database.transaction(keyValueStore, 'readonly')
  const stored = await requestResult<StoredValue | undefined>(
    transaction.objectStore(keyValueStore).get(key),
  )
  return stored?.value
}

async function saveStoredValue(
  connection: IndexedDbConnection,
  key: string,
  value: unknown,
): Promise<void> {
  const database = await connection.get()
  const transaction = database.transaction(keyValueStore, 'readwrite')
  transaction.objectStore(keyValueStore).put({ key, value } satisfies StoredValue)
  await transactionComplete(transaction)
}

async function removeStoredValue(
  connection: IndexedDbConnection,
  key: string,
): Promise<void> {
  const database = await connection.get()
  const transaction = database.transaction(keyValueStore, 'readwrite')
  transaction.objectStore(keyValueStore).delete(key)
  await transactionComplete(transaction)
}

class IndexedDbLessonPackRepository implements LessonPackRepository {
  private readonly connection: IndexedDbConnection

  constructor(connection: IndexedDbConnection) {
    this.connection = connection
  }

  async list(): Promise<Result<readonly LessonPackSummary[], PersistenceError>> {
    try {
      const database = await this.connection.get()
      const transaction = database.transaction(packStore, 'readonly')
      const values = await requestResult<unknown[]>(
        transaction.objectStore(packStore).getAll(),
      )
      const packs = values.map((value) => lessonPackSchema.parse(value))

      return ok(
        packs.map((pack) => ({
          id: pack.id,
          version: pack.version,
          title: pack.title,
          lessonCount: pack.lessons.length,
          itemCount: pack.lessons.reduce(
            (count, lesson) => count + lesson.items.length,
            0,
          ),
        })),
      )
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not list lesson packs') }
    }
  }

  async get(id: string): Promise<Result<LessonPack, PersistenceError>> {
    try {
      const database = await this.connection.get()
      const transaction = database.transaction(packStore, 'readonly')
      const value = await requestResult<unknown>(
        transaction.objectStore(packStore).get(id),
      )

      if (value === undefined) {
        return { ok: false, error: { code: 'not-found', message: 'Lesson pack not found' } }
      }

      const parsed = lessonPackSchema.safeParse(value)
      if (!parsed.success) {
        return {
          ok: false,
          error: { code: 'invalid-data', message: 'Stored lesson pack is invalid' },
        }
      }

      return ok(parsed.data)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not load lesson pack') }
    }
  }

  async save(pack: LessonPack): Promise<Result<void, PersistenceError>> {
    try {
      const validated = lessonPackSchema.parse(pack)
      const database = await this.connection.get()
      const transaction = database.transaction(packStore, 'readwrite')
      transaction.objectStore(packStore).put(validated)
      await transactionComplete(transaction)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not save lesson pack') }
    }
  }

  async remove(id: string): Promise<Result<void, PersistenceError>> {
    try {
      const database = await this.connection.get()
      const transaction = database.transaction(packStore, 'readwrite')
      transaction.objectStore(packStore).delete(id)
      await transactionComplete(transaction)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not remove lesson pack') }
    }
  }
}

class IndexedDbProgressRepository implements ProgressRepository {
  private readonly connection: IndexedDbConnection

  constructor(connection: IndexedDbConnection) {
    this.connection = connection
  }

  async loadProgress(): Promise<Result<LearnerProgress | null, PersistenceError>> {
    try {
      const value = await getStoredValue(this.connection, progressKey)
      if (value === undefined) return ok(null)
      if (!isLearnerProgress(value)) {
        return {
          ok: false,
          error: { code: 'invalid-data', message: 'Stored progress is invalid' },
        }
      }
      return ok(value)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not load progress') }
    }
  }

  async saveProgress(progress: LearnerProgress): Promise<Result<void, PersistenceError>> {
    try {
      await saveStoredValue(this.connection, progressKey, progress)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not save progress') }
    }
  }

  async loadActiveSession(): Promise<
    Result<LearningSessionSnapshot | null, PersistenceError>
  > {
    try {
      const value = await getStoredValue(this.connection, sessionKey)
      if (value === undefined) return ok(null)
      if (!isSessionSnapshot(value)) {
        return {
          ok: false,
          error: { code: 'invalid-data', message: 'Stored session is invalid' },
        }
      }
      return ok(value)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not load session') }
    }
  }

  async saveActiveSession(
    session: LearningSessionSnapshot,
  ): Promise<Result<void, PersistenceError>> {
    try {
      await saveStoredValue(this.connection, sessionKey, session)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not save session') }
    }
  }

  async clearActiveSession(): Promise<Result<void, PersistenceError>> {
    try {
      await removeStoredValue(this.connection, sessionKey)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not clear session') }
    }
  }
}

class IndexedDbSettingsRepository implements SettingsRepository {
  private readonly connection: IndexedDbConnection

  constructor(connection: IndexedDbConnection) {
    this.connection = connection
  }

  async load(): Promise<Result<AppSettings | null, PersistenceError>> {
    try {
      const value = await getStoredValue(this.connection, settingsKey)
      if (value === undefined) return ok(null)
      if (!isSettings(value)) {
        return {
          ok: false,
          error: { code: 'invalid-data', message: 'Stored settings are invalid' },
        }
      }
      return ok(value)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not load settings') }
    }
  }

  async save(settings: AppSettings): Promise<Result<void, PersistenceError>> {
    try {
      await saveStoredValue(this.connection, settingsKey, settings)
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not save settings') }
    }
  }
}

export class IndexedDbPersistenceProvider implements PersistenceProvider {
  readonly lessonPacks: LessonPackRepository
  readonly progress: ProgressRepository
  readonly settings: SettingsRepository

  constructor() {
    const connection = new IndexedDbConnection()
    this.lessonPacks = new IndexedDbLessonPackRepository(connection)
    this.progress = new IndexedDbProgressRepository(connection)
    this.settings = new IndexedDbSettingsRepository(connection)
  }
}
