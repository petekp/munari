import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REGISTRY_DIR = join(ROOT, 'registry/materials')
const LAB_MATERIALS_DIR = join(ROOT, 'apps/lab/src/scenes/gpu-studio/materials')

const WELDED_MATERIALS = [
  'bleedGlow',
  'fisheyeLens',
  'flightCard',
  'foil',
  'glassRefract',
  'lacquerLtc',
] as const

describe('gpu-studio material copies weld', () => {
  for (const name of WELDED_MATERIALS) {
    it(`${name}.material.{ts,gen.ts} matches registry/materials/`, () => {
      for (const ext of ['.material.ts', '.material.gen.ts'] as const) {
        const expected = readFileSync(join(REGISTRY_DIR, `${name}${ext}`), 'utf8')
        const actual = readFileSync(join(LAB_MATERIALS_DIR, `${name}${ext}`), 'utf8')
        expect(actual).toBe(expected)
      }
    })
  }
})
