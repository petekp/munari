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
      'bleed-glow',
      'tilt-shadow',
      'glass-refract',
      'lacquer-ltc',
      'finish-opaque',
      'finish-layered',
      'finish-transmissive',
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

  it('emits fixed tuple types for vec uniforms and rejects implicit TypeGPU conversions + bad options', () => {
    const dir = makeTempWorkspace()
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
    const vecPath = join(dir, 'tupleTest.material.ts')
    writeFileSync(
      vecPath,
      `import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import { createMaterialUniformLayout, defineManifestMaterial, sampleSurface, surfaceLayout } from '@petepetrash/munari-cli/author'
const Uniforms = d.struct({ offset: d.vec2f, tint: d.vec3f })
const layout = createMaterialUniformLayout(Uniforms)
const vertex = tgpu.vertexFn({
  in: { position: d.location(0, d.vec3f), uv: d.location(1, d.vec2f) },
  out: { pos: d.builtin.position, uv: d.vec2f },
})((i) => {
  'use gpu'
  return { pos: surfaceLayout.$.frame.mvp.mul(d.vec4f(i.position, 1.0)), uv: i.uv }
})
const fragment = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((i) => {
  'use gpu'
  const u = layout.$.u
  const c = sampleSurface(i.uv.add(u.offset))
  return d.vec4f(c.rgb.mul(u.tint), c.a)
})
export default defineManifestMaterial({
  name: 'tuple-test',
  uniforms: { schema: Uniforms, layout, initial: { offset: d.vec2f(0, 0), tint: d.vec3f(1, 1, 1) } },
  vertex,
  fragment,
})
`,
      'utf8',
    )
    const tupleCompile = runCli(dir, ['compile', vecPath])
    expect(tupleCompile.stderr).toBe('')
    expect(tupleCompile.status).toBe(0)
    const genText = readFileSync(join(dir, 'tupleTest.material.gen.ts'), 'utf8')
    expect(genText).toContain('readonly offset: readonly [number, number]')
    expect(genText).toContain('readonly tint: readonly [number, number, number]')

    const implicitPath = join(dir, 'implicitConv.material.ts')
    writeFileSync(
      implicitPath,
      `import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import { defineManifestMaterial, sampleSurface, surfaceLayout } from '@petepetrash/munari-cli/author'
const vertex = tgpu.vertexFn({
  in: { position: d.location(0, d.vec3f), uv: d.location(1, d.vec2f) },
  out: { pos: d.builtin.position, uv: d.vec2f },
})((i) => {
  'use gpu'
  return { pos: surfaceLayout.$.frame.mvp.mul(d.vec4f(i.position, 1.0)), uv: i.uv }
})
const fragment = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((i) => {
  'use gpu'
  let acc = 0
  acc += 0.25
  const c = sampleSurface(i.uv)
  return d.vec4f(c.rgb.mul(d.f32(acc)), c.a)
})
export default defineManifestMaterial({ name: 'implicit-conv', vertex, fragment })
`,
      'utf8',
    )
    const badCompile = runCli(dir, ['compile', implicitPath])
    expect(badCompile.status).toBe(1)
    expect(badCompile.stderr).toContain('implicit TypeGPU conversion warning')

    const compilerPath = join(ROOT, 'packages', 'cli', 'src', 'compiler.mjs')
    const badOpt = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { pathToFileURL } from 'node:url'; const { generateMaterialSource } = await import(pathToFileURL(${JSON.stringify(compilerPath)}).href); try { await generateMaterialSource(${JSON.stringify(vecPath)}, { manifestImport: 123 }); process.exit(2) } catch (err) { console.error(String(err)); process.exit(0) }`,
      ],
      { cwd: dir, encoding: 'utf8' },
    )
    expect(badOpt.status).toBe(0)
    expect(badOpt.stderr).toContain('options.manifestImport')
  })

  it('supports defineGpuMaterial, composeShades, fast source-hash check, and munari info --json', () => {
    const dir = makeTempWorkspace()
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
    const stackedPath = join(dir, 'stackedCard.material.ts')
    writeFileSync(
      stackedPath,
      `import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import { SurfaceFragmentIn, defineGpuMaterial } from '@petepetrash/munari-cli/author'
const tint = tgpu.fn([SurfaceFragmentIn], d.vec4f)((ctx) => {
  'use gpu'
  return d.vec4f(ctx.color.mul(d.vec3f(0.8, 1.0, 0.9)), ctx.alpha)
})
const boost = tgpu.fn([SurfaceFragmentIn], d.vec4f)((ctx) => {
  'use gpu'
  return d.vec4f(ctx.color.add(d.vec3f(0.05, 0.02, 0.0)), ctx.alpha)
})
export default defineGpuMaterial({ name: 'stacked-card', shades: [tint, boost] })
`,
      'utf8',
    )

    const compileRes = runCli(dir, ['compile', stackedPath])
    expect(compileRes.stderr).toBe('')
    expect(compileRes.status).toBe(0)
    const genPath = join(dir, 'stackedCard.material.gen.ts')
    const genText = readFileSync(genPath, 'utf8')
    expect(genText).toContain('version: 2')
    expect(genText).toContain('// munari-body-sha256:')
    expect(genText).toContain('sourceHash:')
    expect(genText).toContain('encodeSurfaceOutput')

    expect(runCli(dir, ['check', stackedPath]).status).toBe(0)
    expect(runCli(dir, ['check', stackedPath, '--deep']).status).toBe(0)

    writeFileSync(genPath, genText.replace('version: 2', 'version: 2 // edit'), 'utf8')
    expect(runCli(dir, ['check', stackedPath]).status).toBe(1)

    expect(runCli(dir, ['compile', stackedPath]).status).toBe(0)
    writeFileSync(stackedPath, `${readFileSync(stackedPath, 'utf8')}\n// src change\n`, 'utf8')
    expect(runCli(dir, ['check', stackedPath]).status).toBe(1)

    const infoRes = runCli(dir, ['info', '--json', '--registry', REGISTRY_DIR])
    expect(infoRes.status).toBe(0)
    // SAFETY: `munari info --json` returns structured JSON summary.
    const info = JSON.parse(infoRes.stdout) as {
      manifestVersion: number
      compilerAbi: string
      frameUniforms: { byteSize: number }
      catalog: { materials: string[] }
    }
    expect(info.manifestVersion).toBe(2)
    expect(info.compilerAbi).toMatch(/^v2\.1-[0-9a-f]{16}$/)
    expect(info.frameUniforms.byteSize).toBe(256)
    expect(info.catalog.materials).toContain('lacquer-ltc')

    const customDir = makeTempWorkspace()
    symlinkSync(join(ROOT, 'node_modules'), join(customDir, 'node_modules'), 'dir')
    const customImport = './custom-gpu'
    expect(
      runCli(customDir, ['add', 'foil', '--manifest-import', customImport, '--registry', REGISTRY_DIR]).status,
    ).toBe(0)
    expect(
      runCli(customDir, ['check', 'src/materials/foil.material.ts', '--manifest-import', customImport]).status,
    ).toBe(0)

    const badStaticPath = join(dir, 'badStatic.material.ts')
    writeFileSync(
      badStaticPath,
      `import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import { LTC_STATIC_TEXTURES, SurfaceFragmentIn, defineGpuMaterial } from '@petepetrash/munari-cli/author'
const shade = tgpu.fn([SurfaceFragmentIn], d.vec4f)((ctx) => {
  'use gpu'
  return d.vec4f(ctx.color, ctx.alpha)
})
export default defineGpuMaterial({ name: 'bad-static', staticTextures: LTC_STATIC_TEXTURES, shade })
`,
      'utf8',
    )
    const badStaticCompile = runCli(dir, ['compile', badStaticPath])
    expect(badStaticCompile.status).toBe(1)
    expect(badStaticCompile.stderr).toContain('WGSL missing @group(1) @binding(2)')

    expect(runCli(ROOT, ['check', '--deep', 'registry/materials/lacquerLtc.material.ts']).status).toBe(0)
  })
})
