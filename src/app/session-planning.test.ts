import { describe, expect, it } from 'vitest'
import starterPackJson from '../data/starter-pack.json'
import { parseLessonPack } from '../domain/lesson-pack.schema.ts'
import { createInitialProgress, createReviewKey } from '../persistence/index.ts'
import {
  createDailyLearningPlan,
  createStableChoices,
} from './session-planning.ts'

const pack = parseLessonPack(starterPackJson)

describe('session planning', () => {
  it('keeps choices stable for retries and varies their position by session', () => {
    const sentence = pack.lessons[0]!.sentences[0]!
    const target = sentence.targets[0]!
    const first = createStableChoices(target, 'session-a', sentence.id)

    expect(createStableChoices(target, 'session-a', sentence.id)).toEqual(first)
    const correctPositions = new Set(
      Array.from({ length: 12 }, (_, index) =>
        createStableChoices(target, `session-${index}`, sentence.id).findIndex(
          (choice) => choice.lexemeId === target.lexemeId,
        ),
      ),
    )
    expect(correctPositions.size).toBeGreaterThan(1)
  })

  it('counts new, due and weak lexemes for the best daily lesson', () => {
    const firstLesson = pack.lessons[0]!
    const lexemeIds = [
      ...new Set(
        firstLesson.sentences.flatMap((sentence) =>
          sentence.targets.map((target) => target.lexemeId),
        ),
      ),
    ]
    const now = '2026-08-13T12:00:00.000Z'
    const progress = {
      ...createInitialProgress(),
      schedulesByLexemeReviewKey: {
        [createReviewKey(pack.id, lexemeIds[0]!)]: {
          dueAt: '2026-08-12T12:00:00.000Z',
          intervalDays: 1,
          easeFactor: 2.5,
          repetitions: 2,
          lapses: 0,
        },
        [createReviewKey(pack.id, lexemeIds[1]!)]: {
          dueAt: '2026-09-12T12:00:00.000Z',
          intervalDays: 30,
          easeFactor: 1.3,
          repetitions: 0,
          lapses: 2,
        },
      },
    }

    const plan = createDailyLearningPlan(
      [{ ...pack, lessons: [firstLesson] }],
      progress,
      Date.parse(now),
    )

    expect(plan).toMatchObject({ reviewCount: 2 })
    expect(plan?.newCount).toBe(Math.min(5, lexemeIds.length - 2))
  })

  it('prefers review work and reports production-bounded daily counts', () => {
    const sourceLesson = pack.lessons[0]!
    const reviewLesson = { ...sourceLesson, id: 'reviews', title: 'Reviews' }
    const newLesson = {
      ...sourceLesson,
      id: 'new-heavy',
      title: 'Many new words',
      sentences: Array.from({ length: 30 }, (_, index) => ({
        ...sourceLesson.sentences[0]!,
        id: `new-sentence-${index}`,
        targets: sourceLesson.sentences[0]!.targets.map((target) => ({
          ...target,
          id: `${target.id}-${index}`,
          lexemeId: `${target.lexemeId}-${index}`,
        })),
      })),
    }
    const expandedPack = {
      ...pack,
      lexemes: [
        ...pack.lexemes,
        ...newLesson.sentences.flatMap((sentence) =>
          sentence.targets.map((target) => ({
            ...pack.lexemes.find((lexeme) => lexeme.id === target.lexemeId.split('-').slice(0, -1).join('-'))!,
            id: target.lexemeId,
          })),
        ),
      ],
      lessons: [newLesson, reviewLesson],
    }
    const reviewLexemeIds = new Set(
      reviewLesson.sentences.flatMap((sentence) =>
        sentence.targets.map((target) => target.lexemeId),
      ),
    )
    const progress = {
      ...createInitialProgress(),
      schedulesByLexemeReviewKey: Object.fromEntries(
        [...reviewLexemeIds].map((lexemeId) => [
          createReviewKey(pack.id, lexemeId),
          {
            dueAt: '2026-08-01T00:00:00.000Z',
            intervalDays: 1,
            easeFactor: 2.5,
            repetitions: 1,
            lapses: 0,
          },
        ]),
      ),
    }

    const plan = createDailyLearningPlan(
      [expandedPack],
      progress,
      Date.parse('2026-08-13T12:00:00.000Z'),
    )

    expect(plan?.lesson.id).toBe('reviews')
    expect(plan?.reviewCount).toBe(reviewLexemeIds.size)
    expect(plan?.newCount).toBe(0)
  })

  it('selects remaining work after a completed bounded session', () => {
    const lesson = pack.lessons[0]!
    const lexemeIds = [
      ...new Set(
        lesson.sentences.flatMap((sentence) =>
          sentence.targets.map((target) => target.lexemeId),
        ),
      ),
    ]
    const excluded = new Set(
      lexemeIds.slice(0, 1).map((lexemeId) => createReviewKey(pack.id, lexemeId)),
    )

    const remaining = createDailyLearningPlan(
      [{ ...pack, lessons: [lesson] }],
      createInitialProgress(),
      Date.parse('2026-08-13T12:00:00.000Z'),
      excluded,
      true,
    )

    expect(remaining).not.toBeNull()
    expect(remaining!.newCount).toBe(
      Math.min(5, Math.max(0, lexemeIds.length - excluded.size)),
    )
    const allExcluded = new Set(
      lexemeIds.map((lexemeId) => createReviewKey(pack.id, lexemeId)),
    )
    expect(
      createDailyLearningPlan(
        [{ ...pack, lessons: [lesson] }],
        createInitialProgress(),
        Date.parse('2026-08-13T12:00:00.000Z'),
        allExcluded,
        true,
      ),
    ).toBeNull()
  })
})
