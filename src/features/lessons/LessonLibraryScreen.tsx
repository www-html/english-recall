import { ArrowRight, BookOpen } from 'lucide-react'
import type { LessonPack } from '../../domain/lesson-pack.schema.ts'
import {
  AppFrame,
  type AppNavigationCallbacks,
} from '../navigation/AppFrame.tsx'

interface LessonLibraryScreenProps extends AppNavigationCallbacks {
  readonly packs: readonly LessonPack[]
  readonly storageAvailable: boolean
  readonly notice: string | undefined
  readonly onOpenPack: (pack: LessonPack) => void
}

export function LessonLibraryScreen({
  packs,
  storageAvailable,
  notice,
  onOpenPack,
  ...navigation
}: LessonLibraryScreenProps) {
  return (
    <AppFrame
      {...navigation}
      activeView="lessons"
      storageAvailable={storageAvailable}
      notice={notice}
    >
      <header className="view-heading">
        <p className="eyebrow">Browse content</p>
        <h1>Lessons</h1>
        <p>Choose a pack, then focus a lesson by topic.</p>
      </header>

      {packs.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={28} aria-hidden="true" />
          <h2>No lesson packs yet</h2>
          <p>Open Settings to import an Excel workbook or JSON lesson pack.</p>
        </div>
      ) : (
        <div className="pack-summary-grid">
          {packs.map((pack) => {
            const sentences = pack.lessons.reduce(
              (count, lesson) => count + lesson.sentences.length,
              0,
            )
            const minutes = pack.lessons.reduce(
              (count, lesson) => count + (lesson.estimatedMinutes ?? 5),
              0,
            )
            return (
              <button
                className="pack-browser-card"
                type="button"
                key={pack.id}
                onClick={() => onOpenPack(pack)}
              >
                <span className="pack-icon"><BookOpen size={22} aria-hidden="true" /></span>
                <span className="pack-browser-copy">
                  <span className="pack-browser-title">
                    <strong>{pack.title}</strong>
                    <small>v{pack.version}</small>
                  </span>
                  <span>{pack.description ?? 'Focused English recall practice.'}</span>
                  <small>{pack.lessons.length} lessons · {sentences} sentences · ~{minutes} min</small>
                </span>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            )
          })}
        </div>
      )}
    </AppFrame>
  )
}
