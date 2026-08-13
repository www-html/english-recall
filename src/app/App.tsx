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
import { HomeScreen } from '../features/home/HomeScreen.tsx'
import {
  LearningScreen,
  type ChoiceOption,
  type LearningFeedback,
} from '../features/learning/LearningScreen.tsx'
import { PauseScreen } from '../features/pause/PauseScreen.tsx'
import { SummaryScreen } from '../features/summary/SummaryScreen.tsx'
import {
  createTargetOccurrenceKey,
  DefaultLearningEngine,
  getMasteryPercent,
  type LearningEngineState,
  type LearningMode,
  type LearningResponse,
  type LearningSessionSnapshot,
} from '../learning-engine/index.ts'
import {
  createInitialProgress,
  createReviewKey,
  defaultAppSettings,
  IndexedDbPersistenceProvider,
  type AppSettings,
  type LearnerProgress,
} from '../persistence/index.ts'
import './app.css'
import {
  createDailyLearningPlan,
  createStableChoices,
} from './session-planning.ts'
import { getSlowerSpeechRate, useSpeech } from './use-speech.ts'

type AppView = 'home' | 'learning' | 'pause' | 'summary'

interface SessionContext {
  readonly pack: LessonPack
  readonly lesson: Lesson
  readonly sentence: Sentence
  readonly target: TargetOccurrence
  readonly lexeme: Lexeme
  readonly choices: readonly ChoiceOption[]
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

export default function App() {
  const provider = useMemo(() => new IndexedDbPersistenceProvider(), [])
  const engine = useMemo(() => new DefaultLearningEngine(), [])
  const {
    supported: speechSupported,
    speaking,
    speak,
    stop: stopSpeaking,
  } = useSpeech()
  const [view, setView] = useState<AppView>('home')
  const [booting, setBooting] = useState(true)
  const [packs, setPacks] = useState<readonly LessonPack[]>([])
  const [progress, setProgress] = useState<LearnerProgress>(createInitialProgress)
  const progressRef = useRef(progress)
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings)
  const [engineState, setEngineState] = useState<LearningEngineState>(
    engine.getState(),
  )
  const [storageAvailable, setStorageAvailable] = useState(true)
  const [notice, setNotice] = useState<string>()
  const completedSessions = useRef(new Set<string>())
  const lastAutoSpokenQuestion = useRef<string | undefined>(undefined)

  useEffect(() => engine.subscribe(setEngineState), [engine])

  useEffect(() => {
    let active = true

    const bootstrap = async () => {
      const builtInPack = parseLessonPack(starterPackJson)
      const savedBuiltIn = await provider.lessonPacks.save(builtInPack)
      const [packListResult, progressResult, settingsResult, sessionResult] =
        await Promise.all([
          provider.lessonPacks.list(),
          provider.progress.loadProgress(),
          provider.settings.load(),
          provider.progress.loadActiveSession(),
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
        setNotice(
          'IndexedDB is unavailable. Learning works, but progress cannot be saved.',
        )
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

      if (sessionResult.ok && sessionResult.value) {
        const savedPack = loadedPacks.find(
          (pack) => pack.id === sessionResult.value?.packId,
        )
        if (savedPack) {
          const restored = engine.restore({
            pack: savedPack,
            snapshot: sessionResult.value,
          })
          if (!restored.ok) void provider.progress.clearActiveSession()
        }
      } else if (!sessionResult.ok && sessionResult.error.code === 'invalid-data') {
        void provider.progress.clearActiveSession()
        setNotice('An incompatible saved session was reset. Your mastery remains saved.')
      }

      setBooting(false)
    }

    void bootstrap()
    return () => {
      active = false
    }
  }, [engine, provider])

  useEffect(() => {
    if (engineState.status === 'active' || engineState.status === 'paused') {
      const nextProgress = mergeSessionSchedules(
        progressRef.current,
        engineState.session,
      )
      progressRef.current = nextProgress
      setProgress(nextProgress)
      void provider.progress.saveProgress(nextProgress)
      void provider.progress.saveActiveSession(engineState.session)
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

      progressRef.current = nextProgress
      setProgress(nextProgress)
      setView('summary')
      void provider.progress.saveProgress(nextProgress)
      void provider.progress.clearActiveSession()
    }
  }, [engineState, provider])

  const context = useMemo(
    () => findSessionContext(packs, engineState),
    [engineState, packs],
  )
  const dailyPlan = useMemo(
    () => createDailyLearningPlan(packs, progress),
    [packs, progress],
  )
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

  useEffect(() => {
    if (engineState.status !== 'active' || !context) return
    const { session } = engineState

    if (
      session.phase === 'question' &&
      session.exerciseMode === 'listening-choice' &&
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
  }, [context, engine, engineState, settings, speak])

  const updateSettings = (next: AppSettings) => {
    setSettings(next)
    void provider.settings.save(next)
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

  const startLesson = (pack: LessonPack, lesson: Lesson) => {
    stopSpeaking()
    const result = engine.start({
      pack,
      lessonId: lesson.id,
      schedulesByLexemeId: schedulesForSession(progressRef.current, pack, lesson),
      learningMode: settings.learningMode,
    })
    if (!result.ok) {
      setNotice(result.error.message)
      return
    }
    setNotice(undefined)
    setView('learning')
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
    if (engine.getState().status === 'paused') engine.resume()
    if (engine.getState().status === 'active') setView('learning')
  }

  const pauseSession = () => {
    stopSpeaking()
    const result = engine.pause()
    if (result.ok) setView('pause')
  }

  const submitAnswer = (response: LearningResponse) => {
    const result = engine.submit(response)
    if (!result.ok) setNotice(result.error.message)
  }

  const endSession = () => {
    stopSpeaking()
    engine.reset()
    setView('home')
    setNotice('Session ended. Completed reviews remain saved.')
    void provider.progress.clearActiveSession()
  }

  const importLessonPack = async (file: File) => {
    if (file.size > 2_000_000) {
      setNotice('Lesson pack is too large. Maximum size is 2 MB.')
      return
    }

    try {
      const importedPack = parseLessonPack(JSON.parse(await file.text()))
      const saved = await provider.lessonPacks.save(importedPack)
      if (!saved.ok) throw new Error(saved.error.message)

      setPacks((current) => [
        ...current.filter((pack) => pack.id !== importedPack.id),
        importedPack,
      ])
      setNotice(`Imported “${importedPack.title}” successfully.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown import error'
      setNotice(`Could not import JSON pack: ${message}`)
    }
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
          session.exerciseMode !== 'fill-words'
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
        speechSupported={speechSupported}
        speaking={speaking}
        autoAdvance={settings.autoAdvance}
        speechRate={settings.speechRate}
        slowerSpeechRate={getSlowerSpeechRate(settings.speechRate)}
        onPause={pauseSession}
        onRestartSentence={() => engine.restartSentence()}
        onModeChange={setLearningMode}
        onAutoAdvanceChange={(autoAdvance) =>
          updateSettings({ ...settings, autoAdvance })
        }
        onSpeechRateChange={(speechRate) =>
          updateSettings({ ...settings, speechRate })
        }
        onEndSession={endSession}
        onSubmitChoice={(choiceId) =>
          submitAnswer({ kind: 'choice', choiceId })
        }
        onSubmitFill={(value) => submitAnswer({ kind: 'text', value })}
        onContinue={() => engine.advance()}
        onListen={() => speak(context.sentence.speechText, settings.speechRate)}
        onReplaySlower={() =>
          speak(context.sentence.speechText, getSlowerSpeechRate(settings.speechRate))
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
        onRepeat={() => startLesson(context.pack, context.lesson)}
      />
    )
  }

  const canResume =
    engineState.status === 'active' || engineState.status === 'paused'

  return (
    <HomeScreen
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
      onStartLesson={startLesson}
      onImport={(file) => void importLessonPack(file)}
    />
  )
}
