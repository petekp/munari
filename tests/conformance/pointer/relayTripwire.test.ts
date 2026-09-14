// Synthetic event dispatch belongs to relay.ts so every emitted event is branded.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { parseSync, Visitor } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const KERNEL = join(ROOT, 'packages/core/src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(entry) ? [full] : []
  })
}

it('dispatchEvent appears in the kernel only inside the relay module', () => {
  const offenders: string[] = []
  const files = walk(KERNEL)
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    if (file === join(KERNEL, 'pointer/relay.ts')) continue
    const parsed = parseSync(file, readFileSync(file, 'utf8'))
    expect(parsed.errors, file).toEqual([])
    new Visitor({
      MemberExpression(node) {
        const dispatch = node.computed
          ? node.property.type === 'Literal' && node.property.value === 'dispatchEvent'
          : node.property.type === 'Identifier' && node.property.name === 'dispatchEvent'
        if (dispatch) offenders.push(relative(ROOT, file))
      },
    }).visit(parsed.program)
  }
  expect(offenders).toEqual([])
})
