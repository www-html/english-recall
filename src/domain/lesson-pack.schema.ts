import { z } from 'zod'

const idSchema = z.string().trim().min(1).max(120)
const textSchema = z.string().trim().min(1)
const localeSchema = z.string().trim().min(2).max(35)

export const partOfSpeechSchema = z.enum([
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'preposition',
  'conjunction',
  'determiner',
  'interjection',
  'phrase',
  'other',
])

export const cefrLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])

export const pronunciationSchema = z
  .object({
    ipa: textSchema.optional(),
    note: textSchema.optional(),
  })
  .strict()
  .refine((pronunciation) => pronunciation.ipa || pronunciation.note, {
    message: 'Pronunciation must contain ipa or note',
  })

export const lexemeSchema = z
  .object({
    id: idSchema,
    text: textSchema,
    spokenText: textSchema.optional(),
    partOfSpeech: partOfSpeechSchema,
    meaningVi: textSchema,
    pronunciation: pronunciationSchema.optional(),
  })
  .strict()

export const targetOccurrenceSchema = z
  .object({
    id: idSchema,
    lexemeId: idSchema,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    distractorLexemeIds: z.array(idSchema).length(3),
  })
  .strict()
  .refine((target) => target.end > target.start, {
    message: 'Target end must be greater than start',
    path: ['end'],
  })

export const sentenceSchema = z
  .object({
    id: idSchema,
    displayText: textSchema,
    speechText: textSchema,
    translationVi: textSchema,
    level: cefrLevelSchema,
    topic: textSchema,
    explanation: textSchema.optional(),
    targets: z.array(targetOccurrenceSchema).min(1).max(4),
  })
  .strict()
  .superRefine((sentence, context) => {
    const targetIds = sentence.targets.map((target) => target.id)

    if (new Set(targetIds).size !== targetIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Target ids must be unique within a sentence',
        path: ['targets'],
      })
    }

    const orderedTargets = sentence.targets
      .map((target, index) => ({ target, index }))
      .sort((left, right) => left.target.start - right.target.start)

    for (const { target, index } of orderedTargets) {
      if (target.end > sentence.displayText.length) {
        context.addIssue({
          code: 'custom',
          message: 'Target occurrence must be within displayText',
          path: ['targets', index, 'end'],
        })
      }
    }

    for (let index = 1; index < orderedTargets.length; index += 1) {
      const previous = orderedTargets[index - 1]
      const current = orderedTargets[index]

      if (previous && current && current.target.start < previous.target.end) {
        context.addIssue({
          code: 'custom',
          message: 'Target occurrences must not overlap',
          path: ['targets', current.index],
        })
      }
    }
  })

export const lessonSchema = z
  .object({
    id: idSchema,
    title: textSchema,
    summary: textSchema.optional(),
    estimatedMinutes: z.number().int().positive().optional(),
    sentences: z.array(sentenceSchema).min(1),
  })
  .strict()
  .superRefine((lesson, context) => {
    const sentenceIds = lesson.sentences.map((sentence) => sentence.id)

    if (new Set(sentenceIds).size !== sentenceIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Sentence ids must be unique within a lesson',
        path: ['sentences'],
      })
    }
  })

function normalizedSurface(value: string): string {
  return value.toLocaleLowerCase('en-US')
}

export const lessonPackSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: idSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Expected semantic version'),
    title: textSchema,
    description: textSchema.optional(),
    sourceLanguage: localeSchema,
    targetLanguage: localeSchema,
    lexemes: z.array(lexemeSchema).min(4),
    lessons: z.array(lessonSchema).min(1),
  })
  .strict()
  .superRefine((pack, context) => {
    const lexemeIds = pack.lexemes.map((lexeme) => lexeme.id)
    const lessonIds = pack.lessons.map((lesson) => lesson.id)
    const sentenceIds = pack.lessons.flatMap((lesson) =>
      lesson.sentences.map((sentence) => sentence.id),
    )

    if (new Set(lexemeIds).size !== lexemeIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Lexeme ids must be unique within a pack',
        path: ['lexemes'],
      })
    }

    if (new Set(lessonIds).size !== lessonIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Lesson ids must be unique within a pack',
        path: ['lessons'],
      })
    }

    if (new Set(sentenceIds).size !== sentenceIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Sentence ids must be unique across a pack',
        path: ['lessons'],
      })
    }

    const lexemesById = new Map(
      pack.lexemes.map((lexeme) => [lexeme.id, lexeme] as const),
    )

    pack.lessons.forEach((lesson, lessonIndex) => {
      lesson.sentences.forEach((sentence, sentenceIndex) => {
        sentence.targets.forEach((target, targetIndex) => {
          const targetPath = [
            'lessons',
            lessonIndex,
            'sentences',
            sentenceIndex,
            'targets',
            targetIndex,
          ] as const
          const lexeme = lexemesById.get(target.lexemeId)

          if (!lexeme) {
            context.addIssue({
              code: 'custom',
              message: 'Target lexemeId must reference an existing lexeme',
              path: [...targetPath, 'lexemeId'],
            })
          } else {
            const surface = sentence.displayText.slice(target.start, target.end)

            if (normalizedSurface(surface) !== normalizedSurface(lexeme.text)) {
              context.addIssue({
                code: 'custom',
                message: 'Target occurrence must match the referenced lexeme text',
                path: [...targetPath, 'start'],
              })
            }
          }

          if (
            new Set(target.distractorLexemeIds).size !==
            target.distractorLexemeIds.length
          ) {
            context.addIssue({
              code: 'custom',
              message: 'Distractor lexeme references must be unique',
              path: [...targetPath, 'distractorLexemeIds'],
            })
          }

          target.distractorLexemeIds.forEach((distractorId, distractorIndex) => {
            if (!lexemesById.has(distractorId)) {
              context.addIssue({
                code: 'custom',
                message: 'Distractor must reference an existing lexeme',
                path: [
                  ...targetPath,
                  'distractorLexemeIds',
                  distractorIndex,
                ],
              })
            }

            if (distractorId === target.lexemeId) {
              context.addIssue({
                code: 'custom',
                message: 'A target lexeme cannot distract itself',
                path: [
                  ...targetPath,
                  'distractorLexemeIds',
                  distractorIndex,
                ],
              })
            }
          })
        })
      })
    })
  })

export type PartOfSpeech = z.infer<typeof partOfSpeechSchema>
export type CefrLevel = z.infer<typeof cefrLevelSchema>
export type Pronunciation = z.infer<typeof pronunciationSchema>
export type Lexeme = z.infer<typeof lexemeSchema>
export type TargetOccurrence = z.infer<typeof targetOccurrenceSchema>
export type Sentence = z.infer<typeof sentenceSchema>
export type Lesson = z.infer<typeof lessonSchema>
export type LessonPack = z.infer<typeof lessonPackSchema>

export function parseLessonPack(input: unknown): LessonPack {
  return lessonPackSchema.parse(input)
}
