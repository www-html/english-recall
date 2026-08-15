import {
  ArrowLeft,
  ArrowRight,
  Check,
  Gauge,
  Headphones,
  MessageCircle,
  Mic,
  Play,
  RotateCcw,
  Square,
  Volume2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import './practice.css'

export type ShadowingPhase = 'listen' | 'repeat' | 'compare'

type RecordingState =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'recorded'
  | 'unavailable'
  | 'denied'
  | 'empty'
  | 'error'

export interface ShadowingSentence {
  readonly id: string
  readonly displayText: string
  readonly translationVi: string
  readonly explanation?: string
}

/**
 * Presentation-only practice. Deliberately exposes no answer, mastery, or SRS
 * callback: finishing a shadowing sentence can only navigate to the next item.
 */
export interface ShadowingPracticeProps {
  readonly lessonTitle: string
  readonly sentence: ShadowingSentence
  readonly currentStep: number
  readonly totalSteps: number
  readonly speechSupported: boolean
  readonly speaking: boolean
  readonly slowerSpeechRate: number
  readonly onListen: () => void
  readonly onReplaySlower: () => void
  readonly onContinue: () => void
  readonly onExit: () => void
}

const PHASE_COPY: Readonly<Record<ShadowingPhase, {
  readonly step: number
  readonly eyebrow: string
  readonly title: string
  readonly guidance: string
}>> = {
  listen: {
    step: 1,
    eyebrow: 'Listen',
    title: 'Focus on rhythm and stress.',
    guidance: 'Play the sentence at least once. Keep the English hidden while you listen.',
  },
  repeat: {
    step: 2,
    eyebrow: 'Record / Repeat',
    title: 'Say it aloud with the speaker.',
    guidance: 'Repeat from memory, or optionally record yourself to compare on this device.',
  },
  compare: {
    step: 3,
    eyebrow: 'Compare',
    title: 'Check the sentence, then try once more.',
    guidance: 'Notice the words or sounds that felt different when you repeated it.',
  },
}

export function ShadowingPractice({
  lessonTitle,
  sentence,
  currentStep,
  totalSteps,
  speechSupported,
  speaking,
  slowerSpeechRate,
  onListen,
  onReplaySlower,
  onContinue,
  onExit,
}: ShadowingPracticeProps) {
  const [phase, setPhase] = useState<ShadowingPhase>('listen')
  const [hasListened, setHasListened] = useState(false)
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingUrlRef = useRef<string | null>(null)
  const recordingSessionRef = useRef(0)
  const phaseCopy = PHASE_COPY[phase]

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const revokeRecordingUrl = useCallback(() => {
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current)
      recordingUrlRef.current = null
    }
    setRecordingUrl(null)
  }, [])

  const resetRecording = useCallback(() => {
    recordingSessionRef.current += 1
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onerror = null
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    stopStream()
    chunksRef.current = []
    revokeRecordingUrl()
    setRecordingState('idle')
  }, [revokeRecordingUrl, stopStream])

  useEffect(() => {
    setPhase('listen')
    setHasListened(false)
    resetRecording()
  }, [resetRecording, sentence.id])

  useEffect(() => () => {
    recordingSessionRef.current += 1
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onerror = null
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    stopStream()
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
  }, [stopStream])

  const exit = useCallback(() => {
    resetRecording()
    onExit()
  }, [onExit, resetRecording])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return
      const interactiveTarget =
        event.target instanceof Element &&
        event.target.closest('button, input, textarea, select, a, [contenteditable="true"]')

      if (event.key === 'Escape' && !interactiveTarget) {
        event.preventDefault()
        exit()
      } else if (event.key === 'ArrowUp' && !interactiveTarget && speechSupported) {
        event.preventDefault()
        onListen()
        setHasListened(true)
      } else if (event.key === 'ArrowDown' && !interactiveTarget && speechSupported) {
        event.preventDefault()
        onReplaySlower()
        setHasListened(true)
      } else if (event.key === ' ' && !interactiveTarget) {
        if (phase === 'listen' && !hasListened && speechSupported) return
        if (phase === 'repeat' && (recordingState === 'requesting' || recordingState === 'recording')) return
        event.preventDefault()
        if (phase === 'listen') setPhase('repeat')
        else if (phase === 'repeat') setPhase('compare')
        else onContinue()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [exit, hasListened, onContinue, onListen, onReplaySlower, phase, recordingState, speechSupported])

  const listen = () => {
    setHasListened(true)
    onListen()
  }

  const listenSlower = () => {
    setHasListened(true)
    onReplaySlower()
  }

  const startRecording = async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setRecordingState('unavailable')
      return
    }

    const session = recordingSessionRef.current + 1
    recordingSessionRef.current = session
    revokeRecordingUrl()
    setRecordingState('requesting')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (recordingSessionRef.current !== session) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      streamRef.current = stream
      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        if (recordingSessionRef.current !== session) return
        recorderRef.current = null
        stopStream()
        setRecordingState('error')
      }
      recorder.onstop = () => {
        recorderRef.current = null
        stopStream()
        if (recordingSessionRef.current !== session) return

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm',
        })
        chunksRef.current = []
        if (blob.size === 0) {
          setRecordingState('empty')
          return
        }

        const url = URL.createObjectURL(blob)
        recordingUrlRef.current = url
        setRecordingUrl(url)
        setRecordingState('recorded')
      }

      recorder.start()
      setRecordingState('recording')
    } catch (error) {
      stopStream()
      if (recordingSessionRef.current !== session) return
      const errorName = error instanceof DOMException ? error.name : ''
      setRecordingState(
        errorName === 'NotAllowedError' || errorName === 'SecurityError' ? 'denied' : 'error',
      )
    }
  }

  const stopRecording = () => {
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
  }

  const playRecording = () => {
    const playResult = audioRef.current?.play()
    if (playResult) void playResult.catch(() => setRecordingState('error'))
  }

  const recordingMessage = {
    requesting: 'Waiting for microphone permission…',
    recording: 'Recording locally. Stop when you finish.',
    recorded: 'Recording ready. Play it back, then compare.',
    unavailable: 'Recording is not supported in this browser. You can keep repeating without it.',
    denied: 'Microphone access was denied. You can keep repeating without recording.',
    empty: 'No audio was captured. Try again, or keep repeating without recording.',
    error: 'Recording could not be used. You can keep repeating without it.',
    idle: 'Recording is optional and stays only on this device.',
  }[recordingState]

  return (
    <main className="shadowing-shell">
      <header className="shadowing-header">
        <button className="shadowing-icon-button" type="button" onClick={exit} aria-label="Back">
          <ArrowLeft size={19} aria-hidden="true" />
        </button>
        <div>
          <strong>{lessonTitle}</strong>
        </div>
        <span className="shadowing-position">{currentStep} / {totalSteps}</span>
      </header>

      <section className="shadowing-stage" aria-labelledby="shadowing-title">
        <div className="shadowing-progress" aria-label={`Shadowing step ${phaseCopy.step} of 3`}>
          {[1, 2, 3].map((step) => (
            <span className={step <= phaseCopy.step ? 'is-active' : ''} key={step} aria-hidden="true" />
          ))}
        </div>

        <div className="shadowing-copy">
          <span>{phaseCopy.eyebrow}</span>
          <h1 id="shadowing-title">{phaseCopy.title}</h1>
          <p>{phaseCopy.guidance}</p>
        </div>

        {phase === 'compare' ? (
          <article className="shadowing-transcript" aria-label="Sentence comparison">
            <p lang="en">{sentence.displayText}</p>
            <p lang="vi">{sentence.translationVi}</p>
            {sentence.explanation ? <p className="shadowing-explanation">{sentence.explanation}</p> : null}
          </article>
        ) : (
          <div className={`shadowing-listening-visual ${speaking ? 'is-speaking' : ''}`} aria-hidden="true">
            {phase === 'listen' ? <Headphones size={36} /> : <MessageCircle size={36} />}
          </div>
        )}

        <div className="shadowing-audio-actions" aria-label="Shadowing audio controls">
          <button type="button" disabled={!speechSupported} onClick={listen}>
            <Volume2 size={18} aria-hidden="true" />
            {phase === 'compare' ? 'Play again' : 'Play sentence'}
          </button>
          <button type="button" disabled={!speechSupported} onClick={listenSlower}>
            <Gauge size={18} aria-hidden="true" />
            Slower {slowerSpeechRate.toFixed(2)}×
          </button>
        </div>

        {!speechSupported ? (
          <p className="shadowing-error" role="status">Audio is not available in this browser.</p>
        ) : null}

        {phase === 'repeat' ? (
          <section className={`shadowing-recorder is-${recordingState}`} aria-label="Optional voice recording">
            <div className="shadowing-recorder-copy">
              <Mic size={20} aria-hidden="true" />
              <div>
                <strong>Your voice</strong>
                <p role="status" aria-live="polite">{recordingMessage}</p>
              </div>
            </div>

            <div className="shadowing-recorder-actions">
              {recordingState === 'recording' ? (
                <button type="button" onClick={stopRecording}>
                  <Square size={16} fill="currentColor" aria-hidden="true" />
                  Stop recording
                </button>
              ) : recordingState === 'recorded' ? (
                <>
                  <button type="button" onClick={playRecording}>
                    <Play size={17} fill="currentColor" aria-hidden="true" />
                    Play recording
                  </button>
                  <button type="button" onClick={() => void startRecording()}>
                    <RotateCcw size={17} aria-hidden="true" />
                    Record again
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={recordingState === 'requesting'}
                  onClick={() => void startRecording()}
                >
                  <Mic size={17} aria-hidden="true" />
                  {recordingState === 'requesting' ? 'Requesting microphone…' : 'Record my voice'}
                </button>
              )}
            </div>
          </section>
        ) : null}

        <audio
          className="shadowing-recording-audio"
          ref={audioRef}
          src={recordingUrl ?? undefined}
          preload="metadata"
        />

        {phase === 'compare' ? (
          <section className="shadowing-recording-compare" aria-label="Compare your recording">
            <div>
              <strong>Your recording</strong>
              <p>{recordingUrl ? 'Listen once more beside the reference.' : 'No recording saved for this sentence.'}</p>
            </div>
            <div className="shadowing-recorder-actions">
              {recordingUrl ? (
                <button type="button" onClick={playRecording}>
                  <Play size={17} fill="currentColor" aria-hidden="true" />
                  Play recording
                </button>
              ) : null}
              <button type="button" onClick={() => setPhase('repeat')}>
                <RotateCcw size={17} aria-hidden="true" />
                Try again
              </button>
            </div>
          </section>
        ) : null}

        <div className="shadowing-primary-action">
          {phase === 'listen' ? (
            <button
              type="button"
              disabled={speechSupported && !hasListened}
              onClick={() => setPhase('repeat')}
            >
              Ready to repeat
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          ) : phase === 'repeat' ? (
            <button
              type="button"
              disabled={recordingState === 'requesting' || recordingState === 'recording'}
              onClick={() => setPhase('compare')}
            >
              I repeated it
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" onClick={onContinue}>
              <Check size={18} aria-hidden="true" />
              Next sentence
            </button>
          )}
          <span><kbd>Space</kbd> continue · <kbd>Esc</kbd> exit</span>
        </div>
      </section>
    </main>
  )
}
