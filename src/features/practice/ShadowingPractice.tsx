import { ArrowLeft, ArrowRight, Check, Eye, Gauge, Mic, Play, RotateCcw, Square, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import './practice.css'

export type ShadowingPhase = 'practice' | 'compare'
type RecordingState = 'idle' | 'requesting' | 'recording' | 'recorded' | 'denied' | 'empty' | 'error'
type RecordingAvailability = 'available' | 'insecure' | 'unsupported'

export interface ShadowingSentence {
  readonly id: string
  readonly displayText: string
  readonly translationVi: string
  readonly explanation?: string
}

/** Presentation-only practice. It deliberately exposes no mastery/SRS callback. */
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
  readonly onPrevious?: () => void
  readonly onExit: () => void
}

function recordingAvailability(): RecordingAvailability {
  if (typeof window !== 'undefined' && window.isSecureContext !== true) return 'insecure'
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return 'unsupported'
  return 'available'
}

export function ShadowingPractice({
  lessonTitle, sentence, currentStep, totalSteps, speechSupported, speaking,
  slowerSpeechRate, onListen, onReplaySlower, onContinue, onPrevious, onExit,
}: ShadowingPracticeProps) {
  const [revealed, setRevealed] = useState(false)
  const [hasListened, setHasListened] = useState(false)
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [playingRecording, setPlayingRecording] = useState(false)
  const [activeReference, setActiveReference] = useState<'normal' | 'slower' | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingUrlRef = useRef<string | null>(null)
  const recordingSessionRef = useRef(0)
  const availability = recordingAvailability()

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const revokeRecording = useCallback(() => {
    audioRef.current?.pause()
    setPlayingRecording(false)
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
    revokeRecording()
    setRecordingState('idle')
  }, [revokeRecording, stopStream])

  useEffect(() => {
    setRevealed(false)
    setHasListened(false)
    setActiveReference(null)
    resetRecording()
  }, [resetRecording, sentence.id])

  useEffect(() => {
    if (!speaking) setActiveReference(null)
  }, [speaking])

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

  const listen = useCallback(() => {
    setHasListened(true)
    setActiveReference('normal')
    onListen()
  }, [onListen])

  const listenSlower = useCallback(() => {
    setHasListened(true)
    setActiveReference('slower')
    onReplaySlower()
  }, [onReplaySlower])

  const startRecording = useCallback(async () => {
    if (availability !== 'available') return
    const session = recordingSessionRef.current + 1
    recordingSessionRef.current = session
    revokeRecording()
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
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm' })
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
      setRecordingState(errorName === 'NotAllowedError' || errorName === 'SecurityError' ? 'denied' : 'error')
    }
  }, [availability, revokeRecording, stopStream])

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const playRecording = useCallback(() => {
    const result = audioRef.current?.play()
    if (result) void result.catch(() => setRecordingState('error'))
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return
      const interactive = event.target instanceof Element && event.target.closest('button, input, textarea, select, a, [contenteditable="true"]')
      if (interactive) return
      if (event.key === 'Escape') {
        event.preventDefault(); exit()
      } else if (event.key === 'ArrowUp' && speechSupported) {
        event.preventDefault(); listen()
      } else if (event.key === 'ArrowDown' && speechSupported) {
        event.preventDefault(); listenSlower()
      } else if (event.key === ' ') {
        event.preventDefault()
        if (recordingState === 'recording') stopRecording()
        else if (!hasListened && speechSupported) listen()
        else if (!revealed) setRevealed(true)
        else onContinue()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [exit, hasListened, listen, listenSlower, onContinue, recordingState, revealed, speechSupported, stopRecording])

  const recordingMessage = availability === 'insecure'
    ? 'Microphone requires HTTPS or localhost. You can continue without recording.'
    : availability === 'unsupported'
      ? 'This browser cannot record audio. You can continue without recording.'
      : ({
          idle: 'Optional. Removed when you leave this sentence.',
          requesting: 'Waiting for microphone permission…',
          recording: 'Recording… Tap Stop when you finish.',
          recorded: 'Ready for local playback and comparison.',
          denied: 'Microphone access was denied. You can continue without recording.',
          empty: 'No audio was captured. Try again or continue.',
          error: 'Recording failed. Try again or continue.',
        } as const)[recordingState]

  return (
    <main className="shadowing-shell">
      <header className="shadowing-header">
        <button className="shadowing-icon-button" type="button" onClick={exit} aria-label="Exit shadowing"><ArrowLeft size={19} aria-hidden="true" /></button>
        <strong title={lessonTitle}>{lessonTitle}</strong>
        <span className="shadowing-position">{currentStep} / {totalSteps}</span>
      </header>

      <section className="shadowing-stage" aria-labelledby="shadowing-title">
        <div className="shadowing-copy">
          <span>Shadowing</span>
          <h1 id="shadowing-title">Listen, repeat, compare.</h1>
          <p>Play the reference, repeat from memory, then reveal the sentence.</p>
        </div>

        <div className="shadowing-reference" aria-label="Reference audio">
          <span className={speaking ? 'is-speaking' : ''}>Reference</span>
          <div className="shadowing-audio-actions">
            <button type="button" disabled={!speechSupported} onClick={listen} aria-pressed={activeReference === 'normal' && speaking}><Volume2 size={18} aria-hidden="true" />{activeReference === 'normal' && speaking ? 'Playing…' : hasListened ? 'Replay' : 'Play'}</button>
            <button type="button" disabled={!speechSupported} onClick={listenSlower} aria-pressed={activeReference === 'slower' && speaking}><Gauge size={18} aria-hidden="true" />{activeReference === 'slower' && speaking ? 'Playing…' : `${slowerSpeechRate.toFixed(2)}×`}</button>
          </div>
        </div>

        {!speechSupported ? <p className="shadowing-error" role="status">Reference audio is unavailable. You can still continue.</p> : null}

        <section className={`shadowing-recorder is-${recordingState}`} aria-label="Optional voice recording">
          <div className="shadowing-recorder-copy"><Mic size={19} aria-hidden="true" /><div><strong>Your voice</strong><p role="status" aria-live="polite">{recordingMessage}</p></div></div>
          {availability === 'available' ? (
            <div className="shadowing-recorder-actions">
              {recordingState === 'recording' ? (
                <button className="is-danger" type="button" onClick={stopRecording}><Square size={16} fill="currentColor" aria-hidden="true" />Stop</button>
              ) : recordingState === 'recorded' ? (
                <>
                  <button type="button" onClick={playRecording} aria-pressed={playingRecording}><Play size={17} fill="currentColor" aria-hidden="true" />{playingRecording ? 'Playing…' : 'Play my voice'}</button>
                  <button type="button" onClick={() => void startRecording()}><RotateCcw size={17} aria-hidden="true" />Record again</button>
                </>
              ) : (
                <button className="shadowing-record-action" type="button" disabled={recordingState === 'requesting'} onClick={() => void startRecording()}><Mic size={17} aria-hidden="true" />{recordingState === 'requesting' ? 'Requesting…' : recordingState === 'idle' ? 'Record' : 'Try recording again'}</button>
              )}
            </div>
          ) : null}
        </section>

        <audio className="shadowing-recording-audio" ref={audioRef} src={recordingUrl ?? undefined} preload="metadata"
          onPlay={() => setPlayingRecording(true)} onPause={() => setPlayingRecording(false)} onEnded={() => setPlayingRecording(false)} />

        {revealed ? (
          <article className="shadowing-transcript" aria-label="Sentence comparison">
            <p lang="en">{sentence.displayText}</p>
            <p lang="vi">{sentence.translationVi}</p>
            {sentence.explanation ? <p className="shadowing-explanation">{sentence.explanation}</p> : null}
          </article>
        ) : (
          <button className="shadowing-reveal-action" type="button" onClick={() => setRevealed(true)}><Eye size={18} aria-hidden="true" />Show sentence</button>
        )}

        <div className="shadowing-action-dock">
          {onPrevious ? <button className="shadowing-secondary-action" type="button" onClick={onPrevious}><ArrowLeft size={18} aria-hidden="true" />Previous</button> : <span />}
          <button className="shadowing-main-action" type="button" disabled={!revealed} onClick={onContinue}>
            {currentStep >= totalSteps ? <Check size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
            {currentStep >= totalSteps ? 'Finish' : 'Next'}
          </button>
          <span className="shadowing-shortcuts"><kbd>Space</kbd> action · <kbd>Esc</kbd> exit</span>
        </div>
      </section>
    </main>
  )
}
