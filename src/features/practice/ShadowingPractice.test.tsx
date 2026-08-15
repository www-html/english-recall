// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShadowingPractice, type ShadowingPracticeProps } from './ShadowingPractice.tsx'

const sentence = {
  id: 'status-update',
  displayText: 'I finished the port mapping.',
  translationVi: 'Tôi đã hoàn thành ánh xạ cổng.',
  explanation: 'Use the past simple for completed work.',
} as const

const originalSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

function setSecureContext(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value })
}

function createProps(overrides: Partial<ShadowingPracticeProps> = {}): ShadowingPracticeProps {
  return {
    lessonTitle: 'Daily Project Update',
    sentence,
    currentStep: 1,
    totalSteps: 2,
    speechSupported: true,
    speaking: false,
    slowerSpeechRate: 0.55,
    onListen: vi.fn(),
    onReplaySlower: vi.fn(),
    onContinue: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  }
}

class MockMediaRecorder {
  static capturedData = new Blob(['voice'], { type: 'audio/webm' })
  readonly mimeType = 'audio/webm'
  state: RecordingState = 'inactive'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onstop: ((event: Event) => void) | null = null
  constructor(_stream: MediaStream) {}
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: MockMediaRecorder.capturedData } as BlobEvent)
    this.onstop?.(new Event('stop'))
  }
}

function createStream() {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
}

function installRecordingMocks(getUserMedia = vi.fn().mockResolvedValue(createStream())) {
  setSecureContext(true)
  vi.stubGlobal('MediaRecorder', MockMediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:local-recording') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  return getUserMedia
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  MockMediaRecorder.capturedData = new Blob(['voice'], { type: 'audio/webm' })
  if (originalSecureContext) Object.defineProperty(window, 'isSecureContext', originalSecureContext)
  else Reflect.deleteProperty(window, 'isSecureContext')
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  else Reflect.deleteProperty(navigator, 'mediaDevices')
  if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
  else Reflect.deleteProperty(URL, 'createObjectURL')
  if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('ShadowingPractice', () => {
  it('keeps the complete workflow in one UI and requests the microphone only from Record', async () => {
    const getUserMedia = installRecordingMocks()
    render(<ShadowingPractice {...createProps()} />)

    expect(screen.getByRole('heading', { name: 'Listen, repeat, compare.' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show sentence' })).toBeTruthy()
    expect(getUserMedia).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeTruthy()
  })

  it('records, plays locally, re-records, reveals, and continues without SRS callbacks', async () => {
    installRecordingMocks()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const onContinue = vi.fn()
    const props = createProps({ onContinue })
    render(<ShadowingPractice {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Play my voice' }))
    expect(play).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Record again' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show sentence' }))
    expect(screen.getByText(sentence.displayText)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onContinue).toHaveBeenCalledOnce()
    expect('onSrsCommit' in props).toBe(false)
    expect('onSubmitAnswer' in props).toBe(false)
  })

  it('removes Record and explains the HTTPS requirement on insecure mobile origins', () => {
    setSecureContext(false)
    render(<ShadowingPractice {...createProps()} />)

    expect(screen.getByText(/Microphone requires HTTPS or localhost/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show sentence' }))
    expect(screen.getByText(sentence.displayText)).toBeTruthy()
  })

  it('supports unsupported, denied, and empty recording states without blocking navigation', async () => {
    setSecureContext(true)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    vi.stubGlobal('MediaRecorder', undefined)
    const unsupported = render(<ShadowingPractice {...createProps()} />)
    expect(screen.getByText(/browser cannot record audio/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
    unsupported.unmount()

    installRecordingMocks(vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')))
    const denied = render(<ShadowingPractice {...createProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(await screen.findByText(/Microphone access was denied/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try recording again' })).toBeTruthy()
    denied.unmount()

    MockMediaRecorder.capturedData = new Blob([])
    installRecordingMocks()
    render(<ShadowingPractice {...createProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(await screen.findByText(/No audio was captured/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try recording again' })).toBeTruthy()
  })

  it('revokes temporary Blob URLs on replacement, sentence change, exit, and unmount', async () => {
    installRecordingMocks()
    const props = createProps()
    const view = render(<ShadowingPractice {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Record again' }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-recording')

    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    view.rerender(<ShadowingPractice {...props} sentence={{ ...sentence, id: 'next' }} />)
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exit shadowing' }))
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
    view.unmount()

    render(<ShadowingPractice {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    cleanup()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4)
  })

  it('keeps Previous and Next stable, and uses Finish on the final sentence', () => {
    installRecordingMocks()
    const onPrevious = vi.fn()
    const onContinue = vi.fn()
    render(<ShadowingPractice {...createProps({ currentStep: 2, totalSteps: 2, onPrevious, onContinue })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(onPrevious).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Finish' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Show sentence' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('supports the compact Space flow and remains usable without reference audio', () => {
    setSecureContext(false)
    const onListen = vi.fn()
    const onContinue = vi.fn()
    const view = render(<ShadowingPractice {...createProps({ onListen, onContinue })} />)
    fireEvent.keyDown(window, { key: ' ' })
    expect(onListen).toHaveBeenCalledOnce()
    fireEvent.keyDown(window, { key: ' ' })
    expect(screen.getByText(sentence.displayText)).toBeTruthy()
    fireEvent.keyDown(window, { key: ' ' })
    expect(onContinue).toHaveBeenCalledOnce()
    view.unmount()

    render(<ShadowingPractice {...createProps({ speechSupported: false })} />)
    expect(screen.getByText(/Reference audio is unavailable/)).toBeTruthy()
    fireEvent.keyDown(window, { key: ' ' })
    expect(screen.getByText(sentence.displayText)).toBeTruthy()
  })
})
