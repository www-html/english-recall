import {
  ArrowRight,
  BookOpen,
  Sparkles,
  Target,
} from 'lucide-react'
import { useEffect } from 'react'
import type { LessonPack } from '../../domain/lesson-pack.schema.ts'
import {
  AppFrame,
  type AppNavigationCallbacks,
} from '../navigation/AppFrame.tsx'

export interface HomeStatistics {
  readonly wordsReviewed: number
  readonly masteredWords: number
  readonly accuracyPercent: number
}

export interface HomeScreenProps extends AppNavigationCallbacks {
  readonly packs: readonly LessonPack[]
  readonly reviewCount: number
  readonly newCount: number
  readonly estimatedMinutes: number
  readonly statistics: HomeStatistics
  readonly canResume: boolean
  readonly storageAvailable: boolean
  readonly notice: string | undefined
  readonly onStartLearning: () => void
  readonly onResume: () => void
  readonly onOpenPack: (pack: LessonPack) => void
}

export function HomeScreen({
  packs,
  reviewCount,
  newCount,
  estimatedMinutes,
  statistics,
  canResume,
  storageAvailable,
  notice,
  onStartLearning,
  onResume,
  onOpenPack,
  ...navigation
}: HomeScreenProps) {
  const totalToday = reviewCount + newCount
  const hasTodayWork = totalToday > 0
  const masteryProgress =
    statistics.wordsReviewed === 0
      ? 0
      : Math.round(
          (statistics.masteredWords / statistics.wordsReviewed) * 100,
        )

  useEffect(() => {
    if (!canResume) return
    const continueWithSpace = (event: KeyboardEvent) => {
      if (
        event.key !== ' ' ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) return
      const interactiveTarget =
        event.target instanceof Element &&
        event.target.closest('button, input, textarea, select, a, [contenteditable="true"]')
      if (interactiveTarget) return
      event.preventDefault()
      onResume()
    }
    window.addEventListener('keydown', continueWithSpace)
    return () => window.removeEventListener('keydown', continueWithSpace)
  }, [canResume, onResume])

  return (
    <AppFrame
      {...navigation}
      activeView="home"
      storageAvailable={storageAvailable}
      notice={notice}
    >
      <section className="today-section" aria-labelledby="today-title">
        <div className="today-heading">
          <div>
            <p className="eyebrow">Daily recall</p>
            <h1 id="today-title">Today</h1>
          </div>
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
                  : 'Start a short practice session or choose a lesson.'}
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
        </div>
      </section>

      <section className="home-progress-summary" aria-labelledby="home-progress-title">
        <div>
          <p className="eyebrow">Your progress</p>
          <h2 id="home-progress-title">Recall is building</h2>
        </div>
        <div className="home-progress-metrics">
          <span><Sparkles size={16} aria-hidden="true" /><strong>{statistics.masteredWords}</strong> mastered</span>
          <span><Target size={16} aria-hidden="true" /><strong>{statistics.accuracyPercent}%</strong> accuracy</span>
        </div>
        <div
          className="home-progress-track"
          role="progressbar"
          aria-label="Mastery progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={masteryProgress}
        >
          <span style={{ width: `${masteryProgress}%` }} />
        </div>
        <button className="text-action" type="button" onClick={navigation.onOpenProgress}>
          View Progress <ArrowRight size={15} aria-hidden="true" />
        </button>
      </section>

      <section className="home-lessons" aria-labelledby="home-lessons-title">
        <div className="compact-section-heading">
          <div>
            <p className="eyebrow">Lesson library</p>
            <h2 id="home-lessons-title">Lessons</h2>
          </div>
          <button className="text-action" type="button" onClick={navigation.onOpenLessons}>
            View all <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>

        {packs.length === 0 ? (
          <div className="empty-state compact-empty-state">
            <BookOpen size={24} aria-hidden="true" />
            <h3>No lesson packs yet</h3>
            <p>Import content from Settings to begin.</p>
          </div>
        ) : (
          <div className="home-pack-list">
            {packs.slice(0, 3).map((pack) => {
              const sentenceCount = pack.lessons.reduce(
                (count, lesson) => count + lesson.sentences.length,
                0,
              )
              return (
                <button
                  className="pack-summary-button"
                  type="button"
                  key={pack.id}
                  onClick={() => onOpenPack(pack)}
                >
                  <span className="pack-icon"><BookOpen size={20} aria-hidden="true" /></span>
                  <span>
                    <strong>{pack.title}</strong>
                    <small>{pack.lessons.length} lessons · {sentenceCount} sentences</small>
                  </span>
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
              )
            })}
          </div>
        )}
      </section>
    </AppFrame>
  )
}
