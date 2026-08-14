import { describe, expect, it } from 'vitest'
import type { LearningSessionSnapshot, SessionResult } from '../learning-engine/index.ts'
import { DEFAULT_LEARNER_ID } from './contracts.ts'
import { createSessionCompletionRecord } from './session-history.ts'

const completedAt = '2026-08-13T12:05:00.000Z'
const session = {
  id: 'session-history',
  packId: 'pack',
  lessonId: 'lesson',
  startedAt: '2026-08-13T12:00:00.000Z',
  attemptHistory: [
    {
      lexemeId: 'new-word', sentenceId: 's1', targetId: 't1',
      exerciseMode: 'word-choice', outcome: 'correct', firstTry: true,
      wrongAttempts: 0, responseTimeMs: 500, reviewedAt: completedAt,
      nextReviewAt: '2026-08-14T12:05:00.000Z',
    },
    {
      lexemeId: 'practice-only', sentenceId: 's2', targetId: 't2',
      exerciseMode: 'fill-words', outcome: 'correct', firstTry: true,
      wrongAttempts: 0, responseTimeMs: 600, reviewedAt: completedAt,
    },
    {
      lexemeId: 'wrong-only', sentenceId: 's3', targetId: 't3',
      exerciseMode: 'fill-words', outcome: 'incorrect', firstTry: false,
      wrongAttempts: 1, responseTimeMs: 700, reviewedAt: completedAt,
    },
  ],
  attemptsByLexemeId: {
    'new-word': { attempts: 2, correct: 1, incorrect: 1, skipped: 0, lastReviewedAt: completedAt },
    'practice-only': { attempts: 1, correct: 1, incorrect: 0, skipped: 0, lastReviewedAt: completedAt },
    'wrong-only': { attempts: 1, correct: 0, incorrect: 1, skipped: 0, lastReviewedAt: completedAt },
  },
  schedulesByLexemeId: {
    'new-word': { dueAt: '2026-09-13T12:05:00.000Z', intervalDays: 30, easeFactor: 2.5, repetitions: 5, lapses: 0 },
  },
} as unknown as LearningSessionSnapshot

const result = {
  correctAnswers: 2,
  incorrectAnswers: 2,
  skippedTargets: 0,
  completedAt,
} as SessionResult

describe('createSessionCompletionRecord', () => {
  it('records only real SRS commits and deterministic new/mastery facts', () => {
    expect(createSessionCompletionRecord({
      session,
      result,
      preSessionSchedulesByLexemeId: {},
    })).toEqual({
      learnerId: DEFAULT_LEARNER_ID,
      sessionId: 'session-history',
      packId: 'pack',
      lessonId: 'lesson',
      startedAt: '2026-08-13T12:00:00.000Z',
      completedAt,
      reviewedLexemeIds: ['new-word'],
      newlyLearnedLexemeIds: ['new-word'],
      masteredLexemeIds: ['new-word'],
      difficultLexemeIds: ['new-word'],
      correctAnswers: 2,
      incorrectAnswers: 2,
      skippedTargets: 0,
    })
  })

  it('does not report already-scheduled or already-mastered lexemes as new growth', () => {
    const current = session.schedulesByLexemeId['new-word']!
    const record = createSessionCompletionRecord({
      session,
      result,
      preSessionSchedulesByLexemeId: { 'new-word': current },
    })
    expect(record.reviewedLexemeIds).toEqual(['new-word'])
    expect(record.newlyLearnedLexemeIds).toEqual([])
    expect(record.masteredLexemeIds).toEqual([])
  })
})
