import { describe, expect, it } from 'vitest'
import { getSlowerSpeechRate } from './use-speech.ts'

describe('getSlowerSpeechRate', () => {
  it('makes slower replay clearly slower than the configured normal rate', () => {
    expect(getSlowerSpeechRate(0.9)).toBe(0.54)
    expect(getSlowerSpeechRate(1.2)).toBe(0.72)
  })

  it('keeps the replay rate within a usable lower bound', () => {
    expect(getSlowerSpeechRate(0.6)).toBe(0.5)
  })
})
