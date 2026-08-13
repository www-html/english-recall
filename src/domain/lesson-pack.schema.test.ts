import { describe, expect, it } from 'vitest'
import { lessonPackSchema } from './lesson-pack.schema.ts'

const validPack = {
  schemaVersion: 1,
  id: 'starter-en',
  version: '1.0.0',
  title: 'Starter English',
  sourceLanguage: 'vi',
  targetLanguage: 'en',
  lessons: [
    {
      id: 'greetings',
      title: 'Greetings',
      items: [
        {
          id: 'hello',
          kind: 'flashcard',
          front: 'hello',
          back: 'xin chào',
        },
      ],
    },
  ],
} as const

describe('lessonPackSchema', () => {
  it('accepts and normalizes a valid lesson pack', () => {
    const result = lessonPackSchema.parse(validPack)

    expect(result.lessons[0]?.items[0]).toMatchObject({ tags: [] })
  })

  it('rejects duplicate learning item ids', () => {
    const duplicateItem = validPack.lessons[0]?.items[0]
    const invalidPack = {
      ...validPack,
      lessons: [{ ...validPack.lessons[0], items: [duplicateItem, duplicateItem] }],
    }

    expect(() => lessonPackSchema.parse(invalidPack)).toThrow(
      'Learning item ids must be unique within a lesson',
    )
  })
})
