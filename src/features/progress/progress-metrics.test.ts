import { describe, expect, it } from 'vitest'
import type { LessonPack } from '../../domain/lesson-pack.schema.ts'
import type { SessionCompletionRecord } from '../../persistence/contracts.ts'
import { resolveDifficultWords, summarizeProgress } from './progress-metrics.ts'

const baseRecord: SessionCompletionRecord = {
  learnerId: 'default',
  sessionId: 'session-1',
  packId: 'pack-1',
  lessonId: 'lesson-1',
  startedAt: '2026-08-02T22:00:00.000Z',
  completedAt: '2026-08-03T04:15:00.000Z',
  reviewedLexemeIds: ['go', 'work'],
  newlyLearnedLexemeIds: ['go'],
  masteredLexemeIds: ['work'],
  difficultLexemeIds: ['go'],
  correctAnswers: 3,
  incorrectAnswers: 1,
  skippedTargets: 0,
}

describe('summarizeProgress', () => {
  it('returns empty metrics when no real session history exists', () => {
    const summary = summarizeProgress(
      [],
      new Date('2026-08-13T12:00:00.000Z'),
      'America/Bogota',
    )

    expect(summary.week.metrics).toEqual({
      sessions: 0,
      studyDays: 0,
      reviewEvents: 0,
      newlyLearned: 0,
      mastered: 0,
      correctAnswers: 0,
      incorrectAnswers: 0,
      accuracyPercent: null,
    })
    expect(summary.month.metrics).toEqual(summary.week.metrics)
  })

  it('uses Monday-based local calendar boundaries in the requested time zone', () => {
    const nextLocalWeek = {
      ...baseRecord,
      sessionId: 'session-2',
      completedAt: '2026-08-03T05:15:00.000Z',
    }
    const summary = summarizeProgress(
      [baseRecord, nextLocalWeek],
      new Date('2026-08-03T03:30:00.000Z'),
      'America/Bogota',
    )

    expect(summary.week.startDate).toBe('2026-07-27')
    expect(summary.week.endDate).toBe('2026-08-02')
    expect(summary.week.metrics.sessions).toBe(1)
    expect(summary.month.metrics.sessions).toBe(2)
  })

  it('deduplicates session ids and counts a lexeme once per session', () => {
    const withRepeatedIds = {
      ...baseRecord,
      reviewedLexemeIds: ['go', 'go', 'work'],
      newlyLearnedLexemeIds: ['go', 'go'],
      difficultLexemeIds: ['go', 'go'],
    }
    const summary = summarizeProgress(
      [withRepeatedIds, { ...withRepeatedIds }],
      new Date('2026-08-02T20:00:00.000Z'),
      'America/Bogota',
    )

    expect(summary.week.metrics).toMatchObject({
      sessions: 1,
      studyDays: 1,
      reviewEvents: 2,
      newlyLearned: 1,
      mastered: 1,
      accuracyPercent: 75,
    })
  })

  it('counts newly learned and mastered words uniquely across the period', () => {
    const secondSession = {
      ...baseRecord,
      sessionId: 'session-2',
      completedAt: '2026-08-03T05:15:00.000Z',
    }
    const summary = summarizeProgress(
      [baseRecord, secondSession],
      new Date('2026-08-03T12:00:00.000Z'),
      'America/Bogota',
    )

    expect(summary.month.metrics.reviewEvents).toBe(4)
    expect(summary.month.metrics.newlyLearned).toBe(1)
    expect(summary.month.metrics.mastered).toBe(1)
  })
})

describe('resolveDifficultWords', () => {
  it('resolves difficult ids to lemmas and ranks repeated session appearances', () => {
    const pack = {
      id: 'pack-1',
      title: 'Starter',
      lexemes: [
        { id: 'go', lemma: 'go', meaningVi: 'đi', partOfSpeech: 'verb' },
        { id: 'work', lemma: 'work', meaningVi: 'làm việc', partOfSpeech: 'verb' },
      ],
    } as LessonPack
    const secondRecord = {
      ...baseRecord,
      sessionId: 'session-2',
      difficultLexemeIds: ['go', 'work'],
    }

    expect(resolveDifficultWords([baseRecord, secondRecord], [pack])).toEqual([
      {
        key: 'pack-1::go',
        lexemeId: 'go',
        lemma: 'go',
        meaningVi: 'đi',
        partOfSpeech: 'verb',
        packTitle: 'Starter',
        sessionCount: 2,
      },
      {
        key: 'pack-1::work',
        lexemeId: 'work',
        lemma: 'work',
        meaningVi: 'làm việc',
        partOfSpeech: 'verb',
        packTitle: 'Starter',
        sessionCount: 1,
      },
    ])
  })
})
