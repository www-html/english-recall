// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionResult } from '../../learning-engine/index.ts'
import { SummaryScreen } from './SummaryScreen.tsx'

afterEach(cleanup)

describe('SummaryScreen result semantics', () => {
  it('labels raw incorrect attempts and unique difficult words accurately', () => {
    const result: SessionResult = {
      reviewedLexemes: 8,
      completedTargets: 10,
      difficultLexemes: 3,
      correctAnswers: 10,
      incorrectAnswers: 5,
      skippedTargets: 0,
      practiceTargets: 0,
      accuracyPercent: 67,
      completedAt: '2026-08-13T00:00:00.000Z',
    }

    render(
      <SummaryScreen
        lessonTitle="Daily English"
        result={result}
        onHome={vi.fn()}
        nextActionLabel="Continue Learning"
        onNext={vi.fn()}
      />,
    )

    expect(within(screen.getByText('wrong attempts')).getByText('5')).toBeTruthy()
    expect(within(screen.getByText('difficult words')).getByText('3')).toBeTruthy()
    expect(screen.queryByText('to review')).toBeNull()
  })

  it('does not claim practice-only work changed the review schedule', () => {
    const result: SessionResult = {
      reviewedLexemes: 0,
      completedTargets: 2,
      difficultLexemes: 0,
      correctAnswers: 2,
      incorrectAnswers: 0,
      skippedTargets: 0,
      practiceTargets: 2,
      accuracyPercent: 100,
      completedAt: '2026-08-13T00:00:00.000Z',
    }
    render(
      <SummaryScreen
        lessonTitle="Practice"
        result={result}
        onHome={vi.fn()}
        nextActionLabel="Extra Practice"
        onNext={vi.fn()}
      />,
    )

    expect(screen.getByText(/review schedule did not change/)).toBeTruthy()
    expect(screen.queryByText(/next review is now scheduled/)).toBeNull()
  })

  it('uses the provided next bounded-session action', () => {
    const onNext = vi.fn()
    render(
      <SummaryScreen
        lessonTitle="Daily English"
        result={{
          reviewedLexemes: 1,
          completedTargets: 1,
          difficultLexemes: 0,
          correctAnswers: 1,
          incorrectAnswers: 0,
          skippedTargets: 0,
          practiceTargets: 0,
          accuracyPercent: 100,
          completedAt: '2026-08-13T00:00:00.000Z',
        }}
        onHome={vi.fn()}
        nextActionLabel="Continue Learning"
        onNext={onNext}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Continue Learning/ }))
    expect(onNext).toHaveBeenCalledOnce()
  })
})
