import type {
  IsoDateTime,
  LearningItemId,
  LessonId,
  LessonPackId,
  SessionId,
} from '../shared/types.ts'

export const recallRatings = ['again', 'hard', 'good', 'easy'] as const
export type RecallRating = (typeof recallRatings)[number]

export interface ReviewSchedule {
  readonly dueAt: IsoDateTime
  readonly intervalDays: number
  readonly easeFactor: number
  readonly repetitions: number
  readonly lapses: number
}

export interface AttemptSummary {
  readonly attempts: number
  readonly correct: number
  readonly incorrect: number
  readonly skipped: number
  readonly lastReviewedAt: IsoDateTime
  readonly lastRating?: RecallRating
}

export interface AnswerEvaluation {
  readonly itemId: LearningItemId
  readonly outcome: 'correct' | 'incorrect' | 'skipped'
  readonly expectedAnswer: string
  readonly response: string
  readonly rating: RecallRating
}

export interface LearningSessionSnapshot {
  readonly id: SessionId
  readonly packId: LessonPackId
  readonly lessonId: LessonId
  readonly itemQueue: readonly LearningItemId[]
  readonly currentIndex: number
  readonly phase: 'question' | 'feedback'
  readonly lastEvaluation?: AnswerEvaluation
  readonly attemptsByItemId: Readonly<Record<LearningItemId, AttemptSummary>>
  readonly schedulesByItemId: Readonly<Record<LearningItemId, ReviewSchedule>>
  readonly startedAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

export interface SessionResult {
  readonly reviewedItems: number
  readonly correctAnswers: number
  readonly incorrectAnswers: number
  readonly skippedItems: number
  readonly accuracyPercent: number
  readonly completedAt: IsoDateTime
}

export type LearningEngineState =
  | { readonly status: 'idle' }
  | { readonly status: 'active'; readonly session: LearningSessionSnapshot }
  | { readonly status: 'paused'; readonly session: LearningSessionSnapshot }
  | {
      readonly status: 'completed'
      readonly session: LearningSessionSnapshot
      readonly result: SessionResult
    }
  | {
      readonly status: 'error'
      readonly message: string
      readonly recoverable: boolean
      readonly session?: LearningSessionSnapshot
    }
