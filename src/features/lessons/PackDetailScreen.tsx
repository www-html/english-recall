import { ArrowLeft, ArrowRight, BookOpen } from 'lucide-react'
import { useState } from 'react'
import type { Lesson, LessonPack } from '../../domain/lesson-pack.schema.ts'
import {
  AppFrame,
  type AppNavigationCallbacks,
} from '../navigation/AppFrame.tsx'

interface PackDetailScreenProps extends AppNavigationCallbacks {
  readonly pack: LessonPack
  readonly storageAvailable: boolean
  readonly notice: string | undefined
  readonly onBack: () => void
  readonly onOpenLesson: (lesson: Lesson) => void
}

export function PackDetailScreen({
  pack,
  storageAvailable,
  notice,
  onBack,
  onOpenLesson,
  ...navigation
}: PackDetailScreenProps) {
  const [showAllLessons, setShowAllLessons] = useState(false)
  const initialLessonCount = 4
  const visibleLessons = showAllLessons
    ? pack.lessons
    : pack.lessons.slice(0, initialLessonCount)
  const hiddenLessonCount = pack.lessons.length - visibleLessons.length
  const sentenceCount = pack.lessons.reduce(
    (total, lesson) => total + lesson.sentences.length,
    0,
  )

  return (
    <AppFrame
      {...navigation}
      activeView="lessons"
      storageAvailable={storageAvailable}
      notice={notice}
    >
      <button className="back-action" type="button" onClick={onBack}>
        <ArrowLeft size={17} aria-hidden="true" /> All lessons
      </button>
      <header className="view-heading pack-detail-heading">
        <span className="pack-icon"><BookOpen size={24} aria-hidden="true" /></span>
        <div>
          <p className="eyebrow">Lesson pack · v{pack.version}</p>
          <h1>{pack.title}</h1>
          <p>{pack.description ?? 'Focused English recall practice.'}</p>
        </div>
      </header>

      <section className="lesson-browser-list" aria-labelledby="pack-lessons-title">
        <div className="lesson-browser-header">
          <h2 id="pack-lessons-title">Lessons</h2>
          <span>{pack.lessons.length} lessons · {sentenceCount} sentences</span>
        </div>
        {visibleLessons.map((lesson) => {
          const topicCount = new Set(
            lesson.sentences.map((sentence) => sentence.topic),
          ).size
          return (
            <button
              className="lesson-browser-row"
              type="button"
              key={lesson.id}
              onClick={() => onOpenLesson(lesson)}
            >
              <span>
                <strong>{lesson.title}</strong>
                <small>{lesson.summary ?? 'Practice sentence recall in context.'}</small>
                <small>{lesson.sentences.length} sentences · {topicCount} topics · ~{lesson.estimatedMinutes ?? 5} min</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          )
        })}
        {pack.lessons.length > initialLessonCount ? (
          <button
            className="lesson-browser-more"
            type="button"
            aria-expanded={showAllLessons}
            onClick={() => setShowAllLessons((current) => !current)}
          >
            {showAllLessons
              ? 'Show fewer lessons'
              : `Show ${hiddenLessonCount} more lesson${hiddenLessonCount === 1 ? '' : 's'}`}
          </button>
        ) : null}
      </section>
    </AppFrame>
  )
}
