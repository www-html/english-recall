import {
  ArrowLeft,
  ArrowRight,
  Check,
  Gauge,
  Headphones,
  MessageCircle,
  Volume2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import './practice.css'

export type ShadowingPhase = 'listen' | 'repeat' | 'compare'

export interface ShadowingSentence {
  readonly id: string
  readonly displayText: string
  readonly translationVi: string
  readonly explanation?: string
}

/**
 * Presentation-only practice. Deliberately exposes no answer, mastery, or SRS
 * callback: finishing a shadowing sentence can only navigate to the next item.
 */
export interface ShadowingPracticeProps {
  readonly lessonTitle: string
  readonly sentence: ShadowingSentence
  readonly currentStep: number
  readonly totalSteps: number
  readonly speechSupported: boolean
  readonly speaking: boolean
  readonly slowerSpeechRate: number
  readonly onListen: () => void
  readonly onReplaySlower: () => void
  readonly onContinue: () => void
  readonly onExit: () => void
}

const PHASE_COPY: Readonly<Record<ShadowingPhase, {
  readonly step: number
  readonly eyebrow: string
  readonly title: string
  readonly guidance: string
}>> = {
  listen: {
    step: 1,
    eyebrow: 'Listen',
    title: 'Focus on rhythm and stress.',
    guidance: 'Play the sentence at least once. Keep the English hidden while you listen.',
  },
  repeat: {
    step: 2,
    eyebrow: 'Repeat',
    title: 'Say it aloud with the speaker.',
    guidance: 'Match the pace and pauses. Nothing is recorded or sent anywhere.',
  },
  compare: {
    step: 3,
    eyebrow: 'Compare',
    title: 'Check the sentence, then try once more.',
    guidance: 'Notice the words or sounds that felt different when you repeated it.',
  },
}

export function ShadowingPractice({
  lessonTitle,
  sentence,
  currentStep,
  totalSteps,
  speechSupported,
  speaking,
  slowerSpeechRate,
  onListen,
  onReplaySlower,
  onContinue,
  onExit,
}: ShadowingPracticeProps) {
  const [phase, setPhase] = useState<ShadowingPhase>('listen')
  const [hasListened, setHasListened] = useState(false)
  const phaseCopy = PHASE_COPY[phase]

  useEffect(() => {
    setPhase('listen')
    setHasListened(false)
  }, [sentence.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return
      const interactiveTarget =
        event.target instanceof Element &&
        event.target.closest('button, input, textarea, select, a, [contenteditable="true"]')

      if (event.key === 'Escape' && !interactiveTarget) {
        event.preventDefault()
        onExit()
      } else if (event.key === 'ArrowUp' && !interactiveTarget && speechSupported) {
        event.preventDefault()
        onListen()
        setHasListened(true)
      } else if (event.key === 'ArrowDown' && !interactiveTarget && speechSupported) {
        event.preventDefault()
        onReplaySlower()
        setHasListened(true)
      } else if (event.key === ' ' && !interactiveTarget) {
        if (phase === 'listen' && !hasListened) return
        event.preventDefault()
        if (phase === 'listen') setPhase('repeat')
        else if (phase === 'repeat') setPhase('compare')
        else onContinue()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hasListened, onContinue, onExit, onListen, onReplaySlower, phase, speechSupported])

  const listen = () => {
    setHasListened(true)
    onListen()
  }

  const listenSlower = () => {
    setHasListened(true)
    onReplaySlower()
  }

  return (
    <main className="shadowing-shell">
      <header className="shadowing-header">
        <button className="shadowing-icon-button" type="button" onClick={onExit} aria-label="Exit Shadowing">
          <ArrowLeft size={19} aria-hidden="true" />
        </button>
        <div>
          <span>Shadowing</span>
          <strong>{lessonTitle}</strong>
        </div>
        <span className="shadowing-position">{currentStep} / {totalSteps}</span>
      </header>

      <section className="shadowing-stage" aria-labelledby="shadowing-title">
        <div className="shadowing-progress" aria-label={`Shadowing step ${phaseCopy.step} of 3`}>
          {[1, 2, 3].map((step) => (
            <span className={step <= phaseCopy.step ? 'is-active' : ''} key={step} aria-hidden="true" />
          ))}
        </div>

        <div className="shadowing-copy">
          <span>{phaseCopy.eyebrow}</span>
          <h1 id="shadowing-title">{phaseCopy.title}</h1>
          <p>{phaseCopy.guidance}</p>
        </div>

        {phase === 'compare' ? (
          <article className="shadowing-transcript" aria-label="Sentence comparison">
            <p lang="en">{sentence.displayText}</p>
            <p lang="vi">{sentence.translationVi}</p>
            {sentence.explanation ? <p className="shadowing-explanation">{sentence.explanation}</p> : null}
          </article>
        ) : (
          <div className={`shadowing-listening-visual ${speaking ? 'is-speaking' : ''}`} aria-hidden="true">
            {phase === 'listen' ? <Headphones size={36} /> : <MessageCircle size={36} />}
          </div>
        )}

        <div className="shadowing-audio-actions" aria-label="Shadowing audio controls">
          <button type="button" disabled={!speechSupported} onClick={listen}>
            <Volume2 size={18} aria-hidden="true" />
            {phase === 'compare' ? 'Play again' : 'Play sentence'}
          </button>
          <button type="button" disabled={!speechSupported} onClick={listenSlower}>
            <Gauge size={18} aria-hidden="true" />
            Slower {slowerSpeechRate.toFixed(2)}×
          </button>
        </div>

        {!speechSupported ? (
          <p className="shadowing-error" role="status">Audio is not available in this browser.</p>
        ) : null}

        <div className="shadowing-primary-action">
          {phase === 'listen' ? (
            <button type="button" disabled={!hasListened} onClick={() => setPhase('repeat')}>
              Ready to repeat
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          ) : phase === 'repeat' ? (
            <button type="button" onClick={() => setPhase('compare')}>
              I repeated it
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" onClick={onContinue}>
              <Check size={18} aria-hidden="true" />
              Next sentence
            </button>
          )}
          <span><kbd>Space</kbd> continue · <kbd>Esc</kbd> exit</span>
        </div>
      </section>
    </main>
  )
}
