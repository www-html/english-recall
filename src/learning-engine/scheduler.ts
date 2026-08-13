import type { ReviewScheduler } from './contracts.ts'
import type { RecallRating, ReviewSchedule } from './state.ts'

const millisecondsPerDay = 86_400_000

function addDays(isoDate: string, days: number): string {
  return new Date(new Date(isoDate).getTime() + days * millisecondsPerDay).toISOString()
}

export class BasicReviewScheduler implements ReviewScheduler {
  schedule(
    previous: ReviewSchedule | undefined,
    rating: RecallRating,
    reviewedAt: string,
  ): ReviewSchedule {
    const ease = previous?.easeFactor ?? 2.3
    const interval = previous?.intervalDays ?? 0
    const repetitions = previous?.repetitions ?? 0
    const lapses = previous?.lapses ?? 0

    if (rating === 'again') {
      return {
        dueAt: addDays(reviewedAt, 10 / 1_440),
        intervalDays: 0,
        easeFactor: Math.max(1.3, ease - 0.2),
        repetitions: 0,
        lapses: lapses + 1,
      }
    }

    if (rating === 'hard') {
      const nextInterval = Math.max(1, Math.round(interval * 1.2))
      return {
        dueAt: addDays(reviewedAt, nextInterval),
        intervalDays: nextInterval,
        easeFactor: Math.max(1.3, ease - 0.15),
        repetitions: repetitions + 1,
        lapses,
      }
    }

    if (rating === 'easy') {
      const nextInterval =
        repetitions === 0 ? 4 : Math.max(4, Math.round(interval * ease * 1.3))
      return {
        dueAt: addDays(reviewedAt, nextInterval),
        intervalDays: nextInterval,
        easeFactor: Math.min(3, ease + 0.15),
        repetitions: repetitions + 1,
        lapses,
      }
    }

    const nextInterval =
      repetitions === 0
        ? 1
        : repetitions === 1
          ? 3
          : Math.max(3, Math.round(interval * ease))

    return {
      dueAt: addDays(reviewedAt, nextInterval),
      intervalDays: nextInterval,
      easeFactor: ease,
      repetitions: repetitions + 1,
      lapses,
    }
  }
}

export function getMasteryPercent(schedule: ReviewSchedule | undefined): number {
  if (!schedule) return 0

  const repetitionScore = Math.min(schedule.repetitions / 5, 1) * 60
  const intervalScore = Math.min(schedule.intervalDays / 30, 1) * 40
  const lapsePenalty = Math.min(schedule.lapses * 5, 25)

  return Math.round(Math.max(0, repetitionScore + intervalScore - lapsePenalty))
}
