import type { LessonPack } from '../../domain/lesson-pack.schema.ts'
import type { SessionCompletionRecord } from '../../persistence/contracts.ts'

export interface ProgressPeriodMetrics {
  readonly sessions: number
  readonly studyDays: number
  /** One review event per unique committed lexeme in each completed session. */
  readonly reviewEvents: number
  readonly newlyLearned: number
  readonly mastered: number
  readonly correctAnswers: number
  readonly incorrectAnswers: number
  readonly accuracyPercent: number | null
}

export interface ProgressPeriod {
  readonly startDate: string
  readonly endDate: string
  readonly records: readonly SessionCompletionRecord[]
  readonly metrics: ProgressPeriodMetrics
}

export interface ProgressSummary {
  readonly week: ProgressPeriod
  readonly month: ProgressPeriod
}

export interface DifficultWordViewModel {
  readonly key: string
  readonly lexemeId: string
  readonly lemma: string
  readonly meaningVi: string
  readonly partOfSpeech: string
  readonly packTitle: string
  /** Number of completed sessions in which this word was difficult. */
  readonly sessionCount: number
}

interface CalendarDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

function calendarDate(value: Date, timeZone: string): CalendarDate | null {
  if (Number.isNaN(value.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  if (!values.year || !values.month || !values.day) return null
  return { year: values.year, month: values.month, day: values.day }
}

function calendarKey(value: CalendarDate): string {
  return [value.year, value.month, value.day]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
    .join('-')
}

function shiftCalendarDate(value: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(value.year, value.month - 1, value.day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function periodRecords(
  records: readonly SessionCompletionRecord[],
  startDate: string,
  endDate: string,
  timeZone: string,
): readonly SessionCompletionRecord[] {
  return dedupeSessions(records).filter((record) => {
    const completedDate = calendarDate(new Date(record.completedAt), timeZone)
    if (!completedDate) return false
    const key = calendarKey(completedDate)
    return key >= startDate && key <= endDate
  })
}

function dedupeSessions(
  records: readonly SessionCompletionRecord[],
): readonly SessionCompletionRecord[] {
  const bySession = new Map<string, SessionCompletionRecord>()
  records.forEach((record) => {
    const key = `${record.learnerId}::${record.sessionId}`
    const previous = bySession.get(key)
    if (!previous || record.completedAt > previous.completedAt) {
      bySession.set(key, record)
    }
  })
  return [...bySession.values()]
}

function uniqueCount(values: readonly string[]): number {
  return new Set(values).size
}

function aggregate(
  records: readonly SessionCompletionRecord[],
  timeZone: string,
): ProgressPeriodMetrics {
  const studyDates = new Set<string>()
  const newlyLearnedWords = new Set<string>()
  const masteredWords = new Set<string>()
  let reviewEvents = 0
  let correctAnswers = 0
  let incorrectAnswers = 0

  records.forEach((record) => {
    const completedDate = calendarDate(new Date(record.completedAt), timeZone)
    if (completedDate) studyDates.add(calendarKey(completedDate))
    reviewEvents += uniqueCount(record.reviewedLexemeIds)
    record.newlyLearnedLexemeIds.forEach((lexemeId) =>
      newlyLearnedWords.add(`${record.packId}::${lexemeId}`),
    )
    record.masteredLexemeIds.forEach((lexemeId) =>
      masteredWords.add(`${record.packId}::${lexemeId}`),
    )
    correctAnswers += record.correctAnswers
    incorrectAnswers += record.incorrectAnswers
  })

  const answered = correctAnswers + incorrectAnswers
  return {
    sessions: records.length,
    studyDays: studyDates.size,
    reviewEvents,
    newlyLearned: newlyLearnedWords.size,
    mastered: masteredWords.size,
    correctAnswers,
    incorrectAnswers,
    accuracyPercent:
      answered === 0 ? null : Math.round((correctAnswers / answered) * 100),
  }
}

export function summarizeProgress(
  records: readonly SessionCompletionRecord[],
  now: Date = new Date(),
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): ProgressSummary {
  const today = calendarDate(now, timeZone)
  if (!today) throw new Error('Progress requires a valid current date')

  const todayAsUtc = new Date(Date.UTC(today.year, today.month - 1, today.day))
  const mondayOffset = (todayAsUtc.getUTCDay() + 6) % 7
  const weekStart = shiftCalendarDate(today, -mondayOffset)
  const weekEnd = shiftCalendarDate(weekStart, 6)
  const monthStart: CalendarDate = { ...today, day: 1 }
  const monthEnd = shiftCalendarDate(
    { year: today.year, month: today.month + 1, day: 1 },
    -1,
  )

  const weekStartDate = calendarKey(weekStart)
  const weekEndDate = calendarKey(weekEnd)
  const monthStartDate = calendarKey(monthStart)
  const monthEndDate = calendarKey(monthEnd)
  const weekRecords = periodRecords(records, weekStartDate, weekEndDate, timeZone)
  const monthRecords = periodRecords(records, monthStartDate, monthEndDate, timeZone)

  return {
    week: {
      startDate: weekStartDate,
      endDate: weekEndDate,
      records: weekRecords,
      metrics: aggregate(weekRecords, timeZone),
    },
    month: {
      startDate: monthStartDate,
      endDate: monthEndDate,
      records: monthRecords,
      metrics: aggregate(monthRecords, timeZone),
    },
  }
}

export function resolveDifficultWords(
  records: readonly SessionCompletionRecord[],
  packs: readonly LessonPack[],
): readonly DifficultWordViewModel[] {
  const lexemesByKey = new Map<
    string,
    { readonly lexeme: LessonPack['lexemes'][number]; readonly packTitle: string }
  >(
    packs.flatMap((pack) =>
      pack.lexemes.map((lexeme) => [
        `${pack.id}::${lexeme.id}`,
        { lexeme, packTitle: pack.title },
      ] as const),
    ),
  )
  const sessionCounts = new Map<string, number>()

  dedupeSessions(records).forEach((record) => {
    new Set(record.difficultLexemeIds).forEach((lexemeId) => {
      const key = `${record.packId}::${lexemeId}`
      if (lexemesByKey.has(key)) {
        sessionCounts.set(key, (sessionCounts.get(key) ?? 0) + 1)
      }
    })
  })

  return [...sessionCounts.entries()]
    .map(([key, sessionCount]) => {
      const resolved = lexemesByKey.get(key)!
      return {
        key,
        lexemeId: resolved.lexeme.id,
        lemma: resolved.lexeme.lemma,
        meaningVi: resolved.lexeme.meaningVi,
        partOfSpeech: resolved.lexeme.partOfSpeech,
        packTitle: resolved.packTitle,
        sessionCount,
      }
    })
    .sort(
      (left, right) =>
        right.sessionCount - left.sessionCount ||
        left.lemma.localeCompare(right.lemma, 'en'),
    )
}
