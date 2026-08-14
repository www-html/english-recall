import { readSheet } from 'read-excel-file/browser'
import {
  cefrLevelSchema,
  parseLessonPack,
  partOfSpeechSchema,
  type CefrLevel,
  type LessonPack,
  type PartOfSpeech,
} from '../../domain/lesson-pack.schema.ts'

export const EXCEL_LESSON_PACK_COLUMNS = [
  'Pack',
  'Lesson',
  'Topic',
  'Level',
  'English sentence',
  'Vietnamese translation',
  'Target',
  'Lemma',
  'Part of speech',
  'Meaning VI',
  'Distractor 1',
  'Distractor 2',
  'Distractor 3',
  'Explanation',
] as const

export const EXCEL_LESSON_PACK_TEMPLATE_URL =
  `${import.meta.env.BASE_URL}assets/english-recall-lesson-pack-template.xlsx`

export type ExcelLessonPackColumn = (typeof EXCEL_LESSON_PACK_COLUMNS)[number]

export type ExcelImportIssueCode =
  | 'ambiguous-occurrence'
  | 'ambiguous-reference'
  | 'conflict'
  | 'duplicate'
  | 'empty-workbook'
  | 'invalid-header'
  | 'invalid-value'
  | 'missing-occurrence'
  | 'missing-value'
  | 'schema-invalid'
  | 'unknown-reference'

export interface ExcelImportIssue {
  readonly row: number
  readonly column?: ExcelLessonPackColumn
  readonly code: ExcelImportIssueCode
  readonly message: string
}

export class ExcelLessonPackImportError extends Error {
  readonly issues: readonly ExcelImportIssue[]

  constructor(issues: readonly ExcelImportIssue[]) {
    super(
      issues.length === 1
        ? issues[0]?.message
        : `The workbook contains ${issues.length} authoring errors.`,
    )
    this.name = 'ExcelLessonPackImportError'
    this.issues = issues
  }
}

type WorkbookCell = string | number | boolean | Date | null | undefined
type WorkbookRows = readonly (readonly WorkbookCell[])[]

interface AuthorRow {
  readonly rowNumber: number
  readonly pack: string
  readonly lesson: string
  readonly topic: string
  readonly level: CefrLevel
  readonly sentence: string
  readonly translationVi: string
  readonly target: string
  readonly lemma: string
  readonly partOfSpeech: PartOfSpeech
  readonly meaningVi: string
  readonly distractors: readonly [string, string, string]
  readonly explanation?: string
}

interface LexemeDraft {
  readonly id: string
  readonly lemma: string
  readonly partOfSpeech: PartOfSpeech
  readonly meaningVi: string
  readonly firstRow: number
  readonly surfaces: Set<string>
}

interface TargetDraft {
  readonly rowNumber: number
  readonly id: string
  readonly lexemeId: string
  readonly start: number
  readonly end: number
  readonly surfaceText: string
  readonly distractorValues: readonly [string, string, string]
}

interface SentenceDraft {
  readonly id: string
  readonly firstRow: number
  readonly displayText: string
  readonly translationVi: string
  readonly level: CefrLevel
  readonly topic: string
  readonly explanation?: string
  readonly targets: TargetDraft[]
  readonly targetOccurrenceKeys: Set<string>
}

interface LessonDraft {
  readonly id: string
  readonly title: string
  readonly sentences: SentenceDraft[]
  readonly sentencesByKey: Map<string, SentenceDraft>
}

interface PackDraft {
  readonly id: string
  readonly firstRow: number
  readonly title: string
  readonly lexemes: LexemeDraft[]
  readonly lexemesByIdentity: Map<string, LexemeDraft>
  readonly lessons: LessonDraft[]
  readonly lessonsByKey: Map<string, LessonDraft>
}

interface LocatedTarget {
  readonly surfaceText: string
  readonly start: number
  readonly end: number
}

interface DistractorSpecifier {
  readonly surfaceText: string
  readonly lemma?: string
  readonly partOfSpeech?: PartOfSpeech
}

const REQUIRED_COLUMNS = EXCEL_LESSON_PACK_COLUMNS.filter(
  (column) => column !== 'Explanation',
)

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function slug(value: string): string {
  const result = value
    .normalize('NFKD')
    .replace(/[đĐ]/g, 'd')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (result || 'item').slice(0, 56)
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(7, '0')
}

function stableId(prefix: string, label: string, identity: string): string {
  return `${prefix}-${slug(label)}-${stableHash(identity)}`
}

function isEmptyRow(row: readonly WorkbookCell[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === '')
}

function cellText(
  row: readonly WorkbookCell[],
  rowNumber: number,
  column: ExcelLessonPackColumn,
  indexes: ReadonlyMap<ExcelLessonPackColumn, number>,
  issues: ExcelImportIssue[],
  required = true,
): string | undefined {
  const index = indexes.get(column)
  const value = index === undefined ? undefined : row[index]
  if (value === null || value === undefined || String(value).trim() === '') {
    if (required) {
      issues.push({
        row: rowNumber,
        column,
        code: 'missing-value',
        message: `Row ${rowNumber}: "${column}" is required.`,
      })
    }
    return undefined
  }
  if (typeof value !== 'string') {
    issues.push({
      row: rowNumber,
      column,
      code: 'invalid-value',
      message: `Row ${rowNumber}: "${column}" must be text.`,
    })
    return undefined
  }
  return value.trim()
}

function readHeaderIndexes(
  header: readonly WorkbookCell[],
  issues: ExcelImportIssue[],
): ReadonlyMap<ExcelLessonPackColumn, number> {
  const allowed = new Set<string>(EXCEL_LESSON_PACK_COLUMNS)
  const indexes = new Map<ExcelLessonPackColumn, number>()

  header.forEach((cell, index) => {
    if (cell === null || cell === undefined || String(cell).trim() === '') return
    if (typeof cell !== 'string' || !allowed.has(cell.trim())) {
      issues.push({
        row: 1,
        code: 'invalid-header',
        message: `Row 1: unknown column "${String(cell)}". Use the official template headers.`,
      })
      return
    }
    const column = cell.trim() as ExcelLessonPackColumn
    if (indexes.has(column)) {
      issues.push({
        row: 1,
        column,
        code: 'duplicate',
        message: `Row 1: column "${column}" appears more than once.`,
      })
      return
    }
    indexes.set(column, index)
  })

  for (const column of EXCEL_LESSON_PACK_COLUMNS) {
    if (!indexes.has(column)) {
      issues.push({
        row: 1,
        column,
        code: 'invalid-header',
        message: `Row 1: required template column "${column}" is missing.`,
      })
    }
  }
  return indexes
}

function parseAuthorRows(
  rows: WorkbookRows,
  indexes: ReadonlyMap<ExcelLessonPackColumn, number>,
  issues: ExcelImportIssue[],
): readonly AuthorRow[] {
  const parsed: AuthorRow[] = []
  const signatures = new Map<string, number>()

  rows.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2
    if (isEmptyRow(row)) return

    const values = new Map<ExcelLessonPackColumn, string | undefined>()
    for (const column of REQUIRED_COLUMNS) {
      values.set(column, cellText(row, rowNumber, column, indexes, issues))
    }
    values.set(
      'Explanation',
      cellText(row, rowNumber, 'Explanation', indexes, issues, false),
    )

    const levelResult = cefrLevelSchema.safeParse(values.get('Level'))
    if (!levelResult.success && values.get('Level')) {
      issues.push({
        row: rowNumber,
        column: 'Level',
        code: 'invalid-value',
        message: `Row ${rowNumber}: "Level" must be A1, A2, B1, B2, C1, or C2.`,
      })
    }
    const partOfSpeechResult = partOfSpeechSchema.safeParse(values.get('Part of speech'))
    if (!partOfSpeechResult.success && values.get('Part of speech')) {
      issues.push({
        row: rowNumber,
        column: 'Part of speech',
        code: 'invalid-value',
        message: `Row ${rowNumber}: "Part of speech" is not supported.`,
      })
    }

    const requiredValuesPresent = REQUIRED_COLUMNS.every((column) => values.get(column))
    if (!requiredValuesPresent || !levelResult.success || !partOfSpeechResult.success) return

    const distractors = [
      values.get('Distractor 1'),
      values.get('Distractor 2'),
      values.get('Distractor 3'),
    ] as const
    if (!distractors[0] || !distractors[1] || !distractors[2]) return

    const signature = EXCEL_LESSON_PACK_COLUMNS.map((column) =>
      normalize(values.get(column) ?? ''),
    ).join('\u001f')
    const duplicateOf = signatures.get(signature)
    if (duplicateOf !== undefined) {
      issues.push({
        row: rowNumber,
        code: 'duplicate',
        message: `Row ${rowNumber}: duplicates row ${duplicateOf}.`,
      })
      return
    }
    signatures.set(signature, rowNumber)

    const explanation = values.get('Explanation')
    parsed.push({
      rowNumber,
      pack: values.get('Pack')!,
      lesson: values.get('Lesson')!,
      topic: values.get('Topic')!,
      level: levelResult.data,
      sentence: values.get('English sentence')!,
      translationVi: values.get('Vietnamese translation')!,
      target: values.get('Target')!,
      lemma: values.get('Lemma')!,
      partOfSpeech: partOfSpeechResult.data,
      meaningVi: values.get('Meaning VI')!,
      distractors: [distractors[0], distractors[1], distractors[2]],
      ...(explanation ? { explanation } : {}),
    })
  })
  return parsed
}

function findOccurrences(sentence: string, surfaceText: string): readonly number[] {
  const starts: number[] = []
  let fromIndex = 0
  while (fromIndex <= sentence.length - surfaceText.length) {
    const index = sentence.indexOf(surfaceText, fromIndex)
    if (index === -1) break
    starts.push(index)
    fromIndex = index + Math.max(surfaceText.length, 1)
  }
  return starts
}

function locateTarget(
  sentence: string,
  targetValue: string,
  rowNumber: number,
  issues: ExcelImportIssue[],
): LocatedTarget | undefined {
  const match = /^(.*?)(?:#([1-9]\d*))?$/.exec(targetValue)
  const surfaceText = match?.[1]?.trim() ?? ''
  const selectedOccurrence = match?.[2] ? Number(match[2]) : undefined
  if (!surfaceText) {
    issues.push({
      row: rowNumber,
      column: 'Target',
      code: 'invalid-value',
      message: `Row ${rowNumber}: "Target" must contain target text before an optional #N occurrence suffix.`,
    })
    return undefined
  }

  const starts = findOccurrences(sentence, surfaceText)
  if (starts.length === 0) {
    issues.push({
      row: rowNumber,
      column: 'Target',
      code: 'missing-occurrence',
      message: `Row ${rowNumber}: target "${surfaceText}" does not occur exactly in the English sentence.`,
    })
    return undefined
  }
  if (selectedOccurrence === undefined && starts.length > 1) {
    issues.push({
      row: rowNumber,
      column: 'Target',
      code: 'ambiguous-occurrence',
      message: `Row ${rowNumber}: target "${surfaceText}" occurs ${starts.length} times. Use "${surfaceText}#1", "${surfaceText}#2", and so on.`,
    })
    return undefined
  }

  const occurrenceNumber = selectedOccurrence ?? 1
  const start = starts[occurrenceNumber - 1]
  if (start === undefined) {
    issues.push({
      row: rowNumber,
      column: 'Target',
      code: 'missing-occurrence',
      message: `Row ${rowNumber}: target "${surfaceText}" has no occurrence #${occurrenceNumber}.`,
    })
    return undefined
  }
  return { surfaceText, start, end: start + surfaceText.length }
}

function sentenceMetadataMatches(sentence: SentenceDraft, row: AuthorRow): boolean {
  return (
    sentence.displayText === row.sentence &&
    sentence.translationVi === row.translationVi &&
    sentence.level === row.level &&
    sentence.topic === row.topic &&
    (sentence.explanation ?? '') === (row.explanation ?? '')
  )
}

function buildDrafts(
  rows: readonly AuthorRow[],
  issues: ExcelImportIssue[],
): readonly PackDraft[] {
  const packs: PackDraft[] = []
  const packsByKey = new Map<string, PackDraft>()

  for (const row of rows) {
    const packKey = normalize(row.pack)
    let pack = packsByKey.get(packKey)
    if (!pack) {
      pack = {
        id: stableId('pack', row.pack, packKey),
        firstRow: row.rowNumber,
        title: row.pack,
        lexemes: [],
        lexemesByIdentity: new Map(),
        lessons: [],
        lessonsByKey: new Map(),
      }
      packsByKey.set(packKey, pack)
      packs.push(pack)
    }

    const lexemeIdentity = `${normalize(row.lemma)}|${row.partOfSpeech}`
    let lexeme = pack.lexemesByIdentity.get(lexemeIdentity)
    if (!lexeme) {
      lexeme = {
        id: stableId('lexeme', row.lemma, lexemeIdentity),
        lemma: row.lemma,
        partOfSpeech: row.partOfSpeech,
        meaningVi: row.meaningVi,
        firstRow: row.rowNumber,
        surfaces: new Set(),
      }
      pack.lexemesByIdentity.set(lexemeIdentity, lexeme)
      pack.lexemes.push(lexeme)
    } else if (normalize(lexeme.meaningVi) !== normalize(row.meaningVi)) {
      issues.push({
        row: row.rowNumber,
        column: 'Meaning VI',
        code: 'conflict',
        message: `Row ${row.rowNumber}: lemma "${row.lemma}" (${row.partOfSpeech}) conflicts with its meaning on row ${lexeme.firstRow}.`,
      })
      continue
    }

    const lessonKey = normalize(row.lesson)
    let lesson = pack.lessonsByKey.get(lessonKey)
    if (!lesson) {
      lesson = {
        id: stableId('lesson', row.lesson, `${packKey}|${lessonKey}`),
        title: row.lesson,
        sentences: [],
        sentencesByKey: new Map(),
      }
      pack.lessonsByKey.set(lessonKey, lesson)
      pack.lessons.push(lesson)
    }

    const sentenceKey = normalize(row.sentence)
    let sentence = lesson.sentencesByKey.get(sentenceKey)
    if (!sentence) {
      sentence = {
        id: stableId(
          'sentence',
          row.sentence.slice(0, 36),
          `${packKey}|${lessonKey}|${sentenceKey}`,
        ),
        firstRow: row.rowNumber,
        displayText: row.sentence,
        translationVi: row.translationVi,
        level: row.level,
        topic: row.topic,
        ...(row.explanation ? { explanation: row.explanation } : {}),
        targets: [],
        targetOccurrenceKeys: new Set(),
      }
      lesson.sentencesByKey.set(sentenceKey, sentence)
      lesson.sentences.push(sentence)
    } else if (!sentenceMetadataMatches(sentence, row)) {
      issues.push({
        row: row.rowNumber,
        column: 'English sentence',
        code: 'conflict',
        message: `Row ${row.rowNumber}: sentence metadata conflicts with the same sentence on row ${sentence.firstRow}.`,
      })
      continue
    }

    const occurrence = locateTarget(row.sentence, row.target, row.rowNumber, issues)
    if (!occurrence) continue
    lexeme.surfaces.add(normalize(occurrence.surfaceText))

    const occurrenceKey = `${occurrence.start}:${occurrence.end}`
    if (sentence.targetOccurrenceKeys.has(occurrenceKey)) {
      issues.push({
        row: row.rowNumber,
        column: 'Target',
        code: 'duplicate',
        message: `Row ${row.rowNumber}: this target occurrence is already defined for the sentence.`,
      })
      continue
    }
    if (sentence.targets.length >= 4) {
      issues.push({
        row: row.rowNumber,
        column: 'Target',
        code: 'invalid-value',
        message: `Row ${row.rowNumber}: a sentence can contain at most 4 targets.`,
      })
      continue
    }
    sentence.targetOccurrenceKeys.add(occurrenceKey)
    sentence.targets.push({
      rowNumber: row.rowNumber,
      id: stableId(
        'target',
        occurrence.surfaceText,
        `${sentence.id}|${occurrence.start}|${occurrence.end}|${lexeme.id}`,
      ),
      lexemeId: lexeme.id,
      ...occurrence,
      distractorValues: row.distractors,
    })
  }
  return packs
}

function parseDistractorSpecifier(
  value: string,
  rowNumber: number,
  column: ExcelLessonPackColumn,
  issues: ExcelImportIssue[],
): DistractorSpecifier | undefined {
  const parts = value.split('|').map((part) => part.trim())
  if (parts.length === 1 && parts[0]) return { surfaceText: parts[0] }

  if (parts.length === 2 && parts[0]) {
    const partOfSpeech = partOfSpeechSchema.safeParse(parts[1])
    if (partOfSpeech.success) {
      return { surfaceText: parts[0], partOfSpeech: partOfSpeech.data }
    }
  }

  if (parts.length === 3 && parts[0] && parts[1]) {
    const partOfSpeech = partOfSpeechSchema.safeParse(parts[2])
    if (partOfSpeech.success) {
      return {
        surfaceText: parts[0],
        lemma: parts[1],
        partOfSpeech: partOfSpeech.data,
      }
    }
  }

  issues.push({
    row: rowNumber,
    column,
    code: 'invalid-value',
    message: `Row ${rowNumber}: "${column}" must use "surface", "surface | partOfSpeech", or "surface | lemma | partOfSpeech".`,
  })
  return undefined
}

function resolveDistractor(
  value: string,
  rowNumber: number,
  column: ExcelLessonPackColumn,
  pack: PackDraft,
  issues: ExcelImportIssue[],
): { readonly lexemeId: string; readonly surfaceText: string } | undefined {
  const specifier = parseDistractorSpecifier(value, rowNumber, column, issues)
  if (!specifier) return undefined

  const surfaceIdentity = normalize(specifier.surfaceText)
  const lemmaIdentity = specifier.lemma ? normalize(specifier.lemma) : undefined
  const candidates = pack.lexemes.filter((lexeme) => {
    if (specifier.partOfSpeech && lexeme.partOfSpeech !== specifier.partOfSpeech) {
      return false
    }
    if (lemmaIdentity) return normalize(lexeme.lemma) === lemmaIdentity
    return normalize(lexeme.lemma) === surfaceIdentity || lexeme.surfaces.has(surfaceIdentity)
  })

  if (candidates.length === 0) {
    issues.push({
      row: rowNumber,
      column,
      code: 'unknown-reference',
      message: `Row ${rowNumber}: distractor "${value}" does not reference a lexeme defined by a Target/Lemma row in this pack.`,
    })
    return undefined
  }
  if (candidates.length > 1) {
    issues.push({
      row: rowNumber,
      column,
      code: 'ambiguous-reference',
      message: `Row ${rowNumber}: distractor "${value}" is ambiguous. Use "surface | lemma | partOfSpeech".`,
    })
    return undefined
  }
  return { lexemeId: candidates[0]!.id, surfaceText: specifier.surfaceText }
}

function finalizePack(pack: PackDraft, issues: ExcelImportIssue[]): LessonPack | undefined {
  const lessons = pack.lessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    sentences: lesson.sentences.map((sentence) => ({
      id: sentence.id,
      displayText: sentence.displayText,
      speechText: sentence.displayText,
      translationVi: sentence.translationVi,
      level: sentence.level,
      topic: sentence.topic,
      ...(sentence.explanation ? { explanation: sentence.explanation } : {}),
      targets: sentence.targets.map((target) => {
        const distractors = target.distractorValues.map((value, index) =>
          resolveDistractor(
            value,
            target.rowNumber,
            `Distractor ${index + 1}` as ExcelLessonPackColumn,
            pack,
            issues,
          ),
        )
        const resolved = distractors.filter(
          (distractor): distractor is NonNullable<typeof distractor> => Boolean(distractor),
        )
        if (resolved.length === 3) {
          const ids = resolved.map((distractor) => distractor.lexemeId)
          if (new Set(ids).size !== 3) {
            issues.push({
              row: target.rowNumber,
              column: 'Distractor 1',
              code: 'duplicate',
              message: `Row ${target.rowNumber}: distractors must reference 3 different lexemes.`,
            })
          }
          if (ids.includes(target.lexemeId)) {
            issues.push({
              row: target.rowNumber,
              column: 'Distractor 1',
              code: 'invalid-value',
              message: `Row ${target.rowNumber}: a distractor cannot reference the target lexeme.`,
            })
          }
        }
        return {
          id: target.id,
          lexemeId: target.lexemeId,
          start: target.start,
          end: target.end,
          surfaceText: target.surfaceText,
          distractors: resolved,
        }
      }),
    })),
  }))

  if (issues.length > 0) return undefined
  try {
    return parseLessonPack({
      schemaVersion: 3,
      id: pack.id,
      version: '1.0.0',
      title: pack.title,
      description: 'Created with the English Recall Excel lesson-pack template.',
      sourceLanguage: 'vi',
      targetLanguage: 'en-US',
      lexemes: pack.lexemes.map((lexeme) => ({
        id: lexeme.id,
        lemma: lexeme.lemma,
        partOfSpeech: lexeme.partOfSpeech,
        meaningVi: lexeme.meaningVi,
      })),
      lessons,
    })
  } catch (error) {
    issues.push({
      row: pack.firstRow,
      code: 'schema-invalid',
      message: `Row ${pack.firstRow}: generated pack failed schemaVersion 3 validation: ${error instanceof Error ? error.message : 'unknown validation error'}`,
    })
    return undefined
  }
}

export function parseLessonPackWorkbookRows(rows: WorkbookRows): readonly LessonPack[] {
  const issues: ExcelImportIssue[] = []
  const header = rows[0]
  if (!header) {
    throw new ExcelLessonPackImportError([
      { row: 1, code: 'empty-workbook', message: 'Row 1: the workbook is empty.' },
    ])
  }

  const indexes = readHeaderIndexes(header, issues)
  if (issues.length > 0) throw new ExcelLessonPackImportError(issues)

  const authorRows = parseAuthorRows(rows, indexes, issues)
  if (authorRows.length === 0 && issues.length === 0) {
    issues.push({
      row: 2,
      code: 'empty-workbook',
      message: 'Row 2: add at least one lesson row below the headers.',
    })
  }
  if (issues.length > 0) throw new ExcelLessonPackImportError(issues)

  const drafts = buildDrafts(authorRows, issues)
  if (issues.length > 0) throw new ExcelLessonPackImportError(issues)

  const packs = drafts
    .map((pack) => finalizePack(pack, issues))
    .filter((pack): pack is LessonPack => Boolean(pack))
  if (issues.length > 0) throw new ExcelLessonPackImportError(issues)
  return packs
}

export async function readLessonPacksFromExcel(
  file: File | Blob | ArrayBuffer,
): Promise<readonly LessonPack[]> {
  const rows = await readSheet(file)
  return parseLessonPackWorkbookRows(rows as unknown as WorkbookRows)
}
