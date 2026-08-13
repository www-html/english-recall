import {
  Check,
  Headphones,
  LogOut,
  MoreHorizontal,
  Pause,
  RotateCcw,
  Settings2,
  Volume2,
} from 'lucide-react'
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import type {
  Lexeme,
  Sentence,
  TargetOccurrence,
} from '../../domain/lesson-pack.schema.ts'

export type LearningMode =
  | 'auto'
  | 'word-choice'
  | 'fill-words'
  | 'listening-choice'
export type LearningActivity = Exclude<LearningMode, 'auto'>
export type LearningFeedback = 'idle' | 'incorrect' | 'correct'

export interface ChoiceOption {
  readonly lexemeId: string
  readonly surfaceText: string
}

export interface LearningScreenProps {
  readonly lessonTitle: string
  readonly sentence: Sentence
  readonly currentTarget: TargetOccurrence
  readonly targetLexeme: Lexeme
  readonly choices: readonly ChoiceOption[]
  readonly sentenceTargetLexemes: readonly Lexeme[]
  /** All due/new targets selected for this sentence, including future ones. */
  readonly activeTargetIds: readonly string[]
  readonly solvedTargetIds: readonly string[]
  /** One-based position in the full learning session. */
  readonly currentStep: number
  readonly totalSteps: number
  readonly mode: LearningMode
  readonly activity: LearningActivity
  readonly feedback: LearningFeedback
  readonly selectedChoiceLexemeId: string | null
  readonly wrongChoiceLexemeIds: readonly string[]
  readonly sentenceComplete: boolean
  readonly speechSupported: boolean
  readonly speaking: boolean
  readonly autoAdvance: boolean
  readonly speechRate: number
  readonly slowerSpeechRate: number
  readonly onPause: () => void
  readonly onRestartSentence: () => void
  readonly onModeChange: (mode: LearningMode) => void
  readonly onAutoAdvanceChange: (enabled: boolean) => void
  readonly onSpeechRateChange: (rate: number) => void
  readonly onEndSession: () => void
  readonly onSubmitChoice: (lexemeId: string) => void
  readonly onSubmitFill: (word: string) => void
  readonly onContinue: () => void
  readonly onListen: () => void
  readonly onReplaySlower: () => void
}

const MODE_LABELS: ReadonlyArray<{
  value: LearningMode
  label: string
}> = [
  { value: 'auto', label: 'Auto' },
  { value: 'word-choice', label: 'Word Choice' },
  { value: 'fill-words', label: 'Fill Words' },
  { value: 'listening-choice', label: 'Listening Choice' },
]

interface LearningMenuProps {
  readonly mode: LearningMode
  readonly sessionSettingsLabel: string | undefined
  readonly onPause: () => void
  readonly onRestartSentence: () => void
  readonly onModeChange: (mode: LearningMode) => void
  readonly onOpenSessionSettings: () => void
  readonly onEndSession: () => void
}

function LearningMenu({
  mode,
  sessionSettingsLabel,
  onPause,
  onRestartSentence,
  onModeChange,
  onOpenSessionSettings,
  onEndSession,
}: LearningMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    menuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus()

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    window.addEventListener('pointerdown', closeOnOutsidePress)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePress)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const runAndClose = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <div className="learning-menu-wrap" ref={menuRef}>
      <button
        className="learning-icon-button"
        ref={triggerRef}
        type="button"
        aria-label="Open session menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Session menu"
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={20} aria-hidden="true" />
      </button>

      {open ? (
        <div
          className="learning-menu"
          role="menu"
          aria-label="Session menu"
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'),
            )
            const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement)
            const nextIndex = event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : event.key === 'ArrowDown'
                  ? (activeIndex + 1) % items.length
                  : (activeIndex - 1 + items.length) % items.length
            event.preventDefault()
            items[nextIndex]?.focus()
          }}
        >
          <button type="button" role="menuitem" onClick={() => runAndClose(onPause)}>
            <Pause size={17} aria-hidden="true" />
            <span>Pause</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(onRestartSentence)}
          >
            <RotateCcw size={17} aria-hidden="true" />
            <span>Restart sentence</span>
          </button>

          <div className="learning-menu-divider" role="separator" />
          <p className="learning-menu-label">Learning mode</p>
          {MODE_LABELS.map((option) => (
            <button
              className="learning-mode-option"
              type="button"
              role="menuitemradio"
              aria-checked={mode === option.value}
              key={option.value}
              onClick={() => runAndClose(() => onModeChange(option.value))}
            >
              <span className="mode-radio" aria-hidden="true" />
              <span>{option.label}</span>
              {mode === option.value ? <Check size={16} aria-hidden="true" /> : null}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(onOpenSessionSettings)}
          >
            <Settings2 size={17} aria-hidden="true" />
            <span>{sessionSettingsLabel ?? 'Session settings'}</span>
          </button>

          <div className="learning-menu-divider" role="separator" />
          <button
            className="learning-menu-danger"
            type="button"
            role="menuitem"
            onClick={() => runAndClose(onEndSession)}
          >
            <LogOut size={17} aria-hidden="true" />
            <span>End session</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

interface SentenceLineProps {
  readonly sentence: Sentence
  readonly currentTarget: TargetOccurrence
  readonly activeTargetIds: ReadonlySet<string>
  readonly solvedTargetIds: ReadonlySet<string>
  readonly activity: LearningActivity
  readonly feedback: LearningFeedback
  readonly answer: string
  readonly suffix: string
  readonly inputWidth: number
  readonly sentenceComplete: boolean
  readonly onSuffixChange: (value: string) => void
  readonly onFillKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
}

function SentenceLine({
  sentence,
  currentTarget,
  activeTargetIds,
  solvedTargetIds,
  activity,
  feedback,
  answer,
  suffix,
  inputWidth,
  sentenceComplete,
  onSuffixChange,
  onFillKeyDown,
}: SentenceLineProps) {
  const orderedTargets = useMemo(
    () => [...sentence.targets].sort((left, right) => left.start - right.start),
    [sentence.targets],
  )
  const parts: ReactNode[] = []
  let cursor = 0

  orderedTargets.forEach((target) => {
    parts.push(sentence.displayText.slice(cursor, target.start))
    const targetText = sentence.displayText.slice(target.start, target.end)
    const isCurrent = target.id === currentTarget.id

    const isActive = activeTargetIds.has(target.id)

    if (sentenceComplete || solvedTargetIds.has(target.id) || !isActive) {
      parts.push(
        <span
          className={solvedTargetIds.has(target.id) ? 'sentence-word is-solved' : 'sentence-word'}
          key={target.id}
        >
          {targetText}
        </span>,
      )
    } else if (!isCurrent) {
      parts.push(
        <span className="sentence-blank" key={target.id} aria-label="Unsolved word">
          <span aria-hidden="true" />
        </span>,
      )
    } else if (activity === 'fill-words') {
      parts.push(
        <span
          className={`inline-answer ${feedback === 'incorrect' ? 'is-wrong' : ''} ${feedback === 'correct' ? 'is-correct' : ''}`}
          key={target.id}
        >
          <span aria-hidden="true">{answer.charAt(0)}</span>
          <input
            autoFocus
            autoCapitalize="none"
            autoComplete="off"
            spellCheck="false"
            aria-label={`Complete the word beginning with ${answer.charAt(0)}`}
            value={suffix}
            size={inputWidth}
            disabled={feedback === 'correct'}
            onChange={(event) => onSuffixChange(event.target.value)}
            onKeyDown={onFillKeyDown}
          />
        </span>,
      )
    } else {
      parts.push(
        <span className="sentence-blank" key={target.id} aria-label="Missing word">
          <span aria-hidden="true" />
        </span>,
      )
    }

    cursor = target.end
  })
  parts.push(sentence.displayText.slice(cursor))

  return (
    <p className="sentence-line">
      {parts.map((part, index) => (
        <Fragment key={`${sentence.id}-${index}`}>{part}</Fragment>
      ))}
    </p>
  )
}

export function LearningScreen({
  lessonTitle,
  sentence,
  currentTarget,
  targetLexeme,
  choices,
  sentenceTargetLexemes,
  activeTargetIds,
  solvedTargetIds,
  currentStep,
  totalSteps,
  mode,
  activity,
  feedback,
  selectedChoiceLexemeId,
  wrongChoiceLexemeIds,
  sentenceComplete,
  speechSupported,
  speaking,
  autoAdvance,
  speechRate,
  slowerSpeechRate,
  onPause,
  onRestartSentence,
  onModeChange,
  onAutoAdvanceChange,
  onSpeechRateChange,
  onEndSession,
  onSubmitChoice,
  onSubmitFill,
  onContinue,
  onListen,
  onReplaySlower,
}: LearningScreenProps) {
  const [suffix, setSuffix] = useState('')
  const [editedAfterAttempt, setEditedAfterAttempt] = useState(false)
  const [shakingChoiceId, setShakingChoiceId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false)
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const answer = choices.find(
    (choice) => choice.lexemeId === targetLexeme.id,
  )?.surfaceText ?? currentTarget.surfaceText
  const firstLetter = answer.charAt(0)
  const visibleFeedback = editedAfterAttempt && feedback === 'incorrect' ? 'idle' : feedback
  const progress = totalSteps > 0
    ? Math.min(100, Math.max(0, (currentStep / totalSteps) * 100))
    : 0
  const activeTargetPosition = activeTargetIds.indexOf(currentTarget.id) + 1
  const solvedTargets = useMemo(() => new Set(solvedTargetIds), [solvedTargetIds])
  const activeTargets = useMemo(() => new Set(activeTargetIds), [activeTargetIds])
  const wrongChoices = useMemo(
    () => new Set(wrongChoiceLexemeIds),
    [wrongChoiceLexemeIds],
  )
  const isChoiceActivity = activity !== 'fill-words'
  const isAudioFirst = activity === 'listening-choice' && speechSupported

  useEffect(() => {
    setSuffix('')
    setEditedAfterAttempt(false)
    setShakingChoiceId(null)
  }, [sentence.id, currentTarget.id, activity])

  useEffect(() => {
    if (feedback === 'correct') setSuffix(answer.slice(firstLetter.length))
  }, [answer, feedback, firstLetter.length])

  useEffect(() => () => {
    if (shakeTimer.current) clearTimeout(shakeTimer.current)
  }, [])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return
      if (
        event.target instanceof Element &&
        event.target.closest('.learning-menu')
      ) {
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (speechSupported) onListen()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (speechSupported) onReplaySlower()
        return
      }

      if (!isChoiceActivity || feedback === 'correct') return
      const choiceIndex = Number(event.key) - 1
      const choice = choices[choiceIndex]
      if (choiceIndex < 0 || choiceIndex > 3 || !choice) return

      event.preventDefault()
      if (choice.lexemeId !== targetLexeme.id) {
        setShakingChoiceId(choice.lexemeId)
        if (shakeTimer.current) clearTimeout(shakeTimer.current)
        shakeTimer.current = setTimeout(() => setShakingChoiceId(null), 440)
      }
      onSubmitChoice(choice.lexemeId)
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [
    activity,
    choices,
    feedback,
    isChoiceActivity,
    onListen,
    onReplaySlower,
    onSubmitChoice,
    speechSupported,
    targetLexeme.id,
  ])

  const submitFill = (event?: FormEvent) => {
    event?.preventDefault()
    const fullWord = `${firstLetter}${suffix}`.trim()
    if (feedback !== 'correct' && suffix.trim() && fullWord) {
      setEditedAfterAttempt(false)
      onSubmitFill(fullWord)
    }
  }

  const choose = (lexemeId: string) => {
    if (feedback === 'correct') return
    if (lexemeId !== targetLexeme.id) {
      setShakingChoiceId(lexemeId)
      if (shakeTimer.current) clearTimeout(shakeTimer.current)
      shakeTimer.current = setTimeout(() => setShakingChoiceId(null), 440)
    }
    onSubmitChoice(lexemeId)
  }

  return (
    <main className="learning-shell">
      <header className="learning-topbar">
        <div className="learning-brand">
          <span className="brand-mark small" aria-hidden="true">ER</span>
          <div>
            <strong>English Recall</strong>
            <span>{lessonTitle}</span>
          </div>
        </div>
        <div className="learning-header-progress" aria-label={`Step ${currentStep} of ${totalSteps}`}>
          <span>{currentStep} / {totalSteps}</span>
          <div className="learning-progress-track" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
        <LearningMenu
          mode={mode}
          sessionSettingsLabel="Session settings"
          onPause={onPause}
          onRestartSentence={onRestartSentence}
          onModeChange={onModeChange}
          onOpenSessionSettings={() => setSettingsOpen(true)}
          onEndSession={() => setEndConfirmationOpen(true)}
        />
      </header>

      {settingsOpen ? (
        <div
          className="session-settings-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false)
          }}
        >
          <section
            className="session-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-settings-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSettingsOpen(false)
            }}
          >
            <div className="session-settings-heading">
              <div>
                <span>Learning preferences</span>
                <h2 id="session-settings-title">Session settings</h2>
              </div>
              <button autoFocus type="button" onClick={() => setSettingsOpen(false)}>
                Done
              </button>
            </div>
            <label className="session-setting-toggle">
              <span>
                <strong>Auto-advance</strong>
                <small>Continue 2 seconds after a sentence is complete</small>
              </span>
              <input
                type="checkbox"
                checked={autoAdvance}
                onChange={(event) => onAutoAdvanceChange(event.target.checked)}
              />
            </label>
            <label className="speech-rate-setting">
              <span>
                <strong>Speech rate</strong>
                <output>{speechRate.toFixed(1)}×</output>
              </span>
              <input
                type="range"
                min="0.6"
                max="1.2"
                step="0.1"
                value={speechRate}
                onChange={(event) => onSpeechRateChange(Number(event.target.value))}
              />
            </label>
          </section>
        </div>
      ) : null}

      {endConfirmationOpen ? (
        <div
          className="session-settings-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setEndConfirmationOpen(false)
          }}
        >
          <section
            className="end-session-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="end-session-title"
            aria-describedby="end-session-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEndConfirmationOpen(false)
            }}
          >
            <span className="end-session-icon" aria-hidden="true"><LogOut size={21} /></span>
            <h2 id="end-session-title">End this session?</h2>
            <p id="end-session-description">
              Completed progress stays saved. The unfinished sentence will not count as completed.
            </p>
            <div className="end-session-actions">
              <button autoFocus className="button secondary" type="button" onClick={() => setEndConfirmationOpen(false)}>
                Keep learning
              </button>
              <button className="button danger" type="button" onClick={onEndSession}>
                End session
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <section className="learning-stage" aria-labelledby="question-label">
        <div className="question-row">
          <span className="question-kicker" id="question-label">
            {activity === 'listening-choice' ? 'Listening' : 'Question'}
          </span>
          <div className="question-audio" aria-label="Sentence audio controls">
            <button
              className={speaking ? 'is-active' : ''}
              type="button"
              disabled={!speechSupported}
              aria-label="Listen to sentence. Keyboard shortcut Arrow Up"
              title="Listen · Arrow Up"
              onClick={onListen}
            >
              <Volume2 size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={!speechSupported}
              aria-label="Replay sentence slower. Keyboard shortcut Arrow Down"
              title="Replay slower · Arrow Down"
              onClick={onReplaySlower}
            >
              <RotateCcw size={16} aria-hidden="true" />
              <span>{slowerSpeechRate.toFixed(1)}×</span>
            </button>
          </div>
        </div>

        {isAudioFirst && !sentenceComplete ? (
          <div className={`listening-prompt ${speaking ? 'is-speaking' : ''}`}>
            <button
              type="button"
              aria-label="Play listening question"
              onClick={onListen}
            >
              <Headphones size={28} aria-hidden="true" />
            </button>
            <div>
              <strong>{speaking ? 'Listening…' : 'Listen to the sentence'}</strong>
              <span>Choose the target word you hear.</span>
            </div>
          </div>
        ) : (
          <form className="sentence-form" onSubmit={submitFill}>
            <SentenceLine
              sentence={sentence}
              currentTarget={currentTarget}
              activeTargetIds={activeTargets}
              solvedTargetIds={solvedTargets}
              activity={activity}
              feedback={visibleFeedback}
              answer={answer}
              suffix={suffix}
              inputWidth={Math.max(2, answer.length - firstLetter.length)}
              sentenceComplete={sentenceComplete}
              onSuffixChange={(value) => {
                setSuffix(value)
                setEditedAfterAttempt(true)
              }}
              onFillKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setSuffix('')
                  setEditedAfterAttempt(true)
                } else if (event.code === 'Space') {
                  event.preventDefault()
                  submitFill()
                }
              }}
            />

            {!sentenceComplete && activity === 'fill-words' ? (
              <div className="fill-actions">
                <p className="learning-hints">
                  First letter stays visible · <kbd>Space</kbd> check · <kbd>Esc</kbd> clear
                </p>
                <button
                  className="fill-submit"
                  type="submit"
                  disabled={!suffix.trim() || feedback === 'correct'}
                >
                  Check
                </button>
              </div>
            ) : null}
          </form>
        )}

        {!sentenceComplete && isChoiceActivity ? (
          <div className="sentence-choices" aria-label="Answer choices">
            {choices.length === 4 ? choices.map((choice, index) => {
              const selectedWrong = wrongChoices.has(choice.lexemeId)
              const selectedCorrect = feedback === 'correct' && selectedChoiceLexemeId === choice.lexemeId
              return (
                <button
                  className={`sentence-choice ${selectedWrong ? 'is-wrong' : ''} ${selectedCorrect ? 'is-correct' : ''} ${shakingChoiceId === choice.lexemeId ? 'is-shaking' : ''}`}
                  type="button"
                  key={choice.lexemeId}
                  disabled={feedback === 'correct'}
                  aria-pressed={selectedWrong || selectedCorrect}
                  onClick={() => choose(choice.lexemeId)}
                >
                  <kbd>{index + 1}</kbd>
                  <span>{choice.surfaceText}</span>
                  {selectedCorrect ? <Check size={18} aria-hidden="true" /> : null}
                </button>
              )
            }) : (
              <p className="learning-data-error" role="alert">Four choices are required for this exercise.</p>
            )}
          </div>
        ) : null}

        {!sentenceComplete ? (
          <div className={`answer-feedback ${visibleFeedback}`} aria-live="polite" role="status">
            {visibleFeedback === 'incorrect' ? 'Not yet — try another answer.' : null}
            {visibleFeedback === 'correct' ? 'Correct' : null}
          </div>
        ) : (
          <div className="sentence-complete" aria-live="polite">
            <div className="sentence-complete-heading">
              <span><Check size={16} aria-hidden="true" /> Sentence complete</span>
              <button
                type="button"
                disabled={!speechSupported}
                onClick={onListen}
              >
                <Volume2 size={16} aria-hidden="true" /> Listen
              </button>
            </div>
            <p className="sentence-translation" lang="vi">{sentence.translationVi}</p>
            <dl className="lexeme-details">
              {sentenceTargetLexemes.map((lexeme) => (
                <div key={lexeme.id}>
                  <dt>{lexeme.lemma} · {lexeme.partOfSpeech}</dt>
                  <dd lang="vi">{lexeme.meaningVi}</dd>
                </div>
              ))}
              {sentence.explanation ? (
                <div>
                  <dt>Why it fits</dt>
                  <dd>{sentence.explanation}</dd>
                </div>
              ) : null}
            </dl>
            <button className="sentence-continue" type="button" onClick={onContinue}>
              Continue
            </button>
          </div>
        )}

        <footer className="learning-stage-footer">
          <span>
            Target {Math.max(1, activeTargetPosition)} of {activeTargetIds.length}
          </span>
          <span><kbd>↑</kbd> listen <kbd>↓</kbd> slower</span>
        </footer>
      </section>
    </main>
  )
}
