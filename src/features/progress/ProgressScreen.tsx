import {
  AlertCircle,
  BarChart3,
  BookCheck,
  CalendarDays,
  RefreshCw,
  Target,
} from 'lucide-react'
import type { LessonPack } from '../../domain/lesson-pack.schema.ts'
import type { SessionCompletionRecord } from '../../persistence/contracts.ts'
import {
  AppFrame,
  type AppNavigationCallbacks,
} from '../navigation/AppFrame.tsx'
import {
  resolveDifficultWords,
  summarizeProgress,
  type ProgressPeriodMetrics,
} from './progress-metrics.ts'

export type ProgressScreenState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready'
      readonly history: readonly SessionCompletionRecord[]
      readonly packs: readonly LessonPack[]
    }

interface ProgressScreenProps extends AppNavigationCallbacks {
  readonly state: ProgressScreenState
  readonly storageAvailable: boolean
  readonly notice: string | undefined
  readonly onRetry: () => void
  /** Injectable for deterministic previews and tests. */
  readonly now?: Date
  /** Defaults to the browser's local time zone. */
  readonly timeZone?: string
}

function displayDateRange(
  startDate: string,
  endDate: string,
): string {
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  })
  const asStableDate = (value: string) => new Date(`${value}T12:00:00Z`)
  return `${formatter.format(asStableDate(startDate))}–${formatter.format(asStableDate(endDate))}`
}

function MetricGrid({ metrics }: { readonly metrics: ProgressPeriodMetrics }) {
  return (
    <dl className="progress-metric-grid">
      <div><dt>Study days</dt><dd>{metrics.studyDays}</dd></div>
      <div><dt>Sessions</dt><dd>{metrics.sessions}</dd></div>
      <div><dt>Review events</dt><dd>{metrics.reviewEvents}</dd></div>
      <div>
        <dt>Accuracy</dt>
        <dd>{metrics.accuracyPercent === null ? '—' : `${metrics.accuracyPercent}%`}</dd>
      </div>
    </dl>
  )
}

export function ProgressScreen({
  state,
  storageAvailable,
  notice,
  onRetry,
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  ...navigation
}: ProgressScreenProps) {
  const summary =
    state.status === 'ready'
      ? summarizeProgress(state.history, now, timeZone)
      : null
  const difficultWords =
    state.status === 'ready' && summary
      ? resolveDifficultWords(summary.month.records, state.packs)
      : []

  return (
    <AppFrame
      {...navigation}
      activeView="progress"
      storageAvailable={storageAvailable}
      notice={notice}
    >
      <header className="view-heading progress-heading">
        <p className="eyebrow">Learning history</p>
        <h1>Progress</h1>
        <p>Completed sessions on this device, grouped by your local calendar.</p>
      </header>

      {state.status === 'loading' ? (
        <div className="progress-state" role="status" aria-live="polite">
          <RefreshCw className="is-spinning" size={22} aria-hidden="true" />
          <span>Loading progress…</span>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <section className="progress-state progress-error" role="alert">
          <AlertCircle size={24} aria-hidden="true" />
          <div>
            <h2>Progress is unavailable</h2>
            <p>{state.message}</p>
          </div>
          <button className="button secondary compact" type="button" onClick={onRetry}>
            <RefreshCw size={15} aria-hidden="true" /> Retry
          </button>
        </section>
      ) : null}

      {state.status === 'ready' && state.history.length === 0 ? (
        <div className="empty-state progress-empty">
          <BarChart3 size={30} aria-hidden="true" />
          <h2>No completed sessions yet</h2>
          <p>Finish a learning session and your progress will appear here.</p>
          <button className="button primary compact" type="button" onClick={navigation.onOpenHome}>
            Start learning
          </button>
        </div>
      ) : null}

      {state.status === 'ready' && state.history.length > 0 && summary ? (
        <div className="progress-content">
          <section className="progress-period progress-period-primary" aria-labelledby="week-progress-title">
            <div className="progress-section-heading">
              <span className="progress-section-icon"><CalendarDays size={19} aria-hidden="true" /></span>
              <div>
                <p className="eyebrow">This week</p>
                <h2 id="week-progress-title">{displayDateRange(summary.week.startDate, summary.week.endDate)}</h2>
              </div>
            </div>
            <MetricGrid metrics={summary.week.metrics} />
            <p className="progress-growth">
              <span><strong>{summary.week.metrics.newlyLearned}</strong> newly learned</span>
              <span aria-hidden="true">·</span>
              <span><strong>{summary.week.metrics.mastered}</strong> reached mastery</span>
            </p>
          </section>

          <section className="progress-period" aria-labelledby="month-progress-title">
            <div className="progress-section-heading">
              <span className="progress-section-icon"><BookCheck size={19} aria-hidden="true" /></span>
              <div>
                <p className="eyebrow">This month</p>
                <h2 id="month-progress-title">
                  {new Intl.DateTimeFormat('en', { timeZone, month: 'long', year: 'numeric' }).format(now)}
                </h2>
              </div>
            </div>
            <MetricGrid metrics={summary.month.metrics} />
            <p className="progress-growth">
              <span><strong>{summary.month.metrics.newlyLearned}</strong> newly learned</span>
              <span aria-hidden="true">·</span>
              <span><strong>{summary.month.metrics.mastered}</strong> reached mastery</span>
            </p>
          </section>

          <section className="progress-difficult" aria-labelledby="difficult-words-title">
            <div className="progress-section-heading">
              <span className="progress-section-icon"><Target size={19} aria-hidden="true" /></span>
              <div>
                <p className="eyebrow">Needs attention</p>
                <h2 id="difficult-words-title">Difficult this month</h2>
              </div>
            </div>
            {difficultWords.length === 0 ? (
              <p className="progress-calm-state">No difficult words recorded this month.</p>
            ) : (
              <ul className="progress-word-list">
                {difficultWords.slice(0, 8).map((word) => (
                  <li key={word.key}>
                    <div>
                      <strong>{word.lemma}</strong>
                      <span>{word.partOfSpeech} · {word.meaningVi}</span>
                    </div>
                    <small>
                      {word.sessionCount} {word.sessionCount === 1 ? 'session' : 'sessions'}
                    </small>
                  </li>
                ))}
              </ul>
            )}
            {difficultWords.length > 8 ? (
              <p className="progress-list-note">Showing 8 of {difficultWords.length} difficult words.</p>
            ) : null}
          </section>
        </div>
      ) : null}
    </AppFrame>
  )
}
