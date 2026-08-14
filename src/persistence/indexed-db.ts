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
import { MAX_DIAGNOSTIC_EVENTS } from './contracts.ts'
import type {
  AppSettings,
  BackupRepository,
  DiagnosticEvent,
  DiagnosticExportV1,
  DiagnosticRepository,
  LearnerId,
  LearnerProgress,
  LessonPackCatalog,
  LessonPackRepository,
  PersistenceError,
  PersistenceErrorCode,
  PersistenceBackup,
  PersistenceBackupV2,
  PersistenceProvider,
  ProgressRepository,
  SavedSentenceRecord,
  SavedSentenceRepository,
  SessionCompletionRecord,
  SessionHistoryRepository,
  SettingsRepository,
} from './contracts.ts'
import { DEFAULT_LEARNER_ID } from './contracts.ts'

const databaseName = 'english-recall'
const databaseVersion = 3
const packStore = 'lesson-packs'
const keyValueStore = 'key-value'
const diagnosticStore = 'diagnostics'
const savedSentenceStore = 'saved-sentences'
const sessionHistoryStore = 'session-history'
const legacyProgressKey = 'learner-progress'
const legacySessionKey = 'active-session'
const legacySettingsKey = 'settings'
const scopedKey = (learnerId: LearnerId, name: string) =>
  `learner:${learnerId}:${name}`
const progressKey = scopedKey(DEFAULT_LEARNER_ID, 'progress')
const sessionKey = scopedKey(DEFAULT_LEARNER_ID, 'active-session')
const settingsKey = scopedKey(DEFAULT_LEARNER_ID, 'settings')
export const BACKUP_SCHEMA_VERSION = 2 as const
const backupFormat = 'english-recall-backup' as const
const diagnosticFormat = 'english-recall-diagnostics' as const

interface StoredDiagnosticEvent extends DiagnosticEvent {
  readonly id?: number
}

interface StoredValue {
  readonly key: string
  readonly value: unknown
}

interface StoredSavedSentence extends SavedSentenceRecord {
  readonly key: readonly [LearnerId, string, string]
}

interface StoredSessionCompletion extends SessionCompletionRecord {
  readonly key: readonly [LearnerId, string]
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isUniqueStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(isNonEmptyString) &&
    new Set(value).size === value.length
  )
}

function isSavedSentenceRecord(value: unknown): value is SavedSentenceRecord {
  if (!isStringRecord(value)) return false
  return (
    isNonEmptyString(value.learnerId) &&
    isNonEmptyString(value.packId) &&
    isNonEmptyString(value.sentenceId) &&
    isIsoDateTime(value.savedAt)
  )
}

function isSessionCompletionRecord(
  value: unknown,
): value is SessionCompletionRecord {
  if (!isStringRecord(value)) return false
  const reviewed = value.reviewedLexemeIds
  if (
    !isNonEmptyString(value.learnerId) ||
    !isNonEmptyString(value.sessionId) ||
    !isNonEmptyString(value.packId) ||
    !isNonEmptyString(value.lessonId) ||
    !isIsoDateTime(value.startedAt) ||
    !isIsoDateTime(value.completedAt) ||
    Date.parse(value.completedAt) < Date.parse(value.startedAt) ||
    !isUniqueStringArray(reviewed) ||
    !isUniqueStringArray(value.newlyLearnedLexemeIds) ||
    !isUniqueStringArray(value.masteredLexemeIds) ||
    !isUniqueStringArray(value.difficultLexemeIds) ||
    !isNonNegativeInteger(value.correctAnswers) ||
    !isNonNegativeInteger(value.incorrectAnswers) ||
    !isNonNegativeInteger(value.skippedTargets)
  ) return false

  const reviewedSet = new Set(reviewed)
  return [
    value.newlyLearnedLexemeIds,
    value.masteredLexemeIds,
    value.difficultLexemeIds,
  ].every((ids) => ids.every((id) => reviewedSet.has(id)))
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const diagnosticEventNames = new Set([
  'session_started',
  'session_resumed',
  'session_paused',
  'session_completed',
  'session_ended',
  'target_presented',
  'answer_incorrect',
  'answer_correct',
  'target_skipped',
  'target_resolved',
  'sentence_restarted',
  'srs_committed',
  'learning_state_saved',
  'persistence_failed',
  'session_restore_failed',
  'session_restored',
  'lesson_pack_imported',
  'lesson_pack_rejected',
  'lesson_pack_updated',
  'backup_exported',
  'backup_restore_completed',
  'backup_restore_failed',
  'service_worker_registration_failed',
  'runtime_error',
])

function isDiagnosticEvent(value: unknown): value is DiagnosticEvent {
  if (!isStringRecord(value)) return false
  const metadata = value.metadata
  return (
    isIsoDateTime(value.timestamp) &&
    typeof value.appVersion === 'string' &&
    value.appVersion.length > 0 &&
    (value.level === 'info' || value.level === 'warn' || value.level === 'error') &&
    typeof value.event === 'string' &&
    diagnosticEventNames.has(value.event) &&
    [
      'sessionId',
      'packId',
      'lessonId',
      'sentenceId',
      'targetId',
      'lexemeId',
      'exerciseMode',
      'learningMode',
      'phase',
      'result',
      'errorCode',
    ].every((key) => value[key] === undefined || typeof value[key] === 'string') &&
    (value.responseTimeMs === undefined ||
      (Number.isFinite(value.responseTimeMs) &&
        (value.responseTimeMs as number) >= 0)) &&
    (metadata === undefined ||
      (isStringRecord(metadata) &&
        Object.values(metadata).every(
          (item) =>
            item === null ||
            typeof item === 'string' ||
            (typeof item === 'number' && Number.isFinite(item)) ||
            typeof item === 'boolean',
        )))
  )
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
      value.exerciseMode === 'listening-choice' ||
      value.exerciseMode === 'full-sentence') &&
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
  const initialSchedules = session.initialSchedulesByLexemeId
  const schedules = session.schedulesByLexemeId
  const wrongChoices = session.wrongChoiceIdsByOccurrenceKey
  const activeTargets = session.activeTargetIdsBySentenceId
  const reviewableOccurrenceKeys = session.reviewableOccurrenceKeys
  const scheduledOccurrenceKeys = session.scheduledOccurrenceKeys
  const continuationExcludedReviewKeys = session.continuationExcludedReviewKeys

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
    (continuationExcludedReviewKeys === undefined ||
      (Array.isArray(continuationExcludedReviewKeys) &&
        continuationExcludedReviewKeys.every(
          (key) => typeof key === 'string',
        ) &&
        new Set(continuationExcludedReviewKeys).size ===
          continuationExcludedReviewKeys.length)) &&
    Array.isArray(session.solvedTargetIds) &&
    session.solvedTargetIds.every((id) => typeof id === 'string') &&
    (session.phase === 'question' ||
      session.phase === 'target-feedback' ||
      session.phase === 'sentence-complete') &&
    (session.learningMode === 'auto' ||
      session.learningMode === 'word-choice' ||
      session.learningMode === 'fill-words' ||
      session.learningMode === 'listening-choice' ||
      session.learningMode === 'full-sentence') &&
    (session.exerciseMode === 'word-choice' ||
      session.exerciseMode === 'fill-words' ||
      session.exerciseMode === 'listening-choice' ||
      session.exerciseMode === 'full-sentence') &&
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
    (initialSchedules === undefined ||
      (isStringRecord(initialSchedules) &&
        Object.values(initialSchedules).every(isReviewSchedule))) &&
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
  const configuredSlowerSpeechRate = value.slowerSpeechRate
  if (
    typeof audioEnabled !== 'boolean' ||
    !Number.isFinite(speechRate) ||
    (speechRate as number) < 0.5 ||
    (speechRate as number) > 2
  ) {
    return undefined
  }

  const slowerSpeechRate = Number.isFinite(configuredSlowerSpeechRate)
    ? configuredSlowerSpeechRate as number
    : Math.max(0.5, Number(((speechRate as number) * 0.6).toFixed(2)))
  if (
    slowerSpeechRate < 0.5 ||
    slowerSpeechRate > 1 ||
    slowerSpeechRate > (speechRate as number)
  ) {
    return undefined
  }

  if (
    (value.learningMode === 'auto' ||
      value.learningMode === 'word-choice' ||
      value.learningMode === 'fill-words' ||
      value.learningMode === 'listening-choice' ||
      value.learningMode === 'full-sentence') &&
    typeof value.autoAdvance === 'boolean'
  ) {
    return {
      learningMode: value.learningMode,
      autoAdvance: value.autoAdvance,
      audioEnabled,
      speechRate: speechRate as number,
      slowerSpeechRate,
    }
  }

  if (typeof value.autoMode === 'boolean') {
    return {
      learningMode: 'auto',
      autoAdvance: value.autoMode,
      audioEnabled,
      speechRate: speechRate as number,
      slowerSpeechRate,
    }
  }
  return undefined
}

function isCurrentSettings(value: unknown): value is AppSettings {
  return (
    isStringRecord(value) &&
    hasExactKeys(value, [
      'learningMode',
      'autoAdvance',
      'audioEnabled',
      'speechRate',
      'slowerSpeechRate',
    ]) &&
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

      request.onupgradeneeded = (event) => {
        const database = request.result
        if (!database.objectStoreNames.contains(packStore)) {
          database.createObjectStore(packStore, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(keyValueStore)) {
          database.createObjectStore(keyValueStore, { keyPath: 'key' })
        }
        if (!database.objectStoreNames.contains(diagnosticStore)) {
          database.createObjectStore(diagnosticStore, {
            keyPath: 'id',
            autoIncrement: true,
          })
        }
        if (!database.objectStoreNames.contains(savedSentenceStore)) {
          database.createObjectStore(savedSentenceStore, { keyPath: 'key' })
        }
        if (!database.objectStoreNames.contains(sessionHistoryStore)) {
          database.createObjectStore(sessionHistoryStore, { keyPath: 'key' })
        }

        if ((event as IDBVersionChangeEvent).oldVersion < 3) {
          const store = request.transaction?.objectStore(keyValueStore)
          if (store) {
            for (const [legacyKey, nextKey] of [
              [legacyProgressKey, progressKey],
              [legacySessionKey, sessionKey],
              [legacySettingsKey, settingsKey],
            ] as const) {
              const nextRequest = store.get(nextKey)
              nextRequest.onsuccess = () => {
                if (nextRequest.result !== undefined) return
                const legacyRequest = store.get(legacyKey)
                legacyRequest.onsuccess = () => {
                  if (legacyRequest.result !== undefined) {
                    store.put({
                      key: nextKey,
                      value: (legacyRequest.result as StoredValue).value,
                    } satisfies StoredValue)
                    store.delete(legacyKey)
                  }
                }
              }
            }
          }
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

async function getScopedStoredValue(
  connection: IndexedDbConnection,
  operations: OperationQueue,
  key: string,
  legacyKey: string,
): Promise<unknown> {
  const current = await getStoredValue(connection, key)
  if (current !== undefined) return current
  const legacy = await getStoredValue(connection, legacyKey)
  if (legacy === undefined) return undefined
  await operations.run(async () => {
    await saveStoredValue(connection, key, legacy)
    await removeStoredValue(connection, legacyKey)
  })
  return legacy
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
      const value = await getScopedStoredValue(
        this.connection,
        this.operations,
        progressKey,
        legacyProgressKey,
      )
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
      const value = await getScopedStoredValue(
        this.connection,
        this.operations,
        sessionKey,
        legacySessionKey,
      )
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

  async completeSession(
    progress: LearnerProgress,
    completion: SessionCompletionRecord,
  ): Promise<Result<void, PersistenceError>> {
    if (
      !isLearnerProgress(progress) ||
      !isSessionCompletionRecord(completion) ||
      completion.learnerId !== DEFAULT_LEARNER_ID
    ) {
      return {
        ok: false,
        error: { code: 'invalid-data', message: 'Completed session is invalid' },
      }
    }

    try {
      await this.operations.run(async () => {
        const database = await this.connection.get()
        const transaction = database.transaction(
          [keyValueStore, sessionHistoryStore],
          'readwrite',
        )
        const values = transaction.objectStore(keyValueStore)
        values.put({ key: progressKey, value: progress } satisfies StoredValue)
        values.delete(sessionKey)
        transaction.objectStore(sessionHistoryStore).put({
          ...completion,
          key: [completion.learnerId, completion.sessionId],
        } satisfies StoredSessionCompletion)
        await transactionComplete(transaction)
      })
      return ok(undefined)
    } catch (error) {
      return {
        ok: false,
        error: toError(error, 'Could not save completed session'),
      }
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
      await this.operations.idle()
      const value = await getScopedStoredValue(
        this.connection,
        this.operations,
        settingsKey,
        legacySettingsKey,
      )
      if (value === undefined) return ok(null)
      const settings = normalizeSettings(value)
      if (!settings) {
        return {
          ok: false,
          error: { code: 'invalid-data', message: 'Stored settings are invalid' },
        }
      }
      if (!isCurrentSettings(value)) {
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

class IndexedDbSavedSentenceRepository implements SavedSentenceRepository {
  private readonly connection: IndexedDbConnection
  private readonly operations: OperationQueue
  private readonly learnerId: LearnerId

  constructor(
    connection: IndexedDbConnection,
    operations: OperationQueue,
    learnerId: LearnerId,
  ) {
    this.connection = connection
    this.operations = operations
    this.learnerId = learnerId
  }

  async list(): Promise<Result<readonly SavedSentenceRecord[], PersistenceError>> {
    try {
      await this.operations.idle()
      const database = await this.connection.get()
      const transaction = database.transaction(savedSentenceStore, 'readonly')
      const stored = await requestResult<StoredSavedSentence[]>(
        transaction.objectStore(savedSentenceStore).getAll(),
      )
      const records = stored
        .filter(({ learnerId }) => learnerId === this.learnerId)
        .map(({ key: _key, ...record }) => record)
      if (!records.every(isSavedSentenceRecord)) {
        return { ok: false, error: { code: 'invalid-data', message: 'Stored saved sentences are invalid' } }
      }
      return ok(records.sort((a, b) => a.savedAt.localeCompare(b.savedAt)))
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not load saved sentences') }
    }
  }

  async isSaved(packId: string, sentenceId: string): Promise<Result<boolean, PersistenceError>> {
    try {
      await this.operations.idle()
      const database = await this.connection.get()
      const transaction = database.transaction(savedSentenceStore, 'readonly')
      const value = await requestResult<StoredSavedSentence | undefined>(
        transaction.objectStore(savedSentenceStore).get([this.learnerId, packId, sentenceId]),
      )
      return ok(value !== undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not check saved sentence') }
    }
  }

  async save(record: SavedSentenceRecord): Promise<Result<void, PersistenceError>> {
    if (!isSavedSentenceRecord(record) || record.learnerId !== this.learnerId) {
      return { ok: false, error: { code: 'invalid-data', message: 'Saved sentence is invalid' } }
    }
    try {
      await this.operations.run(async () => {
        const database = await this.connection.get()
        const transaction = database.transaction(savedSentenceStore, 'readwrite')
        transaction.objectStore(savedSentenceStore).put({
          ...record,
          key: [record.learnerId, record.packId, record.sentenceId],
        } satisfies StoredSavedSentence)
        await transactionComplete(transaction)
      })
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not save sentence') }
    }
  }

  async remove(packId: string, sentenceId: string): Promise<Result<void, PersistenceError>> {
    try {
      await this.operations.run(async () => {
        const database = await this.connection.get()
        const transaction = database.transaction(savedSentenceStore, 'readwrite')
        transaction.objectStore(savedSentenceStore).delete([this.learnerId, packId, sentenceId])
        await transactionComplete(transaction)
      })
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not remove saved sentence') }
    }
  }
}

class IndexedDbSessionHistoryRepository implements SessionHistoryRepository {
  private readonly connection: IndexedDbConnection
  private readonly operations: OperationQueue
  private readonly learnerId: LearnerId

  constructor(
    connection: IndexedDbConnection,
    operations: OperationQueue,
    learnerId: LearnerId,
  ) {
    this.connection = connection
    this.operations = operations
    this.learnerId = learnerId
  }

  async list(): Promise<Result<readonly SessionCompletionRecord[], PersistenceError>> {
    try {
      await this.operations.idle()
      const database = await this.connection.get()
      const transaction = database.transaction(sessionHistoryStore, 'readonly')
      const stored = await requestResult<StoredSessionCompletion[]>(
        transaction.objectStore(sessionHistoryStore).getAll(),
      )
      const records = stored
        .filter(({ learnerId }) => learnerId === this.learnerId)
        .map(({ key: _key, ...record }) => record)
      if (!records.every(isSessionCompletionRecord)) {
        return { ok: false, error: { code: 'invalid-data', message: 'Stored session history is invalid' } }
      }
      return ok(records.sort((a, b) => a.completedAt.localeCompare(b.completedAt)))
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not load session history') }
    }
  }

  async append(record: SessionCompletionRecord): Promise<Result<void, PersistenceError>> {
    if (!isSessionCompletionRecord(record) || record.learnerId !== this.learnerId) {
      return { ok: false, error: { code: 'invalid-data', message: 'Session completion is invalid' } }
    }
    try {
      await this.operations.run(async () => {
        const database = await this.connection.get()
        const transaction = database.transaction(sessionHistoryStore, 'readwrite')
        transaction.objectStore(sessionHistoryStore).put({
          ...record,
          key: [record.learnerId, record.sessionId],
        } satisfies StoredSessionCompletion)
        await transactionComplete(transaction)
      })
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not save session history') }
    }
  }
}

function backupValidationError(
  code: 'invalid-data' | 'unsupported-version',
  message: string,
): Result<never, PersistenceError> {
  return { ok: false, error: { code, message } }
}

function validateBackup(input: unknown): Result<PersistenceBackupV2, PersistenceError> {
  if (!isStringRecord(input)) {
    return backupValidationError('invalid-data', 'Backup must be an object')
  }
  if (input.format !== backupFormat) {
    return backupValidationError('invalid-data', 'Backup format is invalid')
  }
  if (input.schemaVersion !== 1 && input.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    return backupValidationError(
      'unsupported-version',
      'Backup schema version is not supported',
    )
  }
  const isV1 = input.schemaVersion === 1
  const expectedKeys = isV1
    ? [
      'format',
      'schemaVersion',
      'exportedAt',
      'lessonPacks',
      'progress',
      'activeSession',
      'settings',
    ]
    : [
      'format',
      'schemaVersion',
      'exportedAt',
      'learnerId',
      'lessonPacks',
      'progress',
      'activeSession',
      'settings',
      'savedSentences',
      'sessionHistory',
    ]
  if (
    !hasExactKeys(input, expectedKeys) ||
    !isIsoDateTime(input.exportedAt) ||
    !Array.isArray(input.lessonPacks) ||
    (!isV1 &&
      (input.learnerId !== DEFAULT_LEARNER_ID ||
        !Array.isArray(input.savedSentences) ||
        !Array.isArray(input.sessionHistory)))
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
  let normalizedSettings: AppSettings | null = null
  if (input.settings !== null) {
    const parsedSettings = normalizeSettings(input.settings)
    if (!parsedSettings) {
      return backupValidationError('invalid-data', 'Backup settings are invalid')
    }
    normalizedSettings = parsedSettings
  }

  const learnerId = isV1 ? DEFAULT_LEARNER_ID : input.learnerId as LearnerId
  const savedSentences = isV1 ? [] : input.savedSentences as unknown[]
  const sessionHistory = isV1 ? [] : input.sessionHistory as unknown[]
  if (
    !savedSentences.every(
      (record) => isSavedSentenceRecord(record) && record.learnerId === learnerId,
    ) ||
    !sessionHistory.every(
      (record) => isSessionCompletionRecord(record) && record.learnerId === learnerId,
    )
  ) {
    return backupValidationError('invalid-data', 'Backup learner data is invalid')
  }
  const validSavedSentences = savedSentences as readonly SavedSentenceRecord[]
  const validSessionHistory = sessionHistory as readonly SessionCompletionRecord[]

  const lexemeReviewKeys = new Set(
    packs.flatMap((pack) =>
      pack.lexemes.map((lexeme) => `${pack.id}::${lexeme.id}`),
    ),
  )
  if (
    new Set(
      validSavedSentences.map((record) => `${record.packId}::${record.sentenceId}`),
    ).size !== validSavedSentences.length
  ) {
    return backupValidationError(
      'invalid-data',
      'Backup contains duplicate saved sentences',
    )
  }
  if (
    new Set(validSessionHistory.map((record) => record.sessionId)).size !==
      validSessionHistory.length
  ) {
    return backupValidationError(
      'invalid-data',
      'Backup contains duplicate session history',
    )
  }

  // Learner-owned history may legitimately outlive updated or removed lesson
  // content. Keep those opaque ids in backup/restore; current UI and planners
  // simply ignore unresolved content. Active sessions remain strictly checked.

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
    const continuationRefsAreValid = (
      session.continuationExcludedReviewKeys ?? []
    ).every((key) => lexemeReviewKeys.has(key))
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
      ...Object.keys(session.initialSchedulesByLexemeId ?? {}),
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
      !continuationRefsAreValid ||
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
    learnerId,
    lessonPacks: packs,
    progress: input.progress,
    activeSession: input.activeSession,
    settings: normalizedSettings,
    savedSentences: validSavedSentences,
    sessionHistory: validSessionHistory,
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
          [packStore, keyValueStore, savedSentenceStore, sessionHistoryStore],
          'readonly',
        )
        const packsRequest = transaction.objectStore(packStore).getAll()
        const keyValues = transaction.objectStore(keyValueStore)
        const progressRequest = keyValues.get(progressKey)
        const sessionRequest = keyValues.get(sessionKey)
        const settingsRequest = keyValues.get(settingsKey)
        const savedRequest = transaction.objectStore(savedSentenceStore).getAll()
        const historyRequest = transaction.objectStore(sessionHistoryStore).getAll()
        const [lessonPacks, progress, activeSession, settings, saved, history] = await Promise.all([
          requestResult<unknown[]>(packsRequest),
          requestResult<StoredValue | undefined>(progressRequest),
          requestResult<StoredValue | undefined>(sessionRequest),
          requestResult<StoredValue | undefined>(settingsRequest),
          requestResult<StoredSavedSentence[]>(savedRequest),
          requestResult<StoredSessionCompletion[]>(historyRequest),
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
          learnerId: DEFAULT_LEARNER_ID,
          lessonPacks: normalizedLessonPacks,
          progress: progress?.value ?? null,
          activeSession: activeSession?.value ?? null,
          settings: settings?.value ?? null,
          savedSentences: saved
            .filter(({ learnerId }) => learnerId === DEFAULT_LEARNER_ID)
            .map(({ key: _key, ...record }) => record),
          sessionHistory: history
            .filter(({ learnerId }) => learnerId === DEFAULT_LEARNER_ID)
            .map(({ key: _key, ...record }) => record),
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
          [packStore, keyValueStore, savedSentenceStore, sessionHistoryStore],
          'readwrite',
        )
        try {
          const packs = transaction.objectStore(packStore)
          const keyValues = transaction.objectStore(keyValueStore)
          const saved = transaction.objectStore(savedSentenceStore)
          const history = transaction.objectStore(sessionHistoryStore)
          packs.clear()
          for (const pack of validated.value.lessonPacks) packs.put(pack)
          keyValues.delete(progressKey)
          keyValues.delete(sessionKey)
          keyValues.delete(settingsKey)
          saved.clear()
          history.clear()
          if (validated.value.progress) {
            keyValues.put({ key: progressKey, value: validated.value.progress })
          }
          if (validated.value.activeSession) {
            keyValues.put({ key: sessionKey, value: validated.value.activeSession })
          }
          if (validated.value.settings) {
            keyValues.put({ key: settingsKey, value: validated.value.settings })
          }
          for (const record of validated.value.savedSentences) {
            saved.put({
              ...record,
              key: [record.learnerId, record.packId, record.sentenceId],
            } satisfies StoredSavedSentence)
          }
          for (const record of validated.value.sessionHistory) {
            history.put({
              ...record,
              key: [record.learnerId, record.sessionId],
            } satisfies StoredSessionCompletion)
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

async function deleteOldestDiagnostics(
  store: IDBObjectStore,
  count: number,
): Promise<void> {
  if (count <= MAX_DIAGNOSTIC_EVENTS) return
  let remaining = count - MAX_DIAGNOSTIC_EVENTS
  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || remaining === 0) {
        resolve()
        return
      }
      cursor.delete()
      remaining -= 1
      cursor.continue()
    }
  })
}

class IndexedDbDiagnosticRepository implements DiagnosticRepository {
  private readonly connection: IndexedDbConnection
  private readonly operations: OperationQueue

  constructor(connection: IndexedDbConnection, operations: OperationQueue) {
    this.connection = connection
    this.operations = operations
  }

  async append(event: DiagnosticEvent): Promise<Result<void, PersistenceError>> {
    if (!isDiagnosticEvent(event)) {
      return {
        ok: false,
        error: { code: 'invalid-data', message: 'Diagnostic event is invalid' },
      }
    }

    try {
      await this.operations.run(async () => {
        const database = await this.connection.get()
        const transaction = database.transaction(diagnosticStore, 'readwrite')
        const store = transaction.objectStore(diagnosticStore)
        store.add(event satisfies StoredDiagnosticEvent)
        const count = await requestResult(store.count())
        await deleteOldestDiagnostics(store, count)
        await transactionComplete(transaction)
      })
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not save diagnostic event') }
    }
  }

  async list(): Promise<Result<readonly DiagnosticEvent[], PersistenceError>> {
    try {
      await this.operations.idle()
      const database = await this.connection.get()
      const transaction = database.transaction(diagnosticStore, 'readonly')
      const stored = await requestResult<StoredDiagnosticEvent[]>(
        transaction.objectStore(diagnosticStore).getAll(),
      )
      const events = stored.map(({ id: _id, ...event }) => event)
      if (!events.every(isDiagnosticEvent)) {
        return {
          ok: false,
          error: { code: 'invalid-data', message: 'Stored diagnostics are invalid' },
        }
      }
      return ok(events)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not load diagnostics') }
    }
  }

  async export(): Promise<Result<DiagnosticExportV1, PersistenceError>> {
    const events = await this.list()
    if (!events.ok) return events
    return ok({
      format: diagnosticFormat,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      events: events.value,
    })
  }

  async clear(): Promise<Result<void, PersistenceError>> {
    try {
      await this.operations.run(async () => {
        const database = await this.connection.get()
        const transaction = database.transaction(diagnosticStore, 'readwrite')
        transaction.objectStore(diagnosticStore).clear()
        await transactionComplete(transaction)
      })
      return ok(undefined)
    } catch (error) {
      return { ok: false, error: toError(error, 'Could not clear diagnostics') }
    }
  }
}

export class IndexedDbPersistenceProvider implements PersistenceProvider {
  readonly lessonPacks: LessonPackRepository
  readonly progress: ProgressRepository
  readonly settings: SettingsRepository
  readonly savedSentences: SavedSentenceRepository
  readonly sessionHistory: SessionHistoryRepository
  readonly backup: BackupRepository
  readonly diagnostics: DiagnosticRepository

  constructor() {
    const connection = new IndexedDbConnection()
    const operations = new OperationQueue()
    const diagnosticOperations = new OperationQueue()
    this.lessonPacks = new IndexedDbLessonPackRepository(connection, operations)
    this.progress = new IndexedDbProgressRepository(connection, operations)
    this.settings = new IndexedDbSettingsRepository(connection, operations)
    this.savedSentences = new IndexedDbSavedSentenceRepository(
      connection,
      operations,
      DEFAULT_LEARNER_ID,
    )
    this.sessionHistory = new IndexedDbSessionHistoryRepository(
      connection,
      operations,
      DEFAULT_LEARNER_ID,
    )
    this.backup = new IndexedDbBackupRepository(connection, operations)
    this.diagnostics = new IndexedDbDiagnosticRepository(
      connection,
      diagnosticOperations,
    )
  }
}
