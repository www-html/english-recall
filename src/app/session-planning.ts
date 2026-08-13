import type {
  Lesson,
  LessonPack,
  TargetOccurrence,
} from '../domain/lesson-pack.schema.ts'
import {
  getMasteryPercent,
  MAX_NEW_PER_SESSION,
  MAX_REVIEW_PER_SESSION,
  MAX_TOTAL_ACTIVE_TARGETS,
} from '../learning-engine/index.ts'
import {
  createReviewKey,
  type LearnerProgress,
} from '../persistence/index.ts'

export interface ChoiceOption {
  readonly lexemeId: string
  readonly surfaceText: string
}

export interface DailyLearningPlan {
  readonly pack: LessonPack
  readonly lesson: Lesson
  readonly reviewCount: number
  readonly newCount: number
  readonly estimatedMinutes: number
}

function hashSeed(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function nextRandom(state: number): number {
  let value = state || 0x9e3779b9
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return value >>> 0
}

/** Stable for retries, while the session id changes positions between sessions. */
export function createStableChoices(
  target: TargetOccurrence,
  sessionId: string,
  sentenceId: string,
): readonly ChoiceOption[] {
  const choices: ChoiceOption[] = [
    { lexemeId: target.lexemeId, surfaceText: target.surfaceText },
    ...target.distractors,
  ]
  let randomState = hashSeed(`${sessionId}::${sentenceId}::${target.id}`)

  for (let index = choices.length - 1; index > 0; index -= 1) {
    randomState = nextRandom(randomState)
    const swapIndex = randomState % (index + 1)
    const current = choices[index]
    choices[index] = choices[swapIndex]!
    choices[swapIndex] = current!
  }

  return choices
}

function lessonCounts(
  pack: LessonPack,
  lesson: Lesson,
  progress: LearnerProgress,
  now: number,
  excludedReviewKeys: ReadonlySet<string>,
): Pick<DailyLearningPlan, 'reviewCount' | 'newCount'> {
  const seenLexemes = new Set<string>()
  let reviewCount = 0
  let newCount = 0

  for (const target of lesson.sentences.flatMap((sentence) => sentence.targets)) {
    if (seenLexemes.has(target.lexemeId)) continue
    seenLexemes.add(target.lexemeId)
    if (excludedReviewKeys.has(createReviewKey(pack.id, target.lexemeId))) continue
    const schedule =
      progress.schedulesByLexemeReviewKey[
        createReviewKey(pack.id, target.lexemeId)
      ]

    if (!schedule) {
      newCount += 1
    } else if (
      Date.parse(schedule.dueAt) <= now ||
      getMasteryPercent(schedule) < 40
    ) {
      reviewCount += 1
    }
  }

  const boundedReviews = Math.min(reviewCount, MAX_REVIEW_PER_SESSION)
  return {
    reviewCount: boundedReviews,
    newCount: Math.min(
      newCount,
      MAX_NEW_PER_SESSION,
      MAX_TOTAL_ACTIVE_TARGETS - boundedReviews,
    ),
  }
}

/** Selects an existing lesson so a daily session stays safely resumable. */
export function createDailyLearningPlan(
  packs: readonly LessonPack[],
  progress: LearnerProgress,
  now = Date.now(),
  excludedReviewKeys: ReadonlySet<string> = new Set(),
  eligibleOnly = false,
): DailyLearningPlan | null {
  const candidates = packs.flatMap((pack) =>
    pack.lessons.map((lesson) => {
      const counts = lessonCounts(pack, lesson, progress, now, excludedReviewKeys)
      return {
        pack,
        lesson,
        ...counts,
        estimatedMinutes: Math.max(
          1,
          Math.ceil((counts.reviewCount + counts.newCount) * 0.5),
        ),
      }
    }),
  )

  return (
    candidates
      .filter(
        ({ reviewCount, newCount }) =>
          !eligibleOnly || reviewCount + newCount > 0,
      )
      .sort((left, right) => {
        if (right.reviewCount !== left.reviewCount) {
          return right.reviewCount - left.reviewCount
        }
        const activeDifference =
          right.reviewCount +
          right.newCount -
          (left.reviewCount + left.newCount)
        if (activeDifference !== 0) return activeDifference
        return left.lesson.title.localeCompare(right.lesson.title)
      })[0] ?? null
  )
}
