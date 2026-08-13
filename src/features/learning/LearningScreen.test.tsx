// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Lexeme, Sentence } from '../../domain/lesson-pack.schema.ts'
import { getSlowerSpeechRate } from '../../app/use-speech.ts'
import { LearningScreen, type LearningScreenProps } from './LearningScreen.tsx'

const lexemes: readonly Lexeme[] = [
  { id: 'usually', lemma: 'usually', partOfSpeech: 'adverb', meaningVi: 'thường' },
  { id: 'coffee', lemma: 'coffee', partOfSpeech: 'noun', meaningVi: 'cà phê' },
  { id: 'always', lemma: 'always', partOfSpeech: 'adverb', meaningVi: 'luôn luôn' },
  { id: 'sometimes', lemma: 'sometimes', partOfSpeech: 'adverb', meaningVi: 'đôi khi' },
  { id: 'normally', lemma: 'normally', partOfSpeech: 'adverb', meaningVi: 'thông thường' },
  { id: 'tea', lemma: 'tea', partOfSpeech: 'noun', meaningVi: 'trà' },
  { id: 'water', lemma: 'water', partOfSpeech: 'noun', meaningVi: 'nước' },
  { id: 'lunch', lemma: 'lunch', partOfSpeech: 'noun', meaningVi: 'bữa trưa' },
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
      surfaceText: 'usually',
      distractors: [
        { lexemeId: 'always', surfaceText: 'always' },
        { lexemeId: 'sometimes', surfaceText: 'sometimes' },
        { lexemeId: 'normally', surfaceText: 'normally' },
      ],
    },
    {
      id: 'target-two',
      lexemeId: 'coffee',
      start: 16,
      end: 22,
      surfaceText: 'coffee',
      distractors: [
        { lexemeId: 'tea', surfaceText: 'tea' },
        { lexemeId: 'water', surfaceText: 'water' },
        { lexemeId: 'lunch', surfaceText: 'lunch' },
      ],
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
    choices: ['usually', 'always', 'sometimes', 'normally'].map((lexemeId) => ({
      lexemeId,
      surfaceText: getLexeme(lexemeId).lemma,
    })),
    sentenceTargetLexemes: [getLexeme('usually'), getLexeme('coffee')],
    activeTargetIds: ['target-one', 'target-two'],
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
    audioEnabled: true,
    autoAdvance: false,
    speechRate: 0.9,
    slowerSpeechRate: getSlowerSpeechRate(0.9),
    onPause: vi.fn(),
    onRestartSentence: vi.fn(),
    onModeChange: vi.fn(),
    onAudioEnabledChange: vi.fn(),
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
  it('toggles automatic question audio from the learning footer', () => {
    const onAudioEnabledChange = vi.fn()
    const { rerender } = render(
      <LearningScreen
        {...createProps({ speechSupported: true, onAudioEnabledChange })}
      />,
    )

    const enabledToggle = screen.getByRole('button', {
      name: 'Automatic audio for new questions: on',
    })
    expect(enabledToggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(enabledToggle)
    expect(onAudioEnabledChange).toHaveBeenCalledWith(false)

    rerender(
      <LearningScreen
        {...createProps({
          speechSupported: true,
          audioEnabled: false,
          onAudioEnabledChange,
        })}
      />,
    )
    expect(
      screen
        .getByRole('button', {
          name: 'Automatic audio for new questions: off',
        })
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('hides both the current target and unsolved future targets', () => {
    const { container } = render(<LearningScreen {...createProps()} />)
    const line = container.querySelector('.sentence-line')

    expect(line?.textContent).not.toContain('usually')
    expect(line?.textContent).not.toContain('coffee')
    expect(screen.getByLabelText('Missing word')).toBeTruthy()
    expect(screen.getByLabelText('Unsolved word')).toBeTruthy()
  })

  it('keeps supporting targets visible when they are not active', () => {
    const { container } = render(
      <LearningScreen {...createProps({ activeTargetIds: ['target-one'] })} />,
    )

    expect(container.querySelector('.sentence-line')?.textContent).toContain('coffee')
    expect(screen.queryByLabelText('Unsolved word')).toBeNull()
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
    const onAutoAdvanceChange = vi.fn()
    const onSpeechRateChange = vi.fn()
    const { rerender } = render(
      <LearningScreen
        {...createProps({ onAutoAdvanceChange, onSpeechRateChange })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open session menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Session settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Session settings' })
    fireEvent.click(within(dialog).getByRole('checkbox'))
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

  it('confirms before ending and explains saved progress', async () => {
    const user = userEvent.setup()
    const onEndSession = vi.fn()
    render(<LearningScreen {...createProps({ onEndSession })} />)

    await user.click(screen.getByRole('button', { name: 'Open session menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'End session' }))
    const dialog = screen.getByRole('alertdialog', { name: 'End this session?' })
    expect(within(dialog).getByText(/Completed progress stays saved/)).toBeTruthy()
    expect(onEndSession).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'End session' }))
    expect(onEndSession).toHaveBeenCalledOnce()
  })
})
