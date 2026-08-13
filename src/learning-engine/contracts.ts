import type { LessonPack, Sentence } from '../domain/lesson-pack.schema.ts'
import type {
  IsoDateTime,
  LexemeId,
  LessonId,
  LessonPackId,
  Result,
  SentenceId,
  TargetOccurrenceId,
  Unsubscribe,
} from '../shared/types.ts'
import type {
  LearningMode,
  LearningEngineState,
  LearningSessionSnapshot,
  RecallRating,
  ReviewSchedule,
} from './state.ts'

export type LearningResponse =
  | { readonly kind: 'self-assessment'; readonly rating: RecallRating }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'choice'; readonly choiceId: string }

export interface StartSessionRequest {
  readonly pack: LessonPack
  readonly lessonId: LessonId
  readonly schedulesByLexemeId?: Readonly<
    Record<LexemeId, ReviewSchedule>
  >
  readonly learningMode?: LearningMode
  readonly now?: IsoDateTime
  readonly excludedLexemeIds?: readonly LexemeId[]
  readonly continuationExcludedReviewKeys?: readonly string[]
  readonly practiceOnly?: boolean
}

export interface RestoreSessionRequest {
  readonly pack: LessonPack
  readonly snapshot: LearningSessionSnapshot
}

export type LearningEngineErrorCode =
  | 'invalid-state'
  | 'lesson-not-found'
  | 'target-not-found'
  | 'invalid-response'
  | 'invalid-snapshot'

export interface LearningEngineError {
  readonly code: LearningEngineErrorCode
  readonly message: string
}

export interface LearningTransition {
  readonly previous: LearningEngineState
  readonly current: LearningEngineState
}

export interface LearningEngine {
  getState(): LearningEngineState
  start(
    request: StartSessionRequest,
  ): Result<LearningTransition, LearningEngineError>
  restore(
    request: RestoreSessionRequest,
  ): Result<LearningTransition, LearningEngineError>
  submit(
    response: LearningResponse,
  ): Result<LearningTransition, LearningEngineError>
  skip(): Result<LearningTransition, LearningEngineError>
  advance(): Result<LearningTransition, LearningEngineError>
  restartSentence(): Result<LearningTransition, LearningEngineError>
  setLearningMode(
    mode: LearningMode,
  ): Result<LearningTransition, LearningEngineError>
  pause(): Result<LearningTransition, LearningEngineError>
  resume(): Result<LearningTransition, LearningEngineError>
  reset(): LearningTransition
  subscribe(listener: (state: LearningEngineState) => void): Unsubscribe
}

export interface SentenceSelectionContext {
  readonly packId: LessonPackId
  readonly lessonId: LessonId
  readonly sentences: readonly Sentence[]
  readonly schedulesByLexemeId: Readonly<Record<LexemeId, ReviewSchedule>>
  readonly activeTargetIdsBySentenceId: Readonly<
    Record<SentenceId, readonly TargetOccurrenceId[]>
  >
  readonly now: IsoDateTime
}

export interface SentenceSelector {
  select(context: SentenceSelectionContext): readonly SentenceId[]
}

export interface ReviewScheduler {
  schedule(
    previous: ReviewSchedule | undefined,
    rating: RecallRating,
    reviewedAt: IsoDateTime,
  ): ReviewSchedule
}

export interface Clock {
  now(): IsoDateTime
}
