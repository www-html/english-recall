import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import starterPackJson from '../data/starter-pack.json'
import {
  parseLessonPack,
  type LearningItem,
  type Lesson,
  type LessonPack,
} from '../domain/lesson-pack.schema.ts'
import { HomeScreen } from '../features/home/HomeScreen.tsx'
import { LearningScreen } from '../features/learning/LearningScreen.tsx'
import { PauseScreen } from '../features/pause/PauseScreen.tsx'
import { SummaryScreen } from '../features/summary/SummaryScreen.tsx'
import {
  DefaultLearningEngine,
  type LearningEngineState,
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
import { useSpeech } from './use-speech.ts'

type AppView = 'home' | 'learning' | 'pause' | 'summary'

function schedulesForSession(
  progress: LearnerProgress,
  pack: LessonPack,
  lesson: Lesson,
) {
  return Object.fromEntries(
    lesson.items.flatMap((item) => {
      const schedule = progress.schedulesByReviewKey[
        createReviewKey(pack.id, item.id)
      ]
      return schedule ? [[item.id, schedule] as const] : []
    }),
  )
}

function mergeSessionSchedules(
  progress: LearnerProgress,
  session: LearningSessionSnapshot,
): LearnerProgress {
  const schedulesByReviewKey = { ...progress.schedulesByReviewKey }

  Object.entries(session.schedulesByItemId).forEach(([itemId, schedule]) => {
    schedulesByReviewKey[createReviewKey(session.packId, itemId)] = schedule
  })

  return { ...progress, schedulesByReviewKey }
}

function findSessionContext(
  packs: readonly LessonPack[],
  state: LearningEngineState,
): { pack: LessonPack; lesson: Lesson; item?: LearningItem } | null {
  if (state.status === 'idle' || state.status === 'error') return null
  const pack = packs.find((candidate) => candidate.id === state.session.packId)
  const lesson = pack?.lessons.find(
    (candidate) => candidate.id === state.session.lessonId,
  )
  if (!pack || !lesson) return null

  const currentId = state.session.itemQueue[state.session.currentIndex]
  const item = lesson.items.find((candidate) => candidate.id === currentId)
  return item ? { pack, lesson, item } : { pack, lesson }
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

  useEffect(() => engine.subscribe(setEngineState), [engine])

  useEffect(() => {
    let active = true

    const bootstrap = async () => {
      const builtInPack = parseLessonPack(starterPackJson)
      const existingBuiltIn = await provider.lessonPacks.get(builtInPack.id)

      if (!existingBuiltIn.ok && existingBuiltIn.error.code === 'not-found') {
        await provider.lessonPacks.save(builtInPack)
      }

      const [packListResult, progressResult, settingsResult, sessionResult] =
        await Promise.all([
          provider.lessonPacks.list(),
          provider.progress.loadProgress(),
          provider.settings.load(),
          provider.progress.loadActiveSession(),
        ])

      if (!active) return

      let loadedPacks: LessonPack[] = [builtInPack]
      if (packListResult.ok) {
        const loaded = await Promise.all(
          packListResult.value.map((summary) => provider.lessonPacks.get(summary.id)),
        )
        loadedPacks = loaded.flatMap((result) => (result.ok ? [result.value] : []))
        if (!loadedPacks.some((pack) => pack.id === builtInPack.id)) {
          loadedPacks.unshift(builtInPack)
        }
      } else {
        setStorageAvailable(false)
        setNotice('IndexedDB is unavailable. Learning works, but progress cannot be saved.')
      }

      const loadedProgress = progressResult.ok && progressResult.value
        ? progressResult.value
        : createInitialProgress()
      const loadedSettings = settingsResult.ok && settingsResult.value
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
          if (!restored.ok) await provider.progress.clearActiveSession()
        }
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

  const context = findSessionContext(packs, engineState)

  useEffect(() => {
    if (engineState.status !== 'active' || !context?.item) return

    if (engineState.session.phase === 'question') {
      if (settings.autoMode && settings.audioEnabled) {
        const item = context.item
        const text =
          item.audioText ??
          (item.kind === 'flashcard' ? item.front : item.prompt)
        speak(text, settings.speechRate)
      }
      return
    }

    if (settings.audioEnabled && engineState.session.lastEvaluation) {
      speak(
        engineState.session.lastEvaluation.expectedAnswer,
        settings.speechRate,
      )
    }

    if (settings.autoMode) {
      const timeout = window.setTimeout(() => engine.advance(), 1_700)
      return () => window.clearTimeout(timeout)
    }
  }, [context?.item, engine, engineState, settings, speak])

  const updateSettings = (next: AppSettings) => {
    setSettings(next)
    void provider.settings.save(next)
    if (!next.audioEnabled) stopSpeaking()
  }

  const startLesson = (pack: LessonPack, lesson: Lesson) => {
    stopSpeaking()
    const result = engine.start({
      pack,
      lessonId: lesson.id,
      schedulesByItemId: schedulesForSession(progressRef.current, pack, lesson),
    })
    if (!result.ok) {
      setNotice(result.error.message)
      return
    }
    setNotice(undefined)
    setView('learning')
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
        <button className="button primary compact" type="button" onClick={() => { engine.reset(); setView('home') }}>Back to Home</button>
      </main>
    )
  }

  if (view === 'learning' && engineState.status === 'active' && context?.item) {
    return (
      <LearningScreen
        lesson={context.lesson}
        item={context.item}
        session={engineState.session}
        settings={settings}
        speechSupported={speechSupported}
        speaking={speaking}
        onPause={pauseSession}
        onSubmit={submitAnswer}
        onSkip={() => engine.skip()}
        onAdvance={() => engine.advance()}
        onSpeak={(text) => speak(text, settings.speechRate)}
        onStopSpeaking={stopSpeaking}
        onSpeechRateChange={(speechRate) =>
          updateSettings({ ...settings, speechRate })
        }
      />
    )
  }

  if (view === 'pause' && engineState.status === 'paused' && context) {
    const completed = engineState.session.currentIndex +
      (engineState.session.phase === 'feedback' ? 1 : 0)
    return (
      <PauseScreen
        lessonTitle={context.lesson.title}
        completed={completed}
        total={engineState.session.itemQueue.length}
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
      progress={progress}
      settings={settings}
      canResume={canResume}
      storageAvailable={storageAvailable}
      notice={notice}
      onResume={resumeSession}
      onStart={startLesson}
      onImport={(file) => void importLessonPack(file)}
      onSettingsChange={updateSettings}
    />
  )
}
