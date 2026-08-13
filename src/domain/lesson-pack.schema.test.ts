import { describe, expect, it } from 'vitest'
import starterPack from '../data/starter-pack.json'
import type { TargetOccurrence } from './lesson-pack.schema.ts'
import { lessonPackSchema } from './lesson-pack.schema.ts'

const lexemes = [
  {
    id: 'usually.adv.01',
    text: 'usually',
    partOfSpeech: 'adverb',
    meaningVi: 'thường',
  },
  {
    id: 'always.adv.01',
    text: 'always',
    partOfSpeech: 'adverb',
    meaningVi: 'luôn luôn',
  },
  {
    id: 'sometimes.adv.01',
    text: 'sometimes',
    partOfSpeech: 'adverb',
    meaningVi: 'thỉnh thoảng',
  },
  {
    id: 'normally.adv.01',
    text: 'normally',
    partOfSpeech: 'adverb',
    meaningVi: 'thông thường',
  },
  {
    id: 'coffee.noun.01',
    text: 'coffee',
    partOfSpeech: 'noun',
    meaningVi: 'cà phê',
  },
  {
    id: 'tea.noun.01',
    text: 'tea',
    partOfSpeech: 'noun',
    meaningVi: 'trà',
  },
  {
    id: 'water.noun.01',
    text: 'water',
    partOfSpeech: 'noun',
    meaningVi: 'nước',
  },
  {
    id: 'lunch.noun.01',
    text: 'lunch',
    partOfSpeech: 'noun',
    meaningVi: 'bữa trưa',
  },
] as const

const sentenceA = {
  id: 'daily-usually-coffee',
  displayText: 'I usually drink coffee in the morning.',
  speechText: 'I usually drink coffee in the morning.',
  translationVi: 'Tôi thường uống cà phê vào buổi sáng.',
  level: 'A1',
  topic: 'daily-routine',
  targets: [
    {
      id: 'usually',
      lexemeId: 'usually.adv.01',
      start: 2,
      end: 9,
      distractorLexemeIds: [
        'always.adv.01',
        'sometimes.adv.01',
        'normally.adv.01',
      ],
    },
    {
      id: 'coffee',
      lexemeId: 'coffee.noun.01',
      start: 16,
      end: 22,
      distractorLexemeIds: [
        'tea.noun.01',
        'water.noun.01',
        'lunch.noun.01',
      ],
    },
  ],
} as const

const sentenceB = {
  id: 'daily-usually-home',
  displayText: 'She usually gets home at six.',
  speechText: 'She usually gets home at six.',
  translationVi: 'Cô ấy thường về nhà lúc sáu giờ.',
  level: 'A1',
  topic: 'daily-routine',
  explanation: 'Usually đứng trước động từ thường để diễn tả tần suất.',
  targets: [
    {
      id: 'usually',
      lexemeId: 'usually.adv.01',
      start: 4,
      end: 11,
      distractorLexemeIds: [
        'always.adv.01',
        'sometimes.adv.01',
        'normally.adv.01',
      ],
    },
  ],
} as const

const validPack = {
  schemaVersion: 2,
  id: 'starter-en',
  version: '2.0.0',
  title: 'Starter English',
  sourceLanguage: 'vi',
  targetLanguage: 'en-US',
  lexemes,
  lessons: [
    {
      id: 'daily-routines',
      title: 'Daily routines',
      sentences: [sentenceA, sentenceB],
    },
  ],
} as const

describe('lessonPackSchema version 2', () => {
  it('accepts the bundled starter pack', () => {
    const result = lessonPackSchema.parse(starterPack)
    const usuallyContexts = result.lessons.flatMap((lesson) =>
      lesson.sentences.filter((sentence) =>
        sentence.targets.some(
          (target) => target.lexemeId === 'usually.adv.01',
        ),
      ),
    )

    expect(usuallyContexts).toHaveLength(4)
    expect(
      result.lessons.some((lesson) =>
        lesson.sentences.some((sentence) => sentence.targets.length > 1),
      ),
    ).toBe(true)
  })

  it('accepts reusable lexemes and multiple targets in one sentence', () => {
    const result = lessonPackSchema.parse(validPack)
    const usuallyTargets = result.lessons.flatMap((lesson) =>
      lesson.sentences.flatMap((sentence) =>
        sentence.targets.filter(
          (target) => target.lexemeId === 'usually.adv.01',
        ),
      ),
    )

    expect(result.schemaVersion).toBe(2)
    expect(result.lessons[0]?.sentences[0]?.targets).toHaveLength(2)
    expect(usuallyTargets).toHaveLength(2)
  })

  it.each([
    {
      name: 'lexeme ids',
      pack: { ...validPack, lexemes: [...lexemes, lexemes[0]] },
      message: 'Lexeme ids must be unique within a pack',
    },
    {
      name: 'lesson ids',
      pack: {
        ...validPack,
        lessons: [validPack.lessons[0], validPack.lessons[0]],
      },
      message: 'Lesson ids must be unique within a pack',
    },
    {
      name: 'sentence ids',
      pack: {
        ...validPack,
        lessons: [
          validPack.lessons[0],
          {
            id: 'another-lesson',
            title: 'Another lesson',
            sentences: [sentenceA],
          },
        ],
      },
      message: 'Sentence ids must be unique across a pack',
    },
    {
      name: 'target ids',
      pack: {
        ...validPack,
        lessons: [
          {
            ...validPack.lessons[0],
            sentences: [
              {
                ...sentenceA,
                targets: [sentenceA.targets[0], sentenceA.targets[0]],
              },
            ],
          },
        ],
      },
      message: 'Target ids must be unique within a sentence',
    },
  ])('rejects duplicate $name', ({ pack, message }) => {
    expect(() => lessonPackSchema.parse(pack)).toThrow(message)
  })

  it('rejects an unknown target lexeme reference', () => {
    const invalidPack = replaceFirstTarget({ lexemeId: 'missing.adv.01' })

    expect(() => lessonPackSchema.parse(invalidPack)).toThrow(
      'Target lexemeId must reference an existing lexeme',
    )
  })

  it('rejects unknown, duplicate, and self-referencing distractors', () => {
    expect(() =>
      lessonPackSchema.parse(
        replaceFirstTarget({
          distractorLexemeIds: [
            'missing.adv.01',
            'always.adv.01',
            'normally.adv.01',
          ],
        }),
      ),
    ).toThrow('Distractor must reference an existing lexeme')

    expect(() =>
      lessonPackSchema.parse(
        replaceFirstTarget({
          distractorLexemeIds: [
            'always.adv.01',
            'always.adv.01',
            'normally.adv.01',
          ],
        }),
      ),
    ).toThrow('Distractor lexeme references must be unique')

    expect(() =>
      lessonPackSchema.parse(
        replaceFirstTarget({
          distractorLexemeIds: [
            'usually.adv.01',
            'always.adv.01',
            'normally.adv.01',
          ],
        }),
      ),
    ).toThrow('A target lexeme cannot distract itself')
  })

  it('rejects invalid target ranges and occurrence text mismatches', () => {
    expect(() =>
      lessonPackSchema.parse(replaceFirstTarget({ start: 2, end: 200 })),
    ).toThrow('Target occurrence must be within displayText')

    expect(() =>
      lessonPackSchema.parse(replaceFirstTarget({ start: 0, end: 1 })),
    ).toThrow('Target occurrence must match the referenced lexeme text')
  })

  it('rejects overlapping target occurrences', () => {
    const invalidPack = {
      ...validPack,
      lessons: [
        {
          ...validPack.lessons[0],
          sentences: [
            {
              ...sentenceA,
              targets: [
                sentenceA.targets[0],
                {
                  ...sentenceA.targets[1],
                  start: 8,
                  end: 14,
                },
              ],
            },
          ],
        },
      ],
    }

    expect(() => lessonPackSchema.parse(invalidPack)).toThrow(
      'Target occurrences must not overlap',
    )
  })

  it('rejects an unsupported schema version and unknown fields', () => {
    expect(() =>
      lessonPackSchema.parse({ ...validPack, schemaVersion: 3 }),
    ).toThrow()
    expect(() =>
      lessonPackSchema.parse({ ...validPack, unexpected: true }),
    ).toThrow()
  })
})

function replaceFirstTarget(
  replacement: Partial<TargetOccurrence>,
) {
  return {
    ...validPack,
    lessons: [
      {
        ...validPack.lessons[0],
        sentences: [
          {
            ...sentenceA,
            targets: [{ ...sentenceA.targets[0], ...replacement }],
          },
          sentenceB,
        ],
      },
    ],
  }
}
