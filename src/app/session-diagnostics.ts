import type {
  LearningEngineState,
  LearningSessionSnapshot,
} from '../learning-engine/index.ts'
import type { DiagnosticInput } from '../persistence/index.ts'

function sessionFromState(
  state: LearningEngineState,
): LearningSessionSnapshot | undefined {
  return state.status === 'active' ||
    state.status === 'paused' ||
    state.status === 'completed'
    ? state.session
    : undefined
}

export function diagnosticsForAttemptTransition(
  previous: LearningEngineState,
  current: LearningEngineState,
): readonly DiagnosticInput[] {
  const previousSession = sessionFromState(previous)
  const currentSession = sessionFromState(current)
  if (
    !previousSession ||
    !currentSession ||
    previousSession.id !== currentSession.id ||
    currentSession.attemptHistory.length <= previousSession.attemptHistory.length
  ) {
    return []
  }

  return currentSession.attemptHistory
    .slice(previousSession.attemptHistory.length)
    .flatMap((signal) => {
      const shared = {
        sessionId: currentSession.id,
        packId: currentSession.packId,
        lessonId: currentSession.lessonId,
        sentenceId: signal.sentenceId,
        targetId: signal.targetId,
        lexemeId: signal.lexemeId,
        exerciseMode: signal.exerciseMode,
        learningMode: currentSession.learningMode,
        phase: currentSession.phase,
        responseTimeMs: signal.responseTimeMs,
      }
      const events: DiagnosticInput[] = [
        {
          level: signal.outcome === 'incorrect' ? 'warn' : 'info',
          event:
            signal.outcome === 'incorrect'
              ? 'answer_incorrect'
              : signal.outcome === 'correct'
                ? 'answer_correct'
                : 'target_skipped',
          ...shared,
          result: signal.outcome,
          metadata: {
            firstTry: signal.firstTry,
            wrongAttempts: signal.wrongAttempts,
          },
        },
      ]
      if (signal.outcome !== 'incorrect') {
        events.push({
          level: 'info',
          event: 'target_resolved',
          ...shared,
          result: signal.outcome,
        })
      }
      if (signal.nextReviewAt) {
        const rating =
          signal.outcome === 'skipped'
            ? 'again'
            : signal.firstTry
              ? 'good'
              : 'hard'
        events.push({
          level: 'info',
          event: 'srs_committed',
          ...shared,
          result: rating,
          metadata: { nextReviewAt: signal.nextReviewAt },
        })
      }
      return events
    })
}
