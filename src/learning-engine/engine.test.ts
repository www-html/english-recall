import { describe, expect, it } from 'vitest'
import type { LessonPack } from '../domain/lesson-pack.schema.ts'
import type { Clock, ReviewScheduler } from './contracts.ts'
import {
  DefaultLearningEngine,
  createTargetOccurrenceKey,
  selectExerciseMode,
} from './engine.ts'
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

const developingSchedule: ReviewSchedule = {
  dueAt: now,
  intervalDays: 3,
  easeFactor: 2.1,
  repetitions: 3,
  lapses: 0,
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

describe('adaptive exercise selection', () => {
  it('progresses from recognition to typed recall as mastery develops', () => {
    expect(selectExerciseMode('auto', undefined)).toBe('word-choice')
    expect(selectExerciseMode('auto', weakSchedule)).toBe('word-choice')
    expect(selectExerciseMode('auto', developingSchedule)).toBe('fill-words')
  })

  it('gives strong scheduled targets Dictation with occasional listening variation', () => {
    const modes = Array.from({ length: 10 }, (_, selectionIndex) =>
      selectExerciseMode('auto', strongSchedule, { selectionIndex }),
    )

    expect(modes[0]).toBe('full-sentence')
    expect(modes).toContain('fill-words')
    expect(modes).toContain('listening-choice')
    expect(modes.filter((mode) => mode === 'listening-choice')).toHaveLength(2)
  })

  it('is deterministic and prevents runs longer than two identical interactions', () => {
    const selectRun = () => {
      const modes: ReturnType<typeof selectExerciseMode>[] = []
      for (let selectionIndex = 0; selectionIndex < 9; selectionIndex += 1) {
        modes.push(
          selectExerciseMode('auto', undefined, {
            selectionIndex,
            recentModes: modes.slice(-2),
          }),
        )
      }
      return modes
    }
    const first = selectRun()

    expect(selectRun()).toEqual(first)
    expect(first.slice(0, 6)).toEqual([
      'word-choice',
      'word-choice',
      'fill-words',
      'word-choice',
      'word-choice',
      'fill-words',
    ])
    expect(
      first.some(
        (mode, index) => mode === first[index + 1] && mode === first[index + 2],
      ),
    ).toBe(false)
  })

  it('preserves every manual exercise override', () => {
    expect(selectExerciseMode('word-choice', strongSchedule)).toBe('word-choice')
    expect(selectExerciseMode('fill-words', undefined)).toBe('fill-words')
    expect(selectExerciseMode('listening-choice', undefined)).toBe(
      'listening-choice',
    )
    expect(selectExerciseMode('full-sentence', undefined)).toBe('full-sentence')
  })

  it('uses Dictation for a strong due target in an auto learning session', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({
      pack,
      lessonId: 'habits',
      now,
      schedulesByLexemeId: {
        usually: { ...strongSchedule, dueAt: now },
        drink: strongSchedule,
      },
    })

    expect(active(engine).exerciseMode).toBe('full-sentence')
  })
})

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

  it('does not make weak future-due mastery reviewable', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({
      pack,
      lessonId: 'habits',
      now,
      schedulesByLexemeId: { usually: weakSchedule, drink: strongSchedule },
    })
    expect(active(engine).isPracticeFallback).toBe(true)
    expect(active(engine).reviewableOccurrenceKeys).toEqual([])
  })

  it('makes weak mastery reviewable once it is due', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({
      pack,
      lessonId: 'habits',
      now,
      schedulesByLexemeId: {
        usually: { ...weakSchedule, dueAt: now },
        drink: strongSchedule,
      },
    })

    expect(active(engine).isPracticeFallback).toBe(false)
    expect(active(engine).reviewableOccurrenceKeys).toEqual(['coffee::usually-1'])
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

  it('allows explicit practice with future-due weak content without scheduling it', () => {
    const scheduler = new RecordingScheduler()
    const engine = new DefaultLearningEngine(new FixedClock(), undefined, scheduler)
    engine.start({
      pack,
      lessonId: 'habits',
      now,
      learningMode: 'fill-words',
      practiceOnly: true,
      schedulesByLexemeId: { usually: weakSchedule, drink: strongSchedule },
    })

    const before = active(engine).schedulesByLexemeId
    engine.submit({ kind: 'text', value: 'usually' })

    expect(scheduler.calls).toHaveLength(0)
    expect(active(engine).schedulesByLexemeId).toEqual(before)
  })
})

describe('SRS scheduling invariants', () => {
  it('checks the full sentence while scheduling only the current target once', () => {
    const scheduler = new RecordingScheduler()
    const engine = new DefaultLearningEngine(new FixedClock(), undefined, scheduler)
    engine.start({ pack, lessonId: 'habits', now, learningMode: 'full-sentence' })

    engine.submit({ kind: 'text', value: 'I usually drink tea.' })
    expect(scheduler.calls).toHaveLength(0)
    expect(active(engine).currentTargetId).toBe('usually-1')

    engine.submit({ kind: 'text', value: 'I usually drink coffee.' })
    expect(scheduler.calls).toEqual([{ previous: undefined, rating: 'hard' }])
    expect(active(engine).scheduledOccurrenceKeys).toEqual(['coffee::usually-1'])
  })

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
  it('captures an immutable pre-session schedule baseline', () => {
    const dueWeakSchedule = { ...weakSchedule, dueAt: now }
    const inputSchedule = { ...dueWeakSchedule }
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({
      pack,
      lessonId: 'habits',
      now,
      learningMode: 'fill-words',
      schedulesByLexemeId: { usually: inputSchedule, drink: strongSchedule },
    })

    inputSchedule.lapses = 99
    expect(active(engine).initialSchedulesByLexemeId).toEqual({
      usually: dueWeakSchedule,
      drink: strongSchedule,
    })

    engine.submit({ kind: 'text', value: 'usually' })
    expect(active(engine).schedulesByLexemeId.usually).not.toEqual(dueWeakSchedule)
    expect(active(engine).initialSchedulesByLexemeId?.usually).toEqual(dueWeakSchedule)
  })

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

  it('restores legacy snapshots without a stored baseline conservatively', () => {
    const engine = new DefaultLearningEngine(new FixedClock())
    engine.start({ pack, lessonId: 'habits', now })
    const {
      initialSchedulesByLexemeId: _legacyMissingField,
      ...legacySnapshot
    } = active(engine)
    const restored = new DefaultLearningEngine(new FixedClock())

    expect(restored.restore({ pack, snapshot: legacySnapshot }).ok).toBe(true)
    expect(active(restored).initialSchedulesByLexemeId).toBeUndefined()
  })

  it('preserves an exact multi-target retry, pause, reload, resume and completion flow', () => {
    const scheduler = new RecordingScheduler()
    const engine = new DefaultLearningEngine(new FixedClock(), undefined, scheduler)
    engine.start({ pack, lessonId: 'habits', now, learningMode: 'fill-words' })

    engine.submit({ kind: 'text', value: 'wrong' })
    engine.submit({ kind: 'text', value: 'usually' })
    engine.advance()
    expect(active(engine).currentTargetId).toBe('drink-1')
    expect(engine.pause().ok).toBe(true)
    const paused = engine.getState()
    if (paused.status !== 'paused') throw new Error('Expected paused state')

    const reloaded = new DefaultLearningEngine(new FixedClock(), undefined, scheduler)
    expect(reloaded.restore({ pack, snapshot: paused.session }).ok).toBe(true)
    expect(active(reloaded).currentTargetId).toBe('drink-1')
    reloaded.submit({ kind: 'text', value: 'drink' })
    reloaded.advance()
    reloaded.advance()

    expect(reloaded.getState()).toMatchObject({
      status: 'completed',
      result: { completedTargets: 2, incorrectAnswers: 1 },
    })
    expect(scheduler.calls.map(({ rating }) => rating)).toEqual(['hard', 'good'])
  })
})
