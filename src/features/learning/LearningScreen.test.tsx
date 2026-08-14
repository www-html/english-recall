// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Lexeme, Sentence } from '../../domain/lesson-pack.schema.ts'
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
    slowerSpeechRate: 0.55,
    sentenceSaved: false,
    onPause: vi.fn(),
    onRestartSentence: vi.fn(),
    onAudioEnabledChange: vi.fn(),
    onAutoAdvanceChange: vi.fn(),
    onSpeechRateChange: vi.fn(),
    onSlowerSpeechRateChange: vi.fn(),
    onEndSession: vi.fn(),
    onSubmitChoice: vi.fn(),
    onSubmitFill: vi.fn(),
    onContinue: vi.fn(),
    onListen: vi.fn(),
    onReplaySlower: vi.fn(),
    onSentenceSavedChange: vi.fn(),
    ...overrides,
  }
}

afterEach(cleanup)

describe('LearningScreen sentence recall', () => {
  it('keeps audio preferences in Session settings instead of the learning footer', () => {
    const onAudioEnabledChange = vi.fn()
    const { container } = render(
      <LearningScreen
        {...createProps({ speechSupported: true, onAudioEnabledChange })}
      />,
    )

    expect(container.querySelector('.question-audio-toggle')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open session menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Session settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Session settings' })
    const audioToggle = within(dialog).getByRole('checkbox', {
      name: /Automatic audio/,
    })
    expect((audioToggle as HTMLInputElement).checked).toBe(true)
    fireEvent.click(audioToggle)
    expect(onAudioEnabledChange).toHaveBeenCalledWith(false)
  })

  it('saves and removes the current sentence with an accessible controlled state', async () => {
    const user = userEvent.setup()
    const onSentenceSavedChange = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <LearningScreen
        {...createProps({ onSentenceSavedChange })}
      />,
    )

    const saveButton = screen.getByRole('button', { name: 'Save sentence' })
    expect(saveButton.getAttribute('aria-pressed')).toBe('false')
    await user.click(saveButton)
    expect(onSentenceSavedChange).toHaveBeenCalledWith(true)

    rerender(
      <LearningScreen
        {...createProps({ sentenceSaved: true, onSentenceSavedChange })}
      />,
    )
    const savedButton = screen.getByRole('button', { name: 'Remove sentence from Saved' })
    expect(savedButton.getAttribute('aria-pressed')).toBe('true')
    await user.click(savedButton)
    expect(onSentenceSavedChange).toHaveBeenLastCalledWith(false)
  })

  it('keeps learning usable when saving a sentence fails', async () => {
    const user = userEvent.setup()
    render(
      <LearningScreen
        {...createProps({
          onSentenceSavedChange: vi.fn().mockRejectedValue(new Error('storage failed')),
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save sentence' }))
    expect(screen.getByRole('alert').textContent).toContain('Could not update Saved')
    expect(screen.getByRole('button', { name: 'Save sentence' }).hasAttribute('disabled')).toBe(false)
  })

  it('hides both the current target and unsolved future targets', () => {
    const { container } = render(<LearningScreen {...createProps()} />)
    const line = container.querySelector('.sentence-line')
    const actions = container.querySelector('.sentence-actions')
    const choices = container.querySelector('.sentence-choices')

    expect(line?.textContent).not.toContain('usually')
    expect(line?.textContent).not.toContain('coffee')
    expect(screen.getByLabelText('Missing word')).toBeTruthy()
    expect(screen.getByLabelText('Unsolved word')).toBeTruthy()
    if (!actions || !choices) throw new Error('Expected learning actions and choices')
    expect(
      Boolean(actions.compareDocumentPosition(choices) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
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

  it('submits Fill Words with Enter or Space and reveals the first letter on demand', async () => {
    const user = userEvent.setup()
    const onSubmitFill = vi.fn()
    render(
      <LearningScreen
        {...createProps({
          activity: 'fill-words',
          onSubmitFill,
        })}
      />,
    )
    let input = screen.getByRole('textbox', {
      name: 'Complete the missing word',
    }) as HTMLInputElement
    expect(input.getAttribute('enterkeyhint')).toBe('done')

    await user.type(input, 'usual')
    await user.keyboard('{Enter}')
    expect(onSubmitFill).toHaveBeenCalledWith('usual')

    await user.keyboard('{Escape}')
    expect(input.value).toBe('')
    await user.click(screen.getByRole('button', { name: 'Show first-letter hint' }))
    input = screen.getByRole('textbox', {
      name: 'Complete the word beginning with u',
    }) as HTMLInputElement
    await user.type(input, 'sual')
    await user.keyboard(' ')
    expect(onSubmitFill).toHaveBeenLastCalledWith('usual')

    await user.keyboard('{Escape}')
    await user.type(input, 'sually')
    await user.keyboard('{Backspace}')
    expect(input.value).toBe('suall')
    expect(within(input.closest('.inline-answer')!).getByText('u')).toBeTruthy()
  })

  it('continues with Space only after the sentence is complete', () => {
    const onContinue = vi.fn()
    const { rerender } = render(<LearningScreen {...createProps({ onContinue })} />)

    fireEvent.keyDown(window, { key: ' ' })
    expect(onContinue).not.toHaveBeenCalled()

    rerender(<LearningScreen {...createProps({ sentenceComplete: true, onContinue })} />)
    const continueButton = screen.getByRole('button', {
      name: 'Continue to next question. Keyboard shortcut Space',
    })
    expect(continueButton.textContent).toBe('')
    expect(screen.queryByRole('button', { name: 'Listen to completed sentence' })).toBeNull()
    expect(screen.getByRole('status', { name: 'Sentence complete' }).textContent).toBe('')
    fireEvent.keyDown(window, { key: ' ' })
    expect(onContinue).toHaveBeenCalledOnce()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Save sentence' }), { key: ' ' })
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('accepts a full sentence with Enter and clears it with Escape without revealing English', async () => {
    const user = userEvent.setup()
    const onSubmitFill = vi.fn()
    const { container } = render(
      <LearningScreen
        {...createProps({
          activity: 'full-sentence',
          speechSupported: true,
          onSubmitFill,
        })}
      />,
    )

    expect(container.querySelector('.sentence-line')).toBeNull()
    expect(screen.queryByText(sentence.displayText)).toBeNull()
    expect(screen.queryByText(sentence.translationVi)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show translation hint' }))
    expect(screen.getByText(sentence.translationVi)).toBeTruthy()
    const input = screen.getByRole('textbox', { name: 'Type the full sentence' })
    expect(input.getAttribute('enterkeyhint')).toBe('done')
    const actions = container.querySelector('.sentence-actions')
    if (!actions) throw new Error('Expected sentence actions')
    expect(
      Boolean(actions.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
    await user.click(
      screen.getByRole('button', { name: 'Show first letters for the sentence' }),
    )
    expect(screen.getByText('I · u · d · c')).toBeTruthy()
    await user.type(input, 'I usually drink coffee.')
    await user.keyboard('{Enter}')
    expect(onSubmitFill).toHaveBeenCalledWith('I usually drink coffee.')

    await user.keyboard('{Escape}')
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: /Replay sentence\. Keyboard shortcut Arrow Up/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Replay sentence slower/ })).toBeTruthy()
  })

  it('shows all target meanings and exposes session settings without a manual mode override', async () => {
    const onAutoAdvanceChange = vi.fn()
    const onSpeechRateChange = vi.fn()
    const onSlowerSpeechRateChange = vi.fn()
    const { rerender } = render(
      <LearningScreen
        {...createProps({
          onAutoAdvanceChange,
          onSpeechRateChange,
          onSlowerSpeechRateChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open session menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Session settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Session settings' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Auto-advance/ }))
    const speechRateSlider = within(dialog).getByRole('slider', { name: /Speech rate/ })
    const slowerRateSlider = within(dialog).getByRole('slider', { name: /Slower replay rate/ })
    fireEvent.change(speechRateSlider, { target: { value: '1.1' } })
    fireEvent.change(slowerRateSlider, { target: { value: '0.65' } })
    expect(onAutoAdvanceChange).toHaveBeenCalledWith(true)
    expect(onSpeechRateChange).toHaveBeenCalledWith(1.1)
    expect(onSlowerSpeechRateChange).toHaveBeenCalledWith(0.65)
    expect(within(dialog).queryByRole('radiogroup', { name: 'Learning mode' })).toBeNull()

    slowerRateSlider.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Done' }),
    )
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Session settings' })).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Open session menu' }),
    )

    rerender(<LearningScreen {...createProps({ sentenceComplete: true })} />)
    expect(screen.getByText('thường')).toBeTruthy()
    expect(screen.getByText('cà phê')).toBeTruthy()
  })

  it('renders audio-first Listening Choice and keeps 1–4 shortcuts', () => {
    const onSubmitChoice = vi.fn()
    const { container } = render(
      <LearningScreen
        {...createProps({
          activity: 'listening-choice',
          speechSupported: true,
          onSubmitChoice,
        })}
      />,
    )

    expect(screen.getByText('Listen to the sentence')).toBeTruthy()
    expect(container.querySelector('.sentence-line')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Play listening question' })).toBeNull()
    expect(
      screen
        .getByRole('button', { name: /Replay sentence slower at 0.55×/ })
        .textContent,
    ).toBe('')
    expect(
      screen.getByRole('button', { name: 'Replay sentence. Keyboard shortcut Arrow Up' })
        .textContent,
    ).toBe('')
    expect(screen.getByRole('button', { name: 'Save sentence' }).textContent).toBe('')

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
