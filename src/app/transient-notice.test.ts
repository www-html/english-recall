import { describe, expect, it } from 'vitest'
import {
  getImportNoticeDuration,
  IMPORT_NOTICE_DURATION_MS,
} from './transient-notice.ts'

describe('transient import notices', () => {
  it('dismisses successful and unchanged imports', () => {
    expect(getImportNoticeDuration('Imported 2 lesson packs from Excel.')).toBe(
      IMPORT_NOTICE_DURATION_MS,
    )
    expect(getImportNoticeDuration('“Project English” is already up to date.')).toBe(
      IMPORT_NOTICE_DURATION_MS,
    )
  })

  it('keeps import failures visible', () => {
    expect(getImportNoticeDuration('Could not import this Excel workbook.')).toBeNull()
    expect(getImportNoticeDuration(undefined)).toBeNull()
  })
})
