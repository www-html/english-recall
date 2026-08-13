import { describe, expect, it, vi } from 'vitest'
import type { DiagnosticRepository } from './contracts.ts'
import { createDiagnosticRecorder } from './diagnostics.ts'

describe('best-effort diagnostic recorder', () => {
  it('does not throw when diagnostics storage fails', () => {
    const repository = {
      append: vi.fn(() => {
        throw new Error('storage unavailable')
      }),
    } as unknown as DiagnosticRepository
    const record = createDiagnosticRecorder(
      repository,
      '0.1.0',
      () => '2026-08-13T12:00:00.000Z',
    )

    expect(() =>
      record({ level: 'error', event: 'persistence_failed' }),
    ).not.toThrow()
  })

  it('adds local timestamp and app version without learner text', () => {
    const append = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const record = createDiagnosticRecorder(
      { append },
      '0.1.0',
      () => '2026-08-13T12:00:00.000Z',
    )

    record({
      level: 'info',
      event: 'answer_correct',
      targetId: 'target-1',
      result: 'good',
    })

    expect(append).toHaveBeenCalledWith({
      timestamp: '2026-08-13T12:00:00.000Z',
      appVersion: '0.1.0',
      level: 'info',
      event: 'answer_correct',
      targetId: 'target-1',
      result: 'good',
    })
  })
})
