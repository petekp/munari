// Prototype `munari compile` CLI: resolves TypeGPU *.material.ts files on a
// stub WebGPU device via unplugin-typegpu/node into standalone zero-dep *.material.gen.ts manifests.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const here = import.meta.dirname
const preloadPath = path.join(here, 'preload.mjs')

if (!process.env.MUNARI_COMPILE_PRELOADED) {
  execFileSync(
    process.execPath,
    ['--import', preloadPath, path.join(here, 'compile.mjs'), ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'development', MUNARI_COMPILE_PRELOADED: '1' },
    },
  )
  process.exit(0)
}

function installWebGpuNodeGlobals() {
  if (!globalThis.GPUShaderStage) {
    globalThis.GPUShaderStage = { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 }
  }
  if (!globalThis.GPUBufferUsage) {
    globalThis.GPUBufferUsage = { MAP_READ: 0x1, MAP_WRITE: 0x2, COPY_SRC: 0x4, COPY_DST: 0x8, INDEX: 0x10, VERTEX: 0x20, UNIFORM: 0x40, STORAGE: 0x80, INDIRECT: 0x100, QUERY_RESOLVE: 0x200 }
  }
  if (!globalThis.GPUTextureUsage) {
    globalThis.GPUTextureUsage = { COPY_SRC: 0x1, COPY_DST: 0x2, TEXTURE_BINDING: 0x4, STORAGE_BINDING: 0x8, RENDER_ATTACHMENT: 0x10 }
  }
}

installWebGpuNodeGlobals()

const [{ default: tgpu }, d, { posVertexLayout, uvVertexLayout }] = await Promise.all([
  import('typegpu'),
  import('typegpu/data'),
  import('../engine/typegpuMaterial'),
])

function createStubDevice() {
  const shaders = []
  const writes = []
  const makeObj = () => ({})
  const device = {
    features: new Set(),
    limits: {
      minUniformBufferOffsetAlignment: 256,
      maxBindGroups: 4,
      maxColorAttachments: 8,
    },
    createShaderModule({ code }) {
      shaders.push(code)
      return { code }
    },
    createBindGroupLayout: makeObj,
    createPipelineLayout: makeObj,
    createRenderPipeline(desc) {
      return { desc }
    },
    createBuffer(desc) {
      const mem = new ArrayBuffer(desc.size)
      return {
        size: desc.size,
        usage: desc.usage,
        getMappedRange: () => mem,
        unmap() {},
        destroy() {},
      }
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
  if (schema.type.startsWith('vec')) return 'readonly number[]'
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
    const elemSize = d.sizeOf(schema.elementType)
    const elemAlign = d.alignmentOf(schema.elementType)
    const stride = Math.ceil(elemSize / elemAlign) * elemAlign
    for (let i = 0; i < schema.elementCount; i++) {
      emitPackField(lines, schema.elementType, offset + i * stride, `${valueExpr}[${i}]`, helpersUsed)
    }
    return
  }
  if (t === 'struct') {
    const props = Object.keys(schema.propTypes)
    for (const key of props) {
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

function extractEntryPoints(wgsl) {
  const vsMatch = wgsl.match(/@vertex\s+(?:@\w+(?:\([^)]*\))?\s+)*fn\s+([A-Za-z0-9_]+)/)
  const fsMatch = wgsl.match(/@fragment\s+(?:@\w+(?:\([^)]*\))?\s+)*fn\s+([A-Za-z0-9_]+)/)
  return {
    vertexEntry: vsMatch ? vsMatch[1] : undefined,
    fragmentEntry: fsMatch ? fsMatch[1] : undefined,
  }
}

function compileMaterialFile(absPath) {
  return import(pathToFileURL(absPath).href).then((mod) => {
    const def = mod.default
    assert.ok(def && def.name && def.vertex && def.fragment, `${absPath}: missing default export from defineManifestMaterial()`)
    const { device, shaders, writes } = createStubDevice()
    // SAFETY: stub WebGPU device implements the subset needed for TypeGPU pipeline WGSL resolution.
    const root = tgpu.initFromDevice({ device })

    const attribs = {
      position: posVertexLayout.attrib,
      uv: uvVertexLayout.attrib,
    }
    const manifestAttrs = [
      { name: 'position', location: 0, format: 'float32x3', stride: 12 },
      { name: 'uv', location: 1, format: 'float32x2', stride: 8 },
    ]
    for (const extra of def.extraAttributes ?? []) {
      attribs[extra.name] = extra.layout.attrib
      manifestAttrs.push({
        name: extra.name,
        location: extra.location,
        format: extra.format,
        stride: extra.stride,
      })
    }

    const pipeline = root.createRenderPipeline({
      attribs,
      vertex: def.vertex,
      fragment: def.fragment,
      targets: { format: 'bgra8unorm' },
    })
    pipeline.initSync()

    const wgsl = shaders[0]
    assert.ok(wgsl && wgsl.includes('@group(0)'), `${def.name}: resolved WGSL did not bind @group(0) surfaceLayout`)
    const { vertexEntry, fragmentEntry } = extractEntryPoints(wgsl)

    let uniformBlock = 'null'
    let valuesTypeName = 'Record<string, never>'
    let helperPrefix = ''
    if (def.uniforms) {
      const { schema, initial, sampleValue } = def.uniforms
      const { byteSize, typeSig, packBody, helperSource } = generatePackSource(schema)
      verifyPackParity(root, writes, schema, sampleValue ?? initial, packBody)
      const plainInitial = serializePlainValue(schema, initial)
      valuesTypeName = typeSig
      if (helperSource) helperPrefix = `${helperSource}\n\n`
      uniformBlock = `{
    byteSize: ${byteSize},
    initial: ${JSON.stringify(plainInitial)},
    pack(values: ${typeSig}, view: DataView, base: number): void {
${packBody}
    },
  }`
    }

    const outPath = absPath.replace(/\.material\.ts$/, '.material.gen.ts')
    const outCode = `// Generated by instruments/webgpu-micro-probe/cli/compile.mjs from ${path.basename(absPath)}.
// Zero TypeGPU runtime dependencies.

import type { MaterialManifest } from '../engine/manifest'

${helperPrefix}export type ${pascalName(def.name)}Uniforms = ${valuesTypeName}

export const ${camelName(def.name)}Manifest: MaterialManifest<${valuesTypeName}> = {
  name: ${JSON.stringify(def.name)},
  wgsl: ${JSON.stringify(wgsl)},
  vertexEntry: ${JSON.stringify(vertexEntry)},
  fragmentEntry: ${JSON.stringify(fragmentEntry)},
  sampleViewFormat: ${JSON.stringify(def.sampleViewFormat ?? 'rgba8unorm')},
  attributes: ${JSON.stringify(manifestAttrs)},
  customUniforms: ${uniformBlock},
  cullMode: ${JSON.stringify(def.doubleSided ? 'none' : 'back')},
  depthWrite: ${Boolean(def.depthWrite)},
  depthTest: ${def.depthTest ?? true},
  needsBackdrop: ${Boolean(def.needsBackdrop)},
  animated: ${Boolean(def.animated)},
}
`
    writeFileSync(outPath, outCode, 'utf8')
    return {
      name: def.name,
      outPath,
      wgslBytes: Buffer.byteLength(wgsl),
      uniformBytes: def.uniforms ? d.sizeOf(def.uniforms.schema) : 0,
    }
  })
}

function camelName(name) {
  return name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
}

function pascalName(name) {
  const c = camelName(name)
  return c.charAt(0).toUpperCase() + c.slice(1)
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node cli/compile.mjs <file1.material.ts> [...]')
  process.exit(1)
}

const compiled = []
for (const fileArg of args) {
  compiled.push(await compileMaterialFile(path.resolve(process.cwd(), fileArg)))
}
console.log(JSON.stringify({ compiled }, null, 2))
