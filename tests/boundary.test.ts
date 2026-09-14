// The hourglass, enforced. Three seams, walked on the filesystem so a
// violation fails in CI rather than surviving as a habit:
//   1. @munari/core imports nothing but itself — zero dependencies
//      is a tested property, not a description.
//   2. packages/react reaches core only through the @munari/core
//      specifier (plus its declared peers), never a relative path.
//   3. Consumers (apps/, registry/) reach the library only through its
//      published entries — `@petepetrash/munari`, `/advanced` and
//      `/snapdom`. @munari/core and relative reach-arounds are both
//      violations.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseSync, Visitor } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest: { name: string; exports: Record<string, string> } = JSON.parse(
  readFileSync(join(ROOT, 'packages/react/package.json'), 'utf8'),
)
const publicEntries = new Set(Object.keys(manifest.exports).map(key =>
  key === '.' ? manifest.name : `${manifest.name}${key.slice(1)}`,
))

function sourceFiles(dir: string, pattern = /\.tsx?$/): string[] {
  const out: string[] = []
  const entries = readdirSync(dir)
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, pattern))
    else if (pattern.test(entry)) out.push(full)
  }
  return out
}

function importSpecifiers(text: string, file = 'source.tsx'): string[] {
  const parsed = parseSync(file, text)
  expect(parsed.errors, file).toEqual([])
  const specs: string[] = []
  new Visitor({
    ImportDeclaration: node => { specs.push(node.source.value) },
    ExportNamedDeclaration: node => { if (node.source) specs.push(node.source.value) },
    ExportAllDeclaration: node => { specs.push(node.source.value) },
    ImportExpression: node => {
      if (node.source.type === 'Literal') specs.push(String(node.source.value))
    },
    TSImportType: node => { specs.push(node.source.value) },
  }).visit(parsed.program)
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
  const files = sourceFiles(join(ROOT, dir))
  expect(files.length, dir).toBeGreaterThan(0)
  for (const file of files) {
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'), file)) {
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

  it('react reaches core only through @munari/core, plus declared peers', () => {
    const dir = join(ROOT, 'packages/react/src')
    const allowed = new Set([
      '@munari/core',
      'react',
      'react-dom',
      'three',
      '@react-three/fiber',
      // The OPTIONAL peer behind the `./snapdom` entry. Allowed for the same
      // reason the others are — it is declared in the manifest and resolved
      // by the consumer — and reachable from exactly one module, which is
      // what keeps a consumer who never imports that entry from needing it.
      '@zumer/snapdom',
    ])
    expect(
      violations('packages/react/src', (spec, file) => {
        if (spec.startsWith('.')) return !escapesDir(file, spec, dir)
        // Suites ride beside their modules, but they are not shipped
        // surface — vitest is the one specifier the
        // runner owns, and it is allowed ONLY there. Everything else in a
        // test file answers to the same allowlist as the module it tests.
        if (spec === 'vitest' && /\.test\.tsx?$/.test(file)) return true
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

  it('consumers reach the library only through its published entries', () => {
    for (const consumer of ['apps', 'registry']) {
      const base = join(ROOT, consumer)
      expect(
        violations(consumer, (spec, file) => {
          if (spec.startsWith('@munari/')) return false
          if (spec.startsWith('@petepetrash/munari/'))
            return publicEntries.has(spec)
          if (spec.startsWith('.')) return !escapesDir(file, spec, base)
          return true
        }),
      ).toEqual([])
    }
  })
})

describe('import syntax', () => {
  it('reads dependencies from code, including dynamic and type imports', () => {
    expect(importSpecifiers(`
      import value from 'value';
      import 'side-effect';
      export { value } from 're-export';
      export * from 'namespace';
      const deferred = import('dynamic');
      type Value = import('type-only').Value;
    `)).toEqual(['value', 'side-effect', 're-export', 'namespace', 'dynamic', 'type-only'])
  })

  it('ignores examples in comments and string literals', () => {
    expect(importSpecifiers(`
      // import fake from 'comment';
      const example = "import('example')";
      const message = "value from 'prose'";
    `)).toEqual([])
  })
})
