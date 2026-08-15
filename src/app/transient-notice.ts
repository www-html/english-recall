export const IMPORT_NOTICE_DURATION_MS = 4_000

export function getImportNoticeDuration(
  notice: string | undefined,
): number | null {
  if (
    notice?.startsWith('Imported ') ||
    notice?.includes('already up to date')
  ) {
    return IMPORT_NOTICE_DURATION_MS
  }
  return null
}
