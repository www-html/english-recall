// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShadowingPractice, type ShadowingPracticeProps } from './ShadowingPractice.tsx'

const sentence = {
  id: 'status-update',
  displayText: 'I finished the port mapping.',
  translationVi: 'Tôi đã hoàn thành ánh xạ cổng.',
  explanation: 'Use the past simple for completed work.',
} as const

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

function createProps(
  overrides: Partial<ShadowingPracticeProps> = {},
): ShadowingPracticeProps {
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

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: MockMediaRecorder.capturedData } as BlobEvent)
    this.onstop?.(new Event('stop'))
  }
}

function createStream() {
  return {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream
}

function installRecordingMocks(
  getUserMedia: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(createStream()),
) {
  vi.stubGlobal('MediaRecorder', MockMediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:local-recording'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
  return getUserMedia
}

function enterRepeat() {
  fireEvent.click(screen.getByRole('button', { name: 'Play sentence' }))
  fireEvent.click(screen.getByRole('button', { name: /Ready to repeat/ }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  MockMediaRecorder.capturedData = new Blob(['voice'], { type: 'audio/webm' })
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  else Reflect.deleteProperty(navigator, 'mediaDevices')
  if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
  else Reflect.deleteProperty(URL, 'createObjectURL')
  if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('ShadowingPractice', () => {
  it('requests microphone permission only after the learner explicitly presses Record', async () => {
    const getUserMedia = installRecordingMocks()
    render(<ShadowingPractice {...createProps()} />)

    expect(getUserMedia).not.toHaveBeenCalled()
    enterRepeat()
    expect(getUserMedia).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Record my voice' }))

    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(screen.getByRole('button', { name: /I repeated it/ }).hasAttribute('disabled')).toBe(true)
    expect(await screen.findByRole('button', { name: 'Stop recording' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /I repeated it/ }).hasAttribute('disabled')).toBe(true)
  })

  it('records, stops, plays locally, and allows re-recording', async () => {
    installRecordingMocks()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    render(<ShadowingPractice {...createProps()} />)
    enterRepeat()

    fireEvent.click(screen.getByRole('button', { name: 'Record my voice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))

    expect(await screen.findByRole('button', { name: 'Play recording' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Play recording' }))
    expect(play).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Record again' })).toBeTruthy()
    expect(URL.createObjectURL).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: /I repeated it/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Play recording' }))
    expect(play).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('button', { name: 'Record again' })).toBeTruthy()
  })

  it('falls back cleanly when recording is denied, unsupported, or empty', async () => {
    const denied = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    installRecordingMocks(denied)
    const { unmount } = render(<ShadowingPractice {...createProps()} />)
    enterRepeat()
    fireEvent.click(screen.getByRole('button', { name: 'Record my voice' }))
    expect(await screen.findByText(/Microphone access was denied/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /I repeated it/ })).toBeTruthy()
    unmount()

    vi.unstubAllGlobals()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    render(<ShadowingPractice {...createProps()} />)
    enterRepeat()
    fireEvent.click(screen.getByRole('button', { name: 'Record my voice' }))
    expect(screen.getByText(/Recording is not supported/)).toBeTruthy()
    cleanup()

    MockMediaRecorder.capturedData = new Blob([])
    installRecordingMocks()
    render(<ShadowingPractice {...createProps()} />)
    enterRepeat()
    fireEvent.click(screen.getByRole('button', { name: 'Record my voice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
    expect(await screen.findByText(/No audio was captured/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /I repeated it/ })).toBeTruthy()
  })

  it('revokes Blob URLs on replacement, sentence change, exit, and unmount', async () => {
    installRecordingMocks()
    const props = createProps()
    const first = render(<ShadowingPractice {...props} />)
    enterRepeat()
    fireEvent.click(screen.getByRole('button', { name: 'Record my voice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Record again' }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-recording')

    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
    first.rerender(
      <ShadowingPractice {...props} sentence={{ ...sentence, id: 'next-sentence' }} />,
    )
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2))

    enterRepeat()
    fireEvent.click(screen.getByRole('button', { name: 'Record my voice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
    first.unmount()

    render(<ShadowingPractice {...props} />)
    enterRepeat()
    fireEvent.click(screen.getByRole('button', { name: 'Record my voice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }))
    cleanup()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4)
  })

  it('keeps comparison and completion presentation-only without an SRS callback', () => {
    installRecordingMocks()
    const onContinue = vi.fn()
    const props = createProps({ onContinue })
    render(<ShadowingPractice {...props} />)
    enterRepeat()
    fireEvent.click(screen.getByRole('button', { name: /I repeated it/ }))

    expect(screen.getByText(sentence.displayText)).toBeTruthy()
    expect(screen.getByText(sentence.translationVi)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Next sentence/ }))
    expect(onContinue).toHaveBeenCalledOnce()
    expect('onSrsCommit' in props).toBe(false)
    expect('onSubmitAnswer' in props).toBe(false)
    expect('onScore' in props).toBe(false)
  })

  it('allows Repeat to continue when reference audio is unavailable', () => {
    render(<ShadowingPractice {...createProps({ speechSupported: false })} />)

    expect(screen.getByText(/Audio is not available/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Ready to repeat/ }).hasAttribute('disabled')).toBe(false)
  })
})
