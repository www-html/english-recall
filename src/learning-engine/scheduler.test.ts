import { describe, expect, it } from 'vitest'
import { BasicReviewScheduler, getMasteryPercent } from './scheduler.ts'

const reviewedAt = '2026-08-12T12:00:00.000Z'

describe('BasicReviewScheduler', () => {
  const scheduler = new BasicReviewScheduler()

  it('schedules a new good answer for the next day', () => {
    const result = scheduler.schedule(undefined, 'good', reviewedAt)

    expect(result).toMatchObject({ intervalDays: 1, repetitions: 1, lapses: 0 })
    expect(result.dueAt).toBe('2026-08-13T12:00:00.000Z')
  })

  it('returns an incorrect answer quickly and counts a lapse', () => {
    const result = scheduler.schedule(
      {
        dueAt: reviewedAt,
        intervalDays: 8,
        easeFactor: 2.3,
        repetitions: 3,
        lapses: 0,
      },
      'again',
      reviewedAt,
    )

    expect(result.intervalDays).toBe(0)
    expect(result.repetitions).toBe(0)
    expect(result.lapses).toBe(1)
    expect(new Date(result.dueAt).getTime()).toBeGreaterThan(
      new Date(reviewedAt).getTime(),
    )
  })
})

describe('getMasteryPercent', () => {
  it('stays within the 0 to 100 range', () => {
    expect(getMasteryPercent(undefined)).toBe(0)
    expect(
      getMasteryPercent({
        dueAt: reviewedAt,
        intervalDays: 120,
        easeFactor: 2.8,
        repetitions: 20,
        lapses: 0,
      }),
    ).toBe(100)
  })
})
