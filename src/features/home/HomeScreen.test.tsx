// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomeScreen, type HomeScreenProps } from './HomeScreen.tsx'

function createProps(overrides: Partial<HomeScreenProps> = {}): HomeScreenProps {
  return {
    packs: [],
    reviewCount: 8,
    newCount: 4,
    estimatedMinutes: 7,
    statistics: {
      wordsReviewed: 24,
      masteredWords: 9,
      accuracyPercent: 83,
    },
    learningMode: 'auto',
    canResume: false,
    storageAvailable: true,
    notice: undefined,
    onStartLearning: vi.fn(),
    onResume: vi.fn(),
    onLearningModeChange: vi.fn(),
    onStartLesson: vi.fn(),
    onImport: vi.fn(),
    ...overrides,
  }
}

afterEach(cleanup)

describe('HomeScreen daily-first flow', () => {
  it('leads with today counts and starts the daily session', () => {
    const onStartLearning = vi.fn()
    render(<HomeScreen {...createProps({ onStartLearning })} />)

    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy()
    expect(screen.getByText('12 words ready')).toBeTruthy()
    expect(screen.getByText('~7 min')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Start Learning/ }))
    expect(onStartLearning).toHaveBeenCalledOnce()
  })

  it('continues a saved session and exposes all learning modes in a select', () => {
    const onResume = vi.fn()
    const onLearningModeChange = vi.fn()
    render(
      <HomeScreen
        {...createProps({ canResume: true, onResume, onLearningModeChange })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Continue Learning/ }))
    expect(onResume).toHaveBeenCalledOnce()
    expect(screen.getByText(/completed progress is already saved/i)).toBeTruthy()

    const select = screen.getByRole('combobox', { name: 'Learning mode' })
    expect(screen.getAllByRole('option')).toHaveLength(4)
    fireEvent.change(select, { target: { value: 'listening-choice' } })
    expect(onLearningModeChange).toHaveBeenCalledWith('listening-choice')
  })
})
