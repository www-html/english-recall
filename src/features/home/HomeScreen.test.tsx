// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseLessonPack } from '../../domain/lesson-pack.schema.ts'
import { HomeScreen, type HomeScreenProps } from './HomeScreen.tsx'

const PACK = parseLessonPack({
  schemaVersion: 3,
  id: 'home-pack',
  version: '1.0.0',
  title: 'Workplace English',
  description: 'Short workplace contexts.',
  sourceLanguage: 'en-US',
  targetLanguage: 'vi-VN',
  lexemes: [
    { id: 'plan.n', lemma: 'plan', partOfSpeech: 'noun', meaningVi: 'kế hoạch' },
    { id: 'task.n', lemma: 'task', partOfSpeech: 'noun', meaningVi: 'nhiệm vụ' },
    { id: 'team.n', lemma: 'team', partOfSpeech: 'noun', meaningVi: 'đội' },
    { id: 'work.n', lemma: 'work', partOfSpeech: 'noun', meaningVi: 'công việc' },
  ],
  lessons: [{
    id: 'daily-work',
    title: 'Daily work',
    estimatedMinutes: 5,
    sentences: [{
      id: 'daily-work-1',
      displayText: 'We plan the work.',
      speechText: 'We plan the work.',
      translationVi: 'Chúng tôi lên kế hoạch công việc.',
      level: 'A2',
      topic: 'Planning',
      targets: [{
        id: 'plan-target',
        lexemeId: 'plan.n',
        start: 3,
        end: 7,
        surfaceText: 'plan',
        distractors: [
          { lexemeId: 'task.n', surfaceText: 'task' },
          { lexemeId: 'team.n', surfaceText: 'team' },
          { lexemeId: 'work.n', surfaceText: 'work' },
        ],
      }],
    }],
  }],
})

function createProps(overrides: Partial<HomeScreenProps> = {}): HomeScreenProps {
  return {
    packs: [PACK],
    reviewCount: 8,
    newCount: 4,
    estimatedMinutes: 7,
    statistics: { wordsReviewed: 24, masteredWords: 9, accuracyPercent: 83 },
    learningMode: 'auto',
    canResume: false,
    storageAvailable: true,
    notice: undefined,
    onStartLearning: vi.fn(),
    onResume: vi.fn(),
    onLearningModeChange: vi.fn(),
    onOpenPack: vi.fn(),
    onOpenHome: vi.fn(),
    onOpenLessons: vi.fn(),
    onOpenSaved: vi.fn(),
    onOpenProgress: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  }
}

afterEach(cleanup)

describe('HomeScreen learning-first flow', () => {
  it('leads with Today, one primary action, and a compact progress summary', () => {
    const onStartLearning = vi.fn()
    const onOpenProgress = vi.fn()
    render(<HomeScreen {...createProps({ onStartLearning, onOpenProgress })} />)

    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy()
    expect(screen.getByText('12 words ready')).toBeTruthy()
    expect(screen.getByText('~7 min')).toBeTruthy()
    expect(screen.getByText('9')).toBeTruthy()
    expect(screen.getByText('83%')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Start Learning/ }))
    expect(onStartLearning).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: /View Progress/ }))
    expect(onOpenProgress).toHaveBeenCalledOnce()
  })

  it('uses a compact accessible Learning Mode popover', () => {
    const onLearningModeChange = vi.fn()
    render(<HomeScreen {...createProps({ onLearningModeChange })} />)

    const trigger = screen.getByRole('button', { name: 'Auto' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(5)
    fireEvent.click(screen.getByRole('option', { name: /Listening Choice/ }))
    expect(onLearningModeChange).toHaveBeenCalledWith('listening-choice')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('continues an unfinished session with Space outside interactive controls', () => {
    const onResume = vi.fn()
    render(<HomeScreen {...createProps({ canResume: true, onResume })} />)

    fireEvent.keyDown(window, { key: ' ' })
    expect(onResume).toHaveBeenCalledOnce()

    fireEvent.keyDown(screen.getByRole('button', { name: /Continue Learning/ }), {
      key: ' ',
    })
    expect(onResume).toHaveBeenCalledOnce()
  })

  it('shows pack summaries without expanding lessons on Home', () => {
    const onOpenPack = vi.fn()
    render(<HomeScreen {...createProps({ onOpenPack })} />)

    expect(screen.getByText('1 lessons · 1 sentences')).toBeTruthy()
    expect(screen.queryByText('Daily work')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Workplace English/ }))
    expect(onOpenPack).toHaveBeenCalledWith(PACK)
  })

  it('provides accessible mobile navigation callbacks and hides success storage UI', () => {
    const onOpenSaved = vi.fn()
    render(<HomeScreen {...createProps({ onOpenSaved })} />)

    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(navigation).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: 'Saved' }))
    expect(onOpenSaved).toHaveBeenCalledOnce()
    expect(screen.queryByText('Saved locally')).toBeNull()
    expect(screen.queryByText(/Export Diagnostics/)).toBeNull()
  })
})
