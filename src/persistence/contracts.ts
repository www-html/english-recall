import type { LessonPack } from '../domain/lesson-pack.schema.ts'
import type {
  LearningSessionSnapshot,
  LearningMode,
  ReviewSchedule,
} from '../learning-engine/index.ts'
import type {
  IsoDateTime,
  LexemeId,
  LessonId,
  LessonPackId,
  Result,
  SentenceId,
  SessionId,
} from '../shared/types.ts'

export type LearnerId = string
export const DEFAULT_LEARNER_ID: LearnerId = 'default'

export interface LessonPackSummary {
  readonly id: LessonPackId
  readonly version: string
  readonly title: string
  readonly lessonCount: number
  readonly targetCount: number
}

export interface SkippedLessonPack {
  readonly id?: LessonPackId
  readonly reason: 'invalid-or-unsupported'
}

export interface LessonPackCatalog {
  readonly summaries: readonly LessonPackSummary[]
  readonly skipped: readonly SkippedLessonPack[]
}

export interface LearnerProgress {
  /** Keys are produced by createReviewKey(packId, lexemeId). */
  readonly schedulesByLexemeReviewKey: Readonly<Record<string, ReviewSchedule>>
  readonly sessionsCompleted: number
  readonly totalAnswers: number
  readonly correctAnswers: number
  readonly lastStudiedAt?: IsoDateTime
}

export interface AppSettings {
  readonly learningMode: LearningMode
  readonly autoAdvance: boolean
  readonly audioEnabled: boolean
  readonly speechRate: number
  readonly slowerSpeechRate: number
}

export type PersistenceErrorCode =
  | 'not-found'
  | 'invalid-data'
  | 'unsupported-version'
  | 'quota-exceeded'
  | 'unavailable'
  | 'unknown'

export interface PersistenceError {
  readonly code: PersistenceErrorCode
  readonly message: string
  readonly cause?: unknown
}

export interface LessonPackRepository {
  list(): Promise<Result<LessonPackCatalog, PersistenceError>>
  get(id: LessonPackId): Promise<Result<LessonPack, PersistenceError>>
  save(pack: LessonPack): Promise<Result<void, PersistenceError>>
  remove(id: LessonPackId): Promise<Result<void, PersistenceError>>
}

export interface ProgressRepository {
  loadProgress(): Promise<Result<LearnerProgress | null, PersistenceError>>
  saveProgress(progress: LearnerProgress): Promise<Result<void, PersistenceError>>
  loadActiveSession(): Promise<
    Result<LearningSessionSnapshot | null, PersistenceError>
  >
  saveActiveSession(
    session: LearningSessionSnapshot,
  ): Promise<Result<void, PersistenceError>>
  clearActiveSession(): Promise<Result<void, PersistenceError>>
  saveLearningState(
    progress: LearnerProgress,
    activeSession: LearningSessionSnapshot | null,
  ): Promise<Result<void, PersistenceError>>
  /** Atomically saves final progress, clears resume state, and records history. */
  completeSession(
    progress: LearnerProgress,
    completion: SessionCompletionRecord,
  ): Promise<Result<void, PersistenceError>>
}

export interface SettingsRepository {
  load(): Promise<Result<AppSettings | null, PersistenceError>>
  save(settings: AppSettings): Promise<Result<void, PersistenceError>>
}

export interface SavedSentenceRecord {
  readonly learnerId: LearnerId
  readonly packId: LessonPackId
  readonly sentenceId: SentenceId
  readonly savedAt: IsoDateTime
}

export interface SavedSentenceRepository {
  list(): Promise<Result<readonly SavedSentenceRecord[], PersistenceError>>
  isSaved(
    packId: LessonPackId,
    sentenceId: SentenceId,
  ): Promise<Result<boolean, PersistenceError>>
  save(record: SavedSentenceRecord): Promise<Result<void, PersistenceError>>
  remove(
    packId: LessonPackId,
    sentenceId: SentenceId,
  ): Promise<Result<void, PersistenceError>>
}

/**
 * Immutable facts captured when a session completes. Arrays contain unique ids:
 * reviewed = real SRS commits only; newly learned = reviewed lexemes without a
 * pre-session schedule; mastered = mastery crossings from below 70 to at least 70.
 */
export interface SessionCompletionRecord {
  readonly learnerId: LearnerId
  readonly sessionId: SessionId
  readonly packId: LessonPackId
  readonly lessonId: LessonId
  readonly startedAt: IsoDateTime
  readonly completedAt: IsoDateTime
  readonly reviewedLexemeIds: readonly LexemeId[]
  readonly newlyLearnedLexemeIds: readonly LexemeId[]
  readonly masteredLexemeIds: readonly LexemeId[]
  readonly difficultLexemeIds: readonly LexemeId[]
  readonly correctAnswers: number
  readonly incorrectAnswers: number
  readonly skippedTargets: number
}

export interface SessionHistoryRepository {
  list(): Promise<Result<readonly SessionCompletionRecord[], PersistenceError>>
  append(record: SessionCompletionRecord): Promise<Result<void, PersistenceError>>
}

export interface PersistenceBackupV1 {
  readonly format: 'english-recall-backup'
  readonly schemaVersion: 1
  readonly exportedAt: IsoDateTime
  readonly lessonPacks: readonly LessonPack[]
  readonly progress: LearnerProgress | null
  readonly activeSession: LearningSessionSnapshot | null
  readonly settings: AppSettings | null
}

export interface PersistenceBackupV2 {
  readonly format: 'english-recall-backup'
  readonly schemaVersion: 2
  readonly exportedAt: IsoDateTime
  readonly learnerId: LearnerId
  readonly lessonPacks: readonly LessonPack[]
  readonly progress: LearnerProgress | null
  readonly activeSession: LearningSessionSnapshot | null
  readonly settings: AppSettings | null
  readonly savedSentences: readonly SavedSentenceRecord[]
  readonly sessionHistory: readonly SessionCompletionRecord[]
}

export type PersistenceBackup = PersistenceBackupV1 | PersistenceBackupV2

export interface BackupRepository {
  export(): Promise<Result<PersistenceBackup, PersistenceError>>
  restore(backup: unknown): Promise<Result<void, PersistenceError>>
}

export const MAX_DIAGNOSTIC_EVENTS = 3_000

export type DiagnosticLevel = 'info' | 'warn' | 'error'

export type DiagnosticEventName =
  | 'session_started'
  | 'session_resumed'
  | 'session_paused'
  | 'session_completed'
  | 'session_ended'
  | 'target_presented'
  | 'answer_incorrect'
  | 'answer_correct'
  | 'target_skipped'
  | 'target_resolved'
  | 'sentence_restarted'
  | 'srs_committed'
  | 'learning_state_saved'
  | 'persistence_failed'
  | 'session_restore_failed'
  | 'session_restored'
  | 'lesson_pack_imported'
  | 'lesson_pack_rejected'
  | 'lesson_pack_updated'
  | 'backup_exported'
  | 'backup_restore_completed'
  | 'backup_restore_failed'
  | 'service_worker_registration_failed'
  | 'runtime_error'

export type DiagnosticMetadataValue = string | number | boolean | null

export interface DiagnosticEvent {
  readonly timestamp: IsoDateTime
  readonly appVersion: string
  readonly level: DiagnosticLevel
  readonly event: DiagnosticEventName
  readonly sessionId?: string
  readonly packId?: LessonPackId
  readonly lessonId?: string
  readonly sentenceId?: string
  readonly targetId?: string
  readonly lexemeId?: LexemeId
  readonly exerciseMode?: string
  readonly learningMode?: LearningMode
  readonly phase?: string
  readonly result?: string
  readonly errorCode?: string
  readonly responseTimeMs?: number
  readonly metadata?: Readonly<Record<string, DiagnosticMetadataValue>>
}

export interface DiagnosticExportV1 {
  readonly format: 'english-recall-diagnostics'
  readonly schemaVersion: 1
  readonly exportedAt: IsoDateTime
  readonly events: readonly DiagnosticEvent[]
}

export interface DiagnosticRepository {
  append(event: DiagnosticEvent): Promise<Result<void, PersistenceError>>
  list(): Promise<Result<readonly DiagnosticEvent[], PersistenceError>>
  export(): Promise<Result<DiagnosticExportV1, PersistenceError>>
  clear(): Promise<Result<void, PersistenceError>>
}

export interface LearnerSyncSnapshotV1 {
  readonly schemaVersion: 1
  readonly learnerId: LearnerId
  readonly capturedAt: IsoDateTime
  readonly progress: LearnerProgress | null
  readonly activeSession: LearningSessionSnapshot | null
  readonly settings: AppSettings | null
  readonly savedSentences: readonly SavedSentenceRecord[]
  readonly sessionHistory: readonly SessionCompletionRecord[]
}

export interface SyncRepository {
  pull(
    learnerId: LearnerId,
  ): Promise<Result<LearnerSyncSnapshotV1 | null, PersistenceError>>
  push(snapshot: LearnerSyncSnapshotV1): Promise<Result<void, PersistenceError>>
}

/** Optional future boundary. The local provider does not configure remote sync. */
export interface SyncProvider {
  readonly sync: SyncRepository
}

export interface PersistenceProvider {
  readonly lessonPacks: LessonPackRepository
  readonly progress: ProgressRepository
  readonly settings: SettingsRepository
  readonly savedSentences: SavedSentenceRepository
  readonly sessionHistory: SessionHistoryRepository
  readonly backup: BackupRepository
  readonly diagnostics: DiagnosticRepository
}

export function createReviewKey(
  packId: LessonPackId,
  lexemeId: LexemeId,
): string {
  return `${packId}::${lexemeId}`
}

export function createInitialProgress(): LearnerProgress {
  return {
    schedulesByLexemeReviewKey: {},
    sessionsCompleted: 0,
    totalAnswers: 0,
    correctAnswers: 0,
  }
}

export const defaultAppSettings: AppSettings = {
  learningMode: 'auto',
  autoAdvance: false,
  audioEnabled: true,
  speechRate: 0.9,
  slowerSpeechRate: 0.55,
}
