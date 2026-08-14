// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsScreen } from './SettingsScreen.tsx'

function renderSettings(overrides: Record<string, unknown> = {}) {
  const props = {
    learningMode: 'auto' as const,
    autoAdvance: false,
    audioEnabled: true,
    speechRate: 0.9,
    slowerSpeechRate: 0.55,
    storageAvailable: true,
    notice: undefined,
    onLearningModeChange: vi.fn(),
    onAutoAdvanceChange: vi.fn(),
    onAudioEnabledChange: vi.fn(),
    onSpeechRateChange: vi.fn(),
    onSlowerSpeechRateChange: vi.fn(),
    onImportExcel: vi.fn(),
    onDownloadExcelTemplate: vi.fn(),
    onImportJson: vi.fn(),
    onExportBackup: vi.fn(),
    onRestoreBackup: vi.fn(),
    onExportDiagnostics: vi.fn(),
    onClearDiagnostics: vi.fn(),
    onOpenHome: vi.fn(),
    onOpenLessons: vi.fn(),
    onOpenSaved: vi.fn(),
    onOpenProgress: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<SettingsScreen {...props} />) }
}

afterEach(cleanup)

describe('SettingsScreen', () => {
  it('organizes learning, audio, content, data, and diagnostics', () => {
    renderSettings()
    expect(screen.getByRole('heading', { name: 'Learning' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Audio' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Content' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Data' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Diagnostics' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: /Slower replay rate/ })).toBeTruthy()
  })

  it('updates the independently configured slower replay rate', () => {
    const onSlowerSpeechRateChange = vi.fn()
    renderSettings({ onSlowerSpeechRateChange })

    fireEvent.change(screen.getByRole('slider', { name: /Slower replay rate/ }), {
      target: { value: '0.65' },
    })

    expect(onSlowerSpeechRateChange).toHaveBeenCalledWith(0.65)
  })

  it('connects Excel, template, JSON, backup, and diagnostics actions', () => {
    const onImportExcel = vi.fn()
    const onImportJson = vi.fn()
    const onDownloadExcelTemplate = vi.fn()
    const onClearDiagnostics = vi.fn()
    const { container } = renderSettings({
      onImportExcel,
      onImportJson,
      onDownloadExcelTemplate,
      onClearDiagnostics,
    })

    const inputs = container.querySelectorAll('input[type="file"]')
    fireEvent.change(inputs[0]!, { target: { files: [new File(['x'], 'lessons.xlsx')] } })
    expect(onImportExcel).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: /Download Excel template/ }))
    expect(onDownloadExcelTemplate).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByText('Advanced JSON import'))
    fireEvent.change(inputs[1]!, { target: { files: [new File(['{}'], 'pack.json')] } })
    expect(onImportJson).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Clear Diagnostics' }))
    expect(onClearDiagnostics).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClearDiagnostics).toHaveBeenCalledOnce()
  })
})
