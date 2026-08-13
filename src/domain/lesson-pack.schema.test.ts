import { describe, expect, it } from 'vitest'
import starterPack from '../data/starter-pack.json'
import { lessonPackSchema, parseLessonPack } from './lesson-pack.schema.ts'

function makeVersion3Pack() {
  return {
    schemaVersion: 3,
    id: 'starter-en',
    version: '3.0.0',
    title: 'Starter English',
    sourceLanguage: 'vi',
    targetLanguage: 'en-US',
    lexemes: [
      {
        id: 'go.verb.01',
        lemma: 'go',
        partOfSpeech: 'verb',
        meaningVi: 'đi',
      },
      {
        id: 'work.verb.01',
        lemma: 'work',
        partOfSpeech: 'verb',
        meaningVi: 'làm việc',
      },
      {
        id: 'check.verb.01',
        lemma: 'check',
        partOfSpeech: 'verb',
        meaningVi: 'kiểm tra',
      },
      {
        id: 'be.verb.01',
        lemma: 'be',
        partOfSpeech: 'verb',
        meaningVi: 'là, thì, ở',
      },
    ],
    lessons: [
      {
        id: 'verb-forms',
        title: 'Verb forms',
        sentences: [
          {
            id: 'went-home',
            displayText: 'Yesterday I went home early.',
            speechText: 'Yesterday I went home early.',
            translationVi: 'Hôm qua tôi về nhà sớm.',
            level: 'A2',
            topic: 'verb-forms',
            targets: [
              {
                id: 'went',
                lexemeId: 'go.verb.01',
                start: 12,
                end: 16,
                surfaceText: 'went',
                distractors: [
                  { lexemeId: 'work.verb.01', surfaceText: 'worked' },
                  { lexemeId: 'check.verb.01', surfaceText: 'checked' },
                  { lexemeId: 'be.verb.01', surfaceText: 'was' },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

function makeVersion2Pack() {
  return {
    schemaVersion: 2,
    id: 'legacy-v2',
    version: '2.1.0',
    title: 'Version 2 pack',
    sourceLanguage: 'vi',
    targetLanguage: 'en-US',
    lexemes: [
      {
        id: 'usually.adv.01',
        text: 'usually',
        spokenText: 'usually',
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
    ],
    lessons: [
      {
        id: 'daily-routines',
        title: 'Daily routines',
        sentences: [
          {
            id: 'usually-home',
            displayText: 'She Usually gets home at six.',
            speechText: 'She Usually gets home at six.',
            translationVi: 'Cô ấy thường về nhà lúc sáu giờ.',
            level: 'A1',
            topic: 'daily-routine',
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
          },
        ],
      },
    ],
  }
}

describe('lessonPackSchema version 3', () => {
  it('accepts the bundled starter pack with reusable inflected lexemes', () => {
    const result = lessonPackSchema.parse(starterPack)
    const surfacesByLexeme = result.lessons
      .flatMap((lesson) =>
        lesson.sentences.flatMap((sentence) => sentence.targets),
      )
      .reduce<Record<string, typeof result.lessons[number]['sentences'][number]['targets']>>(
        (groups, target) => ({
          ...groups,
          [target.lexemeId]: [...(groups[target.lexemeId] ?? []), target],
        }),
        {},
      )

    expect(result.schemaVersion).toBe(3)
    expect(result.lexemes.find((lexeme) => lexeme.id === 'go.verb.01')).toMatchObject({
      lemma: 'go',
    })
    expect(surfacesByLexeme['go.verb.01']?.map(({ surfaceText }) => surfaceText)).toEqual([
      'go',
      'went',
    ])
    expect(
      surfacesByLexeme['work.verb.01']?.map(({ surfaceText }) => surfaceText),
    ).toEqual(['work', 'worked'])
    expect(
      surfacesByLexeme['check.verb.01']?.map(({ surfaceText }) => surfaceText),
    ).toEqual(['check', 'checks'])
    expect(surfacesByLexeme['be.verb.01']?.map(({ surfaceText }) => surfaceText)).toEqual([
      'am',
      'was',
    ])
    expect(
      result.lessons.some((lesson) =>
        lesson.sentences.some((sentence) => sentence.targets.length > 1),
      ),
    ).toBe(true)
  })

  it('accepts an inflected surface independent from its lemma', () => {
    const result = lessonPackSchema.parse(makeVersion3Pack())

    expect(result.lexemes[0]?.lemma).toBe('go')
    expect(result.lessons[0]?.sentences[0]?.targets[0]?.surfaceText).toBe('went')
    expect(result.lessons[0]?.sentences[0]?.targets[0]?.distractors).toEqual([
      { lexemeId: 'work.verb.01', surfaceText: 'worked' },
      { lexemeId: 'check.verb.01', surfaceText: 'checked' },
      { lexemeId: 'be.verb.01', surfaceText: 'was' },
    ])
  })

  it('matches target surface text case-insensitively against its exact span', () => {
    const pack = makeVersion3Pack()
    pack.lessons[0]!.sentences[0]!.targets[0]!.surfaceText = 'WENT'

    expect(lessonPackSchema.parse(pack)).toBeDefined()
  })

  it.each([
    {
      name: 'lexeme ids',
      mutate: (pack: ReturnType<typeof makeVersion3Pack>) => {
        pack.lexemes.push({ ...pack.lexemes[0]! })
      },
      message: 'Lexeme ids must be unique within a pack',
    },
    {
      name: 'lesson ids',
      mutate: (pack: ReturnType<typeof makeVersion3Pack>) => {
        pack.lessons.push({ ...pack.lessons[0]! })
      },
      message: 'Lesson ids must be unique within a pack',
    },
    {
      name: 'sentence ids',
      mutate: (pack: ReturnType<typeof makeVersion3Pack>) => {
        pack.lessons.push({
          id: 'another-lesson',
          title: 'Another lesson',
          sentences: [{ ...pack.lessons[0]!.sentences[0]! }],
        })
      },
      message: 'Sentence ids must be unique across a pack',
    },
    {
      name: 'target ids',
      mutate: (pack: ReturnType<typeof makeVersion3Pack>) => {
        const sentence = pack.lessons[0]!.sentences[0]!
        sentence.targets.push({ ...sentence.targets[0]!, start: 17, end: 21 })
      },
      message: 'Target ids must be unique within a sentence',
    },
  ])('rejects duplicate $name', ({ mutate, message }) => {
    const pack = makeVersion3Pack()
    mutate(pack)

    expect(() => lessonPackSchema.parse(pack)).toThrow(message)
  })

  it('rejects unknown target and distractor lexeme references', () => {
    const unknownTarget = makeVersion3Pack()
    unknownTarget.lessons[0]!.sentences[0]!.targets[0]!.lexemeId = 'missing.verb.01'
    expect(() => lessonPackSchema.parse(unknownTarget)).toThrow(
      'Target lexemeId must reference an existing lexeme',
    )

    const unknownDistractor = makeVersion3Pack()
    unknownDistractor.lessons[0]!.sentences[0]!.targets[0]!.distractors[0]!.lexemeId =
      'missing.verb.01'
    expect(() => lessonPackSchema.parse(unknownDistractor)).toThrow(
      'Distractor must reference an existing lexeme',
    )
  })

  it('rejects duplicate and self-referencing distractor lexemes', () => {
    const duplicate = makeVersion3Pack()
    duplicate.lessons[0]!.sentences[0]!.targets[0]!.distractors[1]!.lexemeId =
      'work.verb.01'
    expect(() => lessonPackSchema.parse(duplicate)).toThrow(
      'Distractor lexeme references must be unique',
    )

    const selfReference = makeVersion3Pack()
    selfReference.lessons[0]!.sentences[0]!.targets[0]!.distractors[0]!.lexemeId =
      'go.verb.01'
    expect(() => lessonPackSchema.parse(selfReference)).toThrow(
      'A target lexeme cannot distract itself',
    )
  })

  it('rejects empty presentation text and non-strict distractor objects', () => {
    const emptyTarget = makeVersion3Pack()
    emptyTarget.lessons[0]!.sentences[0]!.targets[0]!.surfaceText = ' '
    expect(() => lessonPackSchema.parse(emptyTarget)).toThrow()

    const emptyDistractor = makeVersion3Pack()
    emptyDistractor.lessons[0]!.sentences[0]!.targets[0]!.distractors[0]!.surfaceText =
      ''
    expect(() => lessonPackSchema.parse(emptyDistractor)).toThrow()

    const extraField = makeVersion3Pack()
    const firstDistractor = extraField.lessons[0]!.sentences[0]!.targets[0]!
      .distractors[0]!
    expect(() =>
      lessonPackSchema.parse({
        ...extraField,
        lessons: [
          {
            ...extraField.lessons[0],
            sentences: [
              {
                ...extraField.lessons[0]!.sentences[0],
                targets: [
                  {
                    ...extraField.lessons[0]!.sentences[0]!.targets[0],
                    distractors: [{ ...firstDistractor, answer: true }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow()
  })

  it('rejects mismatched, out-of-range, and overlapping occurrences', () => {
    const mismatch = makeVersion3Pack()
    mismatch.lessons[0]!.sentences[0]!.targets[0]!.surfaceText = 'gone'
    expect(() => lessonPackSchema.parse(mismatch)).toThrow(
      'Target surfaceText must match its displayText occurrence',
    )

    const outside = makeVersion3Pack()
    outside.lessons[0]!.sentences[0]!.targets[0]!.end = 200
    expect(() => lessonPackSchema.parse(outside)).toThrow(
      'Target occurrence must be within displayText',
    )

    const overlap = makeVersion3Pack()
    const sentence = overlap.lessons[0]!.sentences[0]!
    sentence.targets.push({
      ...sentence.targets[0]!,
      id: 'home',
      lexemeId: 'work.verb.01',
      start: 15,
      end: 20,
      surfaceText: 'home',
      distractors: [
        { lexemeId: 'go.verb.01', surfaceText: 'went' },
        { lexemeId: 'check.verb.01', surfaceText: 'checked' },
        { lexemeId: 'be.verb.01', surfaceText: 'was' },
      ],
    })
    expect(() => lessonPackSchema.parse(overlap)).toThrow(
      'Target occurrences must not overlap',
    )
  })
})

describe('parseLessonPack migration boundary', () => {
  it('losslessly upgrades schema version 2 presentation data to version 3', () => {
    const result = parseLessonPack(makeVersion2Pack())
    const target = result.lessons[0]?.sentences[0]?.targets[0]

    expect(result.schemaVersion).toBe(3)
    expect(result.version).toBe('2.1.0')
    expect(result.lexemes[0]).toMatchObject({
      id: 'usually.adv.01',
      lemma: 'usually',
      spokenText: 'usually',
    })
    expect(result.lexemes[0]).not.toHaveProperty('text')
    expect(target).toMatchObject({
      lexemeId: 'usually.adv.01',
      surfaceText: 'Usually',
      distractors: [
        { lexemeId: 'always.adv.01', surfaceText: 'always' },
        { lexemeId: 'sometimes.adv.01', surfaceText: 'sometimes' },
        { lexemeId: 'normally.adv.01', surfaceText: 'normally' },
      ],
    })
    expect(target).not.toHaveProperty('distractorLexemeIds')
  })

  it('validates version 2 before migration', () => {
    const invalid = makeVersion2Pack()
    invalid.lessons[0]!.sentences[0]!.targets[0]!.distractorLexemeIds[0] =
      'missing.adv.01'

    expect(() => parseLessonPack(invalid)).toThrow(
      'Distractor must reference an existing lexeme',
    )
  })

  it('rejects unsupported versions and unknown fields instead of guessing', () => {
    expect(() =>
      parseLessonPack({ ...makeVersion3Pack(), schemaVersion: 1 }),
    ).toThrow()
    expect(() =>
      parseLessonPack({ ...makeVersion3Pack(), schemaVersion: 4 }),
    ).toThrow()
    expect(() =>
      parseLessonPack({ ...makeVersion2Pack(), unexpected: true }),
    ).toThrow()
  })
})
