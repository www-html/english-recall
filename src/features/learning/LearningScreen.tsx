import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Check,
  Gauge,
  Headphones,
  Lightbulb,
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
  type RefObject,
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
  | 'full-sentence'
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
  readonly audioEnabled: boolean
  readonly autoAdvance: boolean
  readonly speechRate: number
  readonly slowerSpeechRate: number
  readonly sentenceSaved: boolean
  readonly onPause: () => void
  readonly onRestartSentence: () => void
  readonly onModeChange: (mode: LearningMode) => void
  readonly onAudioEnabledChange: (enabled: boolean) => void
  readonly onAutoAdvanceChange: (enabled: boolean) => void
  readonly onSpeechRateChange: (rate: number) => void
  readonly onSlowerSpeechRateChange: (rate: number) => void
  readonly onEndSession: () => void
  readonly onSubmitChoice: (lexemeId: string) => void
  readonly onSubmitFill: (word: string) => void
  readonly onContinue: () => void
  readonly onListen: () => void
  readonly onReplaySlower: () => void
  readonly onSentenceSavedChange: (saved: boolean) => void | Promise<void>
}

function handleModalKeyDown(
  event: ReactKeyboardEvent<HTMLElement>,
  onClose: () => void,
) {
  if (event.key === 'Escape') {
    event.preventDefault()
    onClose()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getAttribute('aria-hidden') !== 'true')
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) return

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

const MODE_LABELS: ReadonlyArray<{
  value: LearningMode
  label: string
}> = [
  { value: 'auto', label: 'Auto' },
  { value: 'word-choice', label: 'Word Choice' },
  { value: 'fill-words', label: 'Fill Words' },
  { value: 'listening-choice', label: 'Listening Choice' },
  { value: 'full-sentence', label: 'Full Sentence' },
]

interface LearningMenuProps {
  readonly onPause: () => void
  readonly onRestartSentence: () => void
  readonly onOpenSessionSettings: () => void
  readonly onEndSession: () => void
}

function LearningMenu({
  onPause,
  onRestartSentence,
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
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(onOpenSessionSettings)}
          >
            <Settings2 size={17} aria-hidden="true" />
            <span>Session settings</span>
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
  readonly fillValue: string
  readonly fillHintVisible: boolean
  readonly fillInputRef: RefObject<HTMLInputElement | null>
  readonly inputWidth: number
  readonly sentenceComplete: boolean
  readonly onFillValueChange: (value: string) => void
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
  fillValue,
  fillHintVisible,
  fillInputRef,
  inputWidth,
  sentenceComplete,
  onFillValueChange,
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
      const firstLetter = answer.charAt(0)
      const editableValue =
        fillHintVisible && fillValue.startsWith(firstLetter)
          ? fillValue.slice(firstLetter.length)
          : fillValue
      parts.push(
        <span
          className={`inline-answer ${feedback === 'incorrect' ? 'is-wrong' : ''} ${feedback === 'correct' ? 'is-correct' : ''}`}
          key={target.id}
        >
          {fillHintVisible ? <span aria-hidden="true">{firstLetter}</span> : null}
          <input
            ref={fillInputRef}
            autoFocus
            autoCapitalize="none"
            autoComplete="off"
            enterKeyHint="done"
            spellCheck="false"
            aria-label={
              fillHintVisible
                ? `Complete the word beginning with ${firstLetter}`
                : 'Complete the missing word'
            }
            value={editableValue}
            size={Math.max(2, inputWidth - (fillHintVisible ? 1 : 0))}
            disabled={feedback === 'correct'}
            onChange={(event) =>
              onFillValueChange(
                fillHintVisible
                  ? `${firstLetter}${event.target.value}`
                  : event.target.value,
              )
            }
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
  audioEnabled,
  autoAdvance,
  speechRate,
  slowerSpeechRate,
  sentenceSaved,
  onPause,
  onRestartSentence,
  onModeChange,
  onAudioEnabledChange,
  onAutoAdvanceChange,
  onSpeechRateChange,
  onSlowerSpeechRateChange,
  onEndSession,
  onSubmitChoice,
  onSubmitFill,
  onContinue,
  onListen,
  onReplaySlower,
  onSentenceSavedChange,
}: LearningScreenProps) {
  const [fillAnswer, setFillAnswer] = useState('')
  const [fillHintVisible, setFillHintVisible] = useState(false)
  const [fullSentenceAnswer, setFullSentenceAnswer] = useState('')
  const [fullSentenceHintVisible, setFullSentenceHintVisible] = useState(false)
  const [editedAfterAttempt, setEditedAfterAttempt] = useState(false)
  const [shakingChoiceId, setShakingChoiceId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false)
  const [savingSentence, setSavingSentence] = useState(false)
  const [saveSentenceError, setSaveSentenceError] = useState(false)
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fillInputRef = useRef<HTMLInputElement>(null)
  const modalWasOpen = useRef(false)
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
  const isChoiceActivity =
    activity === 'word-choice' || activity === 'listening-choice'
  const isFullSentenceActivity = activity === 'full-sentence'
  const isAudioFirst = activity === 'listening-choice' && speechSupported
  const sentenceFirstLetters = useMemo(
    () =>
      sentence.displayText
        .split(/\s+/)
        .flatMap((word) => word.match(/\p{L}/u)?.[0] ?? [])
        .join(' · '),
    [sentence.displayText],
  )
  const canSubmitFill = fillHintVisible
    ? fillAnswer.trim().length > firstLetter.length
    : fillAnswer.trim().length > 0

  const toggleSavedSentence = async () => {
    if (savingSentence) return
    setSavingSentence(true)
    setSaveSentenceError(false)
    try {
      await onSentenceSavedChange(!sentenceSaved)
    } catch {
      setSaveSentenceError(true)
    } finally {
      setSavingSentence(false)
    }
  }

  useEffect(() => {
    setFillAnswer('')
    setFillHintVisible(false)
    setFullSentenceAnswer('')
    setFullSentenceHintVisible(false)
    setEditedAfterAttempt(false)
    setShakingChoiceId(null)
    setSaveSentenceError(false)
  }, [sentence.id, currentTarget.id, activity])

  useEffect(() => {
    if (feedback !== 'correct') return
    setFillAnswer(answer)
    if (isFullSentenceActivity) setFullSentenceAnswer(sentence.displayText)
  }, [answer, feedback, firstLetter.length, isFullSentenceActivity, sentence.displayText])

  useEffect(() => () => {
    if (shakeTimer.current) clearTimeout(shakeTimer.current)
  }, [])

  useEffect(() => {
    if (settingsOpen || endConfirmationOpen) {
      modalWasOpen.current = true
      return
    }
    if (modalWasOpen.current) {
      modalWasOpen.current = false
      document.querySelector<HTMLButtonElement>('.learning-icon-button')?.focus()
    }
  }, [endConfirmationOpen, settingsOpen])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return
      if (settingsOpen || endConfirmationOpen) return
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

      if (sentenceComplete && event.key === ' ') {
        const interactiveTarget =
          event.target instanceof Element &&
          event.target.closest('button, input, textarea, select, a, [contenteditable="true"]')
        if (!interactiveTarget) {
          event.preventDefault()
          onContinue()
        }
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
    onContinue,
    speechSupported,
    sentenceComplete,
    settingsOpen,
    targetLexeme.id,
    endConfirmationOpen,
  ])

  const submitFill = (event?: FormEvent) => {
    event?.preventDefault()
    const fullWord = fillAnswer.trim()
    if (feedback !== 'correct' && canSubmitFill && fullWord) {
      setEditedAfterAttempt(false)
      onSubmitFill(fullWord)
    }
  }

  const showTypingHint = () => {
    if (activity === 'fill-words') {
      setFillHintVisible(true)
      setFillAnswer((current) => {
        if (!current) return firstLetter
        return current.toLocaleLowerCase('en-US').startsWith(
          firstLetter.toLocaleLowerCase('en-US'),
        )
          ? current
          : `${firstLetter}${current}`
      })
      window.requestAnimationFrame(() => fillInputRef.current?.focus())
    } else if (activity === 'full-sentence') {
      setFullSentenceHintVisible(true)
    }
  }

  const submitFullSentence = (event?: FormEvent) => {
    event?.preventDefault()
    const response = fullSentenceAnswer.trim()
    if (feedback !== 'correct' && response) {
      setEditedAfterAttempt(false)
      onSubmitFill(response)
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
          onPause={onPause}
          onRestartSentence={onRestartSentence}
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
            onKeyDown={(event) =>
              handleModalKeyDown(event, () => setSettingsOpen(false))
            }
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
            <fieldset className="session-mode-setting">
              <legend>Learning mode</legend>
              <div role="radiogroup" aria-label="Learning mode">
                {MODE_LABELS.map((option) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === option.value}
                    key={option.value}
                    onClick={() => onModeChange(option.value)}
                  >
                    <span>{option.label}</span>
                    {mode === option.value ? <Check size={15} aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className={`session-setting-toggle ${!speechSupported ? 'is-disabled' : ''}`}>
              <span>
                <strong>Automatic audio</strong>
                <small>
                  {speechSupported
                    ? `Play each new sentence automatically · ${audioEnabled ? 'On' : 'Off'}`
                    : 'Not available in this browser'}
                </small>
              </span>
              <input
                type="checkbox"
                checked={audioEnabled}
                disabled={!speechSupported}
                onChange={(event) => onAudioEnabledChange(event.target.checked)}
              />
            </label>
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
                aria-label="Speech rate"
                min="0.6"
                max="1.2"
                step="0.1"
                value={speechRate}
                onChange={(event) => onSpeechRateChange(Number(event.target.value))}
              />
            </label>
            <label className="speech-rate-setting">
              <span>
                <strong>Slower replay rate</strong>
                <output>{slowerSpeechRate.toFixed(2)}×</output>
              </span>
              <input
                type="range"
                aria-label="Slower replay rate"
                min="0.5"
                max={Math.max(0.5, Number((speechRate - 0.05).toFixed(2)))}
                step="0.05"
                value={slowerSpeechRate}
                onChange={(event) => onSlowerSpeechRateChange(Number(event.target.value))}
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
            onKeyDown={(event) =>
              handleModalKeyDown(event, () => setEndConfirmationOpen(false))
            }
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
        </div>

        <div className="sentence-actions" aria-label="Sentence actions">
          <div className="question-audio" aria-label="Sentence audio controls">
            <button
              className={speaking ? 'is-active' : ''}
              type="button"
              disabled={!speechSupported}
              aria-label="Replay sentence. Keyboard shortcut Arrow Up"
              title="Replay · Arrow Up"
              onClick={onListen}
            >
              <Volume2 size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={!speechSupported}
              aria-label={`Replay sentence slower at ${slowerSpeechRate.toFixed(2)}×. Keyboard shortcut Arrow Down`}
              title={`Slower ${slowerSpeechRate.toFixed(2)}× · Arrow Down`}
              onClick={onReplaySlower}
            >
              <Gauge size={17} aria-hidden="true" />
            </button>
          </div>
          <button
            className={`sentence-save-button ${sentenceSaved ? 'is-saved' : ''}`}
            type="button"
            aria-pressed={sentenceSaved}
            aria-busy={savingSentence}
            aria-label={
              savingSentence
                ? 'Saving sentence'
                : sentenceSaved
                  ? 'Remove sentence from Saved'
                  : 'Save sentence'
            }
            title={sentenceSaved ? 'Remove from Saved' : 'Save sentence'}
            disabled={savingSentence}
            onClick={() => void toggleSavedSentence()}
          >
            {sentenceSaved
              ? <BookmarkCheck size={17} aria-hidden="true" />
              : <Bookmark size={17} aria-hidden="true" />}
          </button>
          {!sentenceComplete &&
          (activity === 'fill-words' || activity === 'full-sentence') ? (
            <button
              className={`sentence-save-button sentence-hint-button ${
                fillHintVisible || fullSentenceHintVisible ? 'is-active' : ''
              }`}
              type="button"
              aria-pressed={fillHintVisible || fullSentenceHintVisible}
              aria-label={
                activity === 'fill-words'
                  ? 'Show first-letter hint'
                  : 'Show first letters for the sentence'
              }
              title="First-letter hint"
              disabled={fillHintVisible || fullSentenceHintVisible}
              onClick={showTypingHint}
            >
              <Lightbulb size={17} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {isFullSentenceActivity && !sentenceComplete ? (
          <form className="full-sentence-form" onSubmit={submitFullSentence}>
            <div className="full-sentence-prompt">
              <strong>Type the full sentence you hear.</strong>
              <span lang="vi">{sentence.translationVi}</span>
            </div>
            <input
              className={`full-sentence-input ${visibleFeedback === 'incorrect' ? 'is-wrong' : ''}`}
              autoFocus
              autoComplete="off"
              enterKeyHint="done"
              spellCheck="false"
              aria-label="Type the full sentence"
              value={fullSentenceAnswer}
              disabled={feedback === 'correct'}
              onChange={(event) => {
                setFullSentenceAnswer(event.target.value)
                setEditedAfterAttempt(true)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setFullSentenceAnswer('')
                  setEditedAfterAttempt(true)
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  submitFullSentence()
                }
              }}
            />
            {fullSentenceHintVisible ? (
              <p className="full-sentence-letter-hint" aria-live="polite">
                {sentenceFirstLetters}
              </p>
            ) : null}
            <div className="fill-actions">
              <p className="learning-hints">
                <kbd>Enter</kbd> check · <kbd>Esc</kbd> clear
              </p>
              <button
                className="fill-submit"
                type="submit"
                disabled={!fullSentenceAnswer.trim() || feedback === 'correct'}
              >
                Check
              </button>
            </div>
          </form>
        ) : isAudioFirst && !sentenceComplete ? (
          <div className={`listening-prompt ${speaking ? 'is-speaking' : ''}`}>
            <span className="listening-prompt-icon" aria-hidden="true">
              <Headphones size={28} aria-hidden="true" />
            </span>
            <div>
              <strong>{speaking ? 'Listening…' : 'Listen to the sentence'}</strong>
              <span>Use Replay if you need to hear it again.</span>
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
              fillValue={fillAnswer}
              fillHintVisible={fillHintVisible}
              fillInputRef={fillInputRef}
              inputWidth={Math.max(2, answer.length)}
              sentenceComplete={sentenceComplete}
              onFillValueChange={(value) => {
                setFillAnswer(value)
                setEditedAfterAttempt(true)
              }}
              onFillKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setFillAnswer('')
                  setEditedAfterAttempt(true)
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  submitFill()
                } else if (event.code === 'Space') {
                  event.preventDefault()
                  submitFill()
                }
              }}
            />

            {!sentenceComplete && activity === 'fill-words' ? (
              <div className="fill-actions">
                <p className="learning-hints">
                  <kbd>Enter</kbd> or <kbd>Space</kbd> check · <kbd>Esc</kbd> clear
                </p>
                <button
                  className="fill-submit"
                  type="submit"
                  disabled={!canSubmitFill || feedback === 'correct'}
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
        ) : null}

        {saveSentenceError ? (
          <p className="sentence-save-error" role="alert">
            Could not update Saved. Please try again.
          </p>
        ) : null}

        {sentenceComplete ? (
          <div className="sentence-complete" aria-live="polite">
            <span
              className="sentence-complete-status"
              role="status"
              aria-label="Sentence complete"
            >
              <Check size={16} aria-hidden="true" />
            </span>
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
            <div className="sentence-complete-actions">
              <button
                className="sentence-continue"
                type="button"
                aria-label="Continue to next question. Keyboard shortcut Space"
                title="Continue · Space"
                onClick={onContinue}
              >
                <ArrowRight size={19} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}

        <footer className="learning-stage-footer">
          <span>
            Target {Math.max(1, activeTargetPosition)} of {activeTargetIds.length}
          </span>
          <span className="learning-audio-shortcuts">
            <kbd>↑</kbd> replay <kbd>↓</kbd> slower
            {sentenceComplete ? <><kbd>Space</kbd> continue</> : null}
          </span>
        </footer>
      </section>
    </main>
  )
}
