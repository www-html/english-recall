import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

export type HomeLearningMode =
  | 'auto'
  | 'word-choice'
  | 'fill-words'
  | 'listening-choice'
  | 'full-sentence'

const LEARNING_MODES: ReadonlyArray<{
  readonly value: HomeLearningMode
  readonly label: string
  readonly description: string
}> = [
  { value: 'auto', label: 'Auto', description: 'Adapt each exercise to mastery' },
  { value: 'word-choice', label: 'Word Choice', description: 'Choose from four answers' },
  { value: 'fill-words', label: 'Fill Words', description: 'Type the missing word' },
  { value: 'listening-choice', label: 'Listening Choice', description: 'Listen, then choose' },
  { value: 'full-sentence', label: 'Full Sentence', description: 'Listen, then type the full sentence' },
]

interface LearningModeMenuProps {
  readonly value: HomeLearningMode
  readonly onChange: (mode: HomeLearningMode) => void
  readonly label?: string
}

export function LearningModeMenu({
  value,
  onChange,
  label = 'Learning mode',
}: LearningModeMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(
    0,
    LEARNING_MODES.findIndex((mode) => mode.value === value),
  )
  const selected = LEARNING_MODES[selectedIndex] ?? LEARNING_MODES[0]

  useEffect(() => {
    if (open) optionRefs.current[selectedIndex]?.focus()
  }, [open, selectedIndex])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? LEARNING_MODES.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1) % LEARNING_MODES.length
            : (currentIndex - 1 + LEARNING_MODES.length) % LEARNING_MODES.length
    optionRefs.current[nextIndex]?.focus()
  }

  return (
    <div className="mode-menu-field">
      <span>{label}</span>
      <div className="mode-menu-wrap">
        <button
          ref={triggerRef}
          className="mode-menu-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
              event.preventDefault()
              setOpen(true)
            }
          }}
        >
          <span>{selected?.label}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {open ? (
          <div className="mode-menu-popover" role="listbox" aria-label={label}>
            {LEARNING_MODES.map((mode, index) => (
              <button
                key={mode.value}
                ref={(node) => { optionRefs.current[index] = node }}
                type="button"
                role="option"
                aria-selected={value === mode.value}
                onClick={() => {
                  onChange(mode.value)
                  close()
                }}
                onKeyDown={(event) => moveFocus(event, index)}
              >
                <span>
                  <strong>{mode.label}</strong>
                  <small>{mode.description}</small>
                </span>
                {value === mode.value ? <Check size={16} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
