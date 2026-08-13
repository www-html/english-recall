import type { LessonPack } from '../domain/lesson-pack.schema.ts'
import type {
  LearningSessionSnapshot,
  LearningMode,
  ReviewSchedule,
} from '../learning-engine/index.ts'
import type {
  IsoDateTime,
  LexemeId,
  LessonPackId,
  Result,
} from '../shared/types.ts'

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
}

export type PersistenceErrorCode =
  | 'not-found'
  | 'invalid-data'
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
}

export interface SettingsRepository {
  load(): Promise<Result<AppSettings | null, PersistenceError>>
  save(settings: AppSettings): Promise<Result<void, PersistenceError>>
}

export interface PersistenceProvider {
  readonly lessonPacks: LessonPackRepository
  readonly progress: ProgressRepository
  readonly settings: SettingsRepository
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
}
