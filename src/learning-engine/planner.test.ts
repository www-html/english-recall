import { describe, expect, it } from 'vitest'
import type { LessonPack, Sentence } from '../domain/lesson-pack.schema.ts'
import {
  DefaultLearningEngine,
  MAX_NEW_PER_SESSION,
  MAX_REVIEW_PER_SESSION,
  MAX_TOTAL_ACTIVE_TARGETS,
} from './engine.ts'
import type { LearningSessionSnapshot, ReviewSchedule } from './state.ts'

const now = '2026-08-13T12:00:00.000Z'

function schedule(
  dueAt: string,
  overrides: Partial<ReviewSchedule> = {},
): ReviewSchedule {
  return {
    dueAt,
    intervalDays: 30,
    easeFactor: 2.5,
    repetitions: 5,
    lapses: 0,
    ...overrides,
  }
}

function makeSentence(index: number, lexemeIds: readonly string[]): Sentence {
  let displayText = ''
  const targets = lexemeIds.map((lexemeId, targetIndex) => {
    if (displayText) displayText += ' '
    const start = displayText.length
    const surfaceText = `word${lexemeId}`
    displayText += surfaceText
    return {
      id: `target-${index}-${targetIndex}`,
      lexemeId,
      start,
      end: start + surfaceText.length,
      surfaceText,
      distractors: [
        { lexemeId: 'd1', surfaceText: 'one' },
        { lexemeId: 'd2', surfaceText: 'two' },
        { lexemeId: 'd3', surfaceText: 'three' },
      ],
    }
  })
  return {
    id: `sentence-${index}`,
    displayText,
    speechText: displayText,
    translationVi: 'Câu kiểm thử.',
    level: 'A1',
    topic: 'test',
    targets,
  }
}

function makePack(sentences: readonly Sentence[], secondLesson = false): LessonPack {
  const targetLexemeIds = Array.from(
    new Set(sentences.flatMap(({ targets }) => targets.map(({ lexemeId }) => lexemeId))),
  )
  const ids = Array.from(new Set([...targetLexemeIds, 'd1', 'd2', 'd3']))
  return {
    schemaVersion: 3,
    id: 'planner-pack',
    version: '3.0.0',
    title: 'Planner pack',
    sourceLanguage: 'vi',
    targetLanguage: 'en',
    lexemes: ids.map((id) => ({
      id,
      lemma: `word${id}`,
      partOfSpeech: 'other',
      meaningVi: id,
    })),
    lessons: [
      { id: 'selected', title: 'Selected', sentences: [...sentences] },
      ...(secondLesson
        ? [{ id: 'other', title: 'Other', sentences: [makeSentence(99_999, ['other'])] }]
        : []),
    ],
  }
}

function start(
  pack: LessonPack,
  schedulesByLexemeId: Readonly<Record<string, ReviewSchedule>> = {},
): LearningSessionSnapshot {
  const engine = new DefaultLearningEngine()
  const result = engine.start({
    pack,
    lessonId: 'selected',
    schedulesByLexemeId,
    now,
  })
  if (!result.ok) throw new Error(result.error.message)
  const state = engine.getState()
  if (state.status !== 'active') throw new Error('Expected active state')
  return state.session
}

function activeCount(session: LearningSessionSnapshot): number {
  return Object.values(session.activeTargetIdsBySentenceId).reduce(
    (total, ids) => total + ids.length,
    0,
  )
}

describe('daily session limits', () => {
  it('caps many new lexemes at the new-word boundary', () => {
    const pack = makePack(
      Array.from({ length: 12 }, (_, index) => makeSentence(index, [`new-${index}`])),
    )
    const session = start(pack)
    expect(activeCount(session)).toBe(MAX_NEW_PER_SESSION)
    expect(session.reviewableOccurrenceKeys).toHaveLength(MAX_NEW_PER_SESSION)
  })

  it('caps many overdue lexemes at the review boundary', () => {
    const sentences = Array.from({ length: 30 }, (_, index) =>
      makeSentence(index, [`review-${index}`]),
    )
    const schedules = Object.fromEntries(
      sentences.map((_, index) => [
        `review-${index}`,
        schedule('2026-07-01T00:00:00.000Z'),
      ]),
    )
    expect(activeCount(start(makePack(sentences), schedules))).toBe(
      MAX_REVIEW_PER_SESSION,
    )
  })

  it('allows exactly 20 reviews plus 5 new targets at the total boundary', () => {
    const reviews = Array.from({ length: 21 }, (_, index) => `review-${index}`)
    const fresh = Array.from({ length: 6 }, (_, index) => `new-${index}`)
    const sentences = [...reviews, ...fresh].map((id, index) =>
      makeSentence(index, [id]),
    )
    const schedules = Object.fromEntries(
      reviews.map((id) => [id, schedule('2026-08-01T00:00:00.000Z')]),
    )
    const session = start(makePack(sentences), schedules)
    expect(activeCount(session)).toBe(MAX_TOTAL_ACTIVE_TARGETS)
    expect(Object.keys(session.activeTargetIdsBySentenceId)).toEqual([
      ...Array.from({ length: 20 }, (_, index) => `sentence-${index}`),
      ...Array.from({ length: 5 }, (_, index) => `sentence-${index + 21}`),
    ])
  })
})

describe('deterministic priority and deduplication', () => {
  it('orders overdue before weak, due, then new', () => {
    const categories = ['new', 'due', 'weak', 'overdue']
    const sentences = categories.map((id, index) => makeSentence(index, [id]))
    const schedules = {
      overdue: schedule('2026-08-01T00:00:00.000Z'),
      weak: schedule('2026-09-01T00:00:00.000Z', {
        intervalDays: 1,
        easeFactor: 1.4,
        repetitions: 1,
        lapses: 2,
      }),
      due: schedule(now),
    }
    expect(start(makePack(sentences), schedules).sentenceQueue).toEqual([
      'sentence-3',
      'sentence-2',
      'sentence-1',
      'sentence-0',
    ])
  })

  it('uses only the first ranked context for a duplicate lexeme', () => {
    const sentences = [makeSentence(0, ['same']), makeSentence(1, ['same'])]
    const session = start(makePack(sentences), {
      same: schedule('2026-08-01T00:00:00.000Z'),
    })
    expect(session.activeTargetIdsBySentenceId).toEqual({
      'sentence-0': ['target-0-0'],
    })
    expect(session.sentenceQueue).toEqual(['sentence-0'])
  })

  it('keeps supporting-only sentences out and remains scoped to one lesson', () => {
    const sentences = [makeSentence(0, ['due']), makeSentence(1, ['supporting'])]
    const session = start(makePack(sentences, true), {
      due: schedule('2026-08-01T00:00:00.000Z'),
      supporting: schedule('2026-09-01T00:00:00.000Z'),
    })
    expect(session.sentenceQueue).toEqual(['sentence-0'])
    expect(session.sentenceQueue).not.toContain('sentence-99999')
  })

  it('uses bounded, deduplicated, non-reviewable practice when nothing is due', () => {
    const sentences = Array.from({ length: 40 }, (_, index) =>
      makeSentence(index, [`strong-${index % 30}`]),
    )
    const schedules = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [
        `strong-${index}`,
        schedule('2026-09-01T00:00:00.000Z'),
      ]),
    )
    const session = start(makePack(sentences), schedules)
    expect(session.isPracticeFallback).toBe(true)
    expect(session.reviewableOccurrenceKeys).toEqual([])
    expect(activeCount(session)).toBe(MAX_TOTAL_ACTIVE_TARGETS)
    const activeIds = Object.entries(session.activeTargetIdsBySentenceId).flatMap(
      ([sentenceId, targetIds]) =>
        targetIds.map((targetId) => `${sentenceId}::${targetId}`),
    )
    expect(new Set(activeIds).size).toBe(activeIds.length)
  })
})

describe('planner scale guard', () => {
  it('plans about 1000 sentences and 3000 targets without unbounded session growth', () => {
    const sentences = Array.from({ length: 1_000 }, (_, sentenceIndex) =>
      makeSentence(
        sentenceIndex,
        Array.from(
          { length: 3 },
          (_, targetIndex) => `lexeme-${sentenceIndex}-${targetIndex}`,
        ),
      ),
    )
    const schedules = Object.fromEntries(
      sentences.flatMap(({ targets }) =>
        targets.map(({ lexemeId }) => [
          lexemeId,
          schedule('2026-08-01T00:00:00.000Z'),
        ]),
      ),
    )
    const startedAt = performance.now()
    const session = start(makePack(sentences), schedules)
    const elapsedMs = performance.now() - startedAt

    expect(activeCount(session)).toBe(MAX_REVIEW_PER_SESSION)
    expect(session.sentenceQueue.length).toBeLessThanOrEqual(MAX_REVIEW_PER_SESSION)
    expect(elapsedMs).toBeLessThan(2_000)
  })
})
