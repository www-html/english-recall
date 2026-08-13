import { useCallback, useEffect, useState } from 'react'

export function getSlowerSpeechRate(rate: number): number {
  return Math.max(0.5, Number((rate * 0.6).toFixed(2)))
}

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false)
  const supported =
    typeof window !== 'undefined' && 'speechSynthesis' in window

  const stop = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [supported])

  const speak = useCallback(
    (text: string, rate: number) => {
      if (!supported || !text.trim()) return

      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'en-US'
      utterance.rate = rate
      utterance.onstart = () => setSpeaking(true)
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)
      window.speechSynthesis.speak(utterance)
    },
    [supported],
  )

  useEffect(() => stop, [stop])

  return { supported, speaking, speak, stop }
}
