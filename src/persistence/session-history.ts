import {
  getMasteryPercent,
  type LearningSessionSnapshot,
  type ReviewSchedule,
  type SessionResult,
} from '../learning-engine/index.ts'
import type { LexemeId } from '../shared/types.ts'
import {
  DEFAULT_LEARNER_ID,
  type LearnerId,
  type SessionCompletionRecord,
} from './contracts.ts'

export interface SessionCompletionFactsInput {
  readonly learnerId?: LearnerId
  readonly session: LearningSessionSnapshot
  readonly result: SessionResult
  /** Pack-local schedules as they existed immediately before this session. */
  readonly preSessionSchedulesByLexemeId: Readonly<Record<LexemeId, ReviewSchedule>>
}

function unique(values: readonly LexemeId[]): readonly LexemeId[] {
  return [...new Set(values)]
}

/** Builds deterministic report facts without turning practice attempts into reviews. */
export function createSessionCompletionRecord({
  learnerId = DEFAULT_LEARNER_ID,
  session,
  result,
  preSessionSchedulesByLexemeId,
}: SessionCompletionFactsInput): SessionCompletionRecord {
  const committedLexemeIds = unique(
    session.attemptHistory.flatMap((attempt) =>
      attempt.nextReviewAt ? [attempt.lexemeId] : [],
    ),
  )
  const difficultLexemeIds = committedLexemeIds.filter((lexemeId) => {
    const summary = session.attemptsByLexemeId[lexemeId]
    return Boolean(summary && (summary.incorrect > 0 || summary.skipped > 0))
  })

  return {
    learnerId,
    sessionId: session.id,
    packId: session.packId,
    lessonId: session.lessonId,
    startedAt: session.startedAt,
    completedAt: result.completedAt,
    reviewedLexemeIds: committedLexemeIds,
    newlyLearnedLexemeIds: committedLexemeIds.filter(
      (lexemeId) => preSessionSchedulesByLexemeId[lexemeId] === undefined,
    ),
    masteredLexemeIds: committedLexemeIds.filter(
      (lexemeId) =>
        getMasteryPercent(preSessionSchedulesByLexemeId[lexemeId]) < 70 &&
        getMasteryPercent(session.schedulesByLexemeId[lexemeId]) >= 70,
    ),
    difficultLexemeIds,
    correctAnswers: result.correctAnswers,
    incorrectAnswers: result.incorrectAnswers,
    skippedTargets: result.skippedTargets,
  }
}
