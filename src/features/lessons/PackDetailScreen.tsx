import { ArrowLeft, ArrowRight, BookOpen } from 'lucide-react'
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
        <h2 id="pack-lessons-title">Lessons</h2>
        {pack.lessons.map((lesson) => {
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
      </section>
    </AppFrame>
  )
}
