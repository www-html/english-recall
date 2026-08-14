import type { LessonPack } from '../domain/lesson-pack.schema.ts'
import { decideLessonPackUpdate } from '../domain/lesson-pack-update.ts'

function nextPatchVersion(version: string): string {
  const [major, minor, patch] = version.split('.').map(Number)
  return `${major}.${minor}.${(patch ?? 0) + 1}`
}

/**
 * Excel keeps versioning out of the authoring sheet. Identical content retains
 * the installed version; changed content receives the next patch version so it
 * still passes the same conservative pack-update policy as JSON imports.
 */
export function prepareExcelPackUpdate(
  current: LessonPack | null,
  imported: LessonPack,
): LessonPack {
  if (!current) return imported
  const atCurrentVersion = { ...imported, version: current.version }
  if (decideLessonPackUpdate(current, atCurrentVersion).action === 'unchanged') {
    return atCurrentVersion
  }
  return { ...imported, version: nextPatchVersion(current.version) }
}
