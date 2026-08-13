import type {
  IsoDateTime,
  LexemeId,
  LessonId,
  LessonPackId,
  SentenceId,
  SessionId,
  TargetOccurrenceId,
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

export const learningModes = [
  'auto',
  'word-choice',
  'fill-words',
  'listening-choice',
] as const
export type LearningMode = (typeof learningModes)[number]
export type ExerciseMode = Exclude<LearningMode, 'auto'>

export interface AttemptSignal {
  readonly lexemeId: LexemeId
  readonly sentenceId: SentenceId
  readonly targetId: TargetOccurrenceId
  readonly exerciseMode: ExerciseMode
  readonly outcome: 'correct' | 'incorrect' | 'skipped'
  readonly firstTry: boolean
  readonly wrongAttempts: number
  readonly responseTimeMs: number
  readonly reviewedAt: IsoDateTime
  /** Present only after this occurrence resolves and affects SRS. */
  readonly nextReviewAt?: IsoDateTime
}

interface AnswerEvaluationBase {
  readonly lexemeId: LexemeId
  readonly sentenceId: SentenceId
  readonly targetId: TargetOccurrenceId
  readonly response: string
  readonly rating: RecallRating
  readonly firstTry: boolean
  readonly wrongAttempts: number
}

export type AnswerEvaluation =
  | (AnswerEvaluationBase & {
      readonly outcome: 'correct'
      readonly expectedAnswer: string
    })
  | (AnswerEvaluationBase & {
      readonly outcome: 'incorrect' | 'skipped'
    })

export interface LearningSessionSnapshot {
  readonly id: SessionId
  readonly packId: LessonPackId
  readonly lessonId: LessonId
  readonly sentenceQueue: readonly SentenceId[]
  readonly currentSentenceIndex: number
  readonly currentSentenceId: SentenceId
  readonly currentTargetIndex: number
  readonly currentTargetId: TargetOccurrenceId
  /** Targets exercised in each queued sentence; all others are supporting context. */
  readonly activeTargetIdsBySentenceId: Readonly<
    Record<SentenceId, readonly TargetOccurrenceId[]>
  >
  /** Empty in practice fallback; these occurrences are allowed to update SRS. */
  readonly reviewableOccurrenceKeys: readonly string[]
  /** Durable idempotency guard: each occurrence can schedule at most once. */
  readonly scheduledOccurrenceKeys: readonly string[]
  readonly isPracticeFallback: boolean
  readonly solvedTargetIds: readonly TargetOccurrenceId[]
  readonly phase: 'question' | 'target-feedback' | 'sentence-complete'
  readonly learningMode: LearningMode
  readonly exerciseMode: ExerciseMode
  readonly lastEvaluation?: AnswerEvaluation
  /** Keys are `${sentenceId}::${targetId}` because target ids are sentence-local. */
  readonly wrongChoiceIdsByOccurrenceKey: Readonly<
    Record<string, readonly LexemeId[]>
  >
  readonly attemptsByLexemeId: Readonly<Record<LexemeId, AttemptSummary>>
  readonly attemptHistory: readonly AttemptSignal[]
  readonly schedulesByLexemeId: Readonly<Record<LexemeId, ReviewSchedule>>
  readonly startedAt: IsoDateTime
  readonly questionStartedAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

export interface SessionResult {
  readonly reviewedLexemes: number
  readonly completedTargets: number
  readonly difficultLexemes: number
  readonly correctAnswers: number
  readonly incorrectAnswers: number
  readonly skippedTargets: number
  readonly practiceTargets: number
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
