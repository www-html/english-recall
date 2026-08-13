import { describe, expect, it } from 'vitest'
import { parseLessonPack } from '../domain/lesson-pack.schema.ts'

const bundledPacks = import.meta.glob<unknown>('./*.json', {
  eager: true,
  import: 'default',
})

describe('bundled production content', () => {
  it('contains at least one lesson pack', () => {
    expect(Object.keys(bundledPacks).length).toBeGreaterThan(0)
  })

  for (const [path, contents] of Object.entries(bundledPacks)) {
    it(`${path} passes the production lesson-pack parser`, () => {
      expect(() => parseLessonPack(contents)).not.toThrow()
    })
  }
})
