// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShadowingPractice, type ShadowingPracticeProps } from './ShadowingPractice.tsx'

const sentence = {
  id: 'status-update',
  displayText: 'I finished the port mapping.',
  translationVi: 'Tôi đã hoàn thành ánh xạ cổng.',
  explanation: 'Use the past simple for completed work.',
} as const

function createProps(
  overrides: Partial<ShadowingPracticeProps> = {},
): ShadowingPracticeProps {
  return {
    lessonTitle: 'Daily Project Update',
    sentence,
    currentStep: 1,
    totalSteps: 2,
    speechSupported: true,
    speaking: false,
    slowerSpeechRate: 0.55,
    onListen: vi.fn(),
    onReplaySlower: vi.fn(),
    onContinue: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  }
}

afterEach(cleanup)

describe('ShadowingPractice', () => {
  it('keeps the transcript hidden until the learner reaches compare', () => {
    render(<ShadowingPractice {...createProps()} />)

    expect(screen.queryByText(sentence.displayText)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Play sentence' }))
    fireEvent.click(screen.getByRole('button', { name: /Ready to repeat/ }))
    fireEvent.click(screen.getByRole('button', { name: /I repeated it/ }))

    expect(screen.getByText(sentence.displayText)).toBeTruthy()
    expect(screen.getByText(sentence.translationVi)).toBeTruthy()
    expect(screen.getByText(sentence.explanation)).toBeTruthy()
  })

  it('replays audio and completes locally without exposing an SRS callback', () => {
    const onListen = vi.fn()
    const onReplaySlower = vi.fn()
    const onContinue = vi.fn()
    const props = createProps({ onListen, onReplaySlower, onContinue })
    render(<ShadowingPractice {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Play sentence' }))
    fireEvent.click(screen.getByRole('button', { name: /Slower 0.55/ }))
    fireEvent.click(screen.getByRole('button', { name: /Ready to repeat/ }))
    fireEvent.click(screen.getByRole('button', { name: /I repeated it/ }))
    fireEvent.click(screen.getByRole('button', { name: /Next sentence/ }))

    expect(onListen).toHaveBeenCalledOnce()
    expect(onReplaySlower).toHaveBeenCalledOnce()
    expect(onContinue).toHaveBeenCalledOnce()
    expect('onSrsCommit' in props).toBe(false)
    expect('onSubmitAnswer' in props).toBe(false)
  })

  it('disables practice progression when speech is unavailable', () => {
    render(<ShadowingPractice {...createProps({ speechSupported: false })} />)

    expect(screen.getByRole('status').textContent).toContain('not available')
    expect(
      screen.getByRole('button', { name: /Ready to repeat/ }).hasAttribute('disabled'),
    ).toBe(true)
  })
})
