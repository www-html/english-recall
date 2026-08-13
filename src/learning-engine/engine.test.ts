import { describe, expect, it } from 'vitest'
import type { LessonPack } from '../domain/lesson-pack.schema.ts'
import type { Clock } from './contracts.ts'
import { DefaultLearningEngine, selectExerciseMode } from './engine.ts'

const pack: LessonPack = {
  schemaVersion: 2,
  id: 'test-pack',
  version: '2.0.0',
  title: 'Context recall',
  sourceLanguage: 'vi',
  targetLanguage: 'en',
  lexemes: [
    { id: 'usually', text: 'usually', partOfSpeech: 'adverb', meaningVi: 'thường' },
    { id: 'drink', text: 'drink', partOfSpeech: 'verb', meaningVi: 'uống' },
    { id: 'always', text: 'always', partOfSpeech: 'adverb', meaningVi: 'luôn luôn' },
    { id: 'sometimes', text: 'sometimes', partOfSpeech: 'adverb', meaningVi: 'đôi khi' },
    { id: 'normally', text: 'normally', partOfSpeech: 'adverb', meaningVi: 'thông thường' },
  ],
  lessons: [
    {
      id: 'habits',
      title: 'Habits',
      sentences: [
        {
          id: 'morning-coffee',
          displayText: 'I usually drink coffee.',
          speechText: 'I usually drink coffee.',
          translationVi: 'Tôi thường uống cà phê.',
          level: 'A1',
          topic: 'habits',
          targets: [
            {
              id: 'morning-usually',
              lexemeId: 'usually',
              start: 2,
              end: 9,
              distractorLexemeIds: ['always', 'sometimes', 'normally'],
            },
            {
              id: 'morning-drink',
              lexemeId: 'drink',
              start: 10,
              end: 15,
              distractorLexemeIds: ['always', 'sometimes', 'normally'],
            },
          ],
        },
        {
          id: 'home-at-six',
          displayText: 'She usually gets home at six.',
          speechText: 'She usually gets home at six.',
          translationVi: 'Cô ấy thường về nhà lúc sáu giờ.',
          level: 'A1',
          topic: 'habits',
          targets: [
            {
              id: 'morning-usually',
              lexemeId: 'usually',
              start: 4,
              end: 11,
              distractorLexemeIds: ['always', 'sometimes', 'normally'],
            },
          ],
        },
      ],
    },
  ],
}

class FixedClock implements Clock {
  now(): string {
    return '2026-08-12T12:00:05.000Z'
  }
}

function activeSession(engine: DefaultLearningEngine) {
  const state = engine.getState()
  if (state.status !== 'active') throw new Error('Expected active session')
  return state.session
}

describe('DefaultLearningEngine retries', () => {
  it('records a wrong choice without revealing or advancing', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits', learningMode: 'word-choice' })

    const result = engine.submit({ kind: 'choice', choiceId: 'always' })

    expect(result.ok).toBe(true)
    const session = activeSession(engine)
    expect(session).toMatchObject({
      phase: 'question',
      currentSentenceId: 'morning-coffee',
      currentTargetId: 'morning-usually',
      solvedTargetIds: [],
      wrongChoiceIdsByOccurrenceKey: {
        'morning-coffee::morning-usually': ['always'],
      },
    })
    expect(session.lastEvaluation).toMatchObject({ outcome: 'incorrect' })
    expect(session.lastEvaluation).not.toHaveProperty('expectedAnswer')
  })

  it('records a wrong fill without revealing or advancing', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({
      pack,
      lessonId: 'habits',
      learningMode: 'fill-words',
      now: '2026-08-12T12:00:00.000Z',
    })

    engine.submit({ kind: 'text', value: 'usual' })

    const session = activeSession(engine)
    expect(session.phase).toBe('question')
    expect(session.currentTargetId).toBe('morning-usually')
    expect(session.lastEvaluation).not.toHaveProperty('expectedAnswer')
    expect(session.attemptHistory[0]).toMatchObject({
      lexemeId: 'usually',
      sentenceId: 'morning-coffee',
      exerciseMode: 'fill-words',
      outcome: 'incorrect',
      firstTry: false,
      wrongAttempts: 1,
      responseTimeMs: 5000,
    })
  })
})

describe('DefaultLearningEngine sentence flow', () => {
  it('preserves solved targets while moving through a multi-target sentence', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits', learningMode: 'fill-words' })
    engine.submit({ kind: 'text', value: 'usually' })

    expect(activeSession(engine)).toMatchObject({
      phase: 'target-feedback',
      solvedTargetIds: ['morning-usually'],
    })

    engine.advance()
    expect(activeSession(engine)).toMatchObject({
      phase: 'question',
      currentTargetId: 'morning-drink',
      solvedTargetIds: ['morning-usually'],
    })
  })

  it('exposes sentence completion before explicit next-sentence advance', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits', learningMode: 'fill-words' })
    engine.submit({ kind: 'text', value: 'usually' })
    engine.advance()
    engine.submit({ kind: 'text', value: 'drink' })
    engine.advance()

    expect(activeSession(engine)).toMatchObject({
      phase: 'sentence-complete',
      currentSentenceId: 'morning-coffee',
      solvedTargetIds: ['morning-usually', 'morning-drink'],
    })

    engine.advance()
    expect(activeSession(engine)).toMatchObject({
      phase: 'question',
      currentSentenceId: 'home-at-six',
      solvedTargetIds: [],
    })
  })

  it('shares one mastery schedule across sentence contexts for a lexeme', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits', learningMode: 'fill-words' })
    engine.submit({ kind: 'text', value: 'usually' })
    engine.advance()
    engine.submit({ kind: 'text', value: 'drink' })
    engine.advance()
    engine.advance()
    engine.submit({ kind: 'text', value: 'usually' })

    const session = activeSession(engine)
    expect(session.schedulesByLexemeId.usually?.repetitions).toBe(2)
    expect(session.attemptsByLexemeId.usually).toMatchObject({
      attempts: 2,
      correct: 2,
    })
    expect(
      session.attemptHistory.filter(({ lexemeId }) => lexemeId === 'usually'),
    ).toHaveLength(2)
  })

  it('isolates retries when two sentences reuse a local target id', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits', learningMode: 'word-choice' })
    engine.submit({ kind: 'choice', choiceId: 'always' })
    engine.submit({ kind: 'choice', choiceId: 'usually' })
    engine.advance()
    engine.submit({ kind: 'choice', choiceId: 'drink' })
    engine.advance()
    engine.advance()

    const session = activeSession(engine)
    expect(session.currentSentenceId).toBe('home-at-six')
    expect(session.currentTargetId).toBe('morning-usually')
    expect(
      session.wrongChoiceIdsByOccurrenceKey[
        'home-at-six::morning-usually'
      ],
    ).toBeUndefined()
  })

  it('completes only after the final completed sentence is advanced', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits', learningMode: 'fill-words' })
    engine.submit({ kind: 'text', value: 'usually' })
    engine.advance()
    engine.submit({ kind: 'text', value: 'drink' })
    engine.advance()
    engine.advance()
    engine.submit({ kind: 'text', value: 'usually' })
    engine.advance()

    expect(engine.getState()).toMatchObject({
      status: 'active',
      session: { phase: 'sentence-complete', currentSentenceId: 'home-at-six' },
    })

    engine.advance()
    expect(engine.getState()).toMatchObject({
      status: 'completed',
      result: { correctAnswers: 3, incorrectAnswers: 0 },
    })
  })
})

describe('DefaultLearningEngine modes and restore', () => {
  it('adapts the exercise across weak, developing, and established mastery', () => {
    expect(selectExerciseMode('auto', undefined)).toBe('word-choice')
    expect(
      selectExerciseMode('auto', {
        dueAt: '2026-08-12T12:00:00.000Z',
        intervalDays: 10,
        easeFactor: 2.3,
        repetitions: 3,
        lapses: 0,
      }),
    ).toBe('fill-words')
    expect(
      selectExerciseMode('auto', {
        dueAt: '2026-09-12T12:00:00.000Z',
        intervalDays: 30,
        easeFactor: 2.5,
        repetitions: 5,
        lapses: 0,
      }),
    ).toBe('listening-choice')
  })

  it('records Listening Choice with the same no-reveal retry semantics', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits', learningMode: 'listening-choice' })

    engine.submit({ kind: 'choice', choiceId: 'always' })
    const session = activeSession(engine)
    expect(session).toMatchObject({
      phase: 'question',
      exerciseMode: 'listening-choice',
      currentTargetId: 'morning-usually',
    })
    expect(session.lastEvaluation).not.toHaveProperty('expectedAnswer')
    expect(session.attemptHistory[0]?.exerciseMode).toBe('listening-choice')
  })

  it('pauses and restores the exact sentence/target/mastery state', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits', learningMode: 'word-choice' })
    engine.submit({ kind: 'choice', choiceId: 'always' })
    engine.pause()
    const paused = engine.getState()
    if (paused.status !== 'paused') throw new Error('Expected paused session')

    const restored = new DefaultLearningEngine(new FixedClock())
    expect(restored.restore({ pack, snapshot: paused.session }).ok).toBe(true)
    expect(restored.getState()).toEqual({ status: 'active', session: paused.session })

    restored.pause()
    expect(restored.resume().ok).toBe(true)
    expect(activeSession(restored)).toEqual(paused.session)
  })

  it('rejects answering while paused and rejects an inconsistent restore', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits' })
    engine.pause()
    expect(engine.submit({ kind: 'choice', choiceId: 'usually' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-state' },
    })

    const paused = engine.getState()
    if (paused.status !== 'paused') throw new Error('Expected paused session')
    const invalidSnapshot = {
      ...paused.session,
      currentTargetId: 'not-in-this-sentence',
    }
    expect(engine.restore({ pack, snapshot: invalidSnapshot })).toMatchObject({
      ok: false,
      error: { code: 'invalid-snapshot' },
    })
  })

  it('rejects a snapshot missing occurrence-key retry state without throwing', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits' })
    const snapshot = activeSession(engine)
    const malformed = { ...snapshot } as Record<string, unknown>
    delete malformed.wrongChoiceIdsByOccurrenceKey

    const restore = () =>
      engine.restore({
        pack,
        snapshot: malformed as unknown as typeof snapshot,
      })
    expect(restore).not.toThrow()
    expect(restore()).toMatchObject({
      ok: false,
      error: { code: 'invalid-snapshot' },
    })
  })

  it('restarts only the current sentence while retaining learning history', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits', learningMode: 'fill-words' })
    engine.submit({ kind: 'text', value: 'usually' })
    engine.advance()

    expect(engine.restartSentence().ok).toBe(true)
    expect(activeSession(engine)).toMatchObject({
      currentSentenceId: 'morning-coffee',
      currentTargetId: 'morning-usually',
      solvedTargetIds: [],
      phase: 'question',
      attemptsByLexemeId: { usually: { correct: 1 } },
    })
  })
})
