// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Lexeme, Sentence } from '../../domain/lesson-pack.schema.ts'
import { getSlowerSpeechRate } from '../../app/use-speech.ts'
import { LearningScreen, type LearningScreenProps } from './LearningScreen.tsx'

const lexemes: readonly Lexeme[] = [
  { id: 'usually', text: 'usually', partOfSpeech: 'adverb', meaningVi: 'thường' },
  { id: 'coffee', text: 'coffee', partOfSpeech: 'noun', meaningVi: 'cà phê' },
  { id: 'always', text: 'always', partOfSpeech: 'adverb', meaningVi: 'luôn luôn' },
  { id: 'sometimes', text: 'sometimes', partOfSpeech: 'adverb', meaningVi: 'đôi khi' },
  { id: 'normally', text: 'normally', partOfSpeech: 'adverb', meaningVi: 'thông thường' },
  { id: 'tea', text: 'tea', partOfSpeech: 'noun', meaningVi: 'trà' },
  { id: 'water', text: 'water', partOfSpeech: 'noun', meaningVi: 'nước' },
  { id: 'lunch', text: 'lunch', partOfSpeech: 'noun', meaningVi: 'bữa trưa' },
]

const sentence: Sentence = {
  id: 'morning',
  displayText: 'I usually drink coffee.',
  speechText: 'I usually drink coffee.',
  translationVi: 'Tôi thường uống cà phê.',
  level: 'A1',
  topic: 'routines',
  explanation: 'Usually describes a frequent routine.',
  targets: [
    {
      id: 'target-one',
      lexemeId: 'usually',
      start: 2,
      end: 9,
      distractorLexemeIds: ['always', 'sometimes', 'normally'],
    },
    {
      id: 'target-two',
      lexemeId: 'coffee',
      start: 16,
      end: 22,
      distractorLexemeIds: ['tea', 'water', 'lunch'],
    },
  ],
}

function getLexeme(id: string): Lexeme {
  const lexeme = lexemes.find((candidate) => candidate.id === id)
  if (!lexeme) throw new Error(`Missing fixture lexeme ${id}`)
  return lexeme
}

function createProps(
  overrides: Partial<LearningScreenProps> = {},
): LearningScreenProps {
  return {
    lessonTitle: 'Daily routines',
    sentence,
    currentTarget: sentence.targets[0]!,
    targetLexeme: getLexeme('usually'),
    choices: ['usually', 'always', 'sometimes', 'normally'].map(getLexeme),
    sentenceTargetLexemes: [getLexeme('usually'), getLexeme('coffee')],
    solvedTargetIds: [],
    currentStep: 1,
    totalSteps: 2,
    mode: 'word-choice',
    activity: 'word-choice',
    feedback: 'idle',
    selectedChoiceLexemeId: null,
    wrongChoiceLexemeIds: [],
    sentenceComplete: false,
    speechSupported: false,
    speaking: false,
    autoAdvance: false,
    speechRate: 0.9,
    slowerSpeechRate: getSlowerSpeechRate(0.9),
    onPause: vi.fn(),
    onRestartSentence: vi.fn(),
    onModeChange: vi.fn(),
    onAutoAdvanceChange: vi.fn(),
    onSpeechRateChange: vi.fn(),
    onEndSession: vi.fn(),
    onSubmitChoice: vi.fn(),
    onSubmitFill: vi.fn(),
    onContinue: vi.fn(),
    onListen: vi.fn(),
    onReplaySlower: vi.fn(),
    ...overrides,
  }
}

afterEach(cleanup)

describe('LearningScreen sentence recall', () => {
  it('hides both the current target and unsolved future targets', () => {
    const { container } = render(<LearningScreen {...createProps()} />)
    const line = container.querySelector('.sentence-line')

    expect(line?.textContent).not.toContain('usually')
    expect(line?.textContent).not.toContain('coffee')
    expect(screen.getByLabelText('Missing word')).toBeTruthy()
    expect(screen.getByLabelText('Unsolved word')).toBeTruthy()
  })

  it('uses 1–4 shortcuts and keeps wrong choices marked without revealing text', () => {
    const onSubmitChoice = vi.fn()
    const { container, rerender } = render(
      <LearningScreen {...createProps({ onSubmitChoice })} />,
    )

    fireEvent.keyDown(window, { key: '2' })
    expect(onSubmitChoice).toHaveBeenCalledWith('always')

    rerender(
      <LearningScreen
        {...createProps({
          feedback: 'incorrect',
          selectedChoiceLexemeId: 'always',
          wrongChoiceLexemeIds: ['always'],
          onSubmitChoice,
        })}
      />,
    )
    expect(
      screen
        .getByRole('button', { name: /2\s*always/ })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(container.querySelector('.sentence-line')?.textContent).not.toContain('usually')
  })

  it('keeps the first-letter hint fixed and supports Space, Esc and Backspace', async () => {
    const user = userEvent.setup()
    const onSubmitFill = vi.fn()
    render(
      <LearningScreen
        {...createProps({
          activity: 'fill-words',
          mode: 'fill-words',
          onSubmitFill,
        })}
      />,
    )
    const input = screen.getByRole('textbox', {
      name: 'Complete the word beginning with u',
    }) as HTMLInputElement

    await user.type(input, 'sual')
    await user.keyboard(' ')
    expect(onSubmitFill).toHaveBeenCalledWith('usual')

    await user.keyboard('{Escape}')
    expect(input.value).toBe('')
    await user.type(input, 'sually')
    await user.keyboard('{Backspace}')
    expect(input.value).toBe('suall')
    expect(within(input.closest('.inline-answer')!).getByText('u')).toBeTruthy()
  })

  it('shows all target meanings and exposes real session settings', async () => {
    const user = userEvent.setup()
    const onAutoAdvanceChange = vi.fn()
    const onSpeechRateChange = vi.fn()
    const { rerender } = render(
      <LearningScreen
        {...createProps({ onAutoAdvanceChange, onSpeechRateChange })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Open session menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Session settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Session settings' })
    await user.click(within(dialog).getByRole('checkbox'))
    fireEvent.change(within(dialog).getByRole('slider'), { target: { value: '1.1' } })
    expect(onAutoAdvanceChange).toHaveBeenCalledWith(true)
    expect(onSpeechRateChange).toHaveBeenCalledWith(1.1)

    rerender(<LearningScreen {...createProps({ sentenceComplete: true })} />)
    expect(screen.getByText('thường')).toBeTruthy()
    expect(screen.getByText('cà phê')).toBeTruthy()
  })

  it('renders audio-first Listening Choice and keeps 1–4 shortcuts', () => {
    const onSubmitChoice = vi.fn()
    const { container } = render(
      <LearningScreen
        {...createProps({
          mode: 'listening-choice',
          activity: 'listening-choice',
          speechSupported: true,
          onSubmitChoice,
        })}
      />,
    )

    expect(screen.getByText('Listen to the sentence')).toBeTruthy()
    expect(container.querySelector('.sentence-line')).toBeNull()
    expect(
      screen
        .getByRole('button', { name: 'Replay sentence slower. Keyboard shortcut Arrow Down' })
        .textContent,
    ).toContain('0.5×')

    fireEvent.keyDown(window, { key: '3' })
    expect(onSubmitChoice).toHaveBeenCalledWith('sometimes')
  })
})
