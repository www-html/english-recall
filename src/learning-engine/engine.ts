import type {
  Lesson,
  LessonPack,
  Lexeme,
  Sentence,
  TargetOccurrence,
} from '../domain/lesson-pack.schema.ts'
import type { LexemeId, Result, SentenceId, Unsubscribe } from '../shared/types.ts'
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
  ExerciseSelectionContext,
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

export const MAX_NEW_PER_SESSION = 5
export const MAX_REVIEW_PER_SESSION = 20
export const MAX_TOTAL_ACTIVE_TARGETS = 25

type CandidatePriority = 0 | 1 | 2 | 3

export function isScheduledReviewDue(
  schedule: ReviewSchedule,
  now: string | number,
): boolean {
  const dueAt = Date.parse(schedule.dueAt)
  const nowTime = typeof now === 'number' ? now : Date.parse(now)
  return Number.isFinite(dueAt) && Number.isFinite(nowTime) && dueAt <= nowTime
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function candidatePriority(
  schedule: ReviewSchedule | undefined,
  now: number,
): CandidatePriority | undefined {
  if (!schedule) return 3
  const dueAt = Date.parse(schedule.dueAt)
  if (!isScheduledReviewDue(schedule, now)) return undefined
  if (dueAt < startOfUtcDay(now)) return 0
  if (getMasteryPercent(schedule) < 40) return 1
  return 2
}

class DueFirstSentenceSelector implements SentenceSelector {
  select(context: SentenceSelectionContext): readonly SentenceId[] {
    const now = Date.parse(context.now)
    const score = (sentence: Sentence): readonly [number, number] => {
      const candidates = sentence.targets
        .filter((target) =>
          context.activeTargetIdsBySentenceId[sentence.id]?.includes(target.id),
        )
        .map((target) => {
          const schedule = context.schedulesByLexemeId[target.lexemeId]
          return [
            candidatePriority(schedule, now) ?? 3,
            schedule ? Date.parse(schedule.dueAt) : Number.POSITIVE_INFINITY,
          ] as const
        })
      return candidates.toSorted(
        (left, right) => left[0] - right[0] || left[1] - right[1],
      )[0] ?? [3, Number.POSITIVE_INFINITY]
    }

    return context.sentences
      .filter(
        (sentence) =>
          (context.activeTargetIdsBySentenceId[sentence.id]?.length ?? 0) > 0,
      )
      .toSorted((left, right) => {
        const leftScore = score(left)
        const rightScore = score(right)
        return leftScore[0] - rightScore[0] || leftScore[1] - rightScore[1]
      })
      .map(({ id }) => id)
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

function normalizeAnswer(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

export function createTargetOccurrenceKey(
  sentenceId: SentenceId,
  targetId: string,
): string {
  return `${sentenceId}::${targetId}`
}

const strongExercisePattern: readonly ExerciseMode[] = [
  'full-sentence',
  'fill-words',
  'full-sentence',
  'listening-choice',
  'fill-words',
]

function variationFallback(mode: ExerciseMode): ExerciseMode {
  if (mode === 'word-choice') return 'fill-words'
  if (mode === 'fill-words') return 'full-sentence'
  if (mode === 'full-sentence') return 'fill-words'
  return 'full-sentence'
}

/** Auto selects presentation only; advancing remains an explicit transition. */
export function selectExerciseMode(
  mode: LearningMode,
  schedule: ReviewSchedule | undefined,
  context: ExerciseSelectionContext = {},
): ExerciseMode {
  if (mode !== 'auto') return mode
  const mastery = getMasteryPercent(schedule)
  const selectionIndex = Math.max(0, context.selectionIndex ?? 0)
  const preferred =
    mastery < 40
      ? 'word-choice'
      : mastery < 75
        ? 'fill-words'
        : strongExercisePattern[selectionIndex % strongExercisePattern.length]!
  const recent = context.recentModes?.slice(-2) ?? []
  return recent.length === 2 && recent.every((recentMode) => recentMode === preferred)
    ? variationFallback(preferred)
    : preferred
}

function selectPlannedExerciseMode(
  learningMode: LearningMode,
  lesson: Lesson,
  sentenceQueue: readonly SentenceId[],
  activeTargetIdsBySentenceId: Readonly<Record<SentenceId, readonly string[]>>,
  schedules: Readonly<Record<LexemeId, ReviewSchedule>>,
  currentSentenceId: SentenceId,
  currentTargetId: string,
): ExerciseMode {
  const selectedModes: ExerciseMode[] = []
  for (const sentenceId of sentenceQueue) {
    const sentence = lesson.sentences.find(({ id }) => id === sentenceId)
    if (!sentence) continue
    for (const targetId of activeTargetIdsBySentenceId[sentenceId] ?? []) {
      const target = sentence.targets.find(({ id }) => id === targetId)
      if (!target) continue
      const selected = selectExerciseMode(
        learningMode,
        schedules[target.lexemeId],
        {
          selectionIndex: selectedModes.length,
          recentModes: selectedModes.slice(-2),
        },
      )
      if (sentenceId === currentSentenceId && targetId === currentTargetId) {
        return selected
      }
      selectedModes.push(selected)
    }
  }
  return selectExerciseMode(learningMode, undefined)
}

interface SessionPlan {
  readonly activeTargetIdsBySentenceId: Readonly<Record<SentenceId, readonly string[]>>
  readonly reviewableOccurrenceKeys: readonly string[]
  readonly isPracticeFallback: boolean
}

interface SessionCandidate {
  readonly sentence: Sentence
  readonly sentenceIndex: number
  readonly target: TargetOccurrence
  readonly targetIndex: number
  readonly priority: CandidatePriority
  readonly dueAt: number
}

function createSessionPlan(
  lesson: Lesson,
  schedules: Readonly<Record<LexemeId, ReviewSchedule>>,
  now: string,
  excludedLexemeIds: readonly LexemeId[] = [],
  practiceOnly = false,
): SessionPlan {
  const nowTime = Date.parse(now)
  const excluded = new Set(excludedLexemeIds)
  const seenLexemes = new Set<LexemeId>()
  const active: Record<SentenceId, string[]> = {}
  const reviewableKeys: string[] = []

  const candidates = practiceOnly
    ? []
    : lesson.sentences.flatMap((sentence, sentenceIndex) =>
        sentence.targets
          .map((target, targetIndex): SessionCandidate | undefined => {
            if (excluded.has(target.lexemeId)) return undefined
            const schedule = schedules[target.lexemeId]
            const priority = candidatePriority(schedule, nowTime)
            return priority === undefined
              ? undefined
              : {
                  sentence,
                  sentenceIndex,
                  target,
                  targetIndex,
                  priority,
                  dueAt: schedule
                    ? Date.parse(schedule.dueAt)
                    : Number.POSITIVE_INFINITY,
                }
          })
          .filter((candidate): candidate is SessionCandidate => Boolean(candidate)),
      )

  let newCount = 0
  let reviewCount = 0
  candidates
    .toSorted(
      (left, right) =>
        left.priority - right.priority ||
        left.dueAt - right.dueAt ||
        left.sentenceIndex - right.sentenceIndex ||
        left.targetIndex - right.targetIndex ||
        left.target.lexemeId.localeCompare(right.target.lexemeId),
    )
    .forEach(({ sentence, target }) => {
      if (seenLexemes.has(target.lexemeId)) return
      const isNew = !schedules[target.lexemeId]
      if (
        reviewableKeys.length >= MAX_TOTAL_ACTIVE_TARGETS ||
        (isNew && newCount >= MAX_NEW_PER_SESSION) ||
        (!isNew && reviewCount >= MAX_REVIEW_PER_SESSION)
      ) {
        return
      }
      seenLexemes.add(target.lexemeId)
      ;(active[sentence.id] ??= []).push(target.id)
      reviewableKeys.push(createTargetOccurrenceKey(sentence.id, target.id))
      if (isNew) newCount += 1
      else reviewCount += 1
    })

  for (const [sentenceId, targetIds] of Object.entries(active)) {
    const sentence = lesson.sentences.find(({ id }) => id === sentenceId)
    if (!sentence) continue
    const targetOrder = new Map(sentence.targets.map(({ id }, index) => [id, index]))
    targetIds.sort(
      (left, right) => (targetOrder.get(left) ?? 0) - (targetOrder.get(right) ?? 0),
    )
  }

  if (reviewableKeys.length > 0) {
    return {
      activeTargetIdsBySentenceId: active,
      reviewableOccurrenceKeys: reviewableKeys,
      isPracticeFallback: false,
    }
  }

  // Nothing is due: expose each lexeme once as non-reviewable practice.
  lesson.sentences.forEach((sentence) => {
    sentence.targets.forEach((target) => {
      if (
        seenLexemes.has(target.lexemeId) ||
        seenLexemes.size >= MAX_TOTAL_ACTIVE_TARGETS
      ) {
        return
      }
      seenLexemes.add(target.lexemeId)
      ;(active[sentence.id] ??= []).push(target.id)
    })
  })
  return {
    activeTargetIdsBySentenceId: active,
    reviewableOccurrenceKeys: [],
    isPracticeFallback: true,
  }
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

function findTargetIndex(sentence: Sentence, targetId: string): number {
  return sentence.targets.findIndex(({ id }) => id === targetId)
}

function copySchedules(
  schedules: Readonly<Record<LexemeId, ReviewSchedule>>,
): Readonly<Record<LexemeId, ReviewSchedule>> {
  return Object.fromEntries(
    Object.entries(schedules).map(([lexemeId, schedule]) => [
      lexemeId,
      { ...schedule },
    ]),
  )
}

function snapshotMatchesPack(
  pack: LessonPack,
  lesson: Lesson,
  snapshot: LearningSessionSnapshot,
): boolean {
  if (
    snapshot.packId !== pack.id ||
    snapshot.lessonId !== lesson.id ||
    snapshot.sentenceQueue.length === 0 ||
    snapshot.currentSentenceIndex < 0 ||
    snapshot.currentSentenceIndex >= snapshot.sentenceQueue.length ||
    snapshot.currentSentenceId !== snapshot.sentenceQueue[snapshot.currentSentenceIndex] ||
    !isFiniteDate(snapshot.startedAt) ||
    !isFiniteDate(snapshot.questionStartedAt) ||
    !isFiniteDate(snapshot.updatedAt) ||
    !snapshot.activeTargetIdsBySentenceId ||
    !Array.isArray(snapshot.reviewableOccurrenceKeys) ||
    !Array.isArray(snapshot.scheduledOccurrenceKeys) ||
    (snapshot.continuationExcludedReviewKeys !== undefined &&
      (!Array.isArray(snapshot.continuationExcludedReviewKeys) ||
        snapshot.continuationExcludedReviewKeys.some(
          (key) => typeof key !== 'string',
        ) ||
        new Set(snapshot.continuationExcludedReviewKeys).size !==
          snapshot.continuationExcludedReviewKeys.length)) ||
    typeof snapshot.isPracticeFallback !== 'boolean'
  ) {
    return false
  }

  const sentenceById = new Map(lesson.sentences.map((sentence) => [sentence.id, sentence]))
  const occurrenceKeys = new Set<string>()
  const activeLexemes = new Set<LexemeId>()
  for (const [sentenceId, targetIds] of Object.entries(
    snapshot.activeTargetIdsBySentenceId,
  )) {
    const sentence = sentenceById.get(sentenceId)
    if (!sentence || !Array.isArray(targetIds) || targetIds.length === 0) return false
    for (const targetId of targetIds) {
      const target = sentence.targets.find(({ id }) => id === targetId)
      if (!target || activeLexemes.has(target.lexemeId)) return false
      activeLexemes.add(target.lexemeId)
      occurrenceKeys.add(createTargetOccurrenceKey(sentenceId, targetId))
    }
  }
  if (
    new Set(snapshot.sentenceQueue).size !== snapshot.sentenceQueue.length ||
    !snapshot.sentenceQueue.every(
      (id) => sentenceById.has(id) && snapshot.activeTargetIdsBySentenceId[id]?.length,
    ) ||
    !snapshot.reviewableOccurrenceKeys.every((key) => occurrenceKeys.has(key)) ||
    new Set(snapshot.reviewableOccurrenceKeys).size !==
      snapshot.reviewableOccurrenceKeys.length ||
    !snapshot.scheduledOccurrenceKeys.every((key) =>
      snapshot.reviewableOccurrenceKeys.includes(key),
    ) ||
    new Set(snapshot.scheduledOccurrenceKeys).size !==
      snapshot.scheduledOccurrenceKeys.length ||
    (snapshot.isPracticeFallback && snapshot.reviewableOccurrenceKeys.length > 0)
  ) {
    return false
  }

  const sentence = sentenceById.get(snapshot.currentSentenceId)
  if (
    !sentence ||
    sentence.targets[snapshot.currentTargetIndex]?.id !== snapshot.currentTargetId ||
    !snapshot.activeTargetIdsBySentenceId[sentence.id]?.includes(snapshot.currentTargetId)
  ) {
    return false
  }

  const lexemeIds = new Set(pack.lexemes.map(({ id }) => id))
  const schedulesMatchPack = (
    schedules: Readonly<Record<LexemeId, ReviewSchedule>>,
  ) =>
    Object.entries(schedules).every(
      ([id, schedule]) => lexemeIds.has(id) && isSchedule(schedule),
    )

  return (
    schedulesMatchPack(snapshot.schedulesByLexemeId) &&
    (snapshot.initialSchedulesByLexemeId === undefined ||
      schedulesMatchPack(snapshot.initialSchedulesByLexemeId))
  )
}

function summarize(session: LearningSessionSnapshot, completedAt: string): SessionResult {
  const correctAnswers = session.attemptHistory.filter(
    ({ outcome }) => outcome === 'correct',
  ).length
  const incorrectAnswers = session.attemptHistory.filter(
    ({ outcome }) => outcome === 'incorrect',
  ).length
  const skippedTargets = session.attemptHistory.filter(
    ({ outcome }) => outcome === 'skipped',
  ).length
  const difficultLexemes = new Set(
    session.attemptHistory
      .filter((attempt) => attempt.wrongAttempts > 0 || attempt.outcome === 'skipped')
      .map(({ lexemeId }) => lexemeId),
  ).size
  const reviewedLexemes = new Set(
    session.attemptHistory
      .filter(({ targetId, sentenceId }) =>
        session.reviewableOccurrenceKeys.includes(
          createTargetOccurrenceKey(sentenceId, targetId),
        ),
      )
      .map(({ lexemeId }) => lexemeId),
  ).size
  const answered = correctAnswers + incorrectAnswers

  return {
    reviewedLexemes,
    completedTargets: new Set(
      session.attemptHistory
        .filter(({ outcome }) => outcome !== 'incorrect')
        .map(({ sentenceId, targetId }) => createTargetOccurrenceKey(sentenceId, targetId)),
    ).size,
    difficultLexemes,
    correctAnswers,
    incorrectAnswers,
    skippedTargets,
    practiceTargets: session.isPracticeFallback
      ? new Set(
          session.attemptHistory
            .filter(({ outcome }) => outcome !== 'incorrect')
            .map(({ sentenceId, targetId }) =>
              createTargetOccurrenceKey(sentenceId, targetId),
            ),
        ).size
      : 0,
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
    const initialSchedules = copySchedules(request.schedulesByLexemeId ?? {})
    const schedules = copySchedules(initialSchedules)
    const plan = createSessionPlan(
      lesson,
      schedules,
      now,
      request.excludedLexemeIds,
      request.practiceOnly,
    )
    const sentenceQueue = this.sentenceSelector.select({
      packId: request.pack.id,
      lessonId: lesson.id,
      sentences: lesson.sentences,
      schedulesByLexemeId: schedules,
      activeTargetIdsBySentenceId: plan.activeTargetIdsBySentenceId,
      now,
    })
    const sentence = lesson.sentences.find(({ id }) => id === sentenceQueue[0])
    const targetId = sentence && plan.activeTargetIdsBySentenceId[sentence.id]?.[0]
    const targetIndex = sentence && targetId ? findTargetIndex(sentence, targetId) : -1
    const target = sentence?.targets[targetIndex]
    if (!sentence || !target) return failure('target-not-found', 'Lesson has no target')

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
          currentTargetIndex: targetIndex,
          currentTargetId: target.id,
          activeTargetIdsBySentenceId: plan.activeTargetIdsBySentenceId,
          reviewableOccurrenceKeys: plan.reviewableOccurrenceKeys,
          scheduledOccurrenceKeys: [],
          isPracticeFallback: plan.isPracticeFallback,
          continuationExcludedReviewKeys:
            request.continuationExcludedReviewKeys ?? [],
          solvedTargetIds: [],
          phase: 'question',
          learningMode,
          exerciseMode: selectPlannedExerciseMode(
            learningMode,
            lesson,
            sentenceQueue,
            plan.activeTargetIdsBySentenceId,
            initialSchedules,
            sentence.id,
            target.id,
          ),
          wrongChoiceIdsByOccurrenceKey: {},
          attemptsByLexemeId: {},
          attemptHistory: [],
          initialSchedulesByLexemeId: initialSchedules,
          schedulesByLexemeId: schedules,
          startedAt: now,
          questionStartedAt: now,
          updatedAt: now,
        },
      }),
    )
  }

  restore(request: RestoreSessionRequest): Result<LearningTransition, LearningEngineError> {
    const lesson = request.pack.lessons.find(({ id }) => id === request.snapshot.lessonId)
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
    if (!context) return failure('target-not-found', 'Current target was not found')

    const isChoiceExercise =
      this.state.session.exerciseMode === 'word-choice' ||
      this.state.session.exerciseMode === 'listening-choice'
    if (isChoiceExercise) {
      if (response.kind !== 'choice') {
        return failure('invalid-response', 'Choice exercises require a choice response')
      }
      const allowed = [
        context.target.lexemeId,
        ...context.target.distractors.map(({ lexemeId }) => lexemeId),
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
      return failure('invalid-response', 'Typing exercises require a text response')
    }
    const expectedAnswer = this.state.session.exerciseMode === 'full-sentence'
      ? context.sentence.displayText
      : context.target.surfaceText
    return success(
      this.recordAttempt(
        this.state.session,
        context,
        normalizeAnswer(response.value) === normalizeAnswer(expectedAnswer)
          ? 'correct'
          : 'incorrect',
        response.value.trim(),
      ),
    )
  }

  skip(): Result<LearningTransition, LearningEngineError> {
    if (this.state.status !== 'active' || this.state.session.phase !== 'question') {
      return failure('invalid-state', 'No question is ready to skip')
    }
    const context = this.currentContext(this.state.session)
    if (!context) return failure('target-not-found', 'Current target was not found')
    return success(this.recordAttempt(this.state.session, context, 'skipped', ''))
  }

  advance(): Result<LearningTransition, LearningEngineError> {
    if (this.state.status !== 'active') {
      return failure('invalid-state', 'No active session can advance')
    }
    const session = this.state.session
    const now = this.clock.now()
    const sentence = this.currentSentence(session)
    if (!sentence) return failure('target-not-found', 'Current sentence was not found')

    if (session.phase === 'target-feedback') {
      const ids = session.activeTargetIdsBySentenceId[sentence.id] ?? []
      const activePosition = ids.indexOf(session.currentTargetId)
      const nextTargetId = ids[activePosition + 1]
      if (!nextTargetId) {
        const completed = { ...session }
        delete completed.lastEvaluation
        return success(
          this.setState({
            status: 'active',
            session: { ...completed, phase: 'sentence-complete', updatedAt: now },
          }),
        )
      }
      return success(
        this.setState({
          status: 'active',
          session: this.moveToTarget(
            session,
            sentence,
            findTargetIndex(sentence, nextTargetId),
            now,
          ),
        }),
      )
    }
    if (session.phase !== 'sentence-complete') {
      return failure('invalid-state', 'The current target must be resolved before advancing')
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
    const nextTargetId =
      nextSentence && session.activeTargetIdsBySentenceId[nextSentence.id]?.[0]
    const nextTargetIndex =
      nextSentence && nextTargetId ? findTargetIndex(nextSentence, nextTargetId) : -1
    if (!nextSentence || nextTargetIndex < 0) {
      return failure('target-not-found', 'Next sentence target was not found')
    }
    return success(
      this.setState({
        status: 'active',
        session: {
          ...this.moveToTarget(session, nextSentence, nextTargetIndex, now),
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
    const firstTargetId =
      sentence && session.activeTargetIdsBySentenceId[sentence.id]?.[0]
    const firstTargetIndex =
      sentence && firstTargetId ? findTargetIndex(sentence, firstTargetId) : -1
    if (!sentence || firstTargetIndex < 0) {
      return failure('target-not-found', 'Current sentence target was not found')
    }
    const restarted = {
      ...this.moveToTarget(session, sentence, firstTargetIndex, this.clock.now()),
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

  setLearningMode(mode: LearningMode): Result<LearningTransition, LearningEngineError> {
    if (this.state.status !== 'active' && this.state.status !== 'paused') {
      return failure('invalid-state', 'No session can change learning mode')
    }
    const context = this.currentContext(this.state.session)
    if (!context) return failure('target-not-found', 'Current target was not found')
    const session = {
      ...this.state.session,
      learningMode: mode,
      exerciseMode: selectPlannedExerciseMode(
        mode,
        this.lesson!,
        this.state.session.sentenceQueue,
        this.state.session.activeTargetIdsBySentenceId,
        this.state.session.initialSchedulesByLexemeId ??
          this.state.session.schedulesByLexemeId,
        context.sentence.id,
        context.target.id,
      ),
      updatedAt: this.clock.now(),
    }
    return success(
      this.setState(
        this.state.status === 'paused'
          ? { status: 'paused', session }
          : { status: 'active', session },
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
      exerciseMode: selectPlannedExerciseMode(
        session.learningMode,
        this.lesson!,
        session.sentenceQueue,
        session.activeTargetIdsBySentenceId,
        session.initialSchedulesByLexemeId ?? session.schedulesByLexemeId,
        sentence.id,
        target.id,
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
    const occurrenceKey = createTargetOccurrenceKey(
      context.sentence.id,
      context.target.id,
    )
    const previousAttempts = session.attemptHistory.filter(
      ({ sentenceId, targetId }) =>
        sentenceId === context.sentence.id && targetId === context.target.id,
    )
    const wrongAttempts = previousAttempts.filter(
      ({ outcome: previousOutcome }) => previousOutcome === 'incorrect',
    ).length
    const resolved = outcome === 'correct' || outcome === 'skipped'
    const alreadyScheduled = session.scheduledOccurrenceKeys.includes(occurrenceKey)
    const reviewable = session.reviewableOccurrenceKeys.includes(occurrenceKey)
    const shouldSchedule = resolved && reviewable && !alreadyScheduled
    const firstTry = outcome === 'correct' && wrongAttempts === 0
    const rating: RecallRating =
      outcome === 'correct' ? (firstTry ? 'good' : 'hard') : 'again'
    const schedule = shouldSchedule
      ? this.scheduler.schedule(
          session.schedulesByLexemeId[context.lexeme.id],
          rating,
          now,
        )
      : undefined
    const previousSummary = session.attemptsByLexemeId[context.lexeme.id]
    const summary: AttemptSummary = {
      attempts: (previousSummary?.attempts ?? 0) + 1,
      correct: (previousSummary?.correct ?? 0) + (outcome === 'correct' ? 1 : 0),
      incorrect:
        (previousSummary?.incorrect ?? 0) + (outcome === 'incorrect' ? 1 : 0),
      skipped: (previousSummary?.skipped ?? 0) + (outcome === 'skipped' ? 1 : 0),
      lastReviewedAt: now,
      lastRating: rating,
    }
    const totalWrong = wrongAttempts + (outcome === 'incorrect' ? 1 : 0)
    const evaluationBase = {
      lexemeId: context.lexeme.id,
      sentenceId: context.sentence.id,
      targetId: context.target.id,
      response,
      rating,
      firstTry,
      wrongAttempts: totalWrong,
    }
    const evaluation: AnswerEvaluation =
      outcome === 'correct'
        ? {
            ...evaluationBase,
            outcome,
            expectedAnswer:
              session.exerciseMode === 'full-sentence'
                ? context.sentence.displayText
                : context.target.surfaceText,
          }
        : { ...evaluationBase, outcome }
    const signalBase = {
      lexemeId: context.lexeme.id,
      sentenceId: context.sentence.id,
      targetId: context.target.id,
      exerciseMode: session.exerciseMode,
      outcome,
      firstTry,
      wrongAttempts: totalWrong,
      responseTimeMs: Math.max(
        0,
        Date.parse(now) - Date.parse(session.questionStartedAt),
      ),
      reviewedAt: now,
    }
    const signal: AttemptSignal = schedule
      ? { ...signalBase, nextReviewAt: schedule.dueAt }
      : signalBase
    const wrongChoices =
      (session.exerciseMode === 'word-choice' ||
        session.exerciseMode === 'listening-choice') &&
      outcome === 'incorrect'
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
        phase: resolved ? 'target-feedback' : 'question',
        lastEvaluation: evaluation,
        solvedTargetIds:
          resolved && !session.solvedTargetIds.includes(context.target.id)
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
          [context.lexeme.id]: summary,
        },
        attemptHistory: [...session.attemptHistory, signal],
        schedulesByLexemeId: schedule
          ? { ...session.schedulesByLexemeId, [context.lexeme.id]: schedule }
          : session.schedulesByLexemeId,
        scheduledOccurrenceKeys: shouldSchedule
          ? [...session.scheduledOccurrenceKeys, occurrenceKey]
          : session.scheduledOccurrenceKeys,
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
