import { ArrowLeft, Home, Play, TimerReset } from 'lucide-react'

interface PauseScreenProps {
  readonly lessonTitle: string
  readonly completed: number
  readonly total: number
  readonly onResume: () => void
  readonly onHome: () => void
}

export function PauseScreen({
  lessonTitle,
  completed,
  total,
  onResume,
  onHome,
}: PauseScreenProps) {
  return (
    <main className="centered-page">
      <section className="pause-card" aria-labelledby="pause-title">
        <span className="pause-illustration"><TimerReset size={34} aria-hidden="true" /></span>
        <p className="eyebrow">Session paused</p>
        <h1 id="pause-title">Take a breath.</h1>
        <p>Your progress in <strong>{lessonTitle}</strong> is saved locally.</p>
        <div className="pause-progress">
          <span><strong>{completed}</strong> completed</span>
          <span><strong>{total - completed}</strong> remaining</span>
        </div>
        <button className="button primary" type="button" onClick={onResume}>
          <Play size={18} aria-hidden="true" /> Resume session
        </button>
        <button className="button secondary" type="button" onClick={onHome}>
          <Home size={18} aria-hidden="true" /> Back to Home
        </button>
        <p className="pause-hint"><ArrowLeft size={14} aria-hidden="true" /> You can resume from Home at any time.</p>
      </section>
    </main>
  )
}
