// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseLessonPack } from '../../domain/lesson-pack.schema.ts'
import { LessonDetailScreen } from './LessonDetailScreen.tsx'
import { LessonLibraryScreen } from './LessonLibraryScreen.tsx'

const PACK = parseLessonPack({
  schemaVersion: 3, id: 'topics-pack', version: '1.0.0', title: 'Project English',
  sourceLanguage: 'en-US', targetLanguage: 'vi-VN',
  lexemes: [
    { id: 'plan.n', lemma: 'plan', partOfSpeech: 'noun', meaningVi: 'kế hoạch' },
    { id: 'task.n', lemma: 'task', partOfSpeech: 'noun', meaningVi: 'nhiệm vụ' },
    { id: 'team.n', lemma: 'team', partOfSpeech: 'noun', meaningVi: 'đội' },
    { id: 'work.n', lemma: 'work', partOfSpeech: 'noun', meaningVi: 'công việc' },
  ],
  lessons: [{
    id: 'delivery', title: 'Delivery', summary: 'Practice project delivery.', estimatedMinutes: 6,
    sentences: [
      {
        id: 'planning-1', displayText: 'We plan the work.', speechText: 'We plan the work.',
        translationVi: 'Chúng tôi lên kế hoạch.', level: 'A2', topic: 'Planning',
        targets: [{ id: 'plan-target', lexemeId: 'plan.n', start: 3, end: 7, surfaceText: 'plan', distractors: [
          { lexemeId: 'task.n', surfaceText: 'task' }, { lexemeId: 'team.n', surfaceText: 'team' }, { lexemeId: 'work.n', surfaceText: 'work' },
        ] }],
      },
      {
        id: 'testing-1', displayText: 'We test the plan.', speechText: 'We test the plan.',
        translationVi: 'Chúng tôi kiểm tra kế hoạch.', level: 'A2', topic: 'Testing',
        targets: [{ id: 'plan-target', lexemeId: 'plan.n', start: 12, end: 16, surfaceText: 'plan', distractors: [
          { lexemeId: 'task.n', surfaceText: 'task' }, { lexemeId: 'team.n', surfaceText: 'team' }, { lexemeId: 'work.n', surfaceText: 'work' },
        ] }],
      },
    ],
  }],
})

const navigation = {
  onOpenHome: vi.fn(), onOpenLessons: vi.fn(), onOpenSaved: vi.fn(),
  onOpenProgress: vi.fn(), onOpenSettings: vi.fn(),
}

afterEach(cleanup)

describe('lesson drill-down', () => {
  it('opens a pack from the library', () => {
    const onOpenPack = vi.fn()
    render(<LessonLibraryScreen {...navigation} packs={[PACK]} storageAvailable notice={undefined} onOpenPack={onOpenPack} />)
    fireEvent.click(screen.getByRole('button', { name: /Project English/ }))
    expect(onOpenPack).toHaveBeenCalledWith(PACK)
  })

  it('derives topics, validates selection, and sends an explicit start contract', () => {
    const onStartLesson = vi.fn()
    render(
      <LessonDetailScreen
        {...navigation}
        pack={PACK}
        lesson={PACK.lessons[0]!}
        progressPercent={25}
        storageAvailable
        notice={undefined}
        onBack={vi.fn()}
        onStartLesson={onStartLesson}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Planning' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Testing' })).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: /Mix selected topics/ }))
    fireEvent.click(screen.getByRole('button', { name: /Start Lesson/ }))
    expect(onStartLesson).toHaveBeenCalledWith({
      pack: PACK,
      lesson: PACK.lessons[0],
      selectedTopics: ['Planning', 'Testing'],
      mixTopics: false,
    })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Planning' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Testing' }))
    expect(screen.getByRole('button', { name: /Start Lesson/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('Select at least one topic')
  })
})
