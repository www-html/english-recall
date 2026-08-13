import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Clock3,
  Database,
  Sparkles,
  Target,
  Upload,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'
import { useRef } from 'react'
import type { Lesson, LessonPack } from '../../domain/lesson-pack.schema.ts'
import { getMasteryPercent } from '../../learning-engine/index.ts'
import type {
  AppSettings,
  LearnerProgress,
} from '../../persistence/index.ts'

const learningModeOrder: readonly AppSettings['learningMode'][] = [
  'auto',
  'word-choice',
  'fill-words',
  'listening-choice',
]

function nextLearningMode(
  current: AppSettings['learningMode'],
): AppSettings['learningMode'] {
  const index = learningModeOrder.indexOf(current)
  return learningModeOrder[(index + 1) % learningModeOrder.length] ?? 'auto'
}

function learningModeLabel(mode: AppSettings['learningMode']): string {
  if (mode === 'auto') return 'Auto · adapts to mastery'
  if (mode === 'word-choice') return 'Word Choice'
  if (mode === 'fill-words') return 'Fill Words'
  return 'Listening Choice'
}

interface HomeScreenProps {
  readonly packs: readonly LessonPack[]
  readonly progress: LearnerProgress
  readonly settings: AppSettings
  readonly canResume: boolean
  readonly storageAvailable: boolean
  readonly notice: string | undefined
  readonly onResume: () => void
  readonly onStart: (pack: LessonPack, lesson: Lesson) => void
  readonly onImport: (file: File) => void
  readonly onSettingsChange: (settings: AppSettings) => void
}

export function HomeScreen({
  packs,
  progress,
  settings,
  canResume,
  storageAvailable,
  notice,
  onResume,
  onStart,
  onImport,
  onSettingsChange,
}: HomeScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const schedules = Object.values(progress.schedulesByLexemeReviewKey)
  const now = Date.now()
  const dueCount = schedules.filter(
    (schedule) => new Date(schedule.dueAt).getTime() <= now,
  ).length
  const masteredCount = schedules.filter(
    (schedule) => getMasteryPercent(schedule) >= 70,
  ).length
  const accuracy =
    progress.totalAnswers === 0
      ? 0
      : Math.round((progress.correctAnswers / progress.totalAnswers) * 100)

  return (
    <main className="page-shell home-page">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            ER
          </span>
          <div>
            <strong>English Recall</strong>
            <span>Learn less. Remember more.</span>
          </div>
        </div>
        <span className={`storage-state ${storageAvailable ? 'is-ready' : ''}`}>
          <Database size={15} aria-hidden="true" />
          {storageAvailable ? 'Saved locally' : 'Storage unavailable'}
        </span>
      </header>

      {notice ? <p className="notice" role="status">{notice}</p> : null}

      <section className="hero-section" aria-labelledby="home-title">
        <div>
          <p className="eyebrow">Your next recall session</p>
          <h1 id="home-title">Build English that stays with you.</h1>
          <p className="hero-copy">
            Short, focused sessions adapt to what you remember and bring back
            what needs practice.
          </p>
        </div>

        <div className="quick-settings" aria-label="Learning preferences">
          <button
            className={`setting-toggle ${settings.learningMode === 'auto' ? 'is-active' : ''}`}
            type="button"
            aria-label={`Learning mode: ${learningModeLabel(settings.learningMode)}. Activate to choose the next mode.`}
            onClick={() =>
              onSettingsChange({
                ...settings,
                learningMode: nextLearningMode(settings.learningMode),
              })
            }
          >
            <Zap size={19} aria-hidden="true" />
            <span>
              <strong>Learning mode</strong>
              <small>
                {learningModeLabel(settings.learningMode)}
              </small>
            </span>
          </button>
          <button
            className={`setting-toggle ${settings.audioEnabled ? 'is-active' : ''}`}
            type="button"
            aria-pressed={settings.audioEnabled}
            onClick={() =>
              onSettingsChange({
                ...settings,
                audioEnabled: !settings.audioEnabled,
              })
            }
          >
            {settings.audioEnabled ? (
              <Volume2 size={19} aria-hidden="true" />
            ) : (
              <VolumeX size={19} aria-hidden="true" />
            )}
            <span>
              <strong>English audio</strong>
              <small>{settings.audioEnabled ? 'Read prompts aloud' : 'Audio muted'}</small>
            </span>
          </button>
        </div>
      </section>

      <section className="metrics-grid" aria-label="Learning progress">
        <article>
          <BrainCircuit size={18} aria-hidden="true" />
          <div><strong>{schedules.length}</strong><span>Words reviewed</span></div>
        </article>
        <article>
          <Clock3 size={18} aria-hidden="true" />
          <div><strong>{dueCount}</strong><span>Due now</span></div>
        </article>
        <article>
          <Sparkles size={18} aria-hidden="true" />
          <div><strong>{masteredCount}</strong><span>Mastered</span></div>
        </article>
        <article>
          <Target size={18} aria-hidden="true" />
          <div><strong>{accuracy}%</strong><span>Accuracy</span></div>
        </article>
      </section>

      {canResume ? (
        <section className="resume-banner" aria-label="Paused session">
          <div>
            <span className="resume-icon"><Zap size={20} aria-hidden="true" /></span>
            <div><strong>Session ready to continue</strong><span>Your place is saved on this device.</span></div>
          </div>
          <button className="button primary compact" type="button" onClick={onResume}>
            Resume <ArrowRight size={17} aria-hidden="true" />
          </button>
        </section>
      ) : null}

      <section className="library-section" aria-labelledby="library-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Lesson library</p>
            <h2 id="library-title">Choose a focused session</h2>
          </div>
          <div>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onImport(file)
                event.target.value = ''
              }}
            />
            <button
              className="button secondary compact"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} aria-hidden="true" /> Import JSON
            </button>
          </div>
        </div>

        {packs.length === 0 ? (
          <div className="empty-state">
            <BookOpen size={28} aria-hidden="true" />
            <h3>No lesson packs yet</h3>
            <p>Import a valid English Recall JSON pack to begin.</p>
          </div>
        ) : (
          <div className="pack-list">
            {packs.map((pack) => (
              <article className="pack-card" key={pack.id}>
                <div className="pack-heading">
                  <div className="pack-icon"><BookOpen size={22} aria-hidden="true" /></div>
                  <div>
                    <h3>{pack.title}</h3>
                    <p>{pack.description ?? `${pack.lessons.length} focused lessons`}</p>
                  </div>
                  <span>v{pack.version}</span>
                </div>
                <div className="lesson-list">
                  {pack.lessons.map((lesson) => (
                    <button
                      className="lesson-row"
                      type="button"
                      key={lesson.id}
                      onClick={() => onStart(pack, lesson)}
                    >
                      <span>
                        <strong>{lesson.title}</strong>
                        <small>
                          {lesson.sentences.length} contexts · {lesson.estimatedMinutes ?? 5} min
                        </small>
                      </span>
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
