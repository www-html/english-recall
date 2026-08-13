import { describe, expect, it } from 'vitest'
import starterPackJson from '../data/starter-pack.json'
import { parseLessonPack, type LessonPack } from './lesson-pack.schema.ts'
import { decideLessonPackUpdate } from './lesson-pack-update.ts'

const pack = parseLessonPack(starterPackJson)

function withVersion(version: string, changes: Partial<LessonPack> = {}): LessonPack {
  return { ...pack, ...changes, version }
}

describe('lesson pack replacement policy', () => {
  it('installs a new pack after boundary validation', () => {
    expect(decideLessonPackUpdate(null, pack)).toEqual({
      action: 'install',
      compatibleLexemeIds: [],
    })
  })

  it('rejects a silent semantic downgrade', () => {
    expect(
      decideLessonPackUpdate(withVersion('3.1.0'), withVersion('3.0.9')),
    ).toEqual({ action: 'reject', reason: 'downgrade' })
  })

  it('rejects changed content that reuses the same semantic version', () => {
    expect(
      decideLessonPackUpdate(pack, {
        ...pack,
        title: 'Changed without a version bump',
      }),
    ).toEqual({ action: 'reject', reason: 'version-conflict' })
  })

  it('accepts an identical re-import without rewriting it', () => {
    expect(decideLessonPackUpdate(pack, structuredClone(pack)).action).toBe(
      'unchanged',
    )
  })

  it('reports only stable lexeme ids as mastery-compatible on upgrade', () => {
    const upgraded = withVersion('3.1.0', {
      lexemes: pack.lexemes.slice(1),
    })
    const decision = decideLessonPackUpdate(pack, upgraded)

    expect(decision.action).toBe('replace')
    if (decision.action !== 'replace') return
    expect(decision.compatibleLexemeIds).not.toContain(pack.lexemes[0]?.id)
    expect(decision.compatibleLexemeIds).toContain(pack.lexemes[1]?.id)
  })
})
