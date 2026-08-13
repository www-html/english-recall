import {
  ArrowRight,
  Check,
  Gauge,
  Pause,
  RotateCcw,
  Square,
  Volume2,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { LearningItem, Lesson } from '../../domain/lesson-pack.schema.ts'
import type {
  LearningResponse,
  LearningSessionSnapshot,
} from '../../learning-engine/index.ts'
import type { AppSettings } from '../../persistence/index.ts'

interface LearningScreenProps {
  readonly lesson: Lesson
  readonly item: LearningItem
  readonly session: LearningSessionSnapshot
  readonly settings: AppSettings
  readonly speechSupported: boolean
  readonly speaking: boolean
  readonly onPause: () => void
  readonly onSubmit: (response: LearningResponse) => void
  readonly onSkip: () => void
  readonly onAdvance: () => void
  readonly onSpeak: (text: string) => void
  readonly onStopSpeaking: () => void
  readonly onSpeechRateChange: (rate: number) => void
}

function itemAudioText(item: LearningItem): string {
  if (item.audioText) return item.audioText
  if (item.kind === 'flashcard') return item.front
  return item.prompt
}

export function LearningScreen({
  lesson,
  item,
  session,
  settings,
  speechSupported,
  speaking,
  onPause,
  onSubmit,
  onSkip,
  onAdvance,
  onSpeak,
  onStopSpeaking,
  onSpeechRateChange,
}: LearningScreenProps) {
  const [answer, setAnswer] = useState('')
  const [flashcardRevealed, setFlashcardRevealed] = useState(false)
  const evaluation = session.lastEvaluation
  const isFeedback = session.phase === 'feedback'
  const progress = ((session.currentIndex + (isFeedback ? 1 : 0)) / session.itemQueue.length) * 100
  const taskLabel =
    item.kind === 'multiple-choice'
      ? 'Word Choice'
      : item.kind === 'typing'
        ? 'Fill Words'
        : 'Recall Card'
  const audioText = itemAudioText(item)

  useEffect(() => {
    setAnswer('')
    setFlashcardRevealed(false)
  }, [item.id])

  useEffect(() => {
    if (item.kind !== 'multiple-choice' || isFeedback) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const choiceIndex = Number(event.key) - 1
      const choice = item.choices[choiceIndex]
      if (choiceIndex >= 0 && choiceIndex < 4 && choice) {
        event.preventDefault()
        onSubmit({ kind: 'choice', choiceId: choice.id })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFeedback, item, onSubmit])

  const feedbackTitle = useMemo(() => {
    if (!evaluation) return ''
    if (evaluation.outcome === 'correct') return 'That’s right'
    if (evaluation.outcome === 'skipped') return 'Saved for another round'
    return 'Not quite yet'
  }, [evaluation])

  return (
    <main className="learning-shell">
      <header className="learning-topbar">
        <div>
          <span className="brand-mark small" aria-hidden="true">ER</span>
          <div><strong>{lesson.title}</strong><span>{taskLabel}</span></div>
        </div>
        <button className="icon-button" type="button" onClick={onPause} aria-label="Pause session" title="Pause session">
          <Pause size={19} aria-hidden="true" />
        </button>
      </header>

      <div className="progress-track" aria-label={`Question ${session.currentIndex + 1} of ${session.itemQueue.length}`}>
        <span style={{ width: `${progress}%` }} />
      </div>

      <section className="learning-card" aria-labelledby="question-title">
        <div className="question-meta">
          <span>{taskLabel}</span>
          <span>{session.currentIndex + 1} / {session.itemQueue.length}</span>
        </div>

        <div className="audio-toolbar" aria-label="Audio controls">
          <button
            className="audio-button"
            type="button"
            disabled={!speechSupported}
            onClick={() => onSpeak(audioText)}
          >
            <Volume2 size={17} aria-hidden="true" /> {speaking ? 'Speaking…' : 'Listen'}
          </button>
          <button
            className="audio-button icon-only"
            type="button"
            disabled={!speaking}
            onClick={onStopSpeaking}
            aria-label="Stop audio"
            title="Stop audio"
          >
            <Square size={14} aria-hidden="true" />
          </button>
          <label className="rate-control">
            <Gauge size={16} aria-hidden="true" />
            <span className="visually-hidden">Speech rate</span>
            <select
              value={settings.speechRate}
              onChange={(event) => onSpeechRateChange(Number(event.target.value))}
            >
              <option value="0.75">0.75×</option>
              <option value="0.9">0.9×</option>
              <option value="1">1×</option>
              <option value="1.15">1.15×</option>
            </select>
          </label>
          {settings.autoMode ? <span className="auto-chip"><Zap size={13} aria-hidden="true" /> Auto</span> : null}
        </div>

        <h1 id="question-title" className="question-title">
          {item.kind === 'flashcard' ? item.front : item.prompt}
        </h1>
        {item.instructions ? <p className="question-help">{item.instructions}</p> : null}

        {item.kind === 'multiple-choice' ? (
          <div className="choice-grid">
            {item.choices.map((choice, index) => {
              const isCorrect = isFeedback && choice.text === evaluation?.expectedAnswer
              const isSelected = isFeedback && choice.text === evaluation?.response
              return (
                <button
                  className={`choice-button ${isCorrect ? 'is-correct' : ''} ${isSelected && !isCorrect ? 'is-wrong' : ''}`}
                  type="button"
                  key={choice.id}
                  disabled={isFeedback}
                  onClick={() => onSubmit({ kind: 'choice', choiceId: choice.id })}
                >
                  <kbd>{index + 1}</kbd><span>{choice.text}</span>
                  {isCorrect ? <Check size={18} aria-hidden="true" /> : null}
                  {isSelected && !isCorrect ? <X size={18} aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
        ) : null}

        {item.kind === 'typing' ? (
          <form
            className="fill-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (answer.trim()) onSubmit({ kind: 'text', value: answer })
            }}
          >
            <label htmlFor="fill-answer">Your answer</label>
            <div className={`answer-field ${isFeedback ? (evaluation?.outcome === 'correct' ? 'is-correct' : 'is-wrong') : ''}`}>
              <input
                id="fill-answer"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck="false"
                value={answer}
                disabled={isFeedback}
                placeholder="Type one word…"
                autoFocus
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setAnswer('')
                  }
                  if (event.code === 'Space' && answer.trim()) {
                    event.preventDefault()
                    onSubmit({ kind: 'text', value: answer })
                  }
                }}
              />
              {answer && !isFeedback ? (
                <button type="button" onClick={() => setAnswer('')} aria-label="Clear answer" title="Clear answer">
                  <X size={17} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className="shortcut-row"><span><kbd>Space</kbd> Submit</span><span><kbd>Esc</kbd> Clear</span></div>
            {!isFeedback ? <button className="button primary" type="submit" disabled={!answer.trim()}>Check answer</button> : null}
          </form>
        ) : null}

        {item.kind === 'flashcard' ? (
          <div className="flashcard-answer">
            {!flashcardRevealed ? (
              <button className="button primary" type="button" onClick={() => setFlashcardRevealed(true)}>Reveal answer</button>
            ) : !isFeedback ? (
              <>
                <p>{item.back}</p>
                <div className="rating-grid">
                  {(['again', 'hard', 'good', 'easy'] as const).map((rating) => (
                    <button type="button" key={rating} onClick={() => onSubmit({ kind: 'self-assessment', rating })}>{rating}</button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {isFeedback && evaluation ? (
          <div className={`feedback-panel ${evaluation.outcome}`} role="status">
            <div className="feedback-icon">
              {evaluation.outcome === 'correct' ? <Check size={20} aria-hidden="true" /> : <RotateCcw size={20} aria-hidden="true" />}
            </div>
            <div>
              <strong>{feedbackTitle}</strong>
              <span>Answer: {evaluation.expectedAnswer}</span>
            </div>
            {!settings.autoMode ? (
              <button className="button primary compact" type="button" onClick={onAdvance}>
                Continue <ArrowRight size={17} aria-hidden="true" />
              </button>
            ) : <span className="advancing-label">Continuing…</span>}
          </div>
        ) : null}

        {!isFeedback ? (
          <button className="skip-button" type="button" onClick={onSkip}>Skip for now</button>
        ) : null}
      </section>
    </main>
  )
}
