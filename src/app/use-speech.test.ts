// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nativeMocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => 'web'),
  isSupported: vi.fn(),
  speak: vi.fn(),
  stop: vi.fn(),
  addListener: vi.fn(),
  remove: vi.fn(),
  stateListener: undefined as ((state: { speaking: boolean }) => void) | undefined,
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: nativeMocks.isNativePlatform,
    getPlatform: nativeMocks.getPlatform,
  },
  registerPlugin: () => ({
    isSupported: nativeMocks.isSupported,
    speak: nativeMocks.speak,
    stop: nativeMocks.stop,
    addListener: nativeMocks.addListener,
  }),
}))
import {
  getSlowerSpeechRate,
  shouldAllowLearningSpeech,
  useSpeech,
} from './use-speech.ts'

const cancel = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  cancel.mockReset()
  nativeMocks.isNativePlatform.mockReturnValue(false)
  nativeMocks.getPlatform.mockReturnValue('web')
  nativeMocks.isSupported.mockResolvedValue({ supported: true })
  nativeMocks.speak.mockResolvedValue(undefined)
  nativeMocks.stop.mockResolvedValue(undefined)
  nativeMocks.remove.mockResolvedValue(undefined)
  nativeMocks.stateListener = undefined
  nativeMocks.addListener.mockImplementation(async (_event, listener) => {
    nativeMocks.stateListener = listener
    return { remove: nativeMocks.remove }
  })
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
  it('uses native Android TTS and tracks native speaking events', async () => {
    nativeMocks.isNativePlatform.mockReturnValue(true)
    nativeMocks.getPlatform.mockReturnValue('android')
    const hook = renderHook(() => useSpeech())

    await waitFor(() => expect(nativeMocks.isSupported).toHaveBeenCalledOnce())
    act(() => hook.result.current.speak('Please check the status.', 0.9))
    expect(nativeMocks.speak).toHaveBeenCalledWith({
      text: 'Please check the status.',
      rate: 0.9,
    })
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled()
    expect(hook.result.current.speaking).toBe(true)

    act(() => nativeMocks.stateListener?.({ speaking: false }))
    expect(hook.result.current.speaking).toBe(false)

    act(() => hook.result.current.stop())
    expect(nativeMocks.stop).toHaveBeenCalledOnce()
    hook.unmount()
    await waitFor(() => expect(nativeMocks.remove).toHaveBeenCalledOnce())
  })

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
