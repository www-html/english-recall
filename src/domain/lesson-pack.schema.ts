import { z } from 'zod'

const idSchema = z.string().trim().min(1).max(120)
const textSchema = z.string().trim().min(1)
const localeSchema = z.string().trim().min(2).max(35)

const commonItemFields = {
  id: idSchema,
  instructions: textSchema.optional(),
  audioText: textSchema.optional(),
  tags: z.array(textSchema).default([]),
}

export const flashcardItemSchema = z
  .object({
    ...commonItemFields,
    kind: z.literal('flashcard'),
    front: textSchema,
    back: textSchema,
    example: textSchema.optional(),
  })
  .strict()

export const typingItemSchema = z
  .object({
    ...commonItemFields,
    kind: z.literal('typing'),
    prompt: textSchema,
    acceptedAnswers: z.array(textSchema).min(1),
    caseSensitive: z.boolean().default(false),
  })
  .strict()

const choiceSchema = z
  .object({
    id: idSchema,
    text: textSchema,
  })
  .strict()

export const multipleChoiceItemSchema = z
  .object({
    ...commonItemFields,
    kind: z.literal('multiple-choice'),
    prompt: textSchema,
    choices: z.array(choiceSchema).min(2),
    correctChoiceId: idSchema,
  })
  .strict()
  .superRefine((item, context) => {
    const choiceIds = item.choices.map((choice) => choice.id)

    if (new Set(choiceIds).size !== choiceIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Choice ids must be unique within an item',
        path: ['choices'],
      })
    }

    if (!choiceIds.includes(item.correctChoiceId)) {
      context.addIssue({
        code: 'custom',
        message: 'correctChoiceId must reference an existing choice',
        path: ['correctChoiceId'],
      })
    }
  })

export const learningItemSchema = z.discriminatedUnion('kind', [
  flashcardItemSchema,
  typingItemSchema,
  multipleChoiceItemSchema,
])

export const lessonSchema = z
  .object({
    id: idSchema,
    title: textSchema,
    summary: textSchema.optional(),
    estimatedMinutes: z.number().int().positive().optional(),
    items: z.array(learningItemSchema).min(1),
  })
  .strict()
  .superRefine((lesson, context) => {
    const itemIds = lesson.items.map((item) => item.id)

    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Learning item ids must be unique within a lesson',
        path: ['items'],
      })
    }
  })

export const lessonPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Expected semantic version'),
    title: textSchema,
    description: textSchema.optional(),
    sourceLanguage: localeSchema,
    targetLanguage: localeSchema,
    lessons: z.array(lessonSchema).min(1),
  })
  .strict()
  .superRefine((pack, context) => {
    const lessonIds = pack.lessons.map((lesson) => lesson.id)
    const itemIds = pack.lessons.flatMap((lesson) =>
      lesson.items.map((item) => item.id),
    )

    if (new Set(lessonIds).size !== lessonIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Lesson ids must be unique within a pack',
        path: ['lessons'],
      })
    }

    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Learning item ids must be unique across a pack',
        path: ['lessons'],
      })
    }
  })

export type FlashcardItem = z.infer<typeof flashcardItemSchema>
export type TypingItem = z.infer<typeof typingItemSchema>
export type MultipleChoiceItem = z.infer<typeof multipleChoiceItemSchema>
export type LearningItem = z.infer<typeof learningItemSchema>
export type Lesson = z.infer<typeof lessonSchema>
export type LessonPack = z.infer<typeof lessonPackSchema>

export function parseLessonPack(input: unknown): LessonPack {
  return lessonPackSchema.parse(input)
}
