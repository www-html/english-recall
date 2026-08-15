import { useCallback, useEffect, useState } from 'react'
import {
  isNativeAndroid,
  nativeTextToSpeech,
} from '../platform/native-text-to-speech.ts'

export function getSlowerSpeechRate(rate: number): number {
  return Math.max(0.5, Number((rate * 0.6).toFixed(2)))
}

export function shouldAllowLearningSpeech(
  view: string,
  engineStatus: string,
): boolean {
  return view === 'learning' && engineStatus === 'active'
}

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false)
  const nativeAndroid = isNativeAndroid()
  const [nativeSupported, setNativeSupported] = useState(nativeAndroid)
  const browserSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window
  const supported = nativeAndroid ? nativeSupported : browserSupported

  const stop = useCallback(() => {
    if (!supported) return
    if (nativeAndroid) {
      void nativeTextToSpeech.stop().catch(() => undefined)
      setSpeaking(false)
      return
    }
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [nativeAndroid, supported])

  const speak = useCallback(
    (text: string, rate: number) => {
      if (!supported || !text.trim()) return

      if (nativeAndroid) {
        setSpeaking(true)
        void nativeTextToSpeech.speak({ text, rate }).catch(() => setSpeaking(false))
        return
      }

      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'en-US'
      utterance.rate = rate
      utterance.onstart = () => setSpeaking(true)
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)
      window.speechSynthesis.speak(utterance)
    },
    [nativeAndroid, supported],
  )

  useEffect(() => {
    if (!nativeAndroid) return

    let disposed = false
    let removeListener: (() => Promise<void>) | undefined
    void nativeTextToSpeech.isSupported()
      .then(({ supported: available }) => {
        if (!disposed) setNativeSupported(available)
      })
      .catch(() => {
        if (!disposed) setNativeSupported(false)
      })
    void nativeTextToSpeech.addListener('speakingStateChange', (state) => {
      if (!disposed) setSpeaking(state.speaking)
    }).then((handle) => {
      if (disposed) void handle.remove()
      else removeListener = () => handle.remove()
    })

    return () => {
      disposed = true
      if (removeListener) void removeListener()
    }
  }, [nativeAndroid])

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState !== 'visible') stop()
    }
    const stopWhenPageLeaves = () => stop()

    document.addEventListener('visibilitychange', stopWhenHidden)
    window.addEventListener('pagehide', stopWhenPageLeaves)
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden)
      window.removeEventListener('pagehide', stopWhenPageLeaves)
      stop()
    }
  }, [stop])

  return { supported, speaking, speak, stop }
}
