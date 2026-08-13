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
    expect(plan?.newCount).toBe(lexemeIds.length - 2)
  })
})
