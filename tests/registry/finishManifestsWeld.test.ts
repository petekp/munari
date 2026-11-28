// Weld check keeping internal WebGPU finish manifests byte-identical to
// registry/materials/finish*.material.gen.ts (with internal manifestRuntime import).

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
// SAFETY: checkFast.mjs is plain ESM without a .d.mts declaration file.
const { rewriteManifestImport } = require('../../packages/cli/src/checkFast.mjs') as {
  readonly rewriteManifestImport: (genText: string, srcText: string, nextImport: string) => string
}

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REGISTRY_DIR = join(ROOT, 'registry/materials')
const GPU_FINISHES_DIR = join(ROOT, 'packages/react/src/gpu/finishes')

const WELDED_FINISHES = ['finishOpaque', 'finishLayered', 'finishTransmissive'] as const

describe('compiled finish manifests weld', () => {
  for (const name of WELDED_FINISHES) {
    it(`${name}.gen.ts matches registry/${name}.material.gen.ts`, () => {
      const regSrc = readFileSync(join(REGISTRY_DIR, `${name}.material.ts`), 'utf8')
      const regGen = readFileSync(join(REGISTRY_DIR, `${name}.material.gen.ts`), 'utf8')
      const expected = rewriteManifestImport(regGen, regSrc, '../manifestRuntime')
      const actual = readFileSync(join(GPU_FINISHES_DIR, `${name}.gen.ts`), 'utf8')
      expect(actual).toBe(expected)
    })
  }
})
