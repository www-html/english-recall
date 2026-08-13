import type {
  LearningItem,
  Lesson,
} from '../domain/lesson-pack.schema.ts'
import type { LearningItemId, Result, Unsubscribe } from '../shared/types.ts'
import type {
  Clock,
  ItemSelectionContext,
  ItemSelector,
  LearningEngine,
  LearningEngineError,
  LearningResponse,
  LearningTransition,
  RestoreSessionRequest,
  ReviewScheduler,
  StartSessionRequest,
} from './contracts.ts'
import { BasicReviewScheduler } from './scheduler.ts'
import type {
  AnswerEvaluation,
  AttemptSummary,
  LearningEngineState,
  LearningSessionSnapshot,
  RecallRating,
  SessionResult,
} from './state.ts'

class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString()
  }
}

class DueFirstItemSelector implements ItemSelector {
  select(context: ItemSelectionContext): readonly LearningItemId[] {
    const now = new Date(context.now).getTime()

    return [...context.items]
      .sort((left, right) => {
        const leftDue = context.schedulesByItemId[left.id]?.dueAt
        const rightDue = context.schedulesByItemId[right.id]?.dueAt
        const leftScore = leftDue ? new Date(leftDue).getTime() : 0
        const rightScore = rightDue ? new Date(rightDue).getTime() : 0
        const leftIsDue = leftScore <= now
        const rightIsDue = rightScore <= now

        if (leftIsDue !== rightIsDue) return leftIsDue ? -1 : 1
        return leftScore - rightScore
      })
      .map((item) => item.id)
  }
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

function expectedAnswer(item: LearningItem): string {
  if (item.kind === 'flashcard') return item.back
  if (item.kind === 'typing') return item.acceptedAnswers[0] ?? ''
  return item.choices.find((choice) => choice.id === item.correctChoiceId)?.text ?? ''
}

function normalizeAnswer(value: string, caseSensitive: boolean): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return caseSensitive ? normalized : normalized.toLocaleLowerCase()
}

function evaluateResponse(
  item: LearningItem,
  response: LearningResponse,
): Result<{ outcome: 'correct' | 'incorrect'; rating: RecallRating; response: string }, LearningEngineError> {
  if (item.kind === 'flashcard') {
    if (response.kind !== 'self-assessment') {
      return failure('invalid-response', 'Flashcards require a self-assessment')
    }

    return success({
      outcome: response.rating === 'again' ? 'incorrect' : 'correct',
      rating: response.rating,
      response: response.rating,
    })
  }

  if (item.kind === 'typing') {
    if (response.kind !== 'text') {
      return failure('invalid-response', 'Fill Words requires a text response')
    }

    const submitted = normalizeAnswer(response.value, item.caseSensitive)
    const correct = item.acceptedAnswers.some(
      (answer) => normalizeAnswer(answer, item.caseSensitive) === submitted,
    )

    return success({
      outcome: correct ? 'correct' : 'incorrect',
      rating: correct ? 'good' : 'again',
      response: response.value.trim(),
    })
  }

  if (response.kind !== 'choice') {
    return failure('invalid-response', 'Word Choice requires a choice response')
  }

  const selectedChoice = item.choices.find(
    (choice) => choice.id === response.choiceId,
  )

  if (!selectedChoice) {
    return failure('invalid-response', 'Selected choice does not exist')
  }

  const correct = response.choiceId === item.correctChoiceId
  return success({
    outcome: correct ? 'correct' : 'incorrect',
    rating: correct ? 'good' : 'again',
    response: selectedChoice.text,
  })
}

function questionSession(
  session: LearningSessionSnapshot,
  currentIndex: number,
  updatedAt: string,
): LearningSessionSnapshot {
  return {
    id: session.id,
    packId: session.packId,
    lessonId: session.lessonId,
    itemQueue: session.itemQueue,
    currentIndex,
    phase: 'question',
    attemptsByItemId: session.attemptsByItemId,
    schedulesByItemId: session.schedulesByItemId,
    startedAt: session.startedAt,
    updatedAt,
  }
}

function summarize(
  session: LearningSessionSnapshot,
  completedAt: string,
): SessionResult {
  const attempts = Object.values(session.attemptsByItemId)
  const correctAnswers = attempts.reduce((sum, item) => sum + item.correct, 0)
  const incorrectAnswers = attempts.reduce((sum, item) => sum + item.incorrect, 0)
  const skippedItems = attempts.reduce((sum, item) => sum + item.skipped, 0)
  const answered = correctAnswers + incorrectAnswers

  return {
    reviewedItems: attempts.filter((item) => item.attempts > 0).length,
    correctAnswers,
    incorrectAnswers,
    skippedItems,
    accuracyPercent: answered === 0 ? 0 : Math.round((correctAnswers / answered) * 100),
    completedAt,
  }
}

export class DefaultLearningEngine implements LearningEngine {
  private state: LearningEngineState = { status: 'idle' }
  private readonly listeners = new Set<(state: LearningEngineState) => void>()
  private lesson: Lesson | undefined
  private readonly clock: Clock
  private readonly itemSelector: ItemSelector
  private readonly scheduler: ReviewScheduler

  constructor(
    clock: Clock = new SystemClock(),
    itemSelector: ItemSelector = new DueFirstItemSelector(),
    scheduler: ReviewScheduler = new BasicReviewScheduler(),
  ) {
    this.clock = clock
    this.itemSelector = itemSelector
    this.scheduler = scheduler
  }

  getState(): LearningEngineState {
    return this.state
  }

  start(
    request: StartSessionRequest,
  ): Result<LearningTransition, LearningEngineError> {
    const lesson = request.pack.lessons.find(
      (candidate) => candidate.id === request.lessonId,
    )
    if (!lesson) return failure('lesson-not-found', 'Lesson was not found')

    const now = request.now ?? this.clock.now()
    const schedules = request.schedulesByItemId ?? {}
    const itemQueue = this.itemSelector.select({
      packId: request.pack.id,
      lessonId: lesson.id,
      items: lesson.items,
      schedulesByItemId: schedules,
      now,
    })

    this.lesson = lesson

    return success(
      this.setState({
        status: 'active',
        session: {
          id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          packId: request.pack.id,
          lessonId: lesson.id,
          itemQueue,
          currentIndex: 0,
          phase: 'question',
          attemptsByItemId: {},
          schedulesByItemId: schedules,
          startedAt: now,
          updatedAt: now,
        },
      }),
    )
  }

  restore(
    request: RestoreSessionRequest,
  ): Result<LearningTransition, LearningEngineError> {
    const lesson = request.pack.lessons.find(
      (candidate) => candidate.id === request.snapshot.lessonId,
    )
    const validQueue = request.snapshot.itemQueue.every((itemId) =>
      lesson?.items.some((item) => item.id === itemId),
    )

    if (
      !lesson ||
      request.snapshot.packId !== request.pack.id ||
      request.snapshot.currentIndex < 0 ||
      request.snapshot.currentIndex >= request.snapshot.itemQueue.length ||
      !validQueue
    ) {
      return failure('invalid-snapshot', 'Saved session is not valid for this pack')
    }

    this.lesson = lesson
    return success(this.setState({ status: 'active', session: request.snapshot }))
  }

  submit(
    response: LearningResponse,
  ): Result<LearningTransition, LearningEngineError> {
    if (this.state.status !== 'active' || this.state.session.phase !== 'question') {
      return failure('invalid-state', 'No question is ready for an answer')
    }

    const item = this.currentItem(this.state.session)
    if (!item) return failure('item-not-found', 'Current learning item was not found')

    const evaluated = evaluateResponse(item, response)
    if (!evaluated.ok) return evaluated

    return success(
      this.recordEvaluation(
        this.state.session,
        item,
        evaluated.value.outcome,
        evaluated.value.rating,
        evaluated.value.response,
      ),
    )
  }

  skip(): Result<LearningTransition, LearningEngineError> {
    if (this.state.status !== 'active' || this.state.session.phase !== 'question') {
      return failure('invalid-state', 'No question is ready to skip')
    }

    const item = this.currentItem(this.state.session)
    if (!item) return failure('item-not-found', 'Current learning item was not found')

    return success(
      this.recordEvaluation(this.state.session, item, 'skipped', 'again', ''),
    )
  }

  advance(): Result<LearningTransition, LearningEngineError> {
    if (this.state.status !== 'active' || this.state.session.phase !== 'feedback') {
      return failure('invalid-state', 'Answer feedback must be shown before advancing')
    }

    const session = this.state.session
    const nextIndex = session.currentIndex + 1
    const now = this.clock.now()

    if (nextIndex >= session.itemQueue.length) {
      return success(
        this.setState({
          status: 'completed',
          session: { ...session, updatedAt: now },
          result: summarize(session, now),
        }),
      )
    }

    return success(
      this.setState({
        status: 'active',
        session: questionSession(session, nextIndex, now),
      }),
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
    this.lesson = undefined
    return this.setState({ status: 'idle' })
  }

  subscribe(listener: (state: LearningEngineState) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private currentItem(session: LearningSessionSnapshot): LearningItem | undefined {
    const currentId = session.itemQueue[session.currentIndex]
    return this.lesson?.items.find((item) => item.id === currentId)
  }

  private recordEvaluation(
    session: LearningSessionSnapshot,
    item: LearningItem,
    outcome: AnswerEvaluation['outcome'],
    rating: RecallRating,
    response: string,
  ): LearningTransition {
    const now = this.clock.now()
    const previousAttempt = session.attemptsByItemId[item.id]
    const schedule = this.scheduler.schedule(
      session.schedulesByItemId[item.id],
      rating,
      now,
    )
    const attempt: AttemptSummary = {
      attempts: (previousAttempt?.attempts ?? 0) + 1,
      correct: (previousAttempt?.correct ?? 0) + (outcome === 'correct' ? 1 : 0),
      incorrect:
        (previousAttempt?.incorrect ?? 0) + (outcome === 'incorrect' ? 1 : 0),
      skipped: (previousAttempt?.skipped ?? 0) + (outcome === 'skipped' ? 1 : 0),
      lastReviewedAt: now,
      lastRating: rating,
    }
    const evaluation: AnswerEvaluation = {
      itemId: item.id,
      outcome,
      expectedAnswer: expectedAnswer(item),
      response,
      rating,
    }

    return this.setState({
      status: 'active',
      session: {
        ...session,
        phase: 'feedback',
        lastEvaluation: evaluation,
        attemptsByItemId: { ...session.attemptsByItemId, [item.id]: attempt },
        schedulesByItemId: {
          ...session.schedulesByItemId,
          [item.id]: schedule,
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
