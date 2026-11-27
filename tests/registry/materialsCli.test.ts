// End-to-end tests for `@petepetrash/munari-cli`: init, list, add (materials + finishes),
// AOT TypeGPU compilation with auto-inferred @location(2+) attributes, d.mat3x3f uniform
// parity, and stale manifest detection via `munari check`.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..', '..')
const CLI_BIN = join(ROOT, 'packages', 'cli', 'bin', 'munari.mjs')
const REGISTRY_DIR = join(ROOT, 'registry')

const tempDirs: string[] = []

function makeTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'munari-cli-test-'))
  tempDirs.push(dir)
  return dir
}

function runCli(cwd: string, args: readonly string[]) {
  const res = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
  })
  return { stdout: res.stdout, stderr: res.stderr, status: res.status ?? 1 }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('munari CLI & Materials registry', () => {
  it('lists starter materials and registry tools', () => {
    const { stdout, status } = runCli(ROOT, ['list', '--json'])
    expect(status).toBe(0)
    // SAFETY: `munari list --json` prints `{ materials, tools }` matching catalog.json.
    const parsed = JSON.parse(stdout) as {
      materials: { name: string; needsBackdrop: boolean }[]
      tools: { name: string }[]
    }
    expect(parsed.materials.map((m) => m.name)).toEqual([
      'flight-card',
      'fisheye-lens',
      'foil',
      'vignette',
      'tilt-shadow',
      'glass-refract',
    ])
    expect(parsed.materials.find((m) => m.name === 'glass-refract')?.needsBackdrop).toBe(true)
    expect(parsed.tools.map((t) => t.name)).toContain('finishes')
  })

  it('initializes munari.json and adds zero-dep manifests and editable source', () => {
    const dir = makeTempWorkspace()
    const init = runCli(dir, ['init', '--materials-dir', 'src/shaders', '--registry-dir', 'src/recipe'])
    expect(init.status).toBe(0)
    expect(existsSync(join(dir, 'munari.json'))).toBe(true)

    const add = runCli(dir, ['add', 'foil', 'finishes', '--registry', REGISTRY_DIR])
    expect(add.status).toBe(0)
    expect(existsSync(join(dir, 'src/shaders/foil.material.ts'))).toBe(true)
    expect(existsSync(join(dir, 'src/shaders/foil.material.gen.ts'))).toBe(true)
    expect(existsSync(join(dir, 'src/recipe/finishes/finishes.ts'))).toBe(true)

    const genSource = readFileSync(join(dir, 'src/shaders/foil.material.gen.ts'), 'utf8')
    expect(genSource).toContain("from '@petepetrash/munari/gpu'")
    expect(genSource).not.toContain('typegpu')

    const compiledOnly = runCli(dir, ['add', 'glass-refract', '--no-source', '--registry', REGISTRY_DIR])
    expect(compiledOnly.status).toBe(0)
    expect(existsSync(join(dir, 'src/shaders/glassRefract.material.ts'))).toBe(false)
    expect(existsSync(join(dir, 'src/shaders/glassRefract.material.gen.ts'))).toBe(true)
  })

  it('compiles auto-inferred @location(2) and d.mat3x3f uniforms, and detects stale .gen.ts in check', () => {
    const dir = makeTempWorkspace()
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
    const srcPath = join(dir, 'customTilt.material.ts')

    writeFileSync(
      srcPath,
      `import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import { createMaterialUniformLayout, defineManifestMaterial, sampleSurface, surfaceLayout } from '@petepetrash/munari-cli/author'

const Uniforms = d.struct({
  basis: d.mat3x3f,
  gain: d.f32,
})
const layout = createMaterialUniformLayout(Uniforms)

const vertex = tgpu.vertexFn({
  in: {
    position: d.location(0, d.vec3f),
    uv: d.location(1, d.vec2f),
    aShift: d.location(2, d.vec2f),
  },
  out: {
    pos: d.builtin.position,
    uv: d.vec2f,
    shift: d.vec2f,
  },
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  return {
    pos: frame.mvp.mul(d.vec4f(input.position, 1.0)),
    uv: input.uv,
    shift: input.aShift,
  }
})

const fragment = tgpu.fragmentFn({
  in: { uv: d.vec2f, shift: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const u = layout.$.u
  const c = sampleSurface(input.uv.add(input.shift))
  const rotated = std.abs(u.basis.mul(c.rgb)).mul(u.gain)
  return d.vec4f(rotated, c.a)
})

export default defineManifestMaterial({
  name: 'custom-tilt',
  uniforms: {
    schema: Uniforms,
    layout,
    initial: {
      basis: d.mat3x3f(1, 0, 0, 0, 1, 0, 0, 0, 1),
      gain: 1,
    },
    sampleValue: {
      basis: d.mat3x3f(1, 2, 3, 4, 5, 6, 7, 8, 9),
      gain: 1.5,
    },
  },
  vertex,
  fragment,
})
`,
      'utf8',
    )

    const compileRes = runCli(dir, ['compile', srcPath])
    expect(compileRes.stderr).toBe('')
    expect(compileRes.status).toBe(0)

    const genPath = join(dir, 'customTilt.material.gen.ts')
    const genText = readFileSync(genPath, 'utf8')
    expect(genText).toContain('"name":"aShift","location":2,"format":"float32x2","stride":8')
    expect(genText).toContain('byteSize: 64')
    expect(genText).not.toContain('typegpu')

    const freshCheck = runCli(dir, ['check', srcPath])
    expect(freshCheck.status).toBe(0)

    writeFileSync(genPath, `${genText}\n// stale comment\n`, 'utf8')
    const staleCheck = runCli(dir, ['check', srcPath])
    expect(staleCheck.status).toBe(1)
  })
})
