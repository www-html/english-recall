import { ArrowRight, Check, Home, RotateCcw, Sparkles, Target } from 'lucide-react'
import { useEffect } from 'react'
import type { SessionResult } from '../../learning-engine/index.ts'

interface SummaryScreenProps {
  readonly lessonTitle: string
  readonly result: SessionResult
  readonly onHome: () => void
  readonly nextActionLabel: 'Continue Learning' | 'Extra Practice'
  readonly onNext: () => void
}

export function SummaryScreen({
  lessonTitle,
  result,
  onHome,
  nextActionLabel,
  onNext,
}: SummaryScreenProps) {
  useEffect(() => {
    if (nextActionLabel !== 'Continue Learning') return
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
      onNext()
    }
    window.addEventListener('keydown', continueWithSpace)
    return () => window.removeEventListener('keydown', continueWithSpace)
  }, [nextActionLabel, onNext])

  return (
    <main className="centered-page summary-page">
      <section className="summary-card" aria-labelledby="summary-title">
        <span className="summary-icon"><Sparkles size={30} aria-hidden="true" /></span>
        <p className="eyebrow">Session complete</p>
        <h1 id="summary-title">Strong finish.</h1>
        <p>
          You completed <strong>{lessonTitle}</strong>.{' '}
          {result.reviewedLexemes > 0
            ? 'Your next review is now scheduled.'
            : 'This was a practice session, so your review schedule did not change.'}
        </p>

        <div className="accuracy-ring" style={{ '--accuracy': `${result.accuracyPercent * 3.6}deg` } as React.CSSProperties}>
          <span><strong>{result.accuracyPercent}%</strong><small>accuracy</small></span>
        </div>

        <div className="summary-stats">
          <div><Check size={18} aria-hidden="true" /><span><strong>{result.correctAnswers}</strong> correct</span></div>
          <div><RotateCcw size={18} aria-hidden="true" /><span><strong>{result.incorrectAnswers}</strong> wrong attempts</span></div>
          <div><Target size={18} aria-hidden="true" /><span><strong>{result.difficultLexemes}</strong> difficult words</span></div>
        </div>

        <div className="summary-actions">
          <button className="button primary" type="button" onClick={onNext}>
            {nextActionLabel}
            {nextActionLabel === 'Continue Learning'
              ? <ArrowRight size={18} aria-hidden="true" />
              : <RotateCcw size={17} aria-hidden="true" />}
          </button>
          <button className="button secondary" type="button" onClick={onHome}>
            <Home size={17} aria-hidden="true" /> Back to Home
          </button>
        </div>
        <span className="home-label"><Home size={14} aria-hidden="true" /> Progress saved on this device</span>
      </section>
    </main>
  )
}
