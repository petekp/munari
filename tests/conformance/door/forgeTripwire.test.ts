// archive#50: every synthetic event leaves through forge() — the brand
// (Symbol.for, HMR-proof) is what makes isForgedEvent()'s predicate
// complete, and it is complete only if forge is the ONE door out. The
// grep-level tripwire from the seed manifest, landed as a test: the
// kernel may say `dispatchEvent` only inside the forge module. Live
// from first commit — vacuously green while core is empty,
// load-bearing the moment the door layer lands.
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

it('dispatchEvent appears in the kernel only inside the forge module', () => {
  const offenders = walk(KERNEL)
    .filter((f) => !basename(f).startsWith('forge'))
    .filter((f) => readFileSync(f, 'utf8').includes('dispatchEvent'))
    .map((f) => relative(ROOT, f))
  expect(offenders).toEqual([])
})
