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
    onExportBackup: vi.fn(),
    onRestoreBackup: vi.fn(),
    onExportDiagnostics: vi.fn(),
    onClearDiagnostics: vi.fn(),
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

  it('continues a saved session and exposes an accessible mode selector', () => {
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

    const selector = screen.getByRole('radiogroup', { name: 'Learning mode' })
    const options = screen.getAllByRole('radio')
    expect(options).toHaveLength(4)
    expect(options[0]?.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Listening Choice' }))
    expect(onLearningModeChange).toHaveBeenCalledWith('listening-choice')
    expect(selector).toBeTruthy()
  })

  it('supports arrow-key selection without adding extra tab stops', () => {
    const onLearningModeChange = vi.fn()
    render(<HomeScreen {...createProps({ onLearningModeChange })} />)

    const auto = screen.getByRole('radio', { name: 'Auto' })
    const wordChoice = screen.getByRole('radio', { name: 'Word Choice' })
    auto.focus()
    fireEvent.keyDown(auto, { key: 'ArrowRight' })

    expect(onLearningModeChange).toHaveBeenCalledWith('word-choice')
    expect(document.activeElement).toBe(wordChoice)
    expect(screen.getByRole('radio', { name: 'Fill Words' }).tabIndex).toBe(-1)
  })

  it('reuses Home for backup export and restore without changing the primary flow', () => {
    const onExportBackup = vi.fn()
    const onRestoreBackup = vi.fn()
    const { container } = render(
      <HomeScreen
        {...createProps({ onExportBackup, onRestoreBackup })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export backup' }))
    expect(onExportBackup).toHaveBeenCalledOnce()

    const backupInput = container.querySelectorAll('input[type="file"]')[1]
    const backup = new File(['{}'], 'backup.json', { type: 'application/json' })
    expect(backupInput).toBeTruthy()
    fireEvent.change(backupInput as HTMLInputElement, {
      target: { files: [backup] },
    })
    expect(onRestoreBackup).toHaveBeenCalledWith(backup)
  })

  it('exports and confirms before clearing local diagnostics', () => {
    const onExportDiagnostics = vi.fn()
    const onClearDiagnostics = vi.fn()
    render(
      <HomeScreen
        {...createProps({ onExportDiagnostics, onClearDiagnostics })}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Export Diagnostics JSON' }),
    )
    expect(onExportDiagnostics).toHaveBeenCalledOnce()

    const clearDiagnostics = screen.getByRole('button', {
      name: 'Clear Diagnostics',
    })
    clearDiagnostics.focus()
    fireEvent.click(clearDiagnostics)
    expect(onClearDiagnostics).not.toHaveBeenCalled()
    expect(clearDiagnostics.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(clearDiagnostics)
    expect(screen.getByRole('alert').textContent).toContain(
      'Clear local diagnostics?',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClearDiagnostics).toHaveBeenCalledOnce()
  })
})
