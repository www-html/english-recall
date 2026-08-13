import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Clock3,
  Database,
  Sparkles,
  Target,
  Upload,
} from 'lucide-react'
import { useRef } from 'react'
import type { Lesson, LessonPack } from '../../domain/lesson-pack.schema.ts'

export type HomeLearningMode =
  | 'auto'
  | 'word-choice'
  | 'fill-words'
  | 'listening-choice'

export interface HomeStatistics {
  readonly wordsReviewed: number
  readonly masteredWords: number
  readonly accuracyPercent: number
}

export interface HomeScreenProps {
  readonly packs: readonly LessonPack[]
  readonly reviewCount: number
  readonly newCount: number
  readonly estimatedMinutes: number
  readonly statistics: HomeStatistics
  readonly learningMode: HomeLearningMode
  readonly canResume: boolean
  readonly storageAvailable: boolean
  readonly notice: string | undefined
  readonly onStartLearning: () => void
  readonly onResume: () => void
  readonly onLearningModeChange: (mode: HomeLearningMode) => void
  readonly onStartLesson: (pack: LessonPack, lesson: Lesson) => void
  readonly onImport: (file: File) => void
}

const LEARNING_MODES: ReadonlyArray<{
  readonly value: HomeLearningMode
  readonly label: string
}> = [
  { value: 'auto', label: 'Auto' },
  { value: 'word-choice', label: 'Word Choice' },
  { value: 'fill-words', label: 'Fill Words' },
  { value: 'listening-choice', label: 'Listening Choice' },
]

export function HomeScreen({
  packs,
  reviewCount,
  newCount,
  estimatedMinutes,
  statistics,
  learningMode,
  canResume,
  storageAvailable,
  notice,
  onStartLearning,
  onResume,
  onLearningModeChange,
  onStartLesson,
  onImport,
}: HomeScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const totalToday = reviewCount + newCount
  const hasTodayWork = totalToday > 0

  return (
    <main className="page-shell home-page">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">ER</span>
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

      <section className="today-section" aria-labelledby="today-title">
        <div className="today-heading">
          <div>
            <p className="eyebrow">Daily recall</p>
            <h1 id="today-title">Today</h1>
          </div>
          <label className="home-mode-select">
            <span>Learning mode</span>
            <select
              value={learningMode}
              onChange={(event) =>
                onLearningModeChange(event.target.value as HomeLearningMode)
              }
            >
              {LEARNING_MODES.map((mode) => (
                <option value={mode.value} key={mode.value}>{mode.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="today-card">
          <div className="today-copy">
            <span className="today-icon" aria-hidden="true"><Sparkles size={23} /></span>
            <div>
              <strong>
                {hasTodayWork ? `${totalToday} words ready` : 'You’re caught up'}
              </strong>
              <p>
                {hasTodayWork
                  ? 'A focused mix of due reviews and new words.'
                  : 'Start a short practice session or choose a lesson below.'}
              </p>
            </div>
          </div>

          <dl className="today-counts">
            <div><dt>Review</dt><dd>{reviewCount}</dd></div>
            <div><dt>New</dt><dd>{newCount}</dd></div>
            <div><dt>Time</dt><dd>~{estimatedMinutes} min</dd></div>
          </dl>

          <button
            className="button today-primary"
            type="button"
            onClick={canResume ? onResume : onStartLearning}
          >
            {canResume ? 'Continue Learning' : 'Start Learning'}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          {canResume ? <span className="today-saved-note">Your completed progress is already saved.</span> : null}
        </div>
      </section>

      <section className="home-statistics" aria-labelledby="statistics-title">
        <div className="home-section-title">
          <p className="eyebrow">Your progress</p>
          <h2 id="statistics-title">Statistics</h2>
        </div>
        <div className="metrics-grid">
          <article>
            <BrainCircuit size={18} aria-hidden="true" />
            <div><strong>{statistics.wordsReviewed}</strong><span>Words reviewed</span></div>
          </article>
          <article>
            <Sparkles size={18} aria-hidden="true" />
            <div><strong>{statistics.masteredWords}</strong><span>Mastered</span></div>
          </article>
          <article>
            <Target size={18} aria-hidden="true" />
            <div><strong>{statistics.accuracyPercent}%</strong><span>Accuracy</span></div>
          </article>
          <article>
            <Clock3 size={18} aria-hidden="true" />
            <div><strong>{reviewCount}</strong><span>Due today</span></div>
          </article>
        </div>
      </section>

      <section className="library-section" aria-labelledby="library-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Lesson library</p>
            <h2 id="library-title">Choose a focused lesson</h2>
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
                      onClick={() => onStartLesson(pack, lesson)}
                    >
                      <span>
                        <strong>{lesson.title}</strong>
                        <small>{lesson.sentences.length} contexts · {lesson.estimatedMinutes ?? 5} min</small>
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
