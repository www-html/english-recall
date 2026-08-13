// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary.tsx'

function BrokenView(): never {
  throw new Error('private diagnostic detail')
}

describe('AppErrorBoundary', () => {
  it('shows a safe recovery action without exposing the stack or error', () => {
    const reload = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <AppErrorBoundary onReload={reload}>
        <BrokenView />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert').textContent).not.toContain(
      'private diagnostic detail',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reload application' }))
    expect(reload).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})
