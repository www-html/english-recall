import {
  lessonPackSchema,
  parseLessonPack,
  type LessonPack,
} from '../domain/lesson-pack.schema.ts'
import { decideLessonPackUpdate } from '../domain/lesson-pack-update.ts'
import type {
  AnswerEvaluation,
  AttemptSignal,
  AttemptSummary,
  LearningSessionSnapshot,
  ReviewSchedule,
} from '../learning-engine/index.ts'
import type { Result } from '../shared/types.ts'
import type {
  AppSettings,
  BackupRepository,
  LearnerProgress,
  LessonPackCatalog,
  LessonPackRepository,
  PersistenceError,
  PersistenceErrorCode,
  PersistenceBackup,
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
export const BACKUP_SCHEMA_VERSION = 1 as const
const backupFormat = 'english-recall-backup' as const

interface StoredValue {
  readonly key: string
  readonly value: unknown
}

function ok<T>(value: T): Result<T, PersistenceError> {
  return { ok: true, value }
}

function toError(error: unknown, fallbackMessage: string): PersistenceError {
  const isQuotaError = error instanceof DOMException && error.name === 'QuotaExceededError'
  const isUnavailable =
    error instanceof Error && error.message === 'IndexedDB is not available'
  const code: PersistenceErrorCode = isQuotaError
    ? 'quota-exceeded'
    : isUnavailable
      ? 'unavailable'
      : 'unknown'
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

function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function isReviewSchedule(value: unknown): value is ReviewSchedule {
  if (!value || typeof value !== 'object') return false
  const schedule = value as Record<string, unknown>
  return (
    isIsoDateTime(schedule.dueAt) &&
    Number.isFinite(schedule.intervalDays) &&
    (schedule.intervalDays as number) >= 0 &&
    Number.isFinite(schedule.easeFactor) &&
    (schedule.easeFactor as number) >= 1 &&
    Number.isInteger(schedule.repetitions) &&
    (schedule.repetitions as number) >= 0 &&
    Number.isInteger(schedule.lapses) &&
    (schedule.lapses as number) >= 0
  )
}

function isLearnerProgress(value: unknown): value is LearnerProgress {
  if (!value || typeof value !== 'object') return false
  const progress = value as Record<string, unknown>
  const schedules = progress.schedulesByLexemeReviewKey

  return (
    Boolean(schedules) &&
    typeof schedules === 'object' &&
    Object.values(schedules as Record<string, unknown>).every(isReviewSchedule) &&
    isNonNegativeInteger(progress.sessionsCompleted) &&
    isNonNegativeInteger(progress.totalAnswers) &&
    isNonNegativeInteger(progress.correctAnswers) &&
    (progress.correctAnswers as number) <= (progress.totalAnswers as number) &&
    (progress.lastStudiedAt === undefined || isIsoDateTime(progress.lastStudiedAt))
  )
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort()
  return actualKeys.length === keys.length &&
    actualKeys.every((key, index) => key === [...keys].sort()[index])
}

function isAttemptSummary(value: unknown): value is AttemptSummary {
  if (!isStringRecord(value)) return false
  return (
    isNonNegativeInteger(value.attempts) &&
    isNonNegativeInteger(value.correct) &&
    isNonNegativeInteger(value.incorrect) &&
    isNonNegativeInteger(value.skipped) &&
    (value.attempts as number) ===
      (value.correct as number) +
        (value.incorrect as number) +
        (value.skipped as number) &&
    isIsoDateTime(value.lastReviewedAt) &&
    (value.lastRating === undefined ||
      ['again', 'hard', 'good', 'easy'].includes(String(value.lastRating)))
  )
}

function isAttemptSignal(value: unknown): value is AttemptSignal {
  if (!isStringRecord(value)) return false
  return (
    typeof value.lexemeId === 'string' &&
    typeof value.sentenceId === 'string' &&
    typeof value.targetId === 'string' &&
    (value.exerciseMode === 'word-choice' ||
      value.exerciseMode === 'fill-words' ||
      value.exerciseMode === 'listening-choice') &&
    (value.outcome === 'correct' ||
      value.outcome === 'incorrect' ||
      value.outcome === 'skipped') &&
    typeof value.firstTry === 'boolean' &&
    Number.isInteger(value.wrongAttempts) &&
    (value.wrongAttempts as number) >= 0 &&
    Number.isFinite(value.responseTimeMs) &&
    (value.responseTimeMs as number) >= 0 &&
    isIsoDateTime(value.reviewedAt) &&
    (value.nextReviewAt === undefined || isIsoDateTime(value.nextReviewAt))
  )
}

function isAnswerEvaluation(value: unknown): value is AnswerEvaluation {
  if (!isStringRecord(value)) return false
  const common =
    typeof value.lexemeId === 'string' &&
    typeof value.sentenceId === 'string' &&
    typeof value.targetId === 'string' &&
    typeof value.response === 'string' &&
    ['again', 'hard', 'good', 'easy'].includes(String(value.rating)) &&
    typeof value.firstTry === 'boolean' &&
    Number.isInteger(value.wrongAttempts) &&
    (value.wrongAttempts as number) >= 0
  if (!common) return false
  if (value.outcome === 'correct') return typeof value.expectedAnswer === 'string'
  return (
    (value.outcome === 'incorrect' || value.outcome === 'skipped') &&
    value.expectedAnswer === undefined
  )
}

function isSessionSnapshot(value: unknown): value is LearningSessionSnapshot {
  if (!isStringRecord(value)) return false
  const session = value
  const attempts = session.attemptsByLexemeId
  const schedules = session.schedulesByLexemeId
  const wrongChoices = session.wrongChoiceIdsByOccurrenceKey
  const activeTargets = session.activeTargetIdsBySentenceId
  const reviewableOccurrenceKeys = session.reviewableOccurrenceKeys
  const scheduledOccurrenceKeys = session.scheduledOccurrenceKeys

  return (
    typeof session.id === 'string' &&
    typeof session.packId === 'string' &&
    typeof session.lessonId === 'string' &&
    Array.isArray(session.sentenceQueue) &&
    session.sentenceQueue.length > 0 &&
    session.sentenceQueue.every((item) => typeof item === 'string') &&
    Number.isInteger(session.currentSentenceIndex) &&
    (session.currentSentenceIndex as number) >= 0 &&
    (session.currentSentenceIndex as number) < session.sentenceQueue.length &&
    typeof session.currentSentenceId === 'string' &&
    session.currentSentenceId ===
      session.sentenceQueue[session.currentSentenceIndex as number] &&
    Number.isInteger(session.currentTargetIndex) &&
    (session.currentTargetIndex as number) >= 0 &&
    typeof session.currentTargetId === 'string' &&
    isStringRecord(activeTargets) &&
    Object.values(activeTargets).every(
      (ids) =>
        Array.isArray(ids) &&
        ids.length > 0 &&
        ids.every((id) => typeof id === 'string') &&
        new Set(ids).size === ids.length,
    ) &&
    Array.isArray(reviewableOccurrenceKeys) &&
    reviewableOccurrenceKeys.every((key) => typeof key === 'string') &&
    new Set(reviewableOccurrenceKeys).size === reviewableOccurrenceKeys.length &&
    Array.isArray(scheduledOccurrenceKeys) &&
    scheduledOccurrenceKeys.every(
      (key) =>
        typeof key === 'string' && reviewableOccurrenceKeys.includes(key),
    ) &&
    new Set(scheduledOccurrenceKeys).size === scheduledOccurrenceKeys.length &&
    typeof session.isPracticeFallback === 'boolean' &&
    (!session.isPracticeFallback || reviewableOccurrenceKeys.length === 0) &&
    Array.isArray(session.solvedTargetIds) &&
    session.solvedTargetIds.every((id) => typeof id === 'string') &&
    (session.phase === 'question' ||
      session.phase === 'target-feedback' ||
      session.phase === 'sentence-complete') &&
    (session.learningMode === 'auto' ||
      session.learningMode === 'word-choice' ||
      session.learningMode === 'fill-words' ||
      session.learningMode === 'listening-choice') &&
    (session.exerciseMode === 'word-choice' ||
      session.exerciseMode === 'fill-words' ||
      session.exerciseMode === 'listening-choice') &&
    (session.lastEvaluation === undefined ||
      isAnswerEvaluation(session.lastEvaluation)) &&
    isStringRecord(wrongChoices) &&
    Object.values(wrongChoices).every(
      (ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'),
    ) &&
    isStringRecord(attempts) &&
    Object.values(attempts).every(isAttemptSummary) &&
    Array.isArray(session.attemptHistory) &&
    session.attemptHistory.every(isAttemptSignal) &&
    isStringRecord(schedules) &&
    Object.values(schedules).every(isReviewSchedule) &&
    isIsoDateTime(session.startedAt) &&
    isIsoDateTime(session.questionStartedAt) &&
    isIsoDateTime(session.updatedAt)
  )
}

function normalizeSettings(value: unknown): AppSettings | undefined {
  if (!isStringRecord(value)) return undefined
  const audioEnabled = value.audioEnabled
  const speechRate = value.speechRate
  if (
    typeof audioEnabled !== 'boolean' ||
    !Number.isFinite(speechRate) ||
    (speechRate as number) < 0.5 ||
    (speechRate as number) > 2
  ) {
    return undefined
  }

  if (
    (value.learningMode === 'auto' ||
      value.learningMode === 'word-choice' ||
      value.learningMode === 'fill-words' ||
      value.learningMode === 'listening-choice') &&
    typeof value.autoAdvance === 'boolean'
  ) {
    return {
      learningMode: value.learningMode,
      autoAdvance: value.autoAdvance,
      audioEnabled,
      speechRate: speechRate as number,
    }
  }

  if (typeof value.autoMode === 'boolean') {
    return {
      learningMode: 'auto',
      autoAdvance: value.autoMode,
      audioEnabled,
      speechRate: speechRate as number,
    }
  }
  return undefined
}

function isCurrentSettings(value: unknown): value is AppSettings {
  return (
    isStringRecord(value) &&
    hasExactKeys(value, ['learningMode', 'autoAdvance', 'audioEnabled', 'speechRate']) &&
    normalizeSettings(value) !== undefined
  )
}

class OperationQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  idle(): Promise<void> {
    return this.tail
  }
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
  private readonly operations: OperationQueue

  constructor(connection: IndexedDbConnection, operations: OperationQueue) {
    this.connection = connection
    this.operations = operations
  }

  async list(): Promise<Result<LessonPackCatalog, PersistenceError>> {
    try {
      const database = await this.connection.get()
      const transaction = database.transaction(packStore, 'readonly')
      const values = await requestResult<unknown[]>(
        transaction.objectStore(packStore).getAll(),
      )
      // Treat each stored pack as its own trust boundary. A single obsolete or
      // malformed import must not make the rest of the library unavailable.
      const skipped: LessonPackCatalog['skipped'][number][] = []
      const packs = values.flatMap((value) => {
        try {
          return [parseLessonPack(value)]
        } catch {
          const id =
            isStringRecord(value) && typeof value.id === 'string'
              ? value.id
              : undefined
          skipped.push(
            id
              ? { id, reason: 'invalid-or-unsupported' }
              : { reason: 'invalid-or-unsupported' },
          )
          return []
        }
      })

      return ok({
        summaries: packs.map((pack) => ({
          id: pack.id,
          version: pack.version,
          title: pack.title,
          lessonCount: pack.lessons.length,
          targetCount: pack.lessons.reduce(
            (count, lesson) =>
              count +
              lesson.sentences.reduce(
                (targetCount, sentence) => targetCount + sentence.targets.length,
                0,
              ),
            0,
          ),
        })),
        skipped,
      })
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

      let parsed: LessonPack
      try {
        parsed = parseLessonPack(value)
      } catch {
        return {
          ok: false,
          error: { code: 'invalid-data', message: 'Stored lesson pack is invalid' },
        }
      }

      return ok(parsed)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not load lesson pack') }
    }
  }

  async save(pack: LessonPack): Promise<Result<void, PersistenceError>> {
    try {
      const validated = lessonPackSchema.parse(pack)
      const decision = await this.operations.run(async () => {
        const database = await this.connection.get()
        const transaction = database.transaction(packStore, 'readwrite')
        const store = transaction.objectStore(packStore)
        const existingValue = await requestResult<unknown>(store.get(validated.id))
        let existing: LessonPack | null = null
        if (existingValue !== undefined) {
          try {
            existing = parseLessonPack(existingValue)
          } catch {
            // A valid import may replace a malformed pack with the same id.
          }
        }
        const update = decideLessonPackUpdate(existing, validated)
        if (update.action === 'install' || update.action === 'replace') {
          store.put(validated)
        }
        await transactionComplete(transaction)
        return update
      })
      if (decision.action === 'reject') {
        return {
          ok: false,
          error: {
            code: 'invalid-data',
            message:
              decision.reason === 'downgrade'
                ? 'Lesson pack downgrade was rejected'
                : 'Changed lesson pack content requires a newer semantic version',
          },
        }
      }
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not save lesson pack') }
    }
  }

  async remove(id: string): Promise<Result<void, PersistenceError>> {
    try {
      await this.operations.run(async () => {
        const database = await this.connection.get()
        const transaction = database.transaction(packStore, 'readwrite')
        transaction.objectStore(packStore).delete(id)
        await transactionComplete(transaction)
      })
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not remove lesson pack') }
    }
  }
}

class IndexedDbProgressRepository implements ProgressRepository {
  private readonly connection: IndexedDbConnection
  private readonly operations: OperationQueue

  constructor(connection: IndexedDbConnection, operations: OperationQueue) {
    this.connection = connection
    this.operations = operations
  }

  async loadProgress(): Promise<Result<LearnerProgress | null, PersistenceError>> {
    try {
      await this.operations.idle()
      const value = await getStoredValue(this.connection, progressKey)
      if (value === undefined) return ok(null)
      if (!isLearnerProgress(value)) {
        return {
          ok: false,
          error: {
            code: 'invalid-data',
            message: 'Stored progress is invalid or requires an unsupported migration',
          },
        }
      }
      return ok(value)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not load progress') }
    }
  }

  async saveProgress(progress: LearnerProgress): Promise<Result<void, PersistenceError>> {
    if (!isLearnerProgress(progress)) {
      return {
        ok: false,
        error: { code: 'invalid-data', message: 'Progress is invalid' },
      }
    }
    try {
      await this.operations.run(() =>
        saveStoredValue(this.connection, progressKey, progress),
      )
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not save progress') }
    }
  }

  async loadActiveSession(): Promise<
    Result<LearningSessionSnapshot | null, PersistenceError>
  > {
    try {
      await this.operations.idle()
      const value = await getStoredValue(this.connection, sessionKey)
      if (value === undefined) return ok(null)
      if (!isSessionSnapshot(value)) {
        if (isStringRecord(value) && Array.isArray(value.itemQueue)) {
          await this.operations.run(() =>
            removeStoredValue(this.connection, sessionKey),
          )
          return ok(null)
        }
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
    if (!isSessionSnapshot(session)) {
      return {
        ok: false,
        error: { code: 'invalid-data', message: 'Session is invalid' },
      }
    }
    try {
      await this.operations.run(() =>
        saveStoredValue(this.connection, sessionKey, session),
      )
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not save session') }
    }
  }

  async clearActiveSession(): Promise<Result<void, PersistenceError>> {
    try {
      await this.operations.run(() =>
        removeStoredValue(this.connection, sessionKey),
      )
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not clear session') }
    }
  }

  async saveLearningState(
    progress: LearnerProgress,
    activeSession: LearningSessionSnapshot | null,
  ): Promise<Result<void, PersistenceError>> {
    if (!isLearnerProgress(progress) || (activeSession && !isSessionSnapshot(activeSession))) {
      return {
        ok: false,
        error: { code: 'invalid-data', message: 'Learning state is invalid' },
      }
    }

    try {
      await this.operations.run(async () => {
        const database = await this.connection.get()
        const transaction = database.transaction(keyValueStore, 'readwrite')
        const store = transaction.objectStore(keyValueStore)
        store.put({ key: progressKey, value: progress } satisfies StoredValue)
        if (activeSession) {
          store.put({ key: sessionKey, value: activeSession } satisfies StoredValue)
        } else {
          store.delete(sessionKey)
        }
        await transactionComplete(transaction)
      })
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not save learning state') }
    }
  }
}

class IndexedDbSettingsRepository implements SettingsRepository {
  private readonly connection: IndexedDbConnection
  private readonly operations: OperationQueue

  constructor(connection: IndexedDbConnection, operations: OperationQueue) {
    this.connection = connection
    this.operations = operations
  }

  async load(): Promise<Result<AppSettings | null, PersistenceError>> {
    try {
      const value = await getStoredValue(this.connection, settingsKey)
      if (value === undefined) return ok(null)
      const settings = normalizeSettings(value)
      if (!settings) {
        return {
          ok: false,
          error: { code: 'invalid-data', message: 'Stored settings are invalid' },
        }
      }
      if (isStringRecord(value) && !('learningMode' in value)) {
        await this.operations.run(() =>
          saveStoredValue(this.connection, settingsKey, settings),
        )
      }
      return ok(settings)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not load settings') }
    }
  }

  async save(settings: AppSettings): Promise<Result<void, PersistenceError>> {
    if (!normalizeSettings(settings)) {
      return {
        ok: false,
        error: { code: 'invalid-data', message: 'Settings are invalid' },
      }
    }
    try {
      await this.operations.run(() =>
        saveStoredValue(this.connection, settingsKey, settings),
      )
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not save settings') }
    }
  }
}

function backupValidationError(
  code: 'invalid-data' | 'unsupported-version',
  message: string,
): Result<never, PersistenceError> {
  return { ok: false, error: { code, message } }
}

function validateBackup(input: unknown): Result<PersistenceBackup, PersistenceError> {
  if (!isStringRecord(input)) {
    return backupValidationError('invalid-data', 'Backup must be an object')
  }
  if (input.format !== backupFormat) {
    return backupValidationError('invalid-data', 'Backup format is invalid')
  }
  if (input.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    return backupValidationError(
      'unsupported-version',
      'Backup schema version is not supported',
    )
  }
  if (
    !hasExactKeys(input, [
      'format',
      'schemaVersion',
      'exportedAt',
      'lessonPacks',
      'progress',
      'activeSession',
      'settings',
    ]) ||
    !isIsoDateTime(input.exportedAt) ||
    !Array.isArray(input.lessonPacks)
  ) {
    return backupValidationError('invalid-data', 'Backup structure is invalid')
  }

  const packs: LessonPack[] = []
  for (const value of input.lessonPacks) {
    const parsed = lessonPackSchema.safeParse(value)
    if (!parsed.success) {
      return backupValidationError('invalid-data', 'Backup contains an invalid lesson pack')
    }
    packs.push(parsed.data)
  }
  if (new Set(packs.map(({ id }) => id)).size !== packs.length) {
    return backupValidationError('invalid-data', 'Backup contains duplicate lesson pack ids')
  }
  if (input.progress !== null && !isLearnerProgress(input.progress)) {
    return backupValidationError('invalid-data', 'Backup progress is invalid')
  }
  if (input.activeSession !== null && !isSessionSnapshot(input.activeSession)) {
    return backupValidationError('invalid-data', 'Backup active session is invalid')
  }
  if (input.settings !== null && !isCurrentSettings(input.settings)) {
    return backupValidationError('invalid-data', 'Backup settings are invalid')
  }

  const lexemeReviewKeys = new Set(
    packs.flatMap((pack) =>
      pack.lexemes.map((lexeme) => `${pack.id}::${lexeme.id}`),
    ),
  )
  if (
    input.progress &&
    !Object.keys(input.progress.schedulesByLexemeReviewKey).every((key) =>
      lexemeReviewKeys.has(key),
    )
  ) {
    return backupValidationError(
      'invalid-data',
      'Backup progress references an unknown lexeme',
    )
  }

  if (input.activeSession) {
    const session = input.activeSession
    const pack = packs.find(({ id }) => id === session.packId)
    const lesson = pack?.lessons.find(({ id }) => id === session.lessonId)
    const sentences = new Map(lesson?.sentences.map((sentence) => [sentence.id, sentence]))
    const lexemeIds = new Set(pack?.lexemes.map(({ id }) => id))
    const queueIsValid =
      new Set(session.sentenceQueue).size === session.sentenceQueue.length &&
      session.sentenceQueue.every((id) => sentences.has(id))
    const activeSentenceIds = Object.keys(session.activeTargetIdsBySentenceId)
    const activeTargetsAreValid = Object.entries(
      session.activeTargetIdsBySentenceId,
    ).every(([sentenceId, targetIds]) => {
      const targetIdSet = new Set(
        sentences.get(sentenceId)?.targets.map(({ id }) => id),
      )
      return (
        session.sentenceQueue.includes(sentenceId) &&
        targetIds.every((targetId) => targetIdSet.has(targetId))
      )
    })
    const allQueuedSentencesHaveTargets =
      activeSentenceIds.length === session.sentenceQueue.length &&
      session.sentenceQueue.every((id) => activeSentenceIds.includes(id))
    const activeOccurrenceKeys = new Set(
      Object.entries(session.activeTargetIdsBySentenceId).flatMap(
        ([sentenceId, targetIds]) =>
          targetIds.map((targetId) => `${sentenceId}::${targetId}`),
      ),
    )
    const currentTargets =
      session.activeTargetIdsBySentenceId[session.currentSentenceId] ?? []
    const currentSentence = sentences.get(session.currentSentenceId)
    const currentTargetIsValid =
      currentSentence?.targets[session.currentTargetIndex]?.id ===
        session.currentTargetId && currentTargets.includes(session.currentTargetId)
    const occurrenceRefsAreValid = [
      ...session.reviewableOccurrenceKeys,
      ...session.scheduledOccurrenceKeys,
      ...Object.keys(session.wrongChoiceIdsByOccurrenceKey),
    ].every((key) => activeOccurrenceKeys.has(key))
    const wrongChoiceRefsAreValid = Object.values(
      session.wrongChoiceIdsByOccurrenceKey,
    ).every((ids) => ids.every((id) => lexemeIds.has(id)))
    const attemptRefsAreValid = session.attemptHistory.every((attempt) => {
      const sentence = sentences.get(attempt.sentenceId)
      const target = sentence?.targets.find(({ id }) => id === attempt.targetId)
      return target?.lexemeId === attempt.lexemeId
    })
    const lexemeRefsAreValid = [
      ...Object.keys(session.attemptsByLexemeId),
      ...Object.keys(session.schedulesByLexemeId),
    ].every((lexemeId) => lexemeIds.has(lexemeId))
    if (
      !pack ||
      !lesson ||
      !queueIsValid ||
      !activeTargetsAreValid ||
      !allQueuedSentencesHaveTargets ||
      !currentTargetIsValid ||
      !occurrenceRefsAreValid ||
      !wrongChoiceRefsAreValid ||
      !attemptRefsAreValid ||
      !lexemeRefsAreValid
    ) {
      return backupValidationError(
        'invalid-data',
        'Backup active session references unknown content',
      )
    }
  }

  return ok({
    format: backupFormat,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: input.exportedAt,
    lessonPacks: packs,
    progress: input.progress,
    activeSession: input.activeSession,
    settings: input.settings,
  })
}

class IndexedDbBackupRepository implements BackupRepository {
  private readonly connection: IndexedDbConnection
  private readonly operations: OperationQueue

  constructor(
    connection: IndexedDbConnection,
    operations: OperationQueue,
  ) {
    this.connection = connection
    this.operations = operations
  }

  async export(): Promise<Result<PersistenceBackup, PersistenceError>> {
    try {
      return await this.operations.run(async () => {
        const database = await this.connection.get()
        const transaction = database.transaction(
          [packStore, keyValueStore],
          'readonly',
        )
        const packsRequest = transaction.objectStore(packStore).getAll()
        const keyValues = transaction.objectStore(keyValueStore)
        const progressRequest = keyValues.get(progressKey)
        const sessionRequest = keyValues.get(sessionKey)
        const settingsRequest = keyValues.get(settingsKey)
        const [lessonPacks, progress, activeSession, settings] = await Promise.all([
          requestResult<unknown[]>(packsRequest),
          requestResult<StoredValue | undefined>(progressRequest),
          requestResult<StoredValue | undefined>(sessionRequest),
          requestResult<StoredValue | undefined>(settingsRequest),
        ])
        const normalizedLessonPacks = lessonPacks.flatMap((value) => {
          try {
            return [parseLessonPack(value)]
          } catch {
            // Invalid packs are already isolated from the library; keep them
            // quarantined rather than allowing them to block a valid backup.
            return []
          }
        })
        return validateBackup({
          format: backupFormat,
          schemaVersion: BACKUP_SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
          lessonPacks: normalizedLessonPacks,
          progress: progress?.value ?? null,
          activeSession: activeSession?.value ?? null,
          settings: settings?.value ?? null,
        })
      })
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not export backup') }
    }
  }

  async restore(backup: unknown): Promise<Result<void, PersistenceError>> {
    const validated = validateBackup(backup)
    if (!validated.ok) return validated

    try {
      await this.operations.run(async () => {
        const database = await this.connection.get()
        const transaction = database.transaction(
          [packStore, keyValueStore],
          'readwrite',
        )
        try {
          const packs = transaction.objectStore(packStore)
          const keyValues = transaction.objectStore(keyValueStore)
          packs.clear()
          for (const pack of validated.value.lessonPacks) packs.put(pack)
          keyValues.delete(progressKey)
          keyValues.delete(sessionKey)
          keyValues.delete(settingsKey)
          if (validated.value.progress) {
            keyValues.put({ key: progressKey, value: validated.value.progress })
          }
          if (validated.value.activeSession) {
            keyValues.put({ key: sessionKey, value: validated.value.activeSession })
          }
          if (validated.value.settings) {
            keyValues.put({ key: settingsKey, value: validated.value.settings })
          }
          await transactionComplete(transaction)
        } catch (error) {
          try {
            transaction.abort()
          } catch {
            // The transaction may already have aborted itself.
          }
          throw error
        }
      })
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not restore backup') }
    }
  }
}

export class IndexedDbPersistenceProvider implements PersistenceProvider {
  readonly lessonPacks: LessonPackRepository
  readonly progress: ProgressRepository
  readonly settings: SettingsRepository
  readonly backup: BackupRepository

  constructor() {
    const connection = new IndexedDbConnection()
    const operations = new OperationQueue()
    this.lessonPacks = new IndexedDbLessonPackRepository(connection, operations)
    this.progress = new IndexedDbProgressRepository(connection, operations)
    this.settings = new IndexedDbSettingsRepository(connection, operations)
    this.backup = new IndexedDbBackupRepository(connection, operations)
  }
}
