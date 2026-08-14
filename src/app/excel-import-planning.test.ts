import { describe, expect, it } from 'vitest'
import starterPackJson from '../data/starter-pack.json'
import { parseLessonPack } from '../domain/lesson-pack.schema.ts'
import { decideLessonPackUpdate } from '../domain/lesson-pack-update.ts'
import { prepareExcelPackUpdate } from './excel-import-planning.ts'

const pack = parseLessonPack(starterPackJson)

describe('Excel lesson-pack update planning', () => {
  it('keeps the installed version for identical workbook content', () => {
    const current = { ...pack, version: '2.4.7' }
    const prepared = prepareExcelPackUpdate(current, pack)

    expect(prepared.version).toBe('2.4.7')
    expect(decideLessonPackUpdate(current, prepared).action).toBe('unchanged')
  })

  it('bumps the patch version for edited workbook content', () => {
    const current = { ...pack, version: '2.4.7' }
    const prepared = prepareExcelPackUpdate(current, {
      ...pack,
      title: 'Updated from Excel',
    })

    expect(prepared.version).toBe('2.4.8')
    expect(decideLessonPackUpdate(current, prepared).action).toBe('replace')
  })
})
