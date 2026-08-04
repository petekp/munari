// Every synthetic event leaves through relay() — the brand
// (Symbol.for, HMR-proof) is what makes isRelayed()'s predicate
// complete, and it is complete only if relay is the ONE door out. A
// grep-level tripwire, as a test: the kernel may say `dispatchEvent`
// only inside the relay module. Vacuously green while the kernel has
// no other callers of dispatchEvent; load-bearing the moment one is
// added.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const KERNEL = join(ROOT, 'packages/core/src')

function walk(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

it('dispatchEvent appears in the kernel only inside the relay module', () => {
  const offenders = walk(KERNEL)
    .filter((f) => !basename(f).startsWith('relay'))
    .filter((f) => readFileSync(f, 'utf8').includes('dispatchEvent'))
    .map((f) => relative(ROOT, f))
  expect(offenders).toEqual([])
})
