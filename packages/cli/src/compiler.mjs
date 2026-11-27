// AOT compiler turning TypeGPU `*.material.ts` definitions into standalone
// `*.material.gen.ts` manifests with static WGSL and typed DataView uniform packers.
//
// The law: resolution runs on a stub WebGPU device via `unplugin-typegpu/node` and checks
// every generated packer byte-for-byte against TypeGPU's own `typed-binary` writer before
// writing or validating `*.material.gen.ts`.
//
// Ownership: `@petepetrash/munari-cli` compiler; output files depend only on `@petepetrash/munari/gpu`.

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import { computeMaterialSourceHash, formatManifestFile } from './checkFast.mjs'

const VERTEX_ATTR_SPECS = {
  f32: { format: 'float32', stride: 4, makeLayout: () => tgpu.vertexLayout((n) => d.arrayOf(d.f32, n)) },
  vec2f: { format: 'float32x2', stride: 8, makeLayout: () => tgpu.vertexLayout((n) => d.disarrayOf(d.vec2f, n)) },
  vec3f: { format: 'float32x3', stride: 12, makeLayout: () => tgpu.vertexLayout((n) => d.disarrayOf(d.vec3f, n)) },
  vec4f: { format: 'float32x4', stride: 16, makeLayout: () => tgpu.vertexLayout((n) => d.disarrayOf(d.vec4f, n)) },
}

const posVertexLayout = tgpu.vertexLayout((n) => d.disarrayOf(d.vec3f, n))
const uvVertexLayout = tgpu.vertexLayout((n) => d.disarrayOf(d.vec2f, n))

function installWebGpuNodeGlobals() {
  globalThis.GPUShaderStage ??= { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 }
  globalThis.GPUBufferUsage ??= {
    MAP_READ: 0x1, MAP_WRITE: 0x2, COPY_SRC: 0x4, COPY_DST: 0x8,
    INDEX: 0x10, VERTEX: 0x20, UNIFORM: 0x40, STORAGE: 0x80, INDIRECT: 0x100, QUERY_RESOLVE: 0x200,
  }
  globalThis.GPUTextureUsage ??= {
    COPY_SRC: 0x1, COPY_DST: 0x2, TEXTURE_BINDING: 0x4, STORAGE_BINDING: 0x8, RENDER_ATTACHMENT: 0x10,
  }
}

function createStubDevice() {
  const shaders = []
  const writes = []
  const noop = () => ({})
  const device = {
    features: new Set(),
    limits: { minUniformBufferOffsetAlignment: 256, maxBindGroups: 4, maxColorAttachments: 8 },
    createShaderModule({ code }) {
      shaders.push(code)
      return { code }
    },
    createBindGroupLayout: noop,
    createPipelineLayout: noop,
    createRenderPipeline: (desc) => ({ desc }),
    createBuffer(desc) {
      const mem = new ArrayBuffer(desc.size)
      return { size: desc.size, usage: desc.usage, getMappedRange: () => mem, unmap() {}, destroy() {} }
    },
    queue: {
      writeBuffer(_buf, offset, data, dataOffset = 0, size) {
        const view = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset + dataOffset, size ?? data.byteLength)
          : new Uint8Array(data, dataOffset, size ?? data.byteLength)
        writes.push({ offset, bytes: new Uint8Array(view) })
      },
    },
  }
  return { device, shaders, writes }
}

function scalarWriteCode(primType, viewExpr, offExpr, valExpr) {
  if (primType === 'f32') return `${viewExpr}.setFloat32(${offExpr}, ${valExpr}, true)`
  if (primType === 'i32') return `${viewExpr}.setInt32(${offExpr}, ${valExpr}, true)`
  if (primType === 'u32') return `${viewExpr}.setUint32(${offExpr}, ${valExpr}, true)`
  throw new Error(`Unsupported scalar primitive type in uniform packer: ${primType}`)
}

function tsTypeForSchema(schema) {
  if (schema.type === 'f32' || schema.type === 'i32' || schema.type === 'u32') return 'number'
  const vecMatch = /^vec([234])/.exec(schema.type)
  if (vecMatch) {
    return `readonly [${Array.from({ length: Number(vecMatch[1]) }, () => 'number').join(', ')}]`
  }
  if (schema.type.startsWith('mat')) return 'readonly number[]'
  if (schema.type === 'array') return `readonly (${tsTypeForSchema(schema.elementType)})[]`
  if (schema.type === 'struct') {
    const fields = Object.entries(schema.propTypes).map(([k, v]) => `readonly ${k}: ${tsTypeForSchema(v)}`)
    return `{ ${fields.join('; ')} }`
  }
  throw new Error(`Unsupported schema type for TS signature: ${schema.type}`)
}

function packElem(arr, idx) {
  return arr?.[idx] ?? 0
}

function packMat3(view, offset, m) {
  if (!m) return
  const step = m.length >= 12 ? 4 : 3
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      view.setFloat32(offset + col * 16 + row * 4, m[col * step + row] ?? 0, true)
    }
  }
}

function emitPackField(lines, schema, offset, valueExpr, helpersUsed) {
  const t = schema.type
  if (t === 'f32' || t === 'i32' || t === 'u32') {
    lines.push(`    ${scalarWriteCode(t, 'view', `base + ${offset}`, valueExpr)}`)
    return
  }
  if (t.startsWith('vec')) {
    helpersUsed.elem = true
    const prim = schema.primitive.type
    for (let i = 0; i < schema.componentCount; i++) {
      lines.push(`    ${scalarWriteCode(prim, 'view', `base + ${offset + i * 4}`, `packElem(${valueExpr}, ${i})`)}`)
    }
    return
  }
  if (t === 'mat3x3f') {
    helpersUsed.mat3 = true
    lines.push(`    packMat3(view, base + ${offset}, ${valueExpr})`)
    return
  }
  if (t === 'mat4x4f') {
    helpersUsed.elem = true
    for (let i = 0; i < 16; i++) {
      lines.push(`    view.setFloat32(base + ${offset + i * 4}, packElem(${valueExpr}, ${i}), true)`)
    }
    return
  }
  if (t === 'array') {
    const elemAlign = d.alignmentOf(schema.elementType)
    const stride = Math.ceil(d.sizeOf(schema.elementType) / elemAlign) * elemAlign
    for (let i = 0; i < schema.elementCount; i++) {
      emitPackField(lines, schema.elementType, offset + i * stride, `${valueExpr}[${i}]`, helpersUsed)
    }
    return
  }
  if (t === 'struct') {
    for (const key of Object.keys(schema.propTypes)) {
      const subLayout = d.memoryLayoutOf(schema, (p) => p[key])
      emitPackField(lines, schema.propTypes[key], offset + subLayout.offset, `${valueExpr}.${key}`, helpersUsed)
    }
    return
  }
  throw new Error(`Unsupported uniform field type: ${t}`)
}

function serializePlainValue(schema, value) {
  const t = schema.type
  if (t === 'f32' || t === 'i32' || t === 'u32') return Number(value)
  if (t.startsWith('vec') || t.startsWith('mat')) return [...value].map(Number)
  if (t === 'array') return Array.from(value, (el) => serializePlainValue(schema.elementType, el))
  if (t === 'struct') {
    const out = {}
    for (const [k, propSchema] of Object.entries(schema.propTypes)) {
      out[k] = serializePlainValue(propSchema, value[k])
    }
    return out
  }
  return value
}

function generatePackSource(schema) {
  const byteSize = d.sizeOf(schema)
  const typeSig = tsTypeForSchema(schema)
  const lines = []
  const helpersUsed = { elem: false, mat3: false }
  emitPackField(lines, schema, 0, 'values', helpersUsed)
  const helperBlocks = []
  if (helpersUsed.elem) {
    helperBlocks.push(`function packElem(arr: readonly number[] | undefined, idx: number): number {
  return arr?.[idx] ?? 0
}`)
  }
  if (helpersUsed.mat3) {
    helperBlocks.push(`function packMat3(view: DataView, offset: number, m: readonly number[] | undefined): void {
  if (!m) return
  const step = m.length >= 12 ? 4 : 3
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      view.setFloat32(offset + col * 16 + row * 4, m[col * step + row] ?? 0, true)
    }
  }
}`)
  }
  return { byteSize, typeSig, packBody: lines.join('\n'), helperSource: helperBlocks.join('\n\n') }
}

function verifyPackParity(root, writes, schema, sampleValue, generatedPackSource) {
  writes.length = 0
  const tgpuBuf = root.createBuffer(schema)
  tgpuBuf.write(sampleValue)
  const expectedBytes = writes[writes.length - 1]?.bytes
  assert.ok(expectedBytes, 'Expected TypeGPU buffer write during parity check')

  const packFn = new Function('values', 'view', 'base', 'packElem', 'packMat3', generatedPackSource)
  const actualBuf = new ArrayBuffer(d.sizeOf(schema))
  const actualView = new DataView(actualBuf)
  packFn(sampleValue, actualView, 0, packElem, packMat3)
  const actualBytes = new Uint8Array(actualBuf)
  assert.deepEqual(
    [...actualBytes],
    [...expectedBytes],
    `Generated packer byte mismatch vs TypeGPU typed-binary for schema ${JSON.stringify(Object.keys(schema.propTypes))}`,
  )
}

function collectVertexAttributes(def) {
  const attribs = { position: posVertexLayout.attrib, uv: uvVertexLayout.attrib }
  const manifestAttrs = [
    { name: 'position', location: 0, format: 'float32x3', stride: 12 },
    { name: 'uv', location: 1, format: 'float32x2', stride: 8 },
  ]
  const explicitByLoc = new Map()
  for (const extra of def.extraAttributes ?? []) explicitByLoc.set(extra.location, extra)

  const vertexIn = def.vertex?.shell?.in ?? {}
  for (const [name, field] of Object.entries(vertexIn)) {
    const loc = field?.attribs?.[0]?.params?.[0]
    if (!Number.isInteger(loc) || loc < 2) continue
    if (explicitByLoc.has(loc)) {
      const explicit = explicitByLoc.get(loc)
      assert.equal(explicit.name, name, `${def.name}: @location(${loc}) name mismatch (${explicit.name} vs ${name})`)
      continue
    }
    const spec = VERTEX_ATTR_SPECS[field.inner?.type]
    assert.ok(spec, `${def.name}: unsupported vertex attribute type ${String(field.inner?.type)} at @location(${loc})`)
    attribs[name] = spec.makeLayout().attrib
    manifestAttrs.push({ name, location: loc, format: spec.format, stride: spec.stride })
  }

  for (const extra of def.extraAttributes ?? []) {
    attribs[extra.name] = extra.layout.attrib
    manifestAttrs.push({ name: extra.name, location: extra.location, format: extra.format, stride: extra.stride })
  }

  manifestAttrs.sort((a, b) => a.location - b.location)
  return { attribs, manifestAttrs }
}

function extractEntryPoints(wgsl) {
  const vsMatch = wgsl.match(/@vertex\s+(?:@\w+(?:\([^)]*\))?\s+)*fn\s+([A-Za-z0-9_]+)/)
  const fsMatch = wgsl.match(/@fragment\s+(?:@\w+(?:\([^)]*\))?\s+)*fn\s+([A-Za-z0-9_]+)/)
  return { vertexEntry: vsMatch ? vsMatch[1] : undefined, fragmentEntry: fsMatch ? fsMatch[1] : undefined }
}

function camelName(name) {
  return name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
}

function pascalName(name) {
  const c = camelName(name)
  return c.charAt(0).toUpperCase() + c.slice(1)
}

function initPipelineStrict(root, attribs, def) {
  const pipeline = root.createRenderPipeline({
    attribs,
    vertex: def.vertex,
    fragment: def.fragment,
    targets: { format: 'bgra8unorm' },
  })
  const implicitWarnings = []
  const origWarn = console.warn
  console.warn = (...args) => {
    const text = args.map((a) => String(a)).join(' ')
    if (/implicit[- ]conversion/i.test(text)) {
      implicitWarnings.push(text)
      return
    }
    origWarn(...args)
  }
  try {
    pipeline.initSync()
  } finally {
    console.warn = origWarn
  }
  if (implicitWarnings.length > 0) {
    throw new Error(
      `${def.name}: implicit TypeGPU conversion warning(s) (use explicit d.f32(...) casts):\n${implicitWarnings.join('\n')}`,
    )
  }
}

function formatStaticTexturesField(staticSpecs) {
  if (staticSpecs.length === 0) return ''
  const rows = staticSpecs
    .map((s) => {
      const loaderExpr = s.loader === 'ltc-1' ? '() => loadLtcTable(1)' : '() => loadLtcTable(2)'
      const fields = [
        `name: ${JSON.stringify(s.name)}`,
        `cacheKey: ${JSON.stringify(s.cacheKey)}`,
        `textureBinding: ${s.textureBinding}`,
        ...(s.samplerBinding !== undefined ? [`samplerBinding: ${s.samplerBinding}`] : []),
        ...(s.filter ? [`filter: ${JSON.stringify(s.filter)}`] : []),
        ...(s.addressMode ? [`addressMode: ${JSON.stringify(s.addressMode)}`] : []),
        `load: ${loaderExpr}`,
      ]
      return `    { ${fields.join(', ')} },`
    })
    .join('\n')
  return `\n  staticTextures: [\n${rows}\n  ],`
}

function resolveManifestImport(absPath, options) {
  const rawImport = options?.manifestImport
  if (rawImport !== undefined && (rawImport === null || rawImport.constructor !== String || rawImport.trim() === '')) {
    throw new Error(`${absPath}: options.manifestImport must be a non-empty string`)
  }
  return rawImport ?? '@petepetrash/munari/gpu'
}

function formatUniformSection(root, writes, uniforms) {
  if (!uniforms) return { uniformBlock: 'null', valuesTypeName: 'Record<string, never>', helperPrefix: '', uniformBytes: 0 }
  const { schema, initial, sampleValue } = uniforms
  const { byteSize, typeSig, packBody, helperSource } = generatePackSource(schema)
  verifyPackParity(root, writes, schema, sampleValue ?? initial, packBody)
  const plainInitial = serializePlainValue(schema, initial)
  return {
    uniformBlock: `{\n    byteSize: ${byteSize},\n    initial: ${JSON.stringify(plainInitial)},\n    pack(values: ${typeSig}, view: DataView, base: number): void {\n${packBody}\n    },\n  }`,
    valuesTypeName: typeSig,
    helperPrefix: helperSource ? `${helperSource}\n\n` : '',
    uniformBytes: d.sizeOf(schema),
  }
}

function verifyStaticTextureBindings(def, wgsl) {
  for (const st of def.staticTextures ?? []) {
    const texRe = new RegExp(
      `@group\\(1\\)\\s+@binding\\(${st.textureBinding}\\)\\s+var\\s+[A-Za-z0-9_]+\\s*:\\s*texture_2d<`,
    )
    assert.ok(
      texRe.test(wgsl),
      `${def.name}: WGSL missing @group(1) @binding(${st.textureBinding}) texture_2d binding for "${st.name}"`,
    )
    if (st.samplerBinding !== undefined) {
      const sampRe = new RegExp(
        `@group\\(1\\)\\s+@binding\\(${st.samplerBinding}\\)\\s+var\\s+[A-Za-z0-9_]+\\s*:\\s*sampler\\b`,
      )
      assert.ok(
        sampRe.test(wgsl),
        `${def.name}: WGSL missing @group(1) @binding(${st.samplerBinding}) sampler binding for "${st.name}"`,
      )
    }
  }
}

export async function generateMaterialSource(absPath, options = {}) {
  const manifestImport = resolveManifestImport(absPath, options)
  installWebGpuNodeGlobals()
  const mod = await import(`${pathToFileURL(absPath).href}?t=${Date.now()}`)
  const def = mod.default
  assert.ok(def && def.name && def.vertex && def.fragment, `${absPath}: missing default export from defineManifestMaterial()`)

  const { device, shaders, writes } = createStubDevice()
  const root = tgpu.initFromDevice({ device })
  const { attribs, manifestAttrs } = collectVertexAttributes(def)
  initPipelineStrict(root, attribs, def)

  const wgsl = shaders[0]
  assert.ok(wgsl && wgsl.includes('@group(0)'), `${def.name}: resolved WGSL did not bind @group(0) surfaceLayout`)
  verifyStaticTextureBindings(def, wgsl)
  const { vertexEntry, fragmentEntry } = extractEntryPoints(wgsl)
  const { uniformBlock, valuesTypeName, helperPrefix, uniformBytes } = formatUniformSection(root, writes, def.uniforms)

  const sourceHash = computeMaterialSourceHash(readFileSync(absPath, 'utf8'), manifestImport)
  const staticSpecs = def.staticTextures ?? []
  const usesLtc = staticSpecs.some((s) => s.loader === 'ltc-1' || s.loader === 'ltc-2')
  const importStmt = usesLtc
    ? `import { loadLtcTable, type MaterialManifest } from '${manifestImport}'`
    : `import type { MaterialManifest } from '${manifestImport}'`
  const staticField = formatStaticTexturesField(staticSpecs)

  const outPath = absPath.replace(/\.material\.ts$/, '.material.gen.ts')
  const bodyCode = `${importStmt}

${helperPrefix}export type ${pascalName(def.name)}Uniforms = ${valuesTypeName}

export const ${camelName(def.name)}Manifest: MaterialManifest<${valuesTypeName}> = {
  version: 2,
  sourceHash: ${JSON.stringify(sourceHash)},
  name: ${JSON.stringify(def.name)},
  wgsl: ${JSON.stringify(wgsl)},
  vertexEntry: ${JSON.stringify(vertexEntry)},
  fragmentEntry: ${JSON.stringify(fragmentEntry)},
  sampleViewFormat: ${JSON.stringify(def.sampleViewFormat ?? 'rgba8unorm')},
  attributes: ${JSON.stringify(manifestAttrs)},
  customUniforms: ${uniformBlock},${staticField}
  cullMode: ${JSON.stringify(def.doubleSided ? 'none' : 'back')},
  depthWrite: ${Boolean(def.depthWrite)},
  depthTest: ${def.depthTest ?? true},
  needsBackdrop: ${Boolean(def.needsBackdrop)},
  animated: ${Boolean(def.animated)},
}
`
  const code = formatManifestFile(path.basename(absPath), bodyCode)
  return {
    name: def.name,
    outPath,
    code,
    wgslBytes: Buffer.byteLength(wgsl),
    uniformBytes,
  }
}

export async function compileMaterialFile(absPath, options = {}) {
  const result = await generateMaterialSource(absPath, options)
  writeFileSync(result.outPath, result.code, 'utf8')
  return result
}

export async function checkMaterialFile(absPath, options = {}) {
  const expected = await generateMaterialSource(absPath, options)
  let current = ''
  try {
    current = readFileSync(expected.outPath, 'utf8')
  } catch {
    return { ...expected, ok: false, reason: 'missing' }
  }
  return {
    ...expected,
    ok: current === expected.code,
    reason: current === expected.code ? 'up-to-date' : 'stale',
  }
}
