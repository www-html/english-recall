import { describe, expect, it } from 'vitest'
import starterPackJson from '../data/starter-pack.json'
import { parseLessonPack } from '../domain/lesson-pack.schema.ts'
import { createInitialProgress, createReviewKey } from '../persistence/index.ts'
import {
  createDailyLearningPlan,
  createStableChoices,
} from './session-planning.ts'
import { DefaultLearningEngine } from '../learning-engine/index.ts'

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

  it('counts due lexemes but excludes weak future-due schedules', () => {
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

    expect(plan).toMatchObject({ reviewCount: 1 })
    expect(plan?.newCount).toBe(Math.min(5, lexemeIds.length - 2))
  })

  it('keeps Home counts aligned with engine review eligibility', () => {
    const lesson = pack.lessons[0]!
    const lexemeIds = [
      ...new Set(
        lesson.sentences.flatMap((sentence) =>
          sentence.targets.map((target) => target.lexemeId),
        ),
      ),
    ]
    const now = '2026-08-13T12:00:00.000Z'
    const schedulesByLexemeId = Object.fromEntries(
      lexemeIds.map((lexemeId, index) => [
        lexemeId,
        {
          dueAt:
            index === 0
              ? '2026-08-13T11:00:00.000Z'
              : '2026-09-13T12:00:00.000Z',
          intervalDays: index === 1 ? 1 : 30,
          easeFactor: index === 1 ? 1.3 : 2.5,
          repetitions: 1,
          lapses: index === 1 ? 3 : 0,
        },
      ]),
    )
    const progress = {
      ...createInitialProgress(),
      schedulesByLexemeReviewKey: Object.fromEntries(
        Object.entries(schedulesByLexemeId).map(([lexemeId, schedule]) => [
          createReviewKey(pack.id, lexemeId),
          schedule,
        ]),
      ),
    }
    const plan = createDailyLearningPlan(
      [{ ...pack, lessons: [lesson] }],
      progress,
      Date.parse(now),
    )
    const engine = new DefaultLearningEngine()
    const started = engine.start({
      pack: { ...pack, lessons: [lesson] },
      lessonId: lesson.id,
      schedulesByLexemeId,
      now,
    })
    if (!started.ok || started.value.current.status !== 'active') {
      throw new Error('Expected an active session')
    }

    expect(plan?.reviewCount).toBe(1)
    expect(plan?.newCount).toBe(0)
    expect(started.value.current.session.reviewableOccurrenceKeys).toHaveLength(1)
    expect(started.value.current.session.isPracticeFallback).toBe(false)
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
