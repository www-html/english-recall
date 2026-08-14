import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import starterPackJson from '../data/starter-pack.json'
import {
  parseLessonPack,
  type Lesson,
  type LessonPack,
  type Lexeme,
  type Sentence,
  type TargetOccurrence,
} from '../domain/lesson-pack.schema.ts'
import { decideLessonPackUpdate } from '../domain/lesson-pack-update.ts'
import { HomeScreen } from '../features/home/HomeScreen.tsx'
import {
  LessonDetailScreen,
  type LessonStartSelection,
} from '../features/lessons/LessonDetailScreen.tsx'
import { LessonLibraryScreen } from '../features/lessons/LessonLibraryScreen.tsx'
import { PackDetailScreen } from '../features/lessons/PackDetailScreen.tsx'
import { SettingsScreen } from '../features/settings/SettingsScreen.tsx'
import {
  EXCEL_LESSON_PACK_TEMPLATE_URL,
  ExcelLessonPackImportError,
  readLessonPacksFromExcel,
} from '../features/import/excel-lesson-pack.ts'
import {
  LearningScreen,
  type ChoiceOption,
  type LearningFeedback,
} from '../features/learning/LearningScreen.tsx'
import { PauseScreen } from '../features/pause/PauseScreen.tsx'
import {
  ProgressScreen,
  type ProgressScreenState,
} from '../features/progress/ProgressScreen.tsx'
import {
  SavedScreen,
  type SavedSentenceViewModel,
  type SavedSentencesState,
} from '../features/saved/SavedScreen.tsx'
import { SummaryScreen } from '../features/summary/SummaryScreen.tsx'
import {
  createTargetOccurrenceKey,
  DefaultLearningEngine,
  getMasteryPercent,
  type LearningEngineState,
  type LearningMode,
  type LearningResponse,
  type LearningSessionSnapshot,
  type ReviewSchedule,
} from '../learning-engine/index.ts'
import {
  createSessionCompletionRecord,
  createInitialProgress,
  createDiagnosticRecorder,
  createReviewKey,
  DEFAULT_LEARNER_ID,
  defaultAppSettings,
  IndexedDbPersistenceProvider,
  type AppSettings,
  type SavedSentenceRecord,
  type SessionCompletionRecord,
  type LearnerProgress,
  type DiagnosticInput,
} from '../persistence/index.ts'
import type { LexemeId } from '../shared/types.ts'
import './app.css'
import {
  createDailyLearningPlan,
  createStableChoices,
} from './session-planning.ts'
import { prepareExcelPackUpdate } from './excel-import-planning.ts'
import { shouldAllowLearningSpeech, useSpeech } from './use-speech.ts'
import { diagnosticsForAttemptTransition } from './session-diagnostics.ts'

type AppView =
  | 'home'
  | 'lessons'
  | 'pack-detail'
  | 'lesson-detail'
  | 'saved'
  | 'progress'
  | 'settings'
  | 'learning'
  | 'pause'
  | 'summary'

function settingsWithSpeechRate(
  settings: AppSettings,
  speechRate: number,
): AppSettings {
  return {
    ...settings,
    speechRate,
    slowerSpeechRate: Math.min(
      settings.slowerSpeechRate,
      Math.max(0.5, Number((speechRate - 0.05).toFixed(2))),
    ),
  }
}

interface SessionContext {
  readonly pack: LessonPack
  readonly lesson: Lesson
  readonly sentence: Sentence
  readonly target: TargetOccurrence
  readonly lexeme: Lexeme
  readonly choices: readonly ChoiceOption[]
}

interface StartLessonOptions {
  readonly excludedReviewKeys?: readonly string[]
  readonly practiceOnly?: boolean
}

function diagnosticSessionContext(
  session: LearningSessionSnapshot,
): Pick<
  DiagnosticInput,
  | 'sessionId'
  | 'packId'
  | 'lessonId'
  | 'sentenceId'
  | 'targetId'
  | 'exerciseMode'
  | 'learningMode'
  | 'phase'
> {
  return {
    sessionId: session.id,
    packId: session.packId,
    lessonId: session.lessonId,
    sentenceId: session.currentSentenceId,
    targetId: session.currentTargetId,
    exerciseMode: session.exerciseMode,
    learningMode: session.learningMode,
    phase: session.phase,
  }
}

function sessionFromState(
  state: LearningEngineState,
): LearningSessionSnapshot | undefined {
  return state.status === 'active' ||
    state.status === 'paused' ||
    state.status === 'completed'
    ? state.session
    : undefined
}

function schedulesForSession(
  progress: LearnerProgress,
  pack: LessonPack,
  lesson: Lesson,
) {
  const lexemeIds = new Set(
    lesson.sentences.flatMap((sentence) =>
      sentence.targets.map((target) => target.lexemeId),
    ),
  )

  return Object.fromEntries(
    [...lexemeIds].flatMap((lexemeId) => {
      const schedule =
        progress.schedulesByLexemeReviewKey[createReviewKey(pack.id, lexemeId)]
      return schedule ? [[lexemeId, schedule] as const] : []
    }),
  )
}

function mergeSessionSchedules(
  progress: LearnerProgress,
  session: LearningSessionSnapshot,
): LearnerProgress {
  const schedulesByLexemeReviewKey = {
    ...progress.schedulesByLexemeReviewKey,
  }

  Object.entries(session.schedulesByLexemeId).forEach(
    ([lexemeId, schedule]) => {
      schedulesByLexemeReviewKey[
        createReviewKey(session.packId, lexemeId)
      ] = schedule
    },
  )

  return { ...progress, schedulesByLexemeReviewKey }
}

function findSessionContext(
  packs: readonly LessonPack[],
  state: LearningEngineState,
): SessionContext | null {
  if (state.status === 'idle' || state.status === 'error') return null
  const pack = packs.find((candidate) => candidate.id === state.session.packId)
  const lesson = pack?.lessons.find(
    (candidate) => candidate.id === state.session.lessonId,
  )
  const sentence = lesson?.sentences.find(
    (candidate) => candidate.id === state.session.currentSentenceId,
  )
  const target = sentence?.targets.find(
    (candidate) => candidate.id === state.session.currentTargetId,
  )
  const lexeme = pack?.lexemes.find(
    (candidate) => candidate.id === target?.lexemeId,
  )

  if (!pack || !lesson || !sentence || !target || !lexeme) return null
  return {
    pack,
    lesson,
    sentence,
    target,
    lexeme,
    choices: createStableChoices(
      target,
      state.session.id,
      sentence.id,
    ),
  }
}

function targetStep(
  lesson: Lesson,
  session: LearningSessionSnapshot,
): { current: number; total: number } {
  const queuedSentences = session.sentenceQueue.flatMap((sentenceId) => {
    const sentence = lesson.sentences.find((candidate) => candidate.id === sentenceId)
    return sentence ? [sentence] : []
  })
  const total = queuedSentences.reduce(
    (count, sentence) =>
      count + (session.activeTargetIdsBySentenceId[sentence.id]?.length ?? 0),
    0,
  )
  const previous = queuedSentences
    .slice(0, session.currentSentenceIndex)
    .reduce(
      (count, sentence) =>
        count + (session.activeTargetIdsBySentenceId[sentence.id]?.length ?? 0),
      0,
    )
  const currentTargetPosition = Math.max(
    0,
    session.activeTargetIdsBySentenceId[session.currentSentenceId]?.indexOf(
      session.currentTargetId,
    ) ?? 0,
  )

  return {
    current: Math.min(total, previous + currentTargetPosition + 1),
    total,
  }
}

function feedbackForSession(
  session: LearningSessionSnapshot,
): LearningFeedback {
  if (session.phase === 'target-feedback') return 'correct'
  if (
    session.phase === 'question' &&
    session.lastEvaluation?.targetId === session.currentTargetId &&
    session.lastEvaluation.outcome === 'incorrect'
  ) {
    return 'incorrect'
  }
  return 'idle'
}

function resolveSavedSentences(
  records: readonly SavedSentenceRecord[],
  packs: readonly LessonPack[],
): readonly SavedSentenceViewModel[] {
  return records.flatMap((record) => {
    const pack = packs.find((candidate) => candidate.id === record.packId)
    const lesson = pack?.lessons.find((candidate) =>
      candidate.sentences.some((sentence) => sentence.id === record.sentenceId),
    )
    const sentence = lesson?.sentences.find(
      (candidate) => candidate.id === record.sentenceId,
    )
    if (!pack || !lesson || !sentence) return []
    return [{
      key: `${record.packId}::${record.sentenceId}`,
      packId: record.packId,
      sentenceId: record.sentenceId,
      packTitle: pack.title,
      lessonTitle: lesson.title,
      topic: sentence.topic,
      sentenceText: sentence.displayText,
      translationVi: sentence.translationVi,
    }]
  })
}

function lessonFromTopicSelection({
  lesson,
  selectedTopics,
  mixTopics,
}: LessonStartSelection): Lesson {
  const selected = new Set(selectedTopics)
  const sentences = lesson.sentences.filter((sentence) =>
    selected.has(sentence.topic),
  )
  if (!mixTopics || selectedTopics.length < 2) return { ...lesson, sentences }

  const queues = selectedTopics.map((topic) =>
    sentences.filter((sentence) => sentence.topic === topic),
  )
  const mixed = Array.from(
    { length: Math.max(0, ...queues.map((queue) => queue.length)) },
    (_, index) => queues.flatMap((queue) => queue[index] ? [queue[index]] : []),
  ).flat()
  return { ...lesson, sentences: mixed }
}

export default function App() {
  const provider = useMemo(() => new IndexedDbPersistenceProvider(), [])
  const recordDiagnostic = useMemo(
    () => createDiagnosticRecorder(provider.diagnostics, __APP_VERSION__),
    [provider],
  )
  const engine = useMemo(() => new DefaultLearningEngine(), [])
  const {
    supported: speechSupported,
    speaking,
    speak,
    stop: stopSpeaking,
  } = useSpeech()
  const [view, setView] = useState<AppView>('home')
  const [selectedPackId, setSelectedPackId] = useState<string>()
  const [selectedLessonId, setSelectedLessonId] = useState<string>()
  const [booting, setBooting] = useState(true)
  const [packs, setPacks] = useState<readonly LessonPack[]>([])
  const [savedSentenceRecords, setSavedSentenceRecords] = useState<
    readonly SavedSentenceRecord[]
  >([])
  const [savedSentenceStatus, setSavedSentenceStatus] = useState<
    'loading' | 'ready' | 'error'
  >('loading')
  const [savedSentenceError, setSavedSentenceError] = useState<string>()
  const [sessionHistory, setSessionHistory] = useState<
    readonly SessionCompletionRecord[]
  >([])
  const [historyError, setHistoryError] = useState<string>()
  const [progress, setProgress] = useState<LearnerProgress>(createInitialProgress)
  const progressRef = useRef(progress)
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings)
  const [engineState, setEngineState] = useState<LearningEngineState>(
    engine.getState(),
  )
  const [storageAvailable, setStorageAvailable] = useState(true)
  const [notice, setNotice] = useState<string>()
  const completedSessions = useRef(new Set<string>())
  const sessionBaselines = useRef(
    new Map<string, Readonly<Record<LexemeId, ReviewSchedule>>>(),
  )
  const lastAutoSpokenQuestion = useRef<string | undefined>(undefined)
  const lastPresentedQuestion = useRef<string | undefined>(undefined)
  const previousEngineState = useRef<LearningEngineState>({ status: 'idle' })

  useEffect(() => engine.subscribe(setEngineState), [engine])

  useEffect(() => {
    let active = true

    const bootstrap = async () => {
      const builtInPack = parseLessonPack(starterPackJson)
      const storedBuiltIn = await provider.lessonPacks.get(builtInPack.id)
      const builtInDecision = decideLessonPackUpdate(
        storedBuiltIn.ok ? storedBuiltIn.value : null,
        builtInPack,
      )
      const savedBuiltIn =
        builtInDecision.action === 'install' ||
        builtInDecision.action === 'replace'
          ? await provider.lessonPacks.save(builtInPack)
          : { ok: true as const, value: undefined }
      const [
        packListResult,
        progressResult,
        settingsResult,
        sessionResult,
        savedSentencesResult,
        sessionHistoryResult,
      ] =
        await Promise.all([
          provider.lessonPacks.list(),
          provider.progress.loadProgress(),
          provider.settings.load(),
          provider.progress.loadActiveSession(),
          provider.savedSentences.list(),
          provider.sessionHistory.list(),
        ])

      if (!active) return

      let loadedPacks: LessonPack[] = [builtInPack]
      if (savedBuiltIn.ok && packListResult.ok) {
        const loaded = await Promise.all(
          packListResult.value.summaries.map((summary) =>
            provider.lessonPacks.get(summary.id),
          ),
        )
        loadedPacks = loaded.flatMap((result) => (result.ok ? [result.value] : []))
        if (!loadedPacks.some((pack) => pack.id === builtInPack.id)) {
          loadedPacks.unshift(builtInPack)
        }
        if (packListResult.value.skipped.length > 0) {
          setNotice(
            `${packListResult.value.skipped.length} invalid or unsupported lesson pack was skipped.`,
          )
        }
      } else {
        setStorageAvailable(false)
      }

      const loadedProgress =
        progressResult.ok && progressResult.value
          ? progressResult.value
          : createInitialProgress()
      const loadedSettings =
        settingsResult.ok && settingsResult.value
          ? settingsResult.value
          : defaultAppSettings

      progressRef.current = loadedProgress
      setPacks(loadedPacks)
      setProgress(loadedProgress)
      setSettings(loadedSettings)
      if (savedSentencesResult.ok) {
        setSavedSentenceRecords(savedSentencesResult.value)
        setSavedSentenceStatus('ready')
        setSavedSentenceError(undefined)
      } else {
        setSavedSentenceStatus('error')
        setSavedSentenceError(savedSentencesResult.error.message)
      }
      if (sessionHistoryResult.ok) {
        setSessionHistory(sessionHistoryResult.value)
        setHistoryError(undefined)
      } else {
        setHistoryError(sessionHistoryResult.error.message)
      }

      if (sessionResult.ok && sessionResult.value) {
        const savedPack = loadedPacks.find(
          (pack) => pack.id === sessionResult.value?.packId,
        )
        if (savedPack) {
          const restored = engine.restore({
            pack: savedPack,
            snapshot: sessionResult.value,
          })
          if (restored.ok && restored.value.current.status === 'active') {
            const restoredSession = restored.value.current.session
            sessionBaselines.current.set(
              restoredSession.id,
              schedulesForSession(
                loadedProgress,
                savedPack,
                savedPack.lessons.find(
                  (lesson) => lesson.id === restoredSession.lessonId,
                ) ?? savedPack.lessons[0]!,
              ),
            )
            recordDiagnostic({
              level: 'info',
              event: 'session_restored',
              ...diagnosticSessionContext(restoredSession),
            })
          } else if (!restored.ok) {
            recordDiagnostic({
              level: 'error',
              event: 'session_restore_failed',
              sessionId: sessionResult.value.id,
              packId: sessionResult.value.packId,
              lessonId: sessionResult.value.lessonId,
              errorCode: restored.error.code,
            })
            void provider.progress.clearActiveSession()
          }
        } else {
          recordDiagnostic({
            level: 'error',
            event: 'session_restore_failed',
            sessionId: sessionResult.value.id,
            packId: sessionResult.value.packId,
            lessonId: sessionResult.value.lessonId,
            errorCode: 'pack-not-found',
          })
        }
      } else if (!sessionResult.ok && sessionResult.error.code === 'invalid-data') {
        recordDiagnostic({
          level: 'error',
          event: 'session_restore_failed',
          errorCode: sessionResult.error.code,
        })
        void provider.progress.clearActiveSession()
        setNotice('An incompatible saved session was reset. Your mastery remains saved.')
      }

      setBooting(false)
    }

    void bootstrap()
    return () => {
      active = false
    }
  }, [engine, provider, recordDiagnostic])

  useEffect(() => {
    diagnosticsForAttemptTransition(previousEngineState.current, engineState)
      .forEach(recordDiagnostic)

    previousEngineState.current = engineState
  }, [engineState, recordDiagnostic])

  useEffect(() => {
    if (engineState.status === 'active' || engineState.status === 'paused') {
      const nextProgress = mergeSessionSchedules(
        progressRef.current,
        engineState.session,
      )
      progressRef.current = nextProgress
      setProgress(nextProgress)
      void provider.progress
        .saveLearningState(nextProgress, engineState.session)
        .then((result) => {
          if (result.ok) {
            recordDiagnostic({
              level: 'info',
              event: 'learning_state_saved',
              ...diagnosticSessionContext(engineState.session),
            })
          } else {
            recordDiagnostic({
              level: 'error',
              event: 'persistence_failed',
              ...diagnosticSessionContext(engineState.session),
              errorCode: result.error.code,
              metadata: { operation: 'save_learning_state' },
            })
            setStorageAvailable(false)
            setNotice(`Learning continues, but the latest progress was not saved: ${result.error.message}`)
          }
        })
      return
    }

    if (
      engineState.status === 'completed' &&
      !completedSessions.current.has(engineState.session.id)
    ) {
      completedSessions.current.add(engineState.session.id)
      const withSchedules = mergeSessionSchedules(
        progressRef.current,
        engineState.session,
      )
      const nextProgress: LearnerProgress = {
        ...withSchedules,
        sessionsCompleted: withSchedules.sessionsCompleted + 1,
        totalAnswers:
          withSchedules.totalAnswers +
          engineState.result.correctAnswers +
          engineState.result.incorrectAnswers,
        correctAnswers:
          withSchedules.correctAnswers + engineState.result.correctAnswers,
        lastStudiedAt: engineState.result.completedAt,
      }
      const completionRecord = createSessionCompletionRecord({
        session: engineState.session,
        result: engineState.result,
        preSessionSchedulesByLexemeId:
          engineState.session.initialSchedulesByLexemeId ??
          sessionBaselines.current.get(engineState.session.id) ??
          engineState.session.schedulesByLexemeId,
      })

      progressRef.current = nextProgress
      setProgress(nextProgress)
      setView('summary')
      recordDiagnostic({
        level: 'info',
        event: 'session_completed',
        ...diagnosticSessionContext(engineState.session),
        result: engineState.session.isPracticeFallback ? 'practice' : 'review',
        metadata: {
          correctAnswers: engineState.result.correctAnswers,
          incorrectAnswers: engineState.result.incorrectAnswers,
          completedTargets: engineState.result.completedTargets,
        },
      })
      void provider.progress.completeSession(nextProgress, completionRecord).then((result) => {
        sessionBaselines.current.delete(engineState.session.id)
        if (result.ok) {
          setSessionHistory((current) => [
            ...current.filter(
              (record) => record.sessionId !== completionRecord.sessionId,
            ),
            completionRecord,
          ])
          setHistoryError(undefined)
          recordDiagnostic({
            level: 'info',
            event: 'learning_state_saved',
            ...diagnosticSessionContext(engineState.session),
            metadata: { sessionCleared: true },
          })
        } else {
          recordDiagnostic({
            level: 'error',
            event: 'persistence_failed',
            ...diagnosticSessionContext(engineState.session),
            errorCode: result.error.code,
            metadata: { operation: 'complete_learning_state' },
          })
          setStorageAvailable(false)
          setNotice(`Session completed, but local storage could not be updated: ${result.error.message}`)
          setHistoryError(result.error.message)
        }
      })
    }
  }, [engineState, provider, recordDiagnostic])

  const context = useMemo(
    () => findSessionContext(packs, engineState),
    [engineState, packs],
  )

  useEffect(() => {
    if (engineState.status !== 'active' || engineState.session.phase !== 'question') {
      return
    }
    const { session } = engineState
    const presentationKey = `${session.id}::${session.currentSentenceId}::${session.currentTargetId}::${session.questionStartedAt}`
    if (lastPresentedQuestion.current === presentationKey) return
    lastPresentedQuestion.current = presentationKey
    const targetLexemeId = context?.target.lexemeId
    recordDiagnostic({
      level: 'info',
      event: 'target_presented',
      ...diagnosticSessionContext(session),
      ...(targetLexemeId ? { lexemeId: targetLexemeId } : {}),
    })
  }, [context, engineState, recordDiagnostic])
  const dailyPlan = useMemo(
    () => createDailyLearningPlan(packs, progress),
    [packs, progress],
  )
  const continuation = useMemo(() => {
    if (engineState.status !== 'completed') return null
    const excludedReviewKeys = new Set([
      ...(engineState.session.continuationExcludedReviewKeys ?? []),
      ...Object.keys(engineState.session.attemptsByLexemeId).map((lexemeId) =>
        createReviewKey(engineState.session.packId, lexemeId),
      ),
    ])
    return {
      excludedReviewKeys: [...excludedReviewKeys],
      remainingPlan: createDailyLearningPlan(
        packs,
        progress,
        Date.now(),
        excludedReviewKeys,
        true,
      ),
    }
  }, [engineState, packs, progress])
  const homeStatistics = useMemo(() => {
    const schedules = Object.values(progress.schedulesByLexemeReviewKey)
    return {
      wordsReviewed: schedules.length,
      masteredWords: schedules.filter(
        (schedule) => getMasteryPercent(schedule) >= 70,
      ).length,
      accuracyPercent:
        progress.totalAnswers === 0
          ? 0
          : Math.round(
              (progress.correctAnswers / progress.totalAnswers) * 100,
            ),
    }
  }, [progress])
  const selectedPack = packs.find((pack) => pack.id === selectedPackId)
  const selectedLesson = selectedPack?.lessons.find(
    (lesson) => lesson.id === selectedLessonId,
  )
  const savedSentenceItems = useMemo(
    () => resolveSavedSentences(savedSentenceRecords, packs),
    [packs, savedSentenceRecords],
  )
  const savedScreenState: SavedSentencesState =
    savedSentenceStatus === 'loading'
      ? { status: 'loading' }
      : savedSentenceStatus === 'error'
        ? {
            status: 'error',
            message: savedSentenceError ?? 'Saved sentences are unavailable.',
          }
        : { status: 'ready', items: savedSentenceItems }
  const progressScreenState: ProgressScreenState = historyError
    ? { status: 'error', message: historyError }
    : { status: 'ready', history: sessionHistory, packs }

  useEffect(() => {
    if (!shouldAllowLearningSpeech(view, engineState.status)) {
      stopSpeaking()
      return
    }
    if (engineState.status !== 'active' || !context) return
    const { session } = engineState

    if (
      session.phase === 'question' &&
      settings.audioEnabled
    ) {
      const questionKey = [
        session.id,
        session.currentSentenceId,
        session.currentTargetId,
        session.questionStartedAt,
        session.exerciseMode,
      ].join('::')
      if (lastAutoSpokenQuestion.current !== questionKey) {
        lastAutoSpokenQuestion.current = questionKey
        speak(context.sentence.speechText, settings.speechRate)
      }
    }

    if (session.phase === 'target-feedback') {
      if (settings.audioEnabled) {
        speak(
          context.lexeme.spokenText ?? context.target.surfaceText,
          settings.speechRate,
        )
      }
      const timeout = window.setTimeout(() => engine.advance(), 300)
      return () => window.clearTimeout(timeout)
    }

    if (session.phase === 'sentence-complete' && settings.autoAdvance) {
      const timeout = window.setTimeout(() => engine.advance(), 2_000)
      return () => window.clearTimeout(timeout)
    }
  }, [context, engine, engineState, settings, speak, stopSpeaking, view])

  const updateSettings = (next: AppSettings) => {
    setSettings(next)
    void provider.settings.save(next).then((result) => {
      if (!result.ok) {
        recordDiagnostic({
          level: 'error',
          event: 'persistence_failed',
          errorCode: result.error.code,
          metadata: { operation: 'save_settings' },
        })
        setStorageAvailable(false)
        setNotice(`Settings changed for now but could not be saved: ${result.error.message}`)
      }
    })
    if (!next.audioEnabled) stopSpeaking()
  }

  const updateHomeLearningMode = (learningMode: LearningMode) => {
    const state = engine.getState()
    if (state.status === 'active' || state.status === 'paused') {
      const result = engine.setLearningMode(learningMode)
      if (!result.ok) setNotice(result.error.message)
    }
    updateSettings({ ...settings, learningMode })
  }

  const setLearningMode = (learningMode: LearningMode) => {
    const result = engine.setLearningMode(learningMode)
    if (!result.ok) {
      setNotice(result.error.message)
      return
    }
    updateSettings({ ...settings, learningMode })
  }

  const startLesson = (
    pack: LessonPack,
    lesson: Lesson,
    options: StartLessonOptions = {},
  ) => {
    stopSpeaking()
    const excludedLexemeIds = options.excludedReviewKeys?.flatMap((key) => {
      const prefix = `${pack.id}::`
      return key.startsWith(prefix) ? [key.slice(prefix.length)] : []
    })
    const result = engine.start({
      pack,
      lessonId: lesson.id,
      schedulesByLexemeId: schedulesForSession(progressRef.current, pack, lesson),
      learningMode: settings.learningMode,
      ...(excludedLexemeIds ? { excludedLexemeIds } : {}),
      ...(options.excludedReviewKeys
        ? { continuationExcludedReviewKeys: options.excludedReviewKeys }
        : {}),
      ...(options.practiceOnly === undefined
        ? {}
        : { practiceOnly: options.practiceOnly }),
    })
    if (!result.ok) {
      setNotice(result.error.message)
      return
    }
    if (result.value.current.status === 'active') {
      sessionBaselines.current.set(
        result.value.current.session.id,
        schedulesForSession(progressRef.current, pack, lesson),
      )
      recordDiagnostic({
        level: 'info',
        event: 'session_started',
        ...diagnosticSessionContext(result.value.current.session),
        result: result.value.current.session.isPracticeFallback
          ? 'practice'
          : 'review',
      })
    }
    setNotice(undefined)
    setView('learning')
  }

  const reloadSavedSentences = async () => {
    setSavedSentenceStatus('loading')
    const result = await provider.savedSentences.list()
    if (result.ok) {
      setSavedSentenceRecords(result.value)
      setSavedSentenceStatus('ready')
      setSavedSentenceError(undefined)
    } else {
      setSavedSentenceStatus('error')
      setSavedSentenceError(result.error.message)
    }
  }

  const setCurrentSentenceSaved = async (saved: boolean) => {
    if (!context) return
    const result = saved
      ? await provider.savedSentences.save({
          learnerId: DEFAULT_LEARNER_ID,
          packId: context.pack.id,
          sentenceId: context.sentence.id,
          savedAt: new Date().toISOString(),
        })
      : await provider.savedSentences.remove(
          context.pack.id,
          context.sentence.id,
        )
    if (!result.ok) {
      setNotice(`Could not update Saved sentences: ${result.error.message}`)
      throw new Error(result.error.message)
    }
    await reloadSavedSentences()
  }

  const removeSavedSentence = async (item: SavedSentenceViewModel) => {
    const result = await provider.savedSentences.remove(item.packId, item.sentenceId)
    if (!result.ok) throw new Error(result.error.message)
    setSavedSentenceRecords((current) =>
      current.filter(
        (record) =>
          record.packId !== item.packId || record.sentenceId !== item.sentenceId,
      ),
    )
  }

  const practiceSavedSentence = (item: SavedSentenceViewModel) => {
    const pack = packs.find((candidate) => candidate.id === item.packId)
    const lesson = pack?.lessons.find((candidate) =>
      candidate.sentences.some((sentence) => sentence.id === item.sentenceId),
    )
    const sentence = lesson?.sentences.find(
      (candidate) => candidate.id === item.sentenceId,
    )
    if (!pack || !lesson || !sentence) {
      setNotice('This saved sentence is no longer available in its lesson pack.')
      return
    }
    const scopedLesson = { ...lesson, sentences: [sentence] }
    const scopedPack = {
      ...pack,
      lessons: pack.lessons.map((candidate) =>
        candidate.id === lesson.id ? scopedLesson : candidate,
      ),
    }
    startLesson(scopedPack, scopedLesson)
  }

  const startDailyLearning = () => {
    if (!dailyPlan) {
      setNotice('Import a valid lesson pack to start learning.')
      return
    }
    startLesson(dailyPlan.pack, dailyPlan.lesson)
  }

  const resumeSession = () => {
    stopSpeaking()
    const state = engine.getState()
    if (state.status === 'paused') {
      const result = engine.resume()
      if (result.ok && result.value.current.status === 'active') {
        recordDiagnostic({
          level: 'info',
          event: 'session_resumed',
          ...diagnosticSessionContext(result.value.current.session),
        })
      }
    } else if (state.status === 'active') {
      recordDiagnostic({
        level: 'info',
        event: 'session_resumed',
        ...diagnosticSessionContext(state.session),
      })
    }
    if (engine.getState().status === 'active') setView('learning')
  }

  const pauseSession = () => {
    stopSpeaking()
    const result = engine.pause()
    if (result.ok && result.value.current.status === 'paused') {
      recordDiagnostic({
        level: 'info',
        event: 'session_paused',
        ...diagnosticSessionContext(result.value.current.session),
      })
      setView('pause')
    }
  }

  const submitAnswer = (response: LearningResponse) => {
    const result = engine.submit(response)
    if (!result.ok) setNotice(result.error.message)
  }

  const restartSentence = () => {
    const result = engine.restartSentence()
    if (
      result.ok &&
      (result.value.current.status === 'active' ||
        result.value.current.status === 'paused')
    ) {
      recordDiagnostic({
        level: 'info',
        event: 'sentence_restarted',
        ...diagnosticSessionContext(result.value.current.session),
      })
    }
  }

  const endSession = () => {
    stopSpeaking()
    const endingSession = sessionFromState(engine.getState())
    if (endingSession) {
      recordDiagnostic({
        level: 'info',
        event: 'session_ended',
        ...diagnosticSessionContext(endingSession),
      })
    }
    engine.reset()
    setView('home')
    setNotice('Session ended. Completed reviews remain saved.')
    void provider.progress.clearActiveSession().then((result) => {
      if (!result.ok) {
        recordDiagnostic({
          level: 'error',
          event: 'persistence_failed',
          ...(endingSession ? diagnosticSessionContext(endingSession) : {}),
          errorCode: result.error.code,
          metadata: { operation: 'clear_active_session' },
        })
        setStorageAvailable(false)
        setNotice(`Session ended, but its saved resume state could not be cleared: ${result.error.message}`)
      }
    })
  }

  const importLessonPack = async (file: File) => {
    if (file.size > 2_000_000) {
      recordDiagnostic({
        level: 'warn',
        event: 'lesson_pack_rejected',
        errorCode: 'file-too-large',
      })
      setNotice('Lesson pack is too large. Maximum size is 2 MB.')
      return
    }

    try {
      const importedPack = parseLessonPack(JSON.parse(await file.text()))
      const currentPack = packs.find((pack) => pack.id === importedPack.id) ?? null
      const decision = decideLessonPackUpdate(currentPack, importedPack)
      if (decision.action === 'reject') {
        recordDiagnostic({
          level: 'warn',
          event: 'lesson_pack_rejected',
          packId: importedPack.id,
          errorCode: decision.reason,
          metadata: { incomingVersion: importedPack.version },
        })
        setNotice(
          decision.reason === 'downgrade'
            ? `Could not import “${importedPack.title}”: version ${importedPack.version} is older than the installed pack.`
            : `Could not import “${importedPack.title}”: changed content must use a newer semantic version.`,
        )
        return
      }
      if (decision.action === 'unchanged') {
        setNotice(`“${importedPack.title}” is already up to date.`)
        return
      }
      const saved = await provider.lessonPacks.save(importedPack)
      if (!saved.ok) {
        recordDiagnostic({
          level: 'error',
          event: 'persistence_failed',
          packId: importedPack.id,
          errorCode: saved.error.code,
          metadata: { operation: 'save_lesson_pack' },
        })
        setNotice(`Could not save “${importedPack.title}”: ${saved.error.message}`)
        return
      }

      setPacks((current) => [
        ...current.filter((pack) => pack.id !== importedPack.id),
        importedPack,
      ])
      setNotice(`Imported “${importedPack.title}” successfully.`)
      recordDiagnostic({
        level: 'info',
        event:
          decision.action === 'replace'
            ? 'lesson_pack_updated'
            : 'lesson_pack_imported',
        packId: importedPack.id,
        metadata: { version: importedPack.version },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown import error'
      setNotice(`Could not import JSON pack: ${message}`)
      recordDiagnostic({
        level: 'warn',
        event: 'lesson_pack_rejected',
        errorCode: 'invalid-or-unsupported',
      })
    }
  }

  const importExcelLessonPacks = async (file: File) => {
    try {
      const importedPacks = await readLessonPacksFromExcel(file)
      const savedPacks: LessonPack[] = []
      const plannedPacks = importedPacks.map((parsedPack) => {
        const currentPack =
          packs.find((pack) => pack.id === parsedPack.id) ?? null
        const importedPack = prepareExcelPackUpdate(currentPack, parsedPack)
        return {
          importedPack,
          decision: decideLessonPackUpdate(currentPack, importedPack),
        }
      })
      const rejected = plannedPacks.find(
        ({ decision }) => decision.action === 'reject',
      )
      if (rejected?.decision.action === 'reject') {
        recordDiagnostic({
          level: 'warn',
          event: 'lesson_pack_rejected',
          packId: rejected.importedPack.id,
          errorCode: rejected.decision.reason,
          metadata: {
            source: 'excel',
            version: rejected.importedPack.version,
          },
        })
        setNotice(
          `Could not import “${rejected.importedPack.title}”: use a newer semantic version for changed content. No packs were changed.`,
        )
        return
      }

      for (const { importedPack, decision } of plannedPacks) {
        if (decision.action === 'unchanged') continue
        const saved = await provider.lessonPacks.save(importedPack)
        if (!saved.ok) {
          recordDiagnostic({
            level: 'error',
            event: 'persistence_failed',
            packId: importedPack.id,
            errorCode: saved.error.code,
            metadata: { operation: 'save_excel_lesson_pack' },
          })
          setNotice(
            `${savedPacks.length > 0 ? `Imported ${savedPacks.length} pack${savedPacks.length === 1 ? '' : 's'}. ` : ''}Could not save “${importedPack.title}”: ${saved.error.message}`,
          )
          return
        }
        savedPacks.push(importedPack)
        setPacks((current) => [
          ...current.filter((pack) => pack.id !== importedPack.id),
          importedPack,
        ])
        recordDiagnostic({
          level: 'info',
          event:
            decision.action === 'replace'
              ? 'lesson_pack_updated'
              : 'lesson_pack_imported',
          packId: importedPack.id,
          metadata: { source: 'excel', version: importedPack.version },
        })
      }
      setNotice(
        savedPacks.length === 0
          ? 'All lesson packs in this workbook are already up to date.'
          : `Imported ${savedPacks.length} lesson pack${savedPacks.length === 1 ? '' : 's'} from Excel.`,
      )
    } catch (error) {
      if (error instanceof ExcelLessonPackImportError) {
        recordDiagnostic({
          level: 'warn',
          event: 'lesson_pack_rejected',
          errorCode: error.issues[0]?.code ?? 'invalid-or-unsupported',
          metadata: { source: 'excel', issueCount: error.issues.length },
        })
        setNotice(error.issues[0]?.message ?? 'Could not import this Excel workbook.')
        return
      }
      setNotice(
        `Could not import Excel workbook: ${error instanceof Error ? error.message : 'Unknown import error'}`,
      )
      recordDiagnostic({
        level: 'warn',
        event: 'lesson_pack_rejected',
        errorCode: 'invalid-or-unsupported',
        metadata: { source: 'excel' },
      })
    }
  }

  const downloadExcelTemplate = () => {
    const link = document.createElement('a')
    link.href = EXCEL_LESSON_PACK_TEMPLATE_URL
    link.download = 'english-recall-lesson-pack-template.xlsx'
    link.click()
  }

  const exportBackup = async () => {
    const result = await provider.backup.export()
    if (!result.ok) {
      recordDiagnostic({
        level: 'error',
        event: 'persistence_failed',
        errorCode: result.error.code,
        metadata: { operation: 'export_backup' },
      })
      setNotice(`Could not export backup: ${result.error.message}`)
      return
    }

    const blob = new Blob([JSON.stringify(result.value, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `english-recall-backup-${result.value.exportedAt.slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    setNotice('Backup exported successfully.')
    recordDiagnostic({ level: 'info', event: 'backup_exported' })
  }

  const restoreBackup = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      recordDiagnostic({
        level: 'warn',
        event: 'backup_restore_failed',
        errorCode: 'file-too-large',
      })
      setNotice('Backup is too large. Maximum size is 10 MB.')
      return
    }

    try {
      const result = await provider.backup.restore(JSON.parse(await file.text()))
      if (!result.ok) {
        recordDiagnostic({
          level: 'error',
          event: 'backup_restore_failed',
          errorCode: result.error.code,
        })
        setNotice(`Could not restore backup: ${result.error.message}`)
        return
      }
      setNotice('Backup restored. Reloading your saved data…')
      recordDiagnostic({ level: 'info', event: 'backup_restore_completed' })
      window.location.reload()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON'
      setNotice(`Could not restore backup: ${message}`)
      recordDiagnostic({
        level: 'warn',
        event: 'backup_restore_failed',
        errorCode: 'invalid-json',
      })
    }
  }

  const exportDiagnostics = async () => {
    const result = await provider.diagnostics.export()
    if (!result.ok) {
      setNotice(`Could not export diagnostics: ${result.error.message}`)
      return
    }
    const blob = new Blob([JSON.stringify(result.value, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `english-recall-diagnostics-${result.value.exportedAt.slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    setNotice('Diagnostics exported successfully.')
  }

  const clearDiagnostics = async () => {
    const result = await provider.diagnostics.clear()
    setNotice(
      result.ok
        ? 'Local diagnostics cleared.'
        : `Could not clear diagnostics: ${result.error.message}`,
    )
  }

  const continueAfterSummary = () => {
    if (engineState.status !== 'completed' || !context || !continuation) return
    const { remainingPlan, excludedReviewKeys } = continuation
    if (remainingPlan) {
      startLesson(remainingPlan.pack, remainingPlan.lesson, {
        excludedReviewKeys,
      })
      return
    }
    startLesson(context.pack, context.lesson, {
      excludedReviewKeys,
      practiceOnly: true,
    })
  }

  const openPack = (pack: LessonPack) => {
    setSelectedPackId(pack.id)
    setSelectedLessonId(undefined)
    setView('pack-detail')
  }

  const openLesson = (lesson: Lesson) => {
    setSelectedLessonId(lesson.id)
    setView('lesson-detail')
  }

  const startSelectedLesson = (selection: LessonStartSelection) => {
    const lesson = lessonFromTopicSelection(selection)
    if (lesson.sentences.length === 0) {
      setNotice('Select at least one topic to start this lesson.')
      return
    }
    const pack = {
      ...selection.pack,
      lessons: selection.pack.lessons.map((candidate) =>
        candidate.id === lesson.id ? lesson : candidate,
      ),
    }
    startLesson(pack, lesson)
  }

  const navigationCallbacks = {
    onOpenHome: () => setView('home' as const),
    onOpenLessons: () => setView('lessons' as const),
    onOpenSaved: () => setView('saved' as const),
    onOpenProgress: () => setView('progress' as const),
    onOpenSettings: () => setView('settings' as const),
  }

  if (booting) {
    return (
      <main className="centered-page boot-screen">
        <LoaderCircle className="spin" size={30} aria-hidden="true" />
        <strong>Preparing your lessons…</strong>
        <span>Loading local progress</span>
      </main>
    )
  }

  if (engineState.status === 'error') {
    return (
      <main className="centered-page boot-screen">
        <AlertTriangle size={30} aria-hidden="true" />
        <strong>Learning session unavailable</strong>
        <span>{engineState.message}</span>
        <button
          className="button primary compact"
          type="button"
          onClick={() => {
            engine.reset()
            setView('home')
          }}
        >
          Back to Home
        </button>
      </main>
    )
  }

  if (view === 'lessons') {
    return (
      <LessonLibraryScreen
        {...navigationCallbacks}
        packs={packs}
        storageAvailable={storageAvailable}
        notice={notice}
        onOpenPack={openPack}
      />
    )
  }

  if (view === 'pack-detail' && selectedPack) {
    return (
      <PackDetailScreen
        {...navigationCallbacks}
        pack={selectedPack}
        storageAvailable={storageAvailable}
        notice={notice}
        onBack={() => setView('lessons')}
        onOpenLesson={openLesson}
      />
    )
  }

  if (view === 'lesson-detail' && selectedPack && selectedLesson) {
    const lessonLexemeIds = new Set(
      selectedLesson.sentences.flatMap((sentence) =>
        sentence.targets.map((target) => target.lexemeId),
      ),
    )
    const mastered = [...lessonLexemeIds].filter((lexemeId) => {
      const schedule =
        progress.schedulesByLexemeReviewKey[
          createReviewKey(selectedPack.id, lexemeId)
        ]
      return getMasteryPercent(schedule) >= 70
    }).length
    const progressPercent = lessonLexemeIds.size === 0
      ? 0
      : Math.round((mastered / lessonLexemeIds.size) * 100)
    return (
      <LessonDetailScreen
        {...navigationCallbacks}
        pack={selectedPack}
        lesson={selectedLesson}
        progressPercent={progressPercent}
        storageAvailable={storageAvailable}
        notice={notice}
        onBack={() => setView('pack-detail')}
        onStartLesson={startSelectedLesson}
      />
    )
  }

  if (view === 'settings') {
    return (
      <SettingsScreen
        {...navigationCallbacks}
        learningMode={settings.learningMode}
        autoAdvance={settings.autoAdvance}
        audioEnabled={settings.audioEnabled}
        speechRate={settings.speechRate}
        slowerSpeechRate={settings.slowerSpeechRate}
        storageAvailable={storageAvailable}
        notice={notice}
        onLearningModeChange={updateHomeLearningMode}
        onAutoAdvanceChange={(autoAdvance) =>
          updateSettings({ ...settings, autoAdvance })
        }
        onAudioEnabledChange={(audioEnabled) =>
          updateSettings({ ...settings, audioEnabled })
        }
        onSpeechRateChange={(speechRate) =>
          updateSettings(settingsWithSpeechRate(settings, speechRate))
        }
        onSlowerSpeechRateChange={(slowerSpeechRate) =>
          updateSettings({ ...settings, slowerSpeechRate })
        }
        onImportExcel={(file) => void importExcelLessonPacks(file)}
        onDownloadExcelTemplate={downloadExcelTemplate}
        onImportJson={(file) => void importLessonPack(file)}
        onExportBackup={() => void exportBackup()}
        onRestoreBackup={(file) => void restoreBackup(file)}
        onExportDiagnostics={() => void exportDiagnostics()}
        onClearDiagnostics={() => void clearDiagnostics()}
      />
    )
  }

  if (view === 'saved') {
    return (
      <SavedScreen
        {...navigationCallbacks}
        state={savedScreenState}
        storageAvailable={storageAvailable}
        notice={notice}
        onRetry={() => void reloadSavedSentences()}
        onRemove={removeSavedSentence}
        onPractice={practiceSavedSentence}
      />
    )
  }

  if (view === 'progress') {
    return (
      <ProgressScreen
        {...navigationCallbacks}
        state={progressScreenState}
        storageAvailable={storageAvailable}
        notice={notice}
        onRetry={() => {
          void provider.sessionHistory.list().then((result) => {
            if (result.ok) {
              setSessionHistory(result.value)
              setHistoryError(undefined)
            } else {
              setHistoryError(result.error.message)
            }
          })
        }}
      />
    )
  }

  if (view === 'learning' && engineState.status === 'active' && context) {
    const { session } = engineState
    const step = targetStep(context.lesson, session)
    return (
      <LearningScreen
        lessonTitle={context.lesson.title}
        sentence={context.sentence}
        currentTarget={context.target}
        targetLexeme={context.lexeme}
        choices={context.choices}
        sentenceTargetLexemes={context.sentence.targets.flatMap((target) => {
          const lexeme = context.pack.lexemes.find(
            (candidate) => candidate.id === target.lexemeId,
          )
          return lexeme ? [lexeme] : []
        })}
        solvedTargetIds={session.solvedTargetIds}
        activeTargetIds={
          session.activeTargetIdsBySentenceId[session.currentSentenceId] ?? []
        }
        currentStep={step.current}
        totalSteps={step.total}
        mode={session.learningMode}
        activity={session.exerciseMode}
        feedback={feedbackForSession(session)}
        selectedChoiceLexemeId={
          session.exerciseMode === 'word-choice' ||
          session.exerciseMode === 'listening-choice'
            ? (session.lastEvaluation?.response ?? null)
            : null
        }
        wrongChoiceLexemeIds={
          session.wrongChoiceIdsByOccurrenceKey[
            createTargetOccurrenceKey(
              session.currentSentenceId,
              session.currentTargetId,
            )
          ] ?? []
        }
        sentenceComplete={session.phase === 'sentence-complete'}
        sentenceSaved={savedSentenceRecords.some(
          (record) =>
            record.packId === context.pack.id &&
            record.sentenceId === context.sentence.id,
        )}
        speechSupported={speechSupported}
        speaking={speaking}
        audioEnabled={settings.audioEnabled}
        autoAdvance={settings.autoAdvance}
        speechRate={settings.speechRate}
        slowerSpeechRate={settings.slowerSpeechRate}
        onPause={pauseSession}
        onRestartSentence={restartSentence}
        onModeChange={setLearningMode}
        onAudioEnabledChange={(audioEnabled) =>
          updateSettings({ ...settings, audioEnabled })
        }
        onAutoAdvanceChange={(autoAdvance) =>
          updateSettings({ ...settings, autoAdvance })
        }
        onSpeechRateChange={(speechRate) =>
          updateSettings(settingsWithSpeechRate(settings, speechRate))
        }
        onSlowerSpeechRateChange={(slowerSpeechRate) =>
          updateSettings({ ...settings, slowerSpeechRate })
        }
        onEndSession={endSession}
        onSentenceSavedChange={setCurrentSentenceSaved}
        onSubmitChoice={(choiceId) =>
          submitAnswer({ kind: 'choice', choiceId })
        }
        onSubmitFill={(value) => submitAnswer({ kind: 'text', value })}
        onContinue={() => engine.advance()}
        onListen={() => speak(context.sentence.speechText, settings.speechRate)}
        onReplaySlower={() =>
          speak(context.sentence.speechText, settings.slowerSpeechRate)
        }
      />
    )
  }

  if (view === 'pause' && engineState.status === 'paused' && context) {
    const step = targetStep(context.lesson, engineState.session)
    const completed =
      step.current - (engineState.session.phase === 'question' ? 1 : 0)
    return (
      <PauseScreen
        lessonTitle={context.lesson.title}
        completed={completed}
        total={step.total}
        onResume={resumeSession}
        onHome={() => setView('home')}
      />
    )
  }

  if (view === 'summary' && engineState.status === 'completed' && context) {
    return (
      <SummaryScreen
        lessonTitle={context.lesson.title}
        result={engineState.result}
        onHome={() => {
          engine.reset()
          setView('home')
        }}
        nextActionLabel={continuation?.remainingPlan ? 'Continue Learning' : 'Extra Practice'}
        onNext={continueAfterSummary}
      />
    )
  }

  const canResume =
    engineState.status === 'active' || engineState.status === 'paused'

  return (
    <HomeScreen
      {...navigationCallbacks}
      packs={packs}
      reviewCount={dailyPlan?.reviewCount ?? 0}
      newCount={dailyPlan?.newCount ?? 0}
      estimatedMinutes={dailyPlan?.estimatedMinutes ?? 1}
      statistics={homeStatistics}
      learningMode={settings.learningMode}
      canResume={canResume}
      storageAvailable={storageAvailable}
      notice={notice}
      onStartLearning={startDailyLearning}
      onResume={resumeSession}
      onLearningModeChange={updateHomeLearningMode}
      onOpenPack={openPack}
    />
  )
}
