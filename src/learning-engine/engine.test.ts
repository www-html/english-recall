import { describe, expect, it } from 'vitest'
import type { LessonPack } from '../domain/lesson-pack.schema.ts'
import { DefaultLearningEngine } from './engine.ts'
import type { Clock } from './contracts.ts'

const pack: LessonPack = {
  schemaVersion: 1,
  id: 'test-pack',
  version: '1.0.0',
  title: 'Test pack',
  sourceLanguage: 'vi',
  targetLanguage: 'en',
  lessons: [
    {
      id: 'basics',
      title: 'Basics',
      items: [
        {
          id: 'choice-one',
          kind: 'multiple-choice',
          prompt: 'Chọn đáp án',
          choices: [
            { id: 'a', text: 'hello' },
            { id: 'b', text: 'goodbye' },
          ],
          correctChoiceId: 'a',
          tags: [],
        },
        {
          id: 'typing-one',
          kind: 'typing',
          prompt: 'Gõ hello',
          acceptedAnswers: ['hello'],
          caseSensitive: false,
          tags: [],
        },
      ],
    },
  ],
}

class FixedClock implements Clock {
  now(): string {
    return '2026-08-12T12:00:00.000Z'
  }
}

describe('DefaultLearningEngine', () => {
  it('moves from question to feedback and completion', () => {
    const engine = new DefaultLearningEngine(new FixedClock())

    expect(engine.start({ pack, lessonId: 'basics' }).ok).toBe(true)
    expect(engine.submit({ kind: 'choice', choiceId: 'a' }).ok).toBe(true)
    expect(engine.getState()).toMatchObject({
      status: 'active',
      session: { phase: 'feedback' },
    })

    engine.advance()
    engine.submit({ kind: 'text', value: 'Hello' })
    engine.advance()

    expect(engine.getState()).toMatchObject({
      status: 'completed',
      result: { correctAnswers: 2, accuracyPercent: 100 },
    })
  })

  it('rejects answers while paused', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'basics' })
    engine.pause()

    const result = engine.submit({ kind: 'choice', choiceId: 'a' })

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid-state' },
    })
  })
})
