import { ArrowRight, Check, Home, RotateCcw, Sparkles, Target } from 'lucide-react'
import type { SessionResult } from '../../learning-engine/index.ts'

interface SummaryScreenProps {
  readonly lessonTitle: string
  readonly result: SessionResult
  readonly onHome: () => void
  readonly onRepeat: () => void
}

export function SummaryScreen({
  lessonTitle,
  result,
  onHome,
  onRepeat,
}: SummaryScreenProps) {
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
          <button className="button primary" type="button" onClick={onHome}>Back to Home <ArrowRight size={18} aria-hidden="true" /></button>
          <button className="button secondary" type="button" onClick={onRepeat}><RotateCcw size={17} aria-hidden="true" /> Repeat lesson</button>
        </div>
        <span className="home-label"><Home size={14} aria-hidden="true" /> Progress saved on this device</span>
      </section>
    </main>
  )
}
