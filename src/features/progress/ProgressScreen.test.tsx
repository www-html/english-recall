// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionCompletionRecord } from '../../persistence/contracts.ts'
import { ProgressScreen, type ProgressScreenState } from './ProgressScreen.tsx'

const navigation = {
  onOpenHome: vi.fn(),
  onOpenLessons: vi.fn(),
  onOpenSaved: vi.fn(),
  onOpenProgress: vi.fn(),
  onOpenSettings: vi.fn(),
}

const record: SessionCompletionRecord = {
  learnerId: 'default',
  sessionId: 'session-1',
  packId: 'pack-1',
  lessonId: 'lesson-1',
  startedAt: '2026-08-12T14:00:00.000Z',
  completedAt: '2026-08-12T14:05:00.000Z',
  reviewedLexemeIds: ['go'],
  newlyLearnedLexemeIds: ['go'],
  masteredLexemeIds: [],
  difficultLexemeIds: [],
  correctAnswers: 2,
  incorrectAnswers: 1,
  skippedTargets: 0,
}

function renderProgress(state: ProgressScreenState, onRetry = vi.fn()) {
  return render(
    <ProgressScreen
      {...navigation}
      state={state}
      storageAvailable
      notice={undefined}
      onRetry={onRetry}
      now={new Date('2026-08-13T12:00:00.000Z')}
      timeZone="America/Bogota"
    />,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ProgressScreen', () => {
  it('renders loading and retryable error states', () => {
    const { rerender } = renderProgress({ status: 'loading' })
    expect(screen.getByRole('status').textContent).toContain('Loading progress')

    const onRetry = vi.fn()
    rerender(
      <ProgressScreen
        {...navigation}
        state={{ status: 'error', message: 'History could not be read.' }}
        storageAvailable
        notice={undefined}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain('History could not be read.')
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows a useful empty state without inventing historical buckets', () => {
    renderProgress({ status: 'ready', history: [], packs: [] })
    expect(screen.getByRole('heading', { name: 'No completed sessions yet' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start learning' }))
    expect(navigation.onOpenHome).toHaveBeenCalledOnce()
  })

  it('shows weekly and monthly facts from completed session history', () => {
    renderProgress({ status: 'ready', history: [record], packs: [] })
    expect(screen.getByRole('heading', { name: /Aug 10/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeTruthy()
    expect(screen.getAllByText('67%')).toHaveLength(2)
    expect(
      screen.getAllByText((_, element) => element?.textContent === '1 newly learned'),
    ).toHaveLength(2)
    expect(screen.getByText('No difficult words recorded this month.')).toBeTruthy()
  })
})
