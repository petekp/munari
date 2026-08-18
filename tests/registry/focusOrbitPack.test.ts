// REGISTRY — Workspace focus-orbit recipe weld.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { arcLayout } from '../../registry/focus-orbit/arcLayout'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('the vendorable files are the Workspace reference', () => {
  for (const file of ['FocusOrbitRig.tsx', 'cameraPose.ts', 'arcLayout.ts']) {
    it(`${file} is byte-identical`, () => {
      expect(read(`registry/focus-orbit/${file}`)).toBe(
        read(`apps/lab/src/scenes/workspace/recipe/${file}`),
      )
    })
  }
})

describe('the cylindrical layout', () => {
  it('makes every requested slot and keeps rows at their authored heights', () => {
    const slots = arcLayout({
      cols: 3,
      rows: 2,
      radius: 7,
      span: Math.PI,
      rowYs: [1, 3],
    })
    expect(slots).toHaveLength(6)
    expect(slots.map((slot) => slot.position[1])).toEqual([1, 1, 1, 3, 3, 3])
  })
})
