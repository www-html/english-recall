/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseLessonPack } from '../../domain/lesson-pack.schema.ts'
import {
  EXCEL_LESSON_PACK_COLUMNS,
  ExcelLessonPackImportError,
  parseLessonPackWorkbookRows,
  readLessonPacksFromExcel,
} from './excel-lesson-pack.ts'

type Row = readonly (string | null)[]

const header: Row = [...EXCEL_LESSON_PACK_COLUMNS]

function row(overrides: Partial<Record<(typeof EXCEL_LESSON_PACK_COLUMNS)[number], string>>): Row {
  const defaults = {
    Pack: 'Everyday English',
    Lesson: 'Daily routines',
    Topic: 'daily-routine',
    Level: 'A2',
    'English sentence': 'Yesterday I went home early.',
    'Vietnamese translation': 'Hôm qua tôi về nhà sớm.',
    Target: 'went',
    Lemma: 'go',
    'Part of speech': 'verb',
    'Meaning VI': 'đi',
    'Distractor 1': 'worked',
    'Distractor 2': 'checked',
    'Distractor 3': 'was',
    Explanation: 'Use the past form after yesterday.',
  }
  const values = { ...defaults, ...overrides }
  return EXCEL_LESSON_PACK_COLUMNS.map((column) => values[column] ?? null)
}

function validRows(): readonly Row[] {
  return [
    header,
    row({}),
    row({
      'English sentence': 'I worked from home yesterday.',
      'Vietnamese translation': 'Hôm qua tôi làm việc ở nhà.',
      Target: 'worked',
      Lemma: 'work',
      'Meaning VI': 'làm việc',
      'Distractor 1': 'went',
      'Distractor 2': 'checked',
      'Distractor 3': 'was',
    }),
    row({
      'English sentence': 'She checked the report twice.',
      'Vietnamese translation': 'Cô ấy đã kiểm tra báo cáo hai lần.',
      Target: 'checked',
      Lemma: 'check',
      'Meaning VI': 'kiểm tra',
      'Distractor 1': 'went',
      'Distractor 2': 'worked',
      'Distractor 3': 'was',
    }),
    row({
      'English sentence': 'She was home before six.',
      'Vietnamese translation': 'Cô ấy đã ở nhà trước sáu giờ.',
      Target: 'was',
      Lemma: 'be',
      'Meaning VI': 'là, thì, ở',
      'Distractor 1': 'went',
      'Distractor 2': 'worked',
      'Distractor 3': 'checked',
    }),
  ]
}

function issuesFor(rows: readonly Row[]) {
  try {
    parseLessonPackWorkbookRows(rows)
    throw new Error('Expected workbook import to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(ExcelLessonPackImportError)
    return (error as ExcelLessonPackImportError).issues
  }
}

describe('Excel lesson-pack importer', () => {
  it('reads the downloadable browser template into a production-valid pack', async () => {
    const bytes = await readFile(
      new URL('../../../public/assets/english-recall-lesson-pack-template.xlsx', import.meta.url),
    )
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer

    const packs = await readLessonPacksFromExcel(arrayBuffer)

    expect(packs).toHaveLength(1)
    expect(parseLessonPack(packs[0])).toEqual(packs[0])
  })

  it('creates deterministic schemaVersion 3 metadata and valid references', () => {
    const first = parseLessonPackWorkbookRows(validRows())
    const second = parseLessonPackWorkbookRows(validRows())

    expect(first).toEqual(second)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      schemaVersion: 3,
      version: '1.0.0',
      title: 'Everyday English',
      sourceLanguage: 'vi',
      targetLanguage: 'en-US',
    })
    expect(first[0]?.id).toMatch(/^pack-everyday-english-/)
    expect(parseLessonPack(first[0])).toEqual(first[0])
  })

  it('reuses a lemma lexeme for inflected target surfaces', () => {
    const rows = [
      ...validRows(),
      row({
        'English sentence': 'I go home after work.',
        'Vietnamese translation': 'Tôi về nhà sau giờ làm.',
        Target: 'go',
        Lemma: 'go',
        'Meaning VI': 'đi',
        'Distractor 1': 'work | verb',
        'Distractor 2': 'check | verb',
        'Distractor 3': 'be | verb',
      }),
    ]

    const pack = parseLessonPackWorkbookRows(rows)[0]!
    const goLexemes = pack.lexemes.filter(
      (lexeme) => lexeme.lemma === 'go' && lexeme.partOfSpeech === 'verb',
    )
    const surfaces = pack.lessons.flatMap((lesson) =>
      lesson.sentences.flatMap((sentence) =>
        sentence.targets
          .filter((target) => target.lexemeId === goLexemes[0]?.id)
          .map((target) => target.surfaceText),
      ),
    )

    expect(goLexemes).toHaveLength(1)
    expect(surfaces).toEqual(['went', 'go'])
  })

  it('groups several target rows into one sentence without overlapping spans', () => {
    const rows = [
      ...validRows(),
      row({
        'English sentence': 'She checked the report twice.',
        'Vietnamese translation': 'Cô ấy đã kiểm tra báo cáo hai lần.',
        Target: 'report',
        Lemma: 'report',
        'Part of speech': 'noun',
        'Meaning VI': 'báo cáo',
        'Distractor 1': 'home | noun',
        'Distractor 2': 'work | noun',
        'Distractor 3': 'time | noun',
      }),
      row({
        'English sentence': 'My home is quiet.',
        'Vietnamese translation': 'Nhà của tôi yên tĩnh.',
        Target: 'home',
        Lemma: 'home',
        'Part of speech': 'noun',
        'Meaning VI': 'nhà',
        'Distractor 1': 'report | noun',
        'Distractor 2': 'work | noun',
        'Distractor 3': 'time | noun',
      }),
      row({
        'English sentence': 'The work is complete.',
        'Vietnamese translation': 'Công việc đã hoàn tất.',
        Target: 'work',
        Lemma: 'work',
        'Part of speech': 'noun',
        'Meaning VI': 'công việc',
        'Distractor 1': 'report | noun',
        'Distractor 2': 'home | noun',
        'Distractor 3': 'time | noun',
      }),
      row({
        'English sentence': 'We have time.',
        'Vietnamese translation': 'Chúng ta có thời gian.',
        Target: 'time',
        Lemma: 'time',
        'Part of speech': 'noun',
        'Meaning VI': 'thời gian',
        'Distractor 1': 'report | noun',
        'Distractor 2': 'home | noun',
        'Distractor 3': 'work | noun',
      }),
    ]

    const pack = parseLessonPackWorkbookRows(rows)[0]!
    const sentence = pack.lessons[0]?.sentences.find(
      ({ displayText }) => displayText === 'She checked the report twice.',
    )

    expect(sentence?.targets.map((target) => target.surfaceText)).toEqual([
      'checked',
      'report',
    ])
    expect(parseLessonPack(pack)).toEqual(pack)
  })

  it('reports missing, invalid, duplicate, and conflicting rows with row numbers', () => {
    const missing = validRows().map((current, index) =>
      index === 1 ? row({ Lemma: '' }) : current,
    )
    expect(issuesFor(missing)).toContainEqual(
      expect.objectContaining({ row: 2, column: 'Lemma', code: 'missing-value' }),
    )

    const invalid = validRows().map((current, index) =>
      index === 1 ? row({ Level: 'A3' }) : current,
    )
    expect(issuesFor(invalid)).toContainEqual(
      expect.objectContaining({ row: 2, column: 'Level', code: 'invalid-value' }),
    )

    expect(issuesFor([...validRows(), validRows()[1]!])).toContainEqual(
      expect.objectContaining({ row: 6, code: 'duplicate' }),
    )

    const conflicting = [
      ...validRows(),
      row({
        'English sentence': 'I go now.',
        'Vietnamese translation': 'Tôi đi bây giờ.',
        Target: 'go',
        Lemma: 'go',
        'Meaning VI': 'di chuyển sai nghĩa',
        'Distractor 1': 'worked',
        'Distractor 2': 'checked',
        'Distractor 3': 'was',
      }),
    ]
    expect(issuesFor(conflicting)).toContainEqual(
      expect.objectContaining({ row: 6, column: 'Meaning VI', code: 'conflict' }),
    )
  })

  it('reports missing and ambiguous target occurrences and supports #N selection', () => {
    const missing = validRows().map((current, index) =>
      index === 1 ? row({ Target: 'gone' }) : current,
    )
    expect(issuesFor(missing)).toContainEqual(
      expect.objectContaining({ row: 2, code: 'missing-occurrence' }),
    )

    const ambiguous = validRows().map((current, index) =>
      index === 1
        ? row({
            'English sentence': 'go now, then go home.',
            'Vietnamese translation': 'Đi ngay, rồi về nhà.',
            Target: 'go',
          })
        : current,
    )
    expect(issuesFor(ambiguous)).toContainEqual(
      expect.objectContaining({ row: 2, code: 'ambiguous-occurrence' }),
    )

    const selected = ambiguous.map((current, index) => {
      const updated = index === 1
        ? row({
            'English sentence': 'go now, then go home.',
            'Vietnamese translation': 'Đi ngay, rồi về nhà.',
            Target: 'go#2',
          })
        : [...current]
      return updated.map((cell) => (cell === 'went' ? 'go | verb' : cell))
    })
    const target = parseLessonPackWorkbookRows(selected)[0]?.lessons[0]?.sentences[0]
      ?.targets[0]
    expect(target).toMatchObject({ surfaceText: 'go', start: 13, end: 15 })
  })

  it('rejects unknown, duplicate, and self-referencing distractors', () => {
    const unknown = validRows().map((current, index) =>
      index === 1 ? row({ 'Distractor 1': 'missing' }) : current,
    )
    expect(issuesFor(unknown)).toContainEqual(
      expect.objectContaining({ row: 2, code: 'unknown-reference' }),
    )

    const duplicate = validRows().map((current, index) =>
      index === 1 ? row({ 'Distractor 2': 'worked' }) : current,
    )
    expect(issuesFor(duplicate)).toContainEqual(
      expect.objectContaining({ row: 2, code: 'duplicate' }),
    )

    const self = validRows().map((current, index) =>
      index === 1 ? row({ 'Distractor 1': 'went' }) : current,
    )
    expect(issuesFor(self)).toContainEqual(
      expect.objectContaining({ row: 2, code: 'invalid-value' }),
    )
  })
})
