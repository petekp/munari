// The registry copy must match the compositor and shader exercised by the lab.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('the vendorable files are the lab files', () => {
  for (const f of ['glassSdf.tsx', 'glassSdfShader.ts']) {
    it(`registry/glass/${f} is byte-identical to apps/lab's`, () => {
      expect(read(`registry/glass/${f}`)).toBe(
        read(`apps/lab/src/scenes/glass/${f}`),
      )
    })
  }
})
