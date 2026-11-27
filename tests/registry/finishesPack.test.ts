import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('the vendorable finishes are the lab finishes', () => {
  it("registry/finishes/finishes.ts is byte-identical to apps/lab's", () => {
    expect(read('registry/finishes/finishes.ts')).toBe(read('apps/lab/src/scenes/material-finishes/recipe/finishes.ts'))
  })
})
