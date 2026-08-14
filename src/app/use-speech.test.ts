// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSlowerSpeechRate,
  shouldAllowLearningSpeech,
  useSpeech,
} from './use-speech.ts'

const cancel = vi.fn()

beforeEach(() => {
  cancel.mockReset()
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { cancel, speak: vi.fn() },
  })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  })
})

describe('getSlowerSpeechRate', () => {
  it('makes slower replay clearly slower than the configured normal rate', () => {
    expect(getSlowerSpeechRate(0.9)).toBe(0.54)
    expect(getSlowerSpeechRate(1.2)).toBe(0.72)
  })

  it('keeps the replay rate within a usable lower bound', () => {
    expect(getSlowerSpeechRate(0.6)).toBe(0.5)
  })
})

describe('learning speech boundaries', () => {
  it('allows automatic speech only on an active Learning screen', () => {
    expect(shouldAllowLearningSpeech('learning', 'active')).toBe(true)
    expect(shouldAllowLearningSpeech('home', 'active')).toBe(false)
    expect(shouldAllowLearningSpeech('learning', 'paused')).toBe(false)
    expect(shouldAllowLearningSpeech('summary', 'completed')).toBe(false)
  })

  it('stops speech when the PWA is hidden or leaves the page', () => {
    renderHook(() => useSpeech())

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(cancel).toHaveBeenCalledOnce()

    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(cancel).toHaveBeenCalledTimes(2)
  })
})
