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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
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
  it('core imports nothing but itself, declares zero runtime dependencies, and ships no colocation tests', () => {
    const dir = join(ROOT, 'packages/core/src')
    expect(
      violations('packages/core/src', (spec, file) => {
        return spec.startsWith('.') && !escapesDir(file, spec, dir)
      }),
    ).toEqual([])
    const coreManifest: { dependencies?: Record<string, string> } = JSON.parse(
      readFileSync(join(ROOT, 'packages/core/package.json'), 'utf8'),
    )
    expect(Object.keys(coreManifest.dependencies ?? {})).toEqual([])
    expect(sourceFiles(dir, /\.(test|spec)\.[cm]?[jt]sx?$/)).toEqual([])
  })

  it('react reaches core only through @munari/core, plus declared peers', () => {
    const dir = join(ROOT, 'packages/react/src')
    const allowed = new Set([
      '@munari/core',
      'react',
      'react-dom',
      'three',
      '@react-three/fiber',
    ])
    expect(
      violations('packages/react/src', (spec, file) => {
        if (spec.startsWith('.')) return !escapesDir(file, spec, dir)
        // The OPTIONAL peer behind `./snapdom` may only be imported from
        // `snapdom*` modules so consumers of `.` or `./advanced` never need it.
        if (spec === '@zumer/snapdom') return /^snapdom.*\.tsx?$/.test(basename(file))
        // Suites ride beside their modules, but they are not shipped
        // surface — vitest is the one specifier the
        // runner owns, and it is allowed ONLY there. Everything else in a
        // test file answers to the same allowlist as the module it tests.
        if (spec === 'vitest' && /\.test\.tsx?$/.test(file)) return true
        return (
          allowed.has(spec) ||
          spec.startsWith('react/') ||
          // Binding tests mount roots with react-dom/client and render HTML
          // with react-dom/server, documented subpaths of a declared peer.
          spec.startsWith('react-dom/') ||
          spec.startsWith('three/')
        )
      }),
    ).toEqual([])
  })

  it('gpu subpath never imports three, @react-three/fiber, typegpu, or @zumer/snapdom', () => {
    const dir = join(ROOT, 'packages/react/src')
    const gpuFiles = [
      join(dir, 'gpu.ts'),
      ...sourceFiles(join(dir, 'gpu')).filter((file) => !/\.test\.tsx?$/.test(file)),
    ]
    const visited = new Set<string>()
    const queue = [...gpuFiles]
    const bad: Violation[] = []
    while (queue.length > 0) {
      const file = queue.pop()!
      if (visited.has(file)) continue
      visited.add(file)
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'), file)) {
        if (spec.startsWith('.')) {
          if (escapesDir(file, spec, dir)) {
            bad.push({ file: relative(ROOT, file), spec })
          } else {
            const base = resolve(dirname(file), spec)
            for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
              if (readdirSync(dirname(cand)).includes(basename(cand))) {
                queue.push(cand)
                break
              }
            }
          }
          continue
        }
        const ok =
          spec === '@munari/core' ||
          spec === 'react' ||
          spec === 'react-dom' ||
          spec.startsWith('react/') ||
          spec.startsWith('react-dom/')
        if (!ok) bad.push({ file: relative(ROOT, file), spec })
      }
    }
    expect(bad).toEqual([])
  })

  it('conformance suites reach core through @munari/core, never relative paths or react', () => {
    const base = join(ROOT, 'tests/conformance')
    expect(
      violations('tests/conformance', (spec, file) => {
        if (
          spec === '@munari/core' ||
          spec === 'vitest' ||
          spec === 'vite' ||
          spec === 'three' ||
          spec.startsWith('node:')
        ) {
          return true
        }
        if (spec.startsWith('.')) return !escapesDir(file, spec, base)
        return false
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

  it('gpu lab routes and shell keep Three.js and @react-three out of static closure', () => {
    const forbidden = new Set(['three', '@petepetrash/munari', '@petepetrash/munari/advanced'])
    const entries = [
      'apps/lab/src/main.tsx',
      'apps/lab/src/App.tsx',
      'apps/lab/src/scenes/finish-demo/FinishDemo.tsx',
      'apps/lab/src/scenes/gpu-studio/GpuStudio.tsx',
    ].map((p) => join(ROOT, p))
    const resolveRel = (from: string, spec: string): string | null => {
      if (!spec.startsWith('.')) return null
      const base = resolve(dirname(from), spec)
      for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(cand) && statSync(cand).isFile()) return cand
      }
      return null
    }
    const queue = [...entries]
    const seen = new Set<string>()
    const hits: string[] = []
    while (queue.length > 0) {
      const file = queue.pop()!
      if (seen.has(file)) continue
      seen.add(file)
      const parsed = parseSync(file, readFileSync(file, 'utf8'))
      const visit = (spec: string) => {
        if (forbidden.has(spec) || spec.startsWith('three/') || spec.startsWith('@react-three/')) {
          hits.push(`${file.slice(ROOT.length + 1)} imports ${spec}`)
        }
        const next = resolveRel(file, spec)
        if (next && !seen.has(next)) queue.push(next)
      }
      new Visitor({
        ImportDeclaration: (n) => { if (n.importKind !== 'type') visit(n.source.value) },
        ExportNamedDeclaration: (n) => { if (n.source && n.exportKind !== 'type') visit(n.source.value) },
        ExportAllDeclaration: (n) => { visit(n.source.value) },
      }).visit(parsed.program)
    }
    expect(hits).toEqual([])
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
