import { z } from 'zod'

const idSchema = z.string().trim().min(1).max(120)
const textSchema = z.string().trim().min(1)
const localeSchema = z.string().trim().min(2).max(35)
const semanticVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'Expected semantic version')

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
    lemma: textSchema,
    /** Retained for compatibility until audio content gets its own contract. */
    spokenText: textSchema.optional(),
    partOfSpeech: partOfSpeechSchema,
    meaningVi: textSchema,
    pronunciation: pronunciationSchema.optional(),
  })
  .strict()

export const distractorSchema = z
  .object({
    lexemeId: idSchema,
    surfaceText: textSchema,
  })
  .strict()

export const targetOccurrenceSchema = z
  .object({
    id: idSchema,
    lexemeId: idSchema,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    surfaceText: textSchema,
    distractors: z.array(distractorSchema).length(3),
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
  .superRefine(validateSentenceOccurrences)

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
    addDuplicateIssue(
      lesson.sentences.map((sentence) => sentence.id),
      'Sentence ids must be unique within a lesson',
      ['sentences'],
      context,
    )
  })

export const lessonPackSchema = z
  .object({
    schemaVersion: z.literal(3),
    id: idSchema,
    version: semanticVersionSchema,
    title: textSchema,
    description: textSchema.optional(),
    sourceLanguage: localeSchema,
    targetLanguage: localeSchema,
    lexemes: z.array(lexemeSchema).min(4),
    lessons: z.array(lessonSchema).min(1),
  })
  .strict()
  .superRefine(validatePackReferences)

const version2LexemeSchema = z
  .object({
    id: idSchema,
    text: textSchema,
    spokenText: textSchema.optional(),
    partOfSpeech: partOfSpeechSchema,
    meaningVi: textSchema,
    pronunciation: pronunciationSchema.optional(),
  })
  .strict()

const version2TargetOccurrenceSchema = z
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

const version2SentenceSchema = z
  .object({
    id: idSchema,
    displayText: textSchema,
    speechText: textSchema,
    translationVi: textSchema,
    level: cefrLevelSchema,
    topic: textSchema,
    explanation: textSchema.optional(),
    targets: z.array(version2TargetOccurrenceSchema).min(1).max(4),
  })
  .strict()
  .superRefine((sentence, context) => {
    validateOccurrenceStructure(sentence, context)
  })

const version2LessonSchema = z
  .object({
    id: idSchema,
    title: textSchema,
    summary: textSchema.optional(),
    estimatedMinutes: z.number().int().positive().optional(),
    sentences: z.array(version2SentenceSchema).min(1),
  })
  .strict()
  .superRefine((lesson, context) => {
    addDuplicateIssue(
      lesson.sentences.map((sentence) => sentence.id),
      'Sentence ids must be unique within a lesson',
      ['sentences'],
      context,
    )
  })

const version2LessonPackSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: idSchema,
    version: semanticVersionSchema,
    title: textSchema,
    description: textSchema.optional(),
    sourceLanguage: localeSchema,
    targetLanguage: localeSchema,
    lexemes: z.array(version2LexemeSchema).min(4),
    lessons: z.array(version2LessonSchema).min(1),
  })
  .strict()
  .superRefine(validateVersion2Pack)

type RefinementContext = z.RefinementCtx
type OccurrenceStructure = {
  readonly id: string
  readonly start: number
  readonly end: number
}
type SentenceStructure = {
  readonly displayText: string
  readonly targets: readonly OccurrenceStructure[]
}

function normalizedSurface(value: string): string {
  return value.toLocaleLowerCase('en-US')
}

function addDuplicateIssue(
  ids: readonly string[],
  message: string,
  path: readonly PropertyKey[],
  context: RefinementContext,
): void {
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message, path: [...path] })
  }
}

function validateOccurrenceStructure(
  sentence: SentenceStructure,
  context: RefinementContext,
): void {
  addDuplicateIssue(
    sentence.targets.map((target) => target.id),
    'Target ids must be unique within a sentence',
    ['targets'],
    context,
  )

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
}

function validateSentenceOccurrences(
  sentence: z.infer<typeof sentenceSchema>,
  context: RefinementContext,
): void {
  validateOccurrenceStructure(sentence, context)
  sentence.targets.forEach((target, targetIndex) => {
    const occurrence = sentence.displayText.slice(target.start, target.end)
    if (normalizedSurface(occurrence) !== normalizedSurface(target.surfaceText)) {
      context.addIssue({
        code: 'custom',
        message: 'Target surfaceText must match its displayText occurrence',
        path: ['targets', targetIndex, 'surfaceText'],
      })
    }
  })
}

function validatePackIdentity(
  pack: {
    readonly lexemes: readonly { readonly id: string }[]
    readonly lessons: readonly {
      readonly id: string
      readonly sentences: readonly { readonly id: string }[]
    }[]
  },
  context: RefinementContext,
): void {
  addDuplicateIssue(
    pack.lexemes.map((lexeme) => lexeme.id),
    'Lexeme ids must be unique within a pack',
    ['lexemes'],
    context,
  )
  addDuplicateIssue(
    pack.lessons.map((lesson) => lesson.id),
    'Lesson ids must be unique within a pack',
    ['lessons'],
    context,
  )
  addDuplicateIssue(
    pack.lessons.flatMap((lesson) =>
      lesson.sentences.map((sentence) => sentence.id),
    ),
    'Sentence ids must be unique across a pack',
    ['lessons'],
    context,
  )
}

function targetPath(
  lessonIndex: number,
  sentenceIndex: number,
  targetIndex: number,
): PropertyKey[] {
  return [
    'lessons',
    lessonIndex,
    'sentences',
    sentenceIndex,
    'targets',
    targetIndex,
  ]
}

function validatePackReferences(
  pack: z.infer<typeof lessonPackSchema>,
  context: RefinementContext,
): void {
  validatePackIdentity(pack, context)
  const lexemeIds = new Set(pack.lexemes.map((lexeme) => lexeme.id))

  pack.lessons.forEach((lesson, lessonIndex) => {
    lesson.sentences.forEach((sentence, sentenceIndex) => {
      sentence.targets.forEach((target, targetIndex) => {
        const path = targetPath(lessonIndex, sentenceIndex, targetIndex)
        if (!lexemeIds.has(target.lexemeId)) {
          context.addIssue({
            code: 'custom',
            message: 'Target lexemeId must reference an existing lexeme',
            path: [...path, 'lexemeId'],
          })
        }

        addDuplicateIssue(
          target.distractors.map((distractor) => distractor.lexemeId),
          'Distractor lexeme references must be unique',
          [...path, 'distractors'],
          context,
        )

        target.distractors.forEach((distractor, distractorIndex) => {
          const distractorPath = [...path, 'distractors', distractorIndex, 'lexemeId']
          if (!lexemeIds.has(distractor.lexemeId)) {
            context.addIssue({
              code: 'custom',
              message: 'Distractor must reference an existing lexeme',
              path: distractorPath,
            })
          }
          if (distractor.lexemeId === target.lexemeId) {
            context.addIssue({
              code: 'custom',
              message: 'A target lexeme cannot distract itself',
              path: distractorPath,
            })
          }
        })
      })
    })
  })
}

function validateVersion2Pack(
  pack: z.infer<typeof version2LessonPackSchema>,
  context: RefinementContext,
): void {
  validatePackIdentity(pack, context)
  const lexemesById = new Map(pack.lexemes.map((lexeme) => [lexeme.id, lexeme]))

  pack.lessons.forEach((lesson, lessonIndex) => {
    lesson.sentences.forEach((sentence, sentenceIndex) => {
      sentence.targets.forEach((target, targetIndex) => {
        const path = targetPath(lessonIndex, sentenceIndex, targetIndex)
        const lexeme = lexemesById.get(target.lexemeId)
        if (!lexeme) {
          context.addIssue({
            code: 'custom',
            message: 'Target lexemeId must reference an existing lexeme',
            path: [...path, 'lexemeId'],
          })
        } else {
          const occurrence = sentence.displayText.slice(target.start, target.end)
          if (normalizedSurface(occurrence) !== normalizedSurface(lexeme.text)) {
            context.addIssue({
              code: 'custom',
              message: 'Target occurrence must match the referenced lexeme text',
              path: [...path, 'start'],
            })
          }
        }

        addDuplicateIssue(
          target.distractorLexemeIds,
          'Distractor lexeme references must be unique',
          [...path, 'distractorLexemeIds'],
          context,
        )
        target.distractorLexemeIds.forEach((distractorId, distractorIndex) => {
          const distractorPath = [
            ...path,
            'distractorLexemeIds',
            distractorIndex,
          ]
          if (!lexemesById.has(distractorId)) {
            context.addIssue({
              code: 'custom',
              message: 'Distractor must reference an existing lexeme',
              path: distractorPath,
            })
          }
          if (distractorId === target.lexemeId) {
            context.addIssue({
              code: 'custom',
              message: 'A target lexeme cannot distract itself',
              path: distractorPath,
            })
          }
        })
      })
    })
  })
}

function migrateVersion2(
  pack: z.infer<typeof version2LessonPackSchema>,
): LessonPack {
  const lexemesById = new Map(pack.lexemes.map((lexeme) => [lexeme.id, lexeme]))
  return lessonPackSchema.parse({
    ...pack,
    schemaVersion: 3,
    lexemes: pack.lexemes.map(({ text, ...lexeme }) => ({
      ...lexeme,
      lemma: text,
    })),
    lessons: pack.lessons.map((lesson) => ({
      ...lesson,
      sentences: lesson.sentences.map((sentence) => ({
        ...sentence,
        targets: sentence.targets.map(({ distractorLexemeIds, ...target }) => ({
          ...target,
          surfaceText: sentence.displayText.slice(target.start, target.end),
          distractors: distractorLexemeIds.map((lexemeId) => ({
            lexemeId,
            surfaceText: lexemesById.get(lexemeId)?.text,
          })),
        })),
      })),
    })),
  })
}

export type PartOfSpeech = z.infer<typeof partOfSpeechSchema>
export type CefrLevel = z.infer<typeof cefrLevelSchema>
export type Pronunciation = z.infer<typeof pronunciationSchema>
export type Lexeme = z.infer<typeof lexemeSchema>
export type Distractor = z.infer<typeof distractorSchema>
export type TargetOccurrence = z.infer<typeof targetOccurrenceSchema>
export type Sentence = z.infer<typeof sentenceSchema>
export type Lesson = z.infer<typeof lessonSchema>
export type LessonPack = z.infer<typeof lessonPackSchema>

export function parseLessonPack(input: unknown): LessonPack {
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 2
  ) {
    return migrateVersion2(version2LessonPackSchema.parse(input))
  }
  return lessonPackSchema.parse(input)
}
