// Content-less grounded cast shadow for `@petepetrash/munari/gpu` Surfaces —
// lazily loaded only when `shadow` is passed so non-shadow pages pay zero weight.
//
// The law: four card corners transform by the Surface's world pose and project
// along `keyPos` onto `z = -0.5` behind the card. Parallelogram half-edge vectors
// keep `(uv * 2 - 1) * quadHalf` exact in CSS px, while `modelWorld[14] = -0.5`
// sorts the shadow before the card in pass 1 (`depthWrite: false`, premultiplied).
//
// Ownership: `@petepetrash/munari/gpu`.

import type { SurfaceShadowLayer } from '@munari/core'
import {
  GPU_BUFFER_USAGE,
  createPlaneGeometry,
  type GpuDrawItem,
  type GpuGeometry,
  type GpuMaterial,
  type GpuRenderer,
} from './gpuGeometry'
import { mat4FromPositionEulerScale, type Mat4 } from './math'
import type { SurfacePose } from './surfaceDom'

export interface SurfaceShadowOptions {
  readonly opacity?: number
  readonly blur?: number
  readonly spread?: number
  readonly elevationScale?: number
  readonly color?: string
}

export interface ShadowProjection {
  readonly verts: readonly [number, number, number, number, number, number, number, number]
  readonly cardHalf: readonly [number, number]
  readonly quadHalf: readonly [number, number]
  readonly sigma: number
  readonly visible: boolean
}

export interface GpuSurfaceShadowHandle {
  readonly ready: Promise<void>
  updateDrawItem(params: {
    readonly size: readonly [number, number]
    readonly radii: readonly [number, number, number, number]
    readonly shadowLayers?: readonly SurfaceShadowLayer[]
    readonly pose: SurfacePose
    readonly keyPos: readonly [number, number, number]
    readonly viewProj: Mat4
    readonly view: GPUTextureView | null
    readonly sampler: GPUSampler
    readonly colorWrite: boolean
  }): GpuDrawItem | null
  updateOptions(options: boolean | SurfaceShadowOptions): void
  dispose(): void
}

const MAX_SHADOW_LAYERS = 4
const SHADOW_UNIFORM_BYTES = 176
const SHADOW_Z = -0.5
const GPU_COLOR_WRITE_ALL = 0xf

const SHADOW_WGSL = /* wgsl */ `
struct FrameUniforms {
  mvp: mat4x4f,
  modelWorld: mat4x4f,
  size: vec2f,
  viewport: vec2f,
  radii: vec4f,
  camera: vec4f,
  keyPos: vec4f,
  keySize: vec4f,
  rimDir: vec4f,
  uvRect: vec4f,
  _r1: vec4f,
};

struct ShadowUniforms {
  radii: vec4f,
  halfs: vec4f,
  info: vec4f,
  layerGeom: array<vec4f, 4>,
  layerColor: array<vec4f, 4>,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(1) @binding(0) var<uniform> u: ShadowUniforms;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsMain(@location(0) position: vec3f, @location(1) uv: vec2f) -> VsOut {
  var out: VsOut;
  out.pos = frame.mvp * vec4f(position, 1.0);
  out.uv = uv;
  return out;
}

fn erfA(x: f32) -> f32 {
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign(x) * (1.0 - poly * exp(-a * a));
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let baseP = (uv * 2.0 - 1.0) * u.halfs.xy;
  let layerCount = u32(clamp(u.info.x + 0.5, 0.0, 4.0));
  var acc = vec4f(0.0);
  for (var i = 0u; i < layerCount; i = i + 1u) {
    let g = u.layerGeom[i];
    let col = u.layerColor[i];
    let p = baseP - g.xy;
    let halfC = max(u.halfs.zw + vec2f(g.w), vec2f(1.0));
    let leftR = select(u.radii.w, u.radii.x, p.y > 0.0);
    let rightR = select(u.radii.z, u.radii.y, p.y > 0.0);
    let r = min(max(select(rightR, leftR, p.x < 0.0), 0.0), min(halfC.x, halfC.y));
    let q = abs(p) - halfC + vec2f(r);
    let sd = min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - r;
    let cov = clamp(0.5 * (1.0 - erfA(sd / max(1.41421356 * g.z, 0.35))), 0.0, 1.0);
    let a = clamp(cov * col.a, 0.0, 1.0);
    acc = vec4f(acc.rgb + (1.0 - acc.a) * (col.rgb * a), acc.a + (1.0 - acc.a) * a);
  }
  if (acc.a < 0.002) {
    discard;
  }
  return acc;
}
`

function hexToSrgb(hex: string): readonly [number, number, number] {
  const raw = hex.startsWith('#') ? hex.slice(1).trim() : hex.trim()
  if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return [0.035, 0.051, 0.086]
  const hex6 = raw.length === 3 ? raw.replace(/(.)/g, '$1$1') : raw.length === 8 ? raw.slice(0, 6) : raw
  const num = Number.parseInt(hex6, 16)
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255]
}

function normalizeOptions(options: boolean | SurfaceShadowOptions) {
  const obj = options === true || options === false ? {} : options
  return {
    opacity: obj.opacity ?? 0.28,
    blur: Math.max(0.5, obj.blur ?? 14),
    spread: obj.spread ?? 0,
    elevationScale: Math.max(0, obj.elevationScale ?? 0.35),
    color: hexToSrgb(obj.color ?? '#090d16'),
  }
}

/** Projects card corners onto the ground plane along `keyPos` and returns parallelogram geometry metrics. */
export function computeShadowProjection(
  size: readonly [number, number],
  pose: SurfacePose,
  keyPos: readonly [number, number, number],
  options: { readonly blur: number; readonly spread: number; readonly elevationScale: number },
  extraMargin = 0,
): ShadowProjection {
  const world = new Float32Array(16)
  mat4FromPositionEulerScale(
    pose.x,
    pose.y,
    pose.z,
    pose.rx ?? 0,
    pose.ry ?? 0,
    pose.rz ?? 0,
    pose.sx ?? 1,
    pose.sy ?? 1,
    pose.sz ?? 1,
    world,
  )
  const hw = size[0] * 0.5
  const hh = size[1] * 0.5
  const lx = [-hw, hw, hw, -hw] as const
  const ly = [hh, hh, -hh, -hh] as const
  const px = [0, 0, 0, 0]
  const py = [0, 0, 0, 0]
  const [kx, ky, kz] = keyPos
  let maxCz = -Infinity

  for (let i = 0; i < 4; i++) {
    const x = lx[i]!
    const y = ly[i]!
    const cx = world[0]! * x + world[4]! * y + world[12]!
    const cy = world[1]! * x + world[5]! * y + world[13]!
    const cz = world[2]! * x + world[6]! * y + world[14]!
    if (cz > maxCz) maxCz = cz
    const denom = Math.max(20, kz - cz)
    const t = Math.max(0, (cz - SHADOW_Z) / denom)
    px[i] = cx + t * (cx - kx)
    py[i] = cy + t * (cy - ky)
  }

  const fcx = (px[0]! + px[1]! + px[2]! + px[3]!) * 0.25
  const fcy = (py[0]! + py[1]! + py[2]! + py[3]!) * 0.25
  let eux = (px[1]! + px[2]! - px[0]! - px[3]!) * 0.25
  let euy = (py[1]! + py[2]! - py[0]! - py[3]!) * 0.25
  let evx = (px[0]! + px[1]! - px[3]! - px[2]!) * 0.25
  let evy = (py[0]! + py[1]! - py[3]! - py[2]!) * 0.25
  const lu = Math.max(Math.hypot(eux, euy), 1e-3)
  const lv = Math.max(Math.hypot(evx, evy), 1e-3)
  eux /= lu
  euy /= lu
  evx /= lv
  evy /= lv

  const altitude = Math.max(0, pose.z)
  const sigma = Math.max(0.5, options.blur + altitude * options.elevationScale)
  const margin = Math.max(4, sigma * 3 + Math.max(0, options.spread), extraMargin)
  const qhx = lu + margin
  const qhy = lv + margin

  return {
    verts: [
      fcx - eux * qhx + evx * qhy,
      fcy - euy * qhx + evy * qhy,
      fcx + eux * qhx + evx * qhy,
      fcy + euy * qhx + evy * qhy,
      fcx - eux * qhx - evx * qhy,
      fcy - euy * qhx - evy * qhy,
      fcx + eux * qhx - evx * qhy,
      fcy + euy * qhx - evy * qhy,
    ],
    cardHalf: [lu, lv],
    quadHalf: [qhx, qhy],
    sigma,
    visible: maxCz > SHADOW_Z,
  }
}

/** Creates a lazily loaded grounded shadow draw-item builder for one `Surface`. */
export function createGpuSurfaceShadow(
  renderer: GpuRenderer,
  initialOptions: boolean | SurfaceShadowOptions,
): GpuSurfaceShadowHandle {
  let opts = normalizeOptions(initialOptions)
  let disposed = false
  let readyState = false
  const geo: GpuGeometry = createPlaneGeometry(renderer.device, 2, 2, 1, 1)
  const uniformBuf = renderer.device.createBuffer({
    size: SHADOW_UNIFORM_BYTES,
    usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
  })
  const uniformScratch = new Float32Array(SHADOW_UNIFORM_BYTES / 4)
  const customBg = renderer.device.createBindGroup({
    layout: renderer.customBindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
  })
  const customBgs: readonly GPUBindGroup[] = [customBg]
  const shadowWorld = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, SHADOW_Z, 1])

  let colorPipe: GPURenderPipeline | null = null
  let warmPipe: GPURenderPipeline | null = null
  const ready = renderer
    .getOrCreatePipelines('munari:surface-shadow', async () => {
      const module = renderer.device.createShaderModule({ label: 'munari-surface-shadow', code: SHADOW_WGSL })
      const layout = renderer.device.createPipelineLayout({
        bindGroupLayouts: [renderer.surfaceBindGroupLayout, renderer.customBindGroupLayout],
      })
      const baseDesc = (writeMask: number): GPURenderPipelineDescriptor => ({
        layout,
        vertex: {
          module,
          entryPoint: 'vsMain',
          buffers: [
            { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
            { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
          ],
        },
        fragment: {
          module,
          entryPoint: 'fsMain',
          targets: [
            {
              format: renderer.format,
              writeMask,
              blend: {
                color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              },
            },
          ],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
      })
      const [color, warm] = await Promise.all([
        renderer.device.createRenderPipelineAsync(baseDesc(GPU_COLOR_WRITE_ALL)),
        renderer.device.createRenderPipelineAsync(baseDesc(0)),
      ])
      return { color, warm }
    })
    .then((pipes) => {
      if (disposed) return
      colorPipe = pipes.color
      warmPipe = pipes.warm
      readyState = true
    })

  let lastView: GPUTextureView | null = null
  let lastSampler: GPUSampler | null = null
  let cachedBg: GPUBindGroup | null = null
  let lastGeoSig = ''
  let lastUniSig = ''

  const shadowMat: GpuMaterial = {
    ready,
    isReady: () => readyState,
    usesDynamicFrameOffset: true,
    needsBackdrop: false,
    writeCustomUniforms() {},
    updateFrameUniforms() {},
    ensureBindGroup(view, sampler) {
      if (!cachedBg || view !== lastView || sampler !== lastSampler) {
        lastView = view
        lastSampler = sampler
        cachedBg = renderer.device.createBindGroup({
          layout: renderer.surfaceBindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: renderer.frameUniformBuffer, size: 256 } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: view },
          ],
        })
      }
      return cachedBg
    },
    extraBindGroups: () => customBgs,
    pipelineFor: (colorWrite) => (colorWrite ? colorPipe : warmPipe),
    dispose() {
      disposed = true
      geo.dispose()
      uniformBuf.destroy()
      cachedBg = null
    },
  }

  return {
    ready,
    updateOptions(nextOptions) {
      opts = normalizeOptions(nextOptions)
      lastUniSig = ''
    },
    updateDrawItem(params) {
      if (disposed || !readyState || !params.view) return null
      const alt = Math.max(0, params.pose.z)
      const t = Math.min(1, alt / 20)
      const elevFade = t * t * (3 - 2 * t)
      const castAlpha = opts.opacity * elevFade
      const cssLayers = params.shadowLayers ?? []
      const geomVals: number[] = []
      const colVals: number[] = []
      let maxReach = 0
      let layerCount = 0

      const pushLayer = (ox: number, oy: number, sigma: number, spread: number, r: number, g: number, b: number, a: number) => {
        if (layerCount >= MAX_SHADOW_LAYERS || a <= 0.002) return
        geomVals.push(ox, oy, sigma, spread)
        colVals.push(r, g, b, a)
        maxReach = Math.max(maxReach, Math.hypot(ox, oy) + 3 * sigma + Math.max(0, spread))
        layerCount += 1
      }

      const maxCss = castAlpha > 0.002 ? MAX_SHADOW_LAYERS - 1 : MAX_SHADOW_LAYERS
      for (let i = 0; i < cssLayers.length && i < maxCss; i++) {
        const l = cssLayers[i]!
        const sigma = Math.max(0.25, l.blur * 0.5 + 0.17 * alt)
        const spread = l.spread / (1 + alt / 140)
        const alpha = l.color[3] / (1 + alt / 210)
        pushLayer(l.x, -l.y, sigma, spread, l.color[0], l.color[1], l.color[2], alpha)
      }
      if (castAlpha > 0.002) {
        const castSigma = Math.max(0.5, opts.blur + alt * opts.elevationScale)
        pushLayer(0, 0, castSigma, opts.spread, opts.color[0], opts.color[1], opts.color[2], castAlpha)
      }
      if (layerCount === 0) return null

      const proj = computeShadowProjection(params.size, params.pose, params.keyPos, opts, maxReach)
      if (!proj.visible) return null
      const geoSig = proj.verts.map((v) => v.toFixed(3)).join(',')
      if (geoSig !== lastGeoSig) {
        lastGeoSig = geoSig
        for (let i = 0; i < 4; i++) {
          geo.positions[i * 3] = proj.verts[i * 2]!
          geo.positions[i * 3 + 1] = proj.verts[i * 2 + 1]!
          geo.positions[i * 3 + 2] = SHADOW_Z
        }
        geo.updatePositions()
      }
      const uniSig = `${params.radii.join(',')}|${proj.quadHalf[0].toFixed(2)},${proj.quadHalf[1].toFixed(2)}|${layerCount}|${geomVals.map((v) => v.toFixed(2)).join(',')}|${colVals.map((v) => v.toFixed(3)).join(',')}`
      if (uniSig !== lastUniSig) {
        lastUniSig = uniSig
        uniformScratch.fill(0)
        uniformScratch.set(params.radii, 0)
        uniformScratch[4] = proj.quadHalf[0]
        uniformScratch[5] = proj.quadHalf[1]
        uniformScratch[6] = proj.cardHalf[0]
        uniformScratch[7] = proj.cardHalf[1]
        uniformScratch[8] = layerCount
        uniformScratch.set(geomVals, 12)
        uniformScratch.set(colVals, 28)
        renderer.device.queue.writeBuffer(uniformBuf, 0, uniformScratch)
      }
      return {
        geometry: geo,
        material: shadowMat,
        view: params.view,
        sampler: params.sampler,
        modelWorld: shadowWorld,
        mvp: params.viewProj,
        size: params.size,
        radii: params.radii,
        colorWrite: params.colorWrite,
      }
    },
    dispose() {
      shadowMat.dispose()
    },
  }
}
