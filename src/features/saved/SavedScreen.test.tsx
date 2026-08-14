// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SavedScreen,
  type SavedSentenceViewModel,
  type SavedSentencesState,
} from './SavedScreen.tsx'

const savedSentence: SavedSentenceViewModel = {
  key: 'starter::morning',
  packId: 'starter',
  sentenceId: 'morning',
  packTitle: 'Starter English',
  lessonTitle: 'Daily routines',
  topic: 'Routines',
  sentenceText: 'I usually drink coffee.',
  translationVi: 'Tôi thường uống cà phê.',
}

function renderScreen(
  state: SavedSentencesState,
  overrides: Partial<ComponentProps<typeof SavedScreen>> = {},
) {
  const props: ComponentProps<typeof SavedScreen> = {
    state,
    storageAvailable: true,
    notice: undefined,
    onRetry: vi.fn(),
    onRemove: vi.fn(),
    onPractice: vi.fn(),
    onOpenHome: vi.fn(),
    onOpenLessons: vi.fn(),
    onOpenSaved: vi.fn(),
    onOpenProgress: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  }
  render(<SavedScreen {...props} />)
  return props
}

afterEach(cleanup)

describe('SavedScreen', () => {
  it('renders loading, empty and error states with recovery actions', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <SavedScreen
        {...renderProps({ status: 'loading' })}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('Loading')

    rerender(<SavedScreen {...renderProps({ status: 'ready', items: [] })} />)
    expect(screen.getByText('No saved sentences yet')).toBeTruthy()

    const onRetry = vi.fn()
    rerender(
      <SavedScreen
        {...renderProps({ status: 'error', message: 'Storage is unavailable.' }, { onRetry })}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Retry/ }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows sentence context and delegates practice and remove actions', async () => {
    const user = userEvent.setup()
    const onPractice = vi.fn()
    const onRemove = vi.fn().mockResolvedValue(undefined)
    renderScreen(
      { status: 'ready', items: [savedSentence] },
      { onPractice, onRemove },
    )

    expect(screen.getByText('Starter English')).toBeTruthy()
    expect(screen.getByText('Daily routines')).toBeTruthy()
    expect(screen.getByText('Routines')).toBeTruthy()
    expect(screen.getByText('I usually drink coffee.')).toBeTruthy()
    expect(screen.getByText('Tôi thường uống cà phê.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Practice' }))
    expect(onPractice).toHaveBeenCalledWith(savedSentence)

    await user.click(screen.getByRole('button', { name: /Remove/ }))
    expect(onRemove).toHaveBeenCalledWith(savedSentence)
  })
})

function renderProps(
  state: SavedSentencesState,
  overrides: Partial<ComponentProps<typeof SavedScreen>> = {},
): ComponentProps<typeof SavedScreen> {
  return {
    state,
    storageAvailable: true,
    notice: undefined,
    onRetry: vi.fn(),
    onRemove: vi.fn(),
    onPractice: vi.fn(),
    onOpenHome: vi.fn(),
    onOpenLessons: vi.fn(),
    onOpenSaved: vi.fn(),
    onOpenProgress: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  }
}
