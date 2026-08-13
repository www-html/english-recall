import type { LessonPack } from './lesson-pack.schema.ts'

export type LessonPackUpdateDecision =
  | {
      readonly action: 'install' | 'replace' | 'unchanged'
      readonly compatibleLexemeIds: readonly string[]
    }
  | {
      readonly action: 'reject'
      readonly reason: 'downgrade' | 'version-conflict'
    }

function compareSemanticVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)

  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

function sameContent(left: LessonPack, right: LessonPack): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Decides whether a fully validated pack may replace the stored pack.
 * Mastery is retained only through stable pack and lexeme ids; this function
 * never guesses mappings for renamed lexemes.
 */
export function decideLessonPackUpdate(
  current: LessonPack | null,
  incoming: LessonPack,
): LessonPackUpdateDecision {
  if (!current || current.id !== incoming.id) {
    return { action: 'install', compatibleLexemeIds: [] }
  }

  const versionOrder = compareSemanticVersions(incoming.version, current.version)
  if (versionOrder < 0) return { action: 'reject', reason: 'downgrade' }
  if (versionOrder === 0) {
    return sameContent(current, incoming)
      ? {
          action: 'unchanged',
          compatibleLexemeIds: current.lexemes.map((lexeme) => lexeme.id),
        }
      : { action: 'reject', reason: 'version-conflict' }
  }

  const currentLexemeIds = new Set(current.lexemes.map((lexeme) => lexeme.id))
  return {
    action: 'replace',
    compatibleLexemeIds: incoming.lexemes.flatMap((lexeme) =>
      currentLexemeIds.has(lexeme.id) ? [lexeme.id] : [],
    ),
  }
}
