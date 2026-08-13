import type { LearningItem, LessonPack } from '../domain/lesson-pack.schema.ts'
import type {
  IsoDateTime,
  LearningItemId,
  LessonId,
  LessonPackId,
  Result,
  Unsubscribe,
} from '../shared/types.ts'
import type {
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
  readonly schedulesByItemId?: Readonly<
    Record<LearningItemId, ReviewSchedule>
  >
  readonly now?: IsoDateTime
}

export interface RestoreSessionRequest {
  readonly pack: LessonPack
  readonly snapshot: LearningSessionSnapshot
}

export type LearningEngineErrorCode =
  | 'invalid-state'
  | 'lesson-not-found'
  | 'item-not-found'
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
  pause(): Result<LearningTransition, LearningEngineError>
  resume(): Result<LearningTransition, LearningEngineError>
  reset(): LearningTransition
  subscribe(listener: (state: LearningEngineState) => void): Unsubscribe
}

export interface ItemSelectionContext {
  readonly packId: LessonPackId
  readonly lessonId: LessonId
  readonly items: readonly LearningItem[]
  readonly schedulesByItemId: Readonly<Record<LearningItemId, ReviewSchedule>>
  readonly now: IsoDateTime
}

export interface ItemSelector {
  select(context: ItemSelectionContext): readonly LearningItemId[]
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
