import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as rootEntry from '@petepetrash/munari'
import * as advancedEntry from '@petepetrash/munari/advanced'
import * as snapdomEntry from '@petepetrash/munari/snapdom'
import { readExportMap, type ExportMap, type PublicEntry } from './architectureExportMap'
import { ARCHITECTURE_LAYERS, architectureLayerProblems } from './architectureLayers'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../..')
const { map } = readExportMap(REPO_ROOT)

function entry(specifier: string): PublicEntry {
  const found = map.entries.find((candidate) => candidate.specifier === specifier)
  if (!found) throw new Error(`The export map has no entry ${specifier}`)
  return found
}

function valueNames(specifier: string): string[] {
  return entry(specifier).exports.filter((declaration) => declaration.kind === 'value').map((declaration) => declaration.name).sort()
}

const fixtures: string[] = []

function fixtureRepo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'munari-export-map-'))
  fixtures.push(root)
  const manifests = {
    'packages/react/package.json': JSON.stringify({ name: '@example/pkg', exports: { '.': './src/index.ts' } }),
    'packages/core/package.json': JSON.stringify({ name: '@example/core', exports: { '.': './src/index.ts' } }),
  }
  for (const [file, text] of Object.entries({ ...manifests, ...files })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  return root
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('readExportMap on the Munari package', () => {
  it('lists the same runtime values each published entry actually exports', () => {
    expect(valueNames('@petepetrash/munari')).toEqual(Object.keys(rootEntry).sort())
    expect(valueNames('@petepetrash/munari/advanced')).toEqual(Object.keys(advancedEntry).sort())
    expect(valueNames('@petepetrash/munari/snapdom')).toEqual(Object.keys(snapdomEntry).sort())
  })

  it('names each export by the file that declares it, through re-exports and renames', () => {
    const surfaceAnchor = entry('@petepetrash/munari').exports.find((declaration) => declaration.name === 'SURFACE_ANCHOR_ATTRIBUTE')
    expect(surfaceAnchor?.source).toBe('packages/core/src/mapping/surfaceAnchors.ts')
    const frameTexture = entry('@petepetrash/munari/advanced').exports.find((declaration) => declaration.name === 'useFrameTexture')
    expect(frameTexture?.source).toBe('packages/react/src/primitives/SurfaceContext.ts')
    for (const published of map.entries) {
      for (const declaration of published.exports) expect(existsSync(path.join(REPO_ROOT, declaration.source)), declaration.source).toBe(true)
    }
  })

  it('separates types from values and keeps the stylesheet entry', () => {
    const surfaceProps = entry('@petepetrash/munari').exports.find((declaration) => declaration.name === 'SurfaceProps')
    expect(surfaceProps?.kind).toBe('type')
    expect(entry('@petepetrash/munari/style.css')).toMatchObject({ stylesheet: true, exports: [] })
  })

  it('groups the root entry by its section rules and the kernel by its layer folders', () => {
    const surface = entry('@petepetrash/munari').exports.find((declaration) => declaration.name === 'Surface')
    expect(surface?.section).toBe('HTML, scene, and captured elements')
    const relay = entry('@petepetrash/munari/advanced').exports.find((declaration) => declaration.name === 'relay')
    expect(relay?.section).toBe('Kernel: pointer')
  })

  it('finds every API, file and guide the architecture layers cite', () => {
    expect(architectureLayerProblems(ARCHITECTURE_LAYERS, map, (file) => existsSync(path.join(REPO_ROOT, file)))).toEqual([])
  })
})

describe('readExportMap failures', () => {
  it('follows star re-exports, renames and exported imports to the declaring file', () => {
    const root = fixtureRepo({
      'packages/react/src/index.ts': "import { imported } from './local'\nexport * from '@example/core'\nexport { local as renamed } from './local'\nexport { imported }",
      'packages/react/src/local.ts': 'export const local = 1\nexport type imported = string',
      'packages/core/src/index.ts': "export { relay } from './pointer/relay'",
      'packages/core/src/pointer/relay.ts': 'export function relay() {}\nexport interface Unused {}',
    })
    expect(readExportMap(root).map.entries[0]?.exports).toEqual([
      { name: 'relay', kind: 'value', source: 'packages/core/src/pointer/relay.ts', section: 'Kernel: pointer' },
      { name: 'renamed', kind: 'value', source: 'packages/react/src/local.ts', section: null },
      { name: 'imported', kind: 'type', source: 'packages/react/src/local.ts', section: null },
    ])
  })

  it.each([
    ['a default export', { 'packages/react/src/index.ts': 'export default 1' }, 'default export'],
    ['a name the target does not export', { 'packages/react/src/index.ts': "export { missing } from './local'", 'packages/react/src/local.ts': 'export const local = 1' }, 'does not export it'],
    ['a package outside the workspace', { 'packages/react/src/index.ts': "export { Mesh } from 'three'" }, 'not a workspace package entry'],
    ['a missing source file', { 'packages/react/src/index.ts': "export { gone } from './gone'" }, 'no source file matches'],
  ])('throws on %s', (_case, files, message) => {
    expect(() => readExportMap(fixtureRepo(files))).toThrow(message)
  })

  it('throws when the manifest points an entry at a missing file', () => {
    const root = fixtureRepo({})
    expect(() => readExportMap(root)).toThrow("exports '.' from a missing file")
  })
})

describe('architectureLayerProblems', () => {
  it('reports a cited API the map lost and a cited file that is gone', () => {
    const withoutSurface: ExportMap = {
      ...map,
      entries: map.entries.map((published) => ({ ...published, exports: published.exports.filter((declaration) => declaration.name !== 'Surface') })),
    }
    const problems = architectureLayerProblems(ARCHITECTURE_LAYERS, withoutSurface, (file) => file !== 'docs/capture-engines.md')
    expect(problems).toEqual(['content: no public entry exports Surface', 'capture: docs/capture-engines.md does not exist'])
  })
})
