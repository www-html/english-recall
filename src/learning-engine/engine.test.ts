import { describe, expect, it } from 'vitest'
import type { LessonPack } from '../domain/lesson-pack.schema.ts'
import type { Clock, ReviewScheduler } from './contracts.ts'
import { DefaultLearningEngine, createTargetOccurrenceKey } from './engine.ts'
import type { RecallRating, ReviewSchedule } from './state.ts'

const now = '2026-08-13T12:00:00.000Z'
const future = '2026-09-13T12:00:00.000Z'

const pack: LessonPack = {
  schemaVersion: 3,
  id: 'pack',
  version: '3.0.0',
  title: 'Context recall',
  sourceLanguage: 'vi',
  targetLanguage: 'en',
  lexemes: [
    { id: 'usually', lemma: 'usually', partOfSpeech: 'adverb', meaningVi: 'thường' },
    { id: 'drink', lemma: 'drink', partOfSpeech: 'verb', meaningVi: 'uống' },
    { id: 'always', lemma: 'always', partOfSpeech: 'adverb', meaningVi: 'luôn' },
    { id: 'sometimes', lemma: 'sometimes', partOfSpeech: 'adverb', meaningVi: 'đôi khi' },
    { id: 'normally', lemma: 'normally', partOfSpeech: 'adverb', meaningVi: 'thông thường' },
  ],
  lessons: [
    {
      id: 'habits',
      title: 'Habits',
      sentences: [
        {
          id: 'coffee',
          displayText: 'I usually drink coffee.',
          speechText: 'I usually drink coffee.',
          translationVi: 'Tôi thường uống cà phê.',
          level: 'A1',
          topic: 'habits',
          targets: [
            {
              id: 'usually-1', lexemeId: 'usually', start: 2, end: 9,
              surfaceText: 'usually',
              distractors: [
                { lexemeId: 'always', surfaceText: 'always' },
                { lexemeId: 'sometimes', surfaceText: 'sometimes' },
                { lexemeId: 'normally', surfaceText: 'normally' },
              ],
            },
            {
              id: 'drink-1', lexemeId: 'drink', start: 10, end: 15,
              surfaceText: 'drink',
              distractors: [
                { lexemeId: 'always', surfaceText: 'always' },
                { lexemeId: 'sometimes', surfaceText: 'sometimes' },
                { lexemeId: 'normally', surfaceText: 'normally' },
              ],
            },
          ],
        },
        {
          id: 'home',
          displayText: 'She usually gets home at six.',
          speechText: 'She usually gets home at six.',
          translationVi: 'Cô ấy thường về nhà lúc sáu giờ.',
          level: 'A1',
          topic: 'habits',
          targets: [
            {
              id: 'usually-2', lexemeId: 'usually', start: 4, end: 11,
              surfaceText: 'usually',
              distractors: [
                { lexemeId: 'always', surfaceText: 'always' },
                { lexemeId: 'sometimes', surfaceText: 'sometimes' },
                { lexemeId: 'normally', surfaceText: 'normally' },
              ],
            },
          ],
        },
      ],
    },
  ],
}

const strongSchedule: ReviewSchedule = {
  dueAt: future,
  intervalDays: 30,
  easeFactor: 2.5,
  repetitions: 5,
  lapses: 0,
}

const weakSchedule: ReviewSchedule = {
  dueAt: future,
  intervalDays: 1,
  easeFactor: 1.5,
  repetitions: 1,
  lapses: 2,
}

class FixedClock implements Clock {
  now(): string { return now }
}

class RecordingScheduler implements ReviewScheduler {
  readonly calls: Array<{ previous: ReviewSchedule | undefined; rating: RecallRating }> = []

  schedule(previous: ReviewSchedule | undefined, rating: RecallRating): ReviewSchedule {
    this.calls.push({ previous, rating })
    return { dueAt: future, intervalDays: 3, easeFactor: 2.2, repetitions: 1, lapses: 0 }
  }
}

function active(engine: DefaultLearningEngine) {
  const state = engine.getState()
  if (state.status !== 'active') throw new Error('Expected active state')
  return state.session
}

describe('active and supporting targets', () => {
  it('exercises due/new targets only and never alters a supporting target', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({
      pack,
      lessonId: 'habits',
      now,
      learningMode: 'fill-words',
      schedulesByLexemeId: { drink: strongSchedule },
    })

    const session = active(engine)
    expect(session.sentenceQueue).toEqual(['coffee'])
    expect(session.activeTargetIdsBySentenceId).toEqual({ coffee: ['usually-1'] })
    expect(session.currentTargetId).toBe('usually-1')
    engine.submit({ kind: 'text', value: 'usually' })
    expect(active(engine).schedulesByLexemeId.drink).toEqual(strongSchedule)
  })

  it('supports multiple active lexemes but selects one occurrence per lexeme', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits', now })

    expect(active(engine).activeTargetIdsBySentenceId).toEqual({
      coffee: ['usually-1', 'drink-1'],
    })
    expect(active(engine).sentenceQueue).toEqual(['coffee'])
  })

  it('treats weak but not-due mastery as active', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({
      pack,
      lessonId: 'habits',
      now,
      schedulesByLexemeId: { usually: weakSchedule, drink: strongSchedule },
    })
    expect(active(engine).activeTargetIdsBySentenceId).toEqual({ coffee: ['usually-1'] })
  })

  it('falls back to non-reviewable practice when nothing is active', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    const scheduler = new RecordingScheduler()
    const withScheduler = new DefaultLearningEngine(new FixedClock(), undefined, scheduler)
    withScheduler.start({
      pack,
      lessonId: 'habits',
      now,
      learningMode: 'fill-words',
      schedulesByLexemeId: { usually: strongSchedule, drink: strongSchedule },
    })
    expect(active(withScheduler).isPracticeFallback).toBe(true)
    expect(active(withScheduler).reviewableOccurrenceKeys).toEqual([])
    withScheduler.submit({ kind: 'text', value: 'usually' })
    expect(scheduler.calls).toHaveLength(0)
    expect(active(withScheduler).schedulesByLexemeId.usually).toEqual(strongSchedule)
    expect(engine.getState()).toEqual({ status: 'idle' })
  })
})

describe('SRS scheduling invariants', () => {
  it('records three wrong attempts then schedules exactly once as hard on correct', () => {
    const scheduler = new RecordingScheduler()
    const engine = new DefaultLearningEngine(new FixedClock(), undefined, scheduler)
    engine.start({ pack, lessonId: 'habits', now, learningMode: 'fill-words' })

    engine.submit({ kind: 'text', value: 'x' })
    engine.submit({ kind: 'text', value: 'y' })
    engine.submit({ kind: 'text', value: 'z' })
    expect(scheduler.calls).toHaveLength(0)
    expect(active(engine).lastEvaluation).not.toHaveProperty('expectedAnswer')
    engine.submit({ kind: 'text', value: 'usually' })

    expect(scheduler.calls).toEqual([{ previous: undefined, rating: 'hard' }])
    expect(active(engine).attemptHistory).toHaveLength(4)
    expect(active(engine).attemptHistory.slice(0, 3).every((a) => !a.nextReviewAt)).toBe(true)
    expect(active(engine).scheduledOccurrenceKeys).toEqual(['coffee::usually-1'])
  })

  it('restart cannot schedule a resolved occurrence twice', () => {
    const scheduler = new RecordingScheduler()
    const engine = new DefaultLearningEngine(new FixedClock(), undefined, scheduler)
    engine.start({ pack, lessonId: 'habits', now, learningMode: 'fill-words' })
    engine.submit({ kind: 'text', value: 'usually' })
    engine.restartSentence()
    engine.submit({ kind: 'text', value: 'usually' })

    expect(scheduler.calls).toHaveLength(1)
    expect(scheduler.calls[0]?.rating).toBe('good')
    expect(active(engine).scheduledOccurrenceKeys).toEqual(['coffee::usually-1'])
  })

  it('skip resolves and schedules again once', () => {
    const scheduler = new RecordingScheduler()
    const engine = new DefaultLearningEngine(new FixedClock(), undefined, scheduler)
    engine.start({ pack, lessonId: 'habits', now })
    engine.skip()
    expect(scheduler.calls.map(({ rating }) => rating)).toEqual(['again'])
    engine.restartSentence()
    engine.skip()
    expect(scheduler.calls).toHaveLength(1)
  })
})

describe('completion metrics', () => {
  it('counts difficult lexemes uniquely with target-oriented wording', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits', now, learningMode: 'fill-words' })
    engine.submit({ kind: 'text', value: 'wrong' })
    engine.submit({ kind: 'text', value: 'usually' })
    engine.advance()
    engine.skip()
    engine.advance()
    engine.advance()

    expect(engine.getState()).toMatchObject({
      status: 'completed',
      result: {
        reviewedLexemes: 2,
        completedTargets: 2,
        difficultLexemes: 2,
        correctAnswers: 1,
        incorrectAnswers: 1,
        skippedTargets: 1,
        practiceTargets: 0,
      },
    })
  })
})

describe('durable restore', () => {
  it('restores active/supporting and scheduling guards exactly', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits', now, learningMode: 'fill-words' })
    engine.submit({ kind: 'text', value: 'usually' })
    const snapshot = active(engine)
    const restored = new DefaultLearningEngine(new FixedClock())

    expect(restored.restore({ pack, snapshot }).ok).toBe(true)
    expect(active(restored)).toEqual(snapshot)
    expect(snapshot.scheduledOccurrenceKeys).toContain(
      createTargetOccurrenceKey('coffee', 'usually-1'),
    )
  })
})
