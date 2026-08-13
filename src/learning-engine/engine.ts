import type {
  Lesson,
  LessonPack,
  Lexeme,
  Sentence,
  TargetOccurrence,
} from '../domain/lesson-pack.schema.ts'
import type {
  LexemeId,
  Result,
  SentenceId,
  Unsubscribe,
} from '../shared/types.ts'
import type {
  Clock,
  LearningEngine,
  LearningEngineError,
  LearningResponse,
  LearningTransition,
  RestoreSessionRequest,
  ReviewScheduler,
  SentenceSelectionContext,
  SentenceSelector,
  StartSessionRequest,
} from './contracts.ts'
import { BasicReviewScheduler, getMasteryPercent } from './scheduler.ts'
import type {
  AnswerEvaluation,
  AttemptSignal,
  AttemptSummary,
  ExerciseMode,
  LearningEngineState,
  LearningMode,
  LearningSessionSnapshot,
  RecallRating,
  ReviewSchedule,
  SessionResult,
} from './state.ts'

class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString()
  }
}

class DueFirstSentenceSelector implements SentenceSelector {
  select(context: SentenceSelectionContext): readonly SentenceId[] {
    const now = Date.parse(context.now)

    return [...context.sentences]
      .sort((left, right) => {
        const leftScore = sentenceDueScore(left, context.schedulesByLexemeId)
        const rightScore = sentenceDueScore(right, context.schedulesByLexemeId)
        const leftIsDue = leftScore <= now
        const rightIsDue = rightScore <= now

        if (leftIsDue !== rightIsDue) return leftIsDue ? -1 : 1
        return leftScore - rightScore
      })
      .map((sentence) => sentence.id)
  }
}

function sentenceDueScore(
  sentence: Sentence,
  schedules: Readonly<Record<LexemeId, ReviewSchedule>>,
): number {
  return Math.min(
    ...sentence.targets.map((target) => {
      const dueAt = schedules[target.lexemeId]?.dueAt
      return dueAt ? Date.parse(dueAt) : 0
    }),
  )
}

function success<T>(value: T): Result<T, LearningEngineError> {
  return { ok: true, value }
}

function failure(
  code: LearningEngineError['code'],
  message: string,
): Result<never, LearningEngineError> {
  return { ok: false, error: { code, message } }
}

function normalizeAnswer(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

export function createTargetOccurrenceKey(
  sentenceId: SentenceId,
  targetId: string,
): string {
  return `${sentenceId}::${targetId}`
}

/** Auto deliberately chooses presentation only; it never advances the session. */
export function selectExerciseMode(
  mode: LearningMode,
  schedule: ReviewSchedule | undefined,
): ExerciseMode {
  if (mode !== 'auto') return mode
  const mastery = getMasteryPercent(schedule)
  if (mastery >= 75) return 'listening-choice'
  return mastery >= 40 ? 'fill-words' : 'word-choice'
}

interface CurrentContext {
  readonly sentence: Sentence
  readonly target: TargetOccurrence
  readonly lexeme: Lexeme
}

function isFiniteDate(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

function isSchedule(value: ReviewSchedule | undefined): value is ReviewSchedule {
  return Boolean(
    value &&
      isFiniteDate(value.dueAt) &&
      Number.isFinite(value.intervalDays) &&
      value.intervalDays >= 0 &&
      Number.isFinite(value.easeFactor) &&
      value.easeFactor >= 1 &&
      Number.isInteger(value.repetitions) &&
      value.repetitions >= 0 &&
      Number.isInteger(value.lapses) &&
      value.lapses >= 0,
  )
}

function snapshotMatchesPack(
  pack: LessonPack,
  lesson: Lesson,
  snapshot: LearningSessionSnapshot,
): boolean {
  if (
    !snapshot.wrongChoiceIdsByOccurrenceKey ||
    typeof snapshot.wrongChoiceIdsByOccurrenceKey !== 'object' ||
    Array.isArray(snapshot.wrongChoiceIdsByOccurrenceKey) ||
    snapshot.packId !== pack.id ||
    snapshot.lessonId !== lesson.id ||
    snapshot.sentenceQueue.length === 0 ||
    snapshot.currentSentenceIndex < 0 ||
    snapshot.currentSentenceIndex >= snapshot.sentenceQueue.length ||
    snapshot.currentSentenceId !==
      snapshot.sentenceQueue[snapshot.currentSentenceIndex] ||
    !isFiniteDate(snapshot.startedAt) ||
    !isFiniteDate(snapshot.questionStartedAt) ||
    !isFiniteDate(snapshot.updatedAt)
  ) {
    return false
  }

  const lessonSentenceIds = new Set(lesson.sentences.map(({ id }) => id))
  if (
    new Set(snapshot.sentenceQueue).size !== snapshot.sentenceQueue.length ||
    !snapshot.sentenceQueue.every((id) => lessonSentenceIds.has(id))
  ) {
    return false
  }

  const sentence = lesson.sentences.find(
    ({ id }) => id === snapshot.currentSentenceId,
  )
  const target = sentence?.targets[snapshot.currentTargetIndex]
  if (!sentence || !target || target.id !== snapshot.currentTargetId) return false

  const targetIds = new Set(sentence.targets.map(({ id }) => id))
  const solvedPrefixLength =
    snapshot.phase === 'sentence-complete'
      ? sentence.targets.length
      : snapshot.phase === 'target-feedback'
        ? snapshot.currentTargetIndex + 1
        : snapshot.currentTargetIndex
  const expectedSolvedTargetIds = sentence.targets
    .slice(0, solvedPrefixLength)
    .map(({ id }) => id)
  if (
    new Set(snapshot.solvedTargetIds).size !== snapshot.solvedTargetIds.length ||
    !snapshot.solvedTargetIds.every((id) => targetIds.has(id)) ||
    snapshot.solvedTargetIds.length !== expectedSolvedTargetIds.length ||
    !snapshot.solvedTargetIds.every(
      (id, index) => id === expectedSolvedTargetIds[index],
    )
  ) {
    return false
  }

  const lexemeIds = new Set(pack.lexemes.map(({ id }) => id))
  const targetContextById = new Map(
    lesson.sentences.flatMap((candidate) =>
      candidate.targets.map(
        (candidateTarget) =>
          [
            createTargetOccurrenceKey(candidate.id, candidateTarget.id),
            {
              sentenceId: candidate.id,
              lexemeId: candidateTarget.lexemeId,
              choiceIds: new Set(candidateTarget.distractorLexemeIds),
            },
          ] as const,
      ),
    ),
  )
  return (
    Object.entries(snapshot.schedulesByLexemeId).every(
      ([id, schedule]) => lexemeIds.has(id) && isSchedule(schedule),
    ) &&
    snapshot.attemptHistory.every((attempt) => {
      const attemptContext = targetContextById.get(
        createTargetOccurrenceKey(attempt.sentenceId, attempt.targetId),
      )
      return (
        lexemeIds.has(attempt.lexemeId) &&
        lessonSentenceIds.has(attempt.sentenceId) &&
        attemptContext?.sentenceId === attempt.sentenceId &&
        attemptContext.lexemeId === attempt.lexemeId &&
        isFiniteDate(attempt.reviewedAt) &&
        isFiniteDate(attempt.nextReviewAt)
      )
    }) &&
    Object.entries(snapshot.wrongChoiceIdsByOccurrenceKey).every(
      ([key, choiceIds]) => {
        const targetContext = targetContextById.get(key)
        return (
          targetContext &&
          new Set(choiceIds).size === choiceIds.length &&
          choiceIds.every((choiceId) => targetContext.choiceIds.has(choiceId))
        )
      },
    )
  )
}

function summarize(
  session: LearningSessionSnapshot,
  completedAt: string,
): SessionResult {
  const attempts = Object.values(session.attemptsByLexemeId)
  const correctAnswers = attempts.reduce((sum, item) => sum + item.correct, 0)
  const incorrectAnswers = attempts.reduce((sum, item) => sum + item.incorrect, 0)
  const skippedItems = attempts.reduce((sum, item) => sum + item.skipped, 0)
  const answered = correctAnswers + incorrectAnswers

  return {
    reviewedLexemes: attempts.filter((attempt) => attempt.attempts > 0).length,
    correctAnswers,
    incorrectAnswers,
    skippedItems,
    accuracyPercent:
      answered === 0 ? 0 : Math.round((correctAnswers / answered) * 100),
    completedAt,
  }
}

export class DefaultLearningEngine implements LearningEngine {
  private state: LearningEngineState = { status: 'idle' }
  private readonly listeners = new Set<(state: LearningEngineState) => void>()
  private pack: LessonPack | undefined
  private lesson: Lesson | undefined
  private readonly clock: Clock
  private readonly sentenceSelector: SentenceSelector
  private readonly scheduler: ReviewScheduler

  constructor(
    clock: Clock = new SystemClock(),
    sentenceSelector: SentenceSelector = new DueFirstSentenceSelector(),
    scheduler: ReviewScheduler = new BasicReviewScheduler(),
  ) {
    this.clock = clock
    this.sentenceSelector = sentenceSelector
    this.scheduler = scheduler
  }

  getState(): LearningEngineState {
    return this.state
  }

  start(request: StartSessionRequest): Result<LearningTransition, LearningEngineError> {
    const lesson = request.pack.lessons.find(({ id }) => id === request.lessonId)
    if (!lesson) return failure('lesson-not-found', 'Lesson was not found')

    const now = request.now ?? this.clock.now()
    const schedules = request.schedulesByLexemeId ?? {}
    const sentenceQueue = this.sentenceSelector.select({
      packId: request.pack.id,
      lessonId: lesson.id,
      sentences: lesson.sentences,
      schedulesByLexemeId: schedules,
      now,
    })
    const sentence = lesson.sentences.find(({ id }) => id === sentenceQueue[0])
    const target = sentence?.targets[0]
    if (!sentence || !target) {
      return failure('target-not-found', 'Lesson has no sentence target')
    }

    this.pack = request.pack
    this.lesson = lesson
    const learningMode = request.learningMode ?? 'auto'

    return success(
      this.setState({
        status: 'active',
        session: {
          id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          packId: request.pack.id,
          lessonId: lesson.id,
          sentenceQueue,
          currentSentenceIndex: 0,
          currentSentenceId: sentence.id,
          currentTargetIndex: 0,
          currentTargetId: target.id,
          solvedTargetIds: [],
          phase: 'question',
          learningMode,
          exerciseMode: selectExerciseMode(
            learningMode,
            schedules[target.lexemeId],
          ),
          wrongChoiceIdsByOccurrenceKey: {},
          attemptsByLexemeId: {},
          attemptHistory: [],
          schedulesByLexemeId: schedules,
          startedAt: now,
          questionStartedAt: now,
          updatedAt: now,
        },
      }),
    )
  }

  restore(request: RestoreSessionRequest): Result<LearningTransition, LearningEngineError> {
    const lesson = request.pack.lessons.find(
      ({ id }) => id === request.snapshot.lessonId,
    )
    if (!lesson || !snapshotMatchesPack(request.pack, lesson, request.snapshot)) {
      return failure('invalid-snapshot', 'Saved session is not valid for this pack')
    }

    this.pack = request.pack
    this.lesson = lesson
    return success(this.setState({ status: 'active', session: request.snapshot }))
  }

  submit(response: LearningResponse): Result<LearningTransition, LearningEngineError> {
    if (this.state.status !== 'active' || this.state.session.phase !== 'question') {
      return failure('invalid-state', 'No question is ready for an answer')
    }

    const context = this.currentContext(this.state.session)
    if (!context) return failure('target-not-found', 'Current sentence target was not found')

    if (this.state.session.exerciseMode !== 'fill-words') {
      if (response.kind !== 'choice') {
        return failure('invalid-response', 'Choice exercises require a choice response')
      }
      const allowed = [
        context.target.lexemeId,
        ...context.target.distractorLexemeIds,
      ]
      if (!allowed.includes(response.choiceId)) {
        return failure('invalid-response', 'Selected choice does not exist')
      }
      return success(
        this.recordAttempt(
          this.state.session,
          context,
          response.choiceId === context.target.lexemeId ? 'correct' : 'incorrect',
          response.choiceId,
        ),
      )
    }

    if (response.kind !== 'text') {
      return failure('invalid-response', 'Fill Words requires a text response')
    }
    const outcome =
      normalizeAnswer(response.value) === normalizeAnswer(context.lexeme.text)
        ? 'correct'
        : 'incorrect'
    return success(
      this.recordAttempt(
        this.state.session,
        context,
        outcome,
        response.value.trim(),
      ),
    )
  }

  skip(): Result<LearningTransition, LearningEngineError> {
    if (this.state.status !== 'active' || this.state.session.phase !== 'question') {
      return failure('invalid-state', 'No question is ready to skip')
    }
    const context = this.currentContext(this.state.session)
    if (!context) return failure('target-not-found', 'Current sentence target was not found')
    return success(this.recordAttempt(this.state.session, context, 'skipped', ''))
  }

  advance(): Result<LearningTransition, LearningEngineError> {
    if (this.state.status !== 'active') {
      return failure('invalid-state', 'No active session can advance')
    }

    const { session } = this.state
    const now = this.clock.now()
    const sentence = this.currentSentence(session)
    if (!sentence) return failure('target-not-found', 'Current sentence was not found')

    if (session.phase === 'target-feedback') {
      const nextTarget = sentence.targets[session.currentTargetIndex + 1]
      if (!nextTarget) {
        const completedSentence = { ...session }
        delete completedSentence.lastEvaluation
        return success(
          this.setState({
            status: 'active',
            session: {
              ...completedSentence,
              phase: 'sentence-complete',
              updatedAt: now,
            },
          }),
        )
      }
      return success(
        this.setState({
          status: 'active',
          session: this.moveToTarget(
            session,
            sentence,
            session.currentTargetIndex + 1,
            now,
          ),
        }),
      )
    }

    if (session.phase !== 'sentence-complete') {
      return failure('invalid-state', 'The current target must be solved before advancing')
    }

    const nextSentenceIndex = session.currentSentenceIndex + 1
    if (nextSentenceIndex >= session.sentenceQueue.length) {
      return success(
        this.setState({
          status: 'completed',
          session: { ...session, updatedAt: now },
          result: summarize(session, now),
        }),
      )
    }

    const nextSentence = this.lesson?.sentences.find(
      ({ id }) => id === session.sentenceQueue[nextSentenceIndex],
    )
    const nextTarget = nextSentence?.targets[0]
    if (!nextSentence || !nextTarget) {
      return failure('target-not-found', 'Next sentence target was not found')
    }

    return success(
      this.setState({
        status: 'active',
        session: {
          ...this.moveToTarget(session, nextSentence, 0, now),
          currentSentenceIndex: nextSentenceIndex,
          currentSentenceId: nextSentence.id,
          solvedTargetIds: [],
        },
      }),
    )
  }

  restartSentence(): Result<LearningTransition, LearningEngineError> {
    if (this.state.status !== 'active' && this.state.status !== 'paused') {
      return failure('invalid-state', 'No current sentence can be restarted')
    }
    const session = this.state.session
    const sentence = this.currentSentence(session)
    if (!sentence) return failure('target-not-found', 'Current sentence was not found')
    const now = this.clock.now()
    const restarted = {
      ...this.moveToTarget(session, sentence, 0, now),
      solvedTargetIds: [],
      wrongChoiceIdsByOccurrenceKey: Object.fromEntries(
        Object.entries(session.wrongChoiceIdsByOccurrenceKey).filter(
          ([key]) => !key.startsWith(`${sentence.id}::`),
        ),
      ),
    }
    return success(
      this.setState(
        this.state.status === 'paused'
          ? { status: 'paused', session: restarted }
          : { status: 'active', session: restarted },
      ),
    )
  }

  setLearningMode(
    mode: LearningMode,
  ): Result<LearningTransition, LearningEngineError> {
    if (this.state.status !== 'active' && this.state.status !== 'paused') {
      return failure('invalid-state', 'No session can change learning mode')
    }
    const context = this.currentContext(this.state.session)
    if (!context) return failure('target-not-found', 'Current sentence target was not found')
    const next = {
      ...this.state.session,
      learningMode: mode,
      exerciseMode: selectExerciseMode(
        mode,
        this.state.session.schedulesByLexemeId[context.target.lexemeId],
      ),
      updatedAt: this.clock.now(),
    }
    return success(
      this.setState(
        this.state.status === 'paused'
          ? { status: 'paused', session: next }
          : { status: 'active', session: next },
      ),
    )
  }

  pause(): Result<LearningTransition, LearningEngineError> {
    if (this.state.status !== 'active') {
      return failure('invalid-state', 'Only an active session can be paused')
    }
    return success(this.setState({ status: 'paused', session: this.state.session }))
  }

  resume(): Result<LearningTransition, LearningEngineError> {
    if (this.state.status !== 'paused') {
      return failure('invalid-state', 'Only a paused session can be resumed')
    }
    return success(this.setState({ status: 'active', session: this.state.session }))
  }

  reset(): LearningTransition {
    this.pack = undefined
    this.lesson = undefined
    return this.setState({ status: 'idle' })
  }

  subscribe(listener: (state: LearningEngineState) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private currentSentence(session: LearningSessionSnapshot): Sentence | undefined {
    return this.lesson?.sentences.find(({ id }) => id === session.currentSentenceId)
  }

  private currentContext(session: LearningSessionSnapshot): CurrentContext | undefined {
    const sentence = this.currentSentence(session)
    const target = sentence?.targets[session.currentTargetIndex]
    const lexeme = this.pack?.lexemes.find(({ id }) => id === target?.lexemeId)
    return sentence && target && lexeme ? { sentence, target, lexeme } : undefined
  }

  private moveToTarget(
    session: LearningSessionSnapshot,
    sentence: Sentence,
    targetIndex: number,
    now: string,
  ): LearningSessionSnapshot {
    const target = sentence.targets[targetIndex]
    if (!target) return session
    const next = { ...session }
    delete next.lastEvaluation
    return {
      ...next,
      currentTargetIndex: targetIndex,
      currentTargetId: target.id,
      phase: 'question',
      exerciseMode: selectExerciseMode(
        session.learningMode,
        session.schedulesByLexemeId[target.lexemeId],
      ),
      questionStartedAt: now,
      updatedAt: now,
    }
  }

  private recordAttempt(
    session: LearningSessionSnapshot,
    context: CurrentContext,
    outcome: AttemptSignal['outcome'],
    response: string,
  ): LearningTransition {
    const now = this.clock.now()
    const wrongAttempts = session.attemptHistory.filter(
      (attempt) =>
        attempt.sentenceId === context.sentence.id &&
        attempt.targetId === context.target.id &&
        attempt.outcome !== 'correct',
    ).length
    const firstTry = outcome === 'correct' && wrongAttempts === 0
    const rating: RecallRating =
      outcome === 'correct' ? (firstTry ? 'good' : 'hard') : 'again'
    const schedule = this.scheduler.schedule(
      session.schedulesByLexemeId[context.lexeme.id],
      rating,
      now,
    )
    const previousAttempt = session.attemptsByLexemeId[context.lexeme.id]
    const attempt: AttemptSummary = {
      attempts: (previousAttempt?.attempts ?? 0) + 1,
      correct: (previousAttempt?.correct ?? 0) + (outcome === 'correct' ? 1 : 0),
      incorrect:
        (previousAttempt?.incorrect ?? 0) + (outcome === 'incorrect' ? 1 : 0),
      skipped: (previousAttempt?.skipped ?? 0) + (outcome === 'skipped' ? 1 : 0),
      lastReviewedAt: now,
      lastRating: rating,
    }
    const baseEvaluation = {
      lexemeId: context.lexeme.id,
      sentenceId: context.sentence.id,
      targetId: context.target.id,
      response,
      rating,
      firstTry,
      wrongAttempts: wrongAttempts + (outcome === 'correct' ? 0 : 1),
    }
    const evaluation: AnswerEvaluation =
      outcome === 'correct'
        ? { ...baseEvaluation, outcome, expectedAnswer: context.lexeme.text }
        : { ...baseEvaluation, outcome }
    const signal: AttemptSignal = {
      lexemeId: context.lexeme.id,
      sentenceId: context.sentence.id,
      targetId: context.target.id,
      exerciseMode: session.exerciseMode,
      outcome,
      firstTry,
      wrongAttempts: evaluation.wrongAttempts,
      responseTimeMs: Math.max(
        0,
        Date.parse(now) - Date.parse(session.questionStartedAt),
      ),
      reviewedAt: now,
      nextReviewAt: schedule.dueAt,
    }
    const isCorrect = outcome === 'correct'
    const occurrenceKey = createTargetOccurrenceKey(
      context.sentence.id,
      context.target.id,
    )
    const wrongChoices =
      session.exerciseMode !== 'fill-words' && outcome === 'incorrect'
        ? Array.from(
            new Set([
              ...(session.wrongChoiceIdsByOccurrenceKey[occurrenceKey] ?? []),
              response,
            ]),
          )
        : session.wrongChoiceIdsByOccurrenceKey[occurrenceKey]

    return this.setState({
      status: 'active',
      session: {
        ...session,
        phase: isCorrect ? 'target-feedback' : 'question',
        lastEvaluation: evaluation,
        solvedTargetIds: isCorrect
          ? [...session.solvedTargetIds, context.target.id]
          : session.solvedTargetIds,
        wrongChoiceIdsByOccurrenceKey: wrongChoices
          ? {
              ...session.wrongChoiceIdsByOccurrenceKey,
              [occurrenceKey]: wrongChoices,
            }
          : session.wrongChoiceIdsByOccurrenceKey,
        attemptsByLexemeId: {
          ...session.attemptsByLexemeId,
          [context.lexeme.id]: attempt,
        },
        attemptHistory: [...session.attemptHistory, signal],
        schedulesByLexemeId: {
          ...session.schedulesByLexemeId,
          [context.lexeme.id]: schedule,
        },
        updatedAt: now,
      },
    })
  }

  private setState(next: LearningEngineState): LearningTransition {
    const previous = this.state
    this.state = next
    this.listeners.forEach((listener) => listener(next))
    return { previous, current: next }
  }
}
