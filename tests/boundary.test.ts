// The hourglass, enforced. Three seams, walked on the filesystem so a
// violation fails in CI rather than surviving as a habit:
//   1. @anamorph/core imports nothing but itself — zero dependencies
//      is a tested property, not a description.
//   2. packages/react reaches core only through the @anamorph/core
//      specifier (plus its declared peers), never a relative path.
//   3. Consumers (apps/, registry/) reach the library only through the
//      `anamorph` barrel — @anamorph/core and relative reach-arounds
//      are both violations. (Mirror of archive tests/boundary.test.ts.)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

function importSpecifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const specs: string[] = []
  for (const re of [
    /\bfrom\s+['"]([^'"]+)['"]/g, // import x from / export x from
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import
    /^\s*import\s+['"]([^'"]+)['"]/gm, // bare side-effect import
  ]) {
    for (const m of text.matchAll(re)) specs.push(m[1] as string)
  }
  return specs
}

function escapesDir(file: string, spec: string, dir: string): boolean {
  if (!spec.startsWith('.')) return false
  return relative(dir, resolve(dirname(file), spec)).startsWith('..')
}

type Violation = { file: string; spec: string }

function violations(
  dir: string,
  isAllowed: (spec: string, file: string) => boolean,
): Violation[] {
  const bad: Violation[] = []
  for (const file of sourceFiles(join(ROOT, dir))) {
    for (const spec of importSpecifiers(file)) {
      if (!isAllowed(spec, file)) bad.push({ file: relative(ROOT, file), spec })
    }
  }
  return bad
}

describe('the hourglass', () => {
  it('core imports nothing but itself', () => {
    const dir = join(ROOT, 'packages/core/src')
    expect(
      violations('packages/core/src', (spec, file) => {
        return spec.startsWith('.') && !escapesDir(file, spec, dir)
      }),
    ).toEqual([])
  })

  it('react reaches core only through @anamorph/core, plus declared peers', () => {
    const dir = join(ROOT, 'packages/react/src')
    const allowed = new Set([
      '@anamorph/core',
      'react',
      'react-dom',
      'three',
      '@react-three/fiber',
    ])
    expect(
      violations('packages/react/src', (spec, file) => {
        if (spec.startsWith('.')) return !escapesDir(file, spec, dir)
        return (
          allowed.has(spec) ||
          spec.startsWith('react/') ||
          // react-dom/client is the second-React-root seam (useSourceHost's
          // createRoot) — a documented subpath of a declared peer.
          spec.startsWith('react-dom/') ||
          spec.startsWith('three/')
        )
      }),
    ).toEqual([])
  })

  it('consumers reach the library only through the anamorph barrel', () => {
    for (const consumer of ['apps', 'registry']) {
      const base = join(ROOT, consumer)
      expect(
        violations(consumer, (spec, file) => {
          if (spec === '@anamorph/core' || spec.startsWith('@anamorph/core/')) return false
          if (spec.startsWith('.')) return !escapesDir(file, spec, base)
          return true
        }),
      ).toEqual([])
    }
  })
})
