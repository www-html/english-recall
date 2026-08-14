import { ArrowLeft, Headphones, Play, Repeat2, Shuffle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Lesson, LessonPack } from '../../domain/lesson-pack.schema.ts'
import {
  AppFrame,
  type AppNavigationCallbacks,
} from '../navigation/AppFrame.tsx'

export interface LessonStartSelection {
  readonly pack: LessonPack
  readonly lesson: Lesson
  readonly selectedTopics: readonly string[]
  readonly mixTopics: boolean
}

interface LessonDetailScreenProps extends AppNavigationCallbacks {
  readonly pack: LessonPack
  readonly lesson: Lesson
  readonly progressPercent: number
  readonly storageAvailable: boolean
  readonly notice: string | undefined
  readonly onBack: () => void
  readonly onStartLesson: (selection: LessonStartSelection) => void
  readonly onStartListeningPractice: (selection: LessonStartSelection) => void
  readonly onStartShadowingPractice: (selection: LessonStartSelection) => void
}

export function LessonDetailScreen({
  pack,
  lesson,
  progressPercent,
  storageAvailable,
  notice,
  onBack,
  onStartLesson,
  onStartListeningPractice,
  onStartShadowingPractice,
  ...navigation
}: LessonDetailScreenProps) {
  const topics = useMemo(
    () => [...new Set(lesson.sentences.map((sentence) => sentence.topic))],
    [lesson],
  )
  const [selectedTopics, setSelectedTopics] = useState<readonly string[]>(topics)
  const [mixTopics, setMixTopics] = useState(true)

  useEffect(() => {
    setSelectedTopics(topics)
    setMixTopics(true)
  }, [topics])

  const toggleTopic = (topic: string) => {
    setSelectedTopics((current) =>
      current.includes(topic)
        ? current.filter((candidate) => candidate !== topic)
        : topics.filter((candidate) => current.includes(candidate) || candidate === topic),
    )
  }

  const selection: LessonStartSelection = {
    pack,
    lesson,
    selectedTopics,
    mixTopics,
  }

  return (
    <AppFrame
      {...navigation}
      activeView="lessons"
      storageAvailable={storageAvailable}
      notice={notice}
    >
      <button className="back-action" type="button" onClick={onBack}>
        <ArrowLeft size={17} aria-hidden="true" /> {pack.title}
      </button>
      <header className="view-heading lesson-detail-heading">
        <p className="eyebrow">Lesson detail</p>
        <h1>{lesson.title}</h1>
        <p>{lesson.summary ?? 'Practice this lesson through natural sentence contexts.'}</p>
      </header>

      <dl className="lesson-detail-stats">
        <div><dt>Sentences</dt><dd>{lesson.sentences.length}</dd></div>
        <div><dt>Time</dt><dd>~{lesson.estimatedMinutes ?? 5} min</dd></div>
        <div><dt>Progress</dt><dd>{progressPercent}%</dd></div>
      </dl>

      <section className="topic-section" aria-labelledby="topic-title">
        <div className="compact-section-heading">
          <div>
            <p className="eyebrow">Focus your session</p>
            <h2 id="topic-title">Topics</h2>
          </div>
          <span>{selectedTopics.length} selected</span>
        </div>
        <div className="topic-options" role="group" aria-labelledby="topic-title">
          {topics.map((topic) => (
            <button
              className="topic-chip"
              type="button"
              role="checkbox"
              aria-checked={selectedTopics.includes(topic)}
              key={topic}
              onClick={() => toggleTopic(topic)}
            >
              <span aria-hidden="true" /> {topic}
            </button>
          ))}
        </div>

        <button
          className="mix-topics-toggle"
          type="button"
          role="switch"
          aria-checked={mixTopics}
          onClick={() => setMixTopics((current) => !current)}
        >
          <span className="mix-topics-icon"><Shuffle size={18} aria-hidden="true" /></span>
          <span>
            <strong>Mix selected topics</strong>
            <small>Rotate between selected contexts during this session.</small>
          </span>
          <span className="switch-track" aria-hidden="true"><span /></span>
        </button>
      </section>

      {selectedTopics.length === 0 ? (
        <p className="field-error" role="alert">Select at least one topic to start.</p>
      ) : null}
      <button
        className="button primary lesson-start-button"
        type="button"
        disabled={selectedTopics.length === 0}
        onClick={() => onStartLesson(selection)}
      >
        <Play size={18} aria-hidden="true" /> Start Lesson
      </button>

      <section className="topic-section" aria-labelledby="lesson-practice-title">
        <div className="compact-section-heading">
          <div>
            <p className="eyebrow">Practice only</p>
            <h2 id="lesson-practice-title">Practice</h2>
          </div>
        </div>
        <p>Strengthen listening and speaking without changing your learning schedule.</p>
        <div className="settings-inline-actions">
          <button
            className="button secondary compact"
            type="button"
            disabled={selectedTopics.length === 0}
            onClick={() => onStartListeningPractice(selection)}
          >
            <Headphones size={16} aria-hidden="true" /> Listening
          </button>
          <button
            className="button secondary compact"
            type="button"
            disabled={selectedTopics.length === 0}
            onClick={() => onStartShadowingPractice(selection)}
          >
            <Repeat2 size={16} aria-hidden="true" /> Shadowing
          </button>
        </div>
      </section>
    </AppFrame>
  )
}
