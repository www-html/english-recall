import { describe, expect, it } from 'vitest'
import starterPackJson from '../data/starter-pack.json'
import { parseLessonPack } from '../domain/lesson-pack.schema.ts'
import { DefaultLearningEngine } from '../learning-engine/index.ts'
import { diagnosticsForAttemptTransition } from './session-diagnostics.ts'

const pack = parseLessonPack(starterPackJson)

describe('attempt diagnostics', () => {
  it('logs one SRS commit on resolution and none for wrong retries', () => {
    const engine = new DefaultLearningEngine()
    const started = engine.start({
      pack,
      lessonId: pack.lessons[0]!.id,
      learningMode: 'fill-words',
      now: '2026-08-13T12:00:00.000Z',
    })
    if (!started.ok || started.value.current.status !== 'active') {
      throw new Error('Expected active session')
    }
    const session = started.value.current.session
    const sentence = pack.lessons[0]!.sentences.find(
      ({ id }) => id === session.currentSentenceId,
    )!
    const target = sentence.targets[session.currentTargetIndex]!

    const wrong = engine.submit({ kind: 'text', value: 'typed-secret-answer' })
    if (!wrong.ok) throw new Error(wrong.error.message)
    const wrongEvents = diagnosticsForAttemptTransition(
      wrong.value.previous,
      wrong.value.current,
    )
    expect(wrongEvents.map(({ event }) => event)).toEqual(['answer_incorrect'])
    expect(JSON.stringify(wrongEvents)).not.toContain('typed-secret-answer')

    const correct = engine.submit({ kind: 'text', value: target.surfaceText })
    if (!correct.ok) throw new Error(correct.error.message)
    const resolvedEvents = diagnosticsForAttemptTransition(
      correct.value.previous,
      correct.value.current,
    )
    expect(resolvedEvents.filter(({ event }) => event === 'srs_committed')).toHaveLength(1)
    expect(resolvedEvents.map(({ event }) => event)).toEqual([
      'answer_correct',
      'target_resolved',
      'srs_committed',
    ])

    engine.restartSentence()
    const repeated = engine.submit({ kind: 'text', value: target.surfaceText })
    if (!repeated.ok) throw new Error(repeated.error.message)
    expect(
      diagnosticsForAttemptTransition(
        repeated.value.previous,
        repeated.value.current,
      ).filter(({ event }) => event === 'srs_committed'),
    ).toHaveLength(0)
  })
})
