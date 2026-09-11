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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string, pattern = /\.tsx?$/): string[] {
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
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, pattern))
    else if (pattern.test(entry)) out.push(full)
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
    for (const m of text.matchAll(re)) {
      const spec = m[1]
      if (spec !== undefined) specs.push(spec)
    }
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
          if (spec === '@munari/core' || spec.startsWith('@munari/core/')) return false
          if (spec.startsWith('.')) return !escapesDir(file, spec, base)
          return true
        }),
      ).toEqual([])
    }
  })
})

// Core states library laws. Demo names belong in their own modules or in the
// historical decision and platform records that explain where a law came
// from. Keeping the names out of package prose stops a working example from
// becoming the implied shape of the API.
describe('core prose is independent of demos', () => {
  it('does not name a Munari demo', () => {
    const files = [
      ...sourceFiles(join(ROOT, 'packages/core/src')),
      ...sourceFiles(join(ROOT, 'tests/conformance')),
      join(ROOT, 'packages/core/README.md'),
      join(ROOT, 'packages/core/package.json'),
    ]
    const demoName =
      /\b(?:genie|knobs|optics|veil|explode|workspace|passage|logo|labs?)\b|\bFlight\b|\b(?:flight|glass)[- ](?:lab|scene|demo)\b/gi
    const offenders: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(demoName)) {
        offenders.push(`${relative(ROOT, file)}: ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

// A module mock is a seam invented at test time. It passes whether or not
// the real seam exists, which makes the suite agree with itself instead of
// with the browser — the one thing the conformance layers are here to
// prevent. Every suite in this repo already injects through a real
// parameter, patches a real prototype, or drives a real DOM; this pins
// that as a rule rather than a habit, since the cost of the first mock is
// paid by whoever writes the second one.
describe('tests use real seams', () => {
  it('no suite mocks a module', () => {
    const offenders: string[] = []
    for (const dir of ['packages', 'apps', 'registry', 'tests', 'instruments']) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const text = readFileSync(file, 'utf8')
        for (const m of text.matchAll(/\b(?:vi|vitest|jest)\.(?:do)?mock\b/g)) {
          offenders.push(`${relative(ROOT, file)}: ${m[0]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

// Documentation is outside TypeScript's file graph. Check Surface attributes
// here too, so an old example cannot silently restore the removed ID prop.
function hasRemovedCanvasProp(text: string): boolean {
  for (const match of text.matchAll(/<(?:Surface|SceneSurface)(?:\.Root)?\b/g)) {
    let attributes = '', depth = 0, quote = ''
    for (let i = match.index + match[0].length; i < text.length; i++) {
      const char = text[i]
      if (quote) {
        if (char === '\\') i++
        else if (char === quote) quote = ''
        continue
      }
      if (char === '"' || char === "'" || char === '`') { quote = char; continue }
      if (char === '{') { depth++; continue }
      if (char === '}') { depth--; continue }
      if (depth > 0) continue
      if (char === '>') break
      attributes += char
    }
    if (/\bcanvas\s*=/.test(attributes)) return true
  }
  return /`canvas`\s+(?:prop|association)\b|\bcanvas\?\s*:\s*(?:string|SurfaceCanvasId)\b/.test(text)
}

describe('current documentation uses the public canvasId prop', () => {
  it('detects retired Surface attributes without rejecting native canvas values', () => {
    expect(hasRemovedCanvasProp('<Surface canvas="one"><Card /></Surface>')).toBe(true)
    expect(hasRemovedCanvasProp('<Surface.Root\n inScene={selected > 0}\n canvas = "one" />')).toBe(true)
    expect(hasRemovedCanvasProp('<SceneSurface.Root canvas="one" />')).toBe(true)
    expect(hasRemovedCanvasProp('Choose the `canvas` prop.')).toBe(true)
    expect(hasRemovedCanvasProp('<Surface canvasId="one" onReady={() => { const canvas = document.createElement("canvas"); canvas.width = 100 }} />')).toBe(false)
    expect(hasRemovedCanvasProp('const canvas = document.createElement("canvas"); frame.canvas')).toBe(false)
  })

  it('keeps removed selector syntax out of maintained guides and agent instructions', () => {
    const files = [
      ...readdirSync(ROOT).filter(name => name.endsWith('.md')).map(name => join(ROOT, name)),
      ...['docs', 'packages', 'apps', 'registry', '.agents', 'instruments'].flatMap(dir => sourceFiles(join(ROOT, dir), /\.md$/)),
    ]
    const offenders: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      if (hasRemovedCanvasProp(text)) offenders.push(relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })
})
