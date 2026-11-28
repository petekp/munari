// Content-less grounded cast shadow for `@petepetrash/munari/gpu` Surfaces —
// lazily loaded only when `shadow` is passed so non-shadow pages pay zero weight.
//
// The law: four card corners transform by the Surface's world pose and project
// along `keyPos` onto `z = -0.5` behind the card. Parallelogram half-edge vectors
// keep `(uv * 2 - 1) * quadHalf` exact in CSS px, while `modelWorld[14] = -0.5`
// sorts the shadow before the card in pass 1 (`depthWrite: false`, premultiplied).
//
// Ownership: `@petepetrash/munari/gpu`.

import {
  GPU_BUFFER_USAGE,
  SURFACE_WGSL_COMMON,
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

const SHADOW_UNIFORM_BYTES = 64
const SHADOW_Z = -0.5
const GPU_COLOR_WRITE_ALL = 0xf

const SHADOW_WGSL =
  SURFACE_WGSL_COMMON +
  /* wgsl */ `
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
  params: vec4f,
  color: vec4f,
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

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let p = (uv * 2.0 - 1.0) * u.halfs.xy;
  let halfC = max(u.halfs.zw + vec2f(u.params.y), vec2f(1.0));
  let leftR = select(u.radii.w, u.radii.x, p.y > 0.0);
  let rightR = select(u.radii.z, u.radii.y, p.y > 0.0);
  let r = min(max(select(rightR, leftR, p.x < 0.0), 0.0), min(halfC.x, halfC.y));
  let q = abs(p) - halfC + vec2f(r);
  let sd = min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - r;
  let sigma = max(u.params.x, 0.5);
  let cov = 0.5 - 0.5 * tanh(sd * 0.85 / sigma);
  let alpha = clamp(cov * u.params.z, 0.0, 1.0);
  if (alpha < 0.002) {
    discard;
  }
  let enc = srgbOetf(clamp(u.color.rgb, vec3f(0.0), vec3f(1.0)));
  return vec4f(enc * alpha, alpha);
}
`

function hexToLinear(hex: string): readonly [number, number, number] {
  const raw = hex.startsWith('#') ? hex.slice(1).trim() : hex.trim()
  if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return [0.003, 0.005, 0.01]
  const hex6 = raw.length === 3 ? raw.replace(/(.)/g, '$1$1') : raw.length === 8 ? raw.slice(0, 6) : raw
  const num = Number.parseInt(hex6, 16)
  const eotf = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return [eotf(((num >> 16) & 255) / 255), eotf(((num >> 8) & 255) / 255), eotf((num & 255) / 255)]
}

function normalizeOptions(options: boolean | SurfaceShadowOptions) {
  const obj = options === true || options === false ? {} : options
  return {
    opacity: obj.opacity ?? 0.28,
    blur: Math.max(0.5, obj.blur ?? 14),
    spread: obj.spread ?? 0,
    elevationScale: Math.max(0, obj.elevationScale ?? 0.35),
    color: hexToLinear(obj.color ?? '#090d16'),
  }
}

/** Projects card corners onto the ground plane along `keyPos` and returns parallelogram geometry metrics. */
export function computeShadowProjection(
  size: readonly [number, number],
  pose: SurfacePose,
  keyPos: readonly [number, number, number],
  options: { readonly blur: number; readonly spread: number; readonly elevationScale: number },
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
  const margin = Math.max(4, sigma * 2.5 + Math.max(0, options.spread))
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
      if (disposed || !readyState || !params.view || opts.opacity <= 0) return null
      const elevFade = Math.min(1, Math.max(0, params.pose.z / 16))
      const effOpacity = opts.opacity * elevFade
      if (effOpacity <= 0.002) return null
      const proj = computeShadowProjection(params.size, params.pose, params.keyPos, opts)
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
      const uniSig = `${params.radii.join(',')}|${proj.quadHalf[0].toFixed(2)},${proj.quadHalf[1].toFixed(2)}|${proj.sigma.toFixed(2)}|${opts.spread}|${effOpacity.toFixed(3)}|${opts.color.join(',')}`
      if (uniSig !== lastUniSig) {
        lastUniSig = uniSig
        uniformScratch.set(params.radii, 0)
        uniformScratch[4] = proj.quadHalf[0]
        uniformScratch[5] = proj.quadHalf[1]
        uniformScratch[6] = proj.cardHalf[0]
        uniformScratch[7] = proj.cardHalf[1]
        uniformScratch[8] = proj.sigma
        uniformScratch[9] = opts.spread
        uniformScratch[10] = effOpacity
        uniformScratch[11] = 0
        uniformScratch[12] = opts.color[0]
        uniformScratch[13] = opts.color[1]
        uniformScratch[14] = opts.color[2]
        uniformScratch[15] = 1
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
