// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => 'web'),
  addListener: vi.fn(),
  exitApp: vi.fn(),
  remove: vi.fn(),
  listener: undefined as (() => void | Promise<void>) | undefined,
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: mocks.isNativePlatform,
    getPlatform: mocks.getPlatform,
  },
}))
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: mocks.addListener,
    exitApp: mocks.exitApp,
  },
}))

import { useAndroidBackButton } from './use-android-back.ts'

describe('useAndroidBackButton', () => {
  beforeEach(() => {
    mocks.isNativePlatform.mockReturnValue(false)
    mocks.getPlatform.mockReturnValue('web')
    mocks.addListener.mockImplementation(async (_event, listener) => {
      mocks.listener = listener
      return { remove: mocks.remove }
    })
    mocks.exitApp.mockResolvedValue(undefined)
    mocks.remove.mockResolvedValue(undefined)
    mocks.listener = undefined
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('does not register native listeners in the web app', () => {
    renderHook(() => useAndroidBackButton(() => true))
    expect(mocks.addListener).not.toHaveBeenCalled()
  })

  it('exits Android only when the application callback reports the root view', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    mocks.getPlatform.mockReturnValue('android')
    const onBack = vi.fn(() => false)
    const view = renderHook(() => useAndroidBackButton(onBack))
    await waitFor(() => expect(mocks.addListener).toHaveBeenCalledWith('backButton', expect.any(Function)))

    await act(async () => mocks.listener?.())
    expect(onBack).toHaveBeenCalledOnce()
    expect(mocks.exitApp).toHaveBeenCalledOnce()

    view.unmount()
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce())
  })

  it('keeps Android open when an in-app navigation action handled Back', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    mocks.getPlatform.mockReturnValue('android')
    renderHook(() => useAndroidBackButton(() => true))
    await waitFor(() => expect(mocks.listener).toBeTypeOf('function'))

    await act(async () => mocks.listener?.())
    expect(mocks.exitApp).not.toHaveBeenCalled()
  })
})
