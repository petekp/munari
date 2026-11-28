// Lazy multi-level 5-tap Kawase downsample backdrop blur — imported dynamically
// only when a `needsBackdrop: true` Surface compiles so opaque pages ship zero blur code.
//
// The law: canvas backdrop pixels live in premultiplied sRGB (`decisions.md #5`, `#80`),
// so each downsample pass reads mip `i - 1` via 5 taps clamped strictly to the
// copied crop UV subrect, decodes EOTF before weighted averaging, then re-encodes OETF
// and premultiplies. Level views and bind groups rebuild only on resize.
//
// Ownership: `@petepetrash/munari/gpu`.

import { GPU_BUFFER_USAGE, GPU_SHADER_STAGE, GPU_TEXTURE_USAGE, SURFACE_WGSL_COMMON, type GpuDrawItem } from './gpuGeometry'

// Covers mip LODs 0..5 (up to ~32 CSS px radius at DPR 2) matching finishTransmissive clamp(lod, 0, 4.5).
const MAX_BACKDROP_MIPS = 6

const BACKDROP_BLUR_WGSL =
  SURFACE_WGSL_COMMON +
  /* wgsl */ `
struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsMain(@builtin(vertex_index) vid: u32) -> VsOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var uv = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
  var out: VsOut;
  out.pos = vec4f(pos[vid], 0.0, 1.0);
  out.uv = uv[vid];
  return out;
}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> cropUv: vec4f;

fn samplePmLin(uv: vec2f) -> vec4f {
  let clamped = clamp(uv, cropUv.xy, cropUv.zw);
  let pm = textureSampleLevel(tex, samp, clamped, 0.0);
  let straight = select(vec3f(0.0), pm.rgb / max(pm.a, 1e-4), pm.a > 0.002);
  return vec4f(srgbEotf(straight) * pm.a, pm.a);
}

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let stepUv = vec2f(1.0) / max(vec2f(textureDimensions(tex)), vec2f(1.0));
  let c = samplePmLin(uv) * 0.5;
  let nw = samplePmLin(uv + vec2f(-stepUv.x, -stepUv.y)) * 0.125;
  let ne = samplePmLin(uv + vec2f(stepUv.x, -stepUv.y)) * 0.125;
  let sw = samplePmLin(uv + vec2f(-stepUv.x, stepUv.y)) * 0.125;
  let se = samplePmLin(uv + vec2f(stepUv.x, stepUv.y)) * 0.125;
  let sum = c + nw + ne + sw + se;
  let straight = select(vec3f(0.0), sum.rgb / max(sum.a, 1e-4), sum.a > 0.002);
  let encoded = srgbOetf(clamp(straight, vec3f(0.0), vec3f(1.0)));
  return vec4f(encoded * sum.a, sum.a);
}
`

export interface CropRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Clamps a pixel-space crop rectangle to `[0, width] x [0, height]` covering the full float span. */
export function clampBackdropCrop(crop: CropRect, width: number, height: number): CropRect {
  const safeW = Math.max(1, width)
  const safeH = Math.max(1, height)
  const x = Math.max(0, Math.min(safeW - 1, Math.floor(crop.x)))
  const y = Math.max(0, Math.min(safeH - 1, Math.floor(crop.y)))
  const right = Math.ceil(crop.x + crop.w)
  const bottom = Math.ceil(crop.y + crop.h)
  const w = Math.max(1, Math.min(safeW - x, right - x))
  const h = Math.max(1, Math.min(safeH - y, bottom - y))
  return { x, y, w, h }
}

/** Projects all `needsBackdrop` item AABBs to padded canvas pixels for cropped blur copies. */
export function computeBackdropCropRect(
  items: readonly GpuDrawItem[],
  backdropIndices: readonly number[],
  width: number,
  height: number,
  dpr: number,
): CropRect {
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  for (const idx of backdropIndices) {
    const item = items[idx]!
    const m = item.mvp
    const { minX: bx0, minY: by0, minZ: bz0, maxX: bx1, maxY: by1, maxZ: bz1 } = item.geometry.bounds
    for (let cx = 0; cx < 2; cx++) {
      const px = cx === 0 ? bx0 : bx1
      for (let cy = 0; cy < 2; cy++) {
        const py = cy === 0 ? by0 : by1
        for (let cz = 0; cz < 2; cz++) {
          const pz = cz === 0 ? bz0 : bz1
          const w = m[3]! * px + m[7]! * py + m[11]! * pz + m[15]!
          if (w <= 1e-4) continue
          const sx = (((m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!) / w) * 0.5 + 0.5) * width
          const sy = (0.5 - ((m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!) / w) * 0.5) * height
          if (sx < minX) minX = sx
          if (sx > maxX) maxX = sx
          if (sy < minY) minY = sy
          if (sy > maxY) maxY = sy
        }
      }
    }
  }
  if (minX > maxX || minY > maxY) return { x: 0, y: 0, w: width, h: height }
  const pad = Math.max(64, Math.ceil(48 * dpr))
  return clampBackdropCrop(
    { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 },
    width,
    height,
  )
}

interface BlurLevel {
  readonly dstView: GPUTextureView
  readonly bg: GPUBindGroup
  readonly level: number
}

export interface BackdropBlurEngine {
  encode(
    encoder: GPUCommandEncoder,
    sourceTex: GPUTexture,
    width: number,
    height: number,
    items: readonly GpuDrawItem[],
    backdropIndices: readonly number[],
    dpr: number,
  ): GPUBindGroup
  dispose(): void
}

/** Builds the lazy multi-mip backdrop downsample pipeline matching canvas `format`. */
export async function createBackdropBlur(
  device: GPUDevice,
  format: GPUTextureFormat,
  backdropBindGroupLayout: GPUBindGroupLayout,
  backdropSampler: GPUSampler,
): Promise<BackdropBlurEngine> {
  const levelLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPU_SHADER_STAGE.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 2, visibility: GPU_SHADER_STAGE.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  })
  const module = device.createShaderModule({ label: 'munari-backdrop-blur', code: BACKDROP_BLUR_WGSL })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'munari-backdrop-blur-pipe',
    layout: device.createPipelineLayout({ bindGroupLayouts: [levelLayout] }),
    vertex: { module, entryPoint: 'vsMain' },
    fragment: { module, entryPoint: 'fsMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
  const levelSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  const cropUvBuf = device.createBuffer({
    size: 16,
    usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
  })
  const cropUvScratch = new Float32Array(4)

  let tex: GPUTexture | null = null
  let curW = 0
  let curH = 0
  let levels: BlurLevel[] = []
  let fullBg: GPUBindGroup | null = null

  const ensureResources = (w: number, h: number) => {
    const safeW = Math.max(1, w)
    const safeH = Math.max(1, h)
    if (tex && curW === safeW && curH === safeH && fullBg) return
    tex?.destroy()
    const mipCount = Math.min(MAX_BACKDROP_MIPS, Math.max(1, Math.floor(Math.log2(Math.max(safeW, safeH))) + 1))
    tex = device.createTexture({
      size: [safeW, safeH],
      mipLevelCount: mipCount,
      format,
      usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST | GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
    })
    curW = safeW
    curH = safeH
    levels = []
    for (let level = 1; level < mipCount; level++) {
      const srcView = tex.createView({ baseMipLevel: level - 1, mipLevelCount: 1 })
      const dstView = tex.createView({ baseMipLevel: level, mipLevelCount: 1 })
      const bg = device.createBindGroup({
        layout: levelLayout,
        entries: [
          { binding: 0, resource: levelSampler },
          { binding: 1, resource: srcView },
          { binding: 2, resource: { buffer: cropUvBuf } },
        ],
      })
      levels.push({ dstView, bg, level })
    }
    fullBg = device.createBindGroup({
      layout: backdropBindGroupLayout,
      entries: [
        { binding: 0, resource: backdropSampler },
        { binding: 1, resource: tex.createView() },
      ],
    })
  }

  return {
    encode(encoder, sourceTex, width, height, items, backdropIndices, dpr) {
      ensureResources(width, height)
      if (!tex || !fullBg) throw new Error('Backdrop blur allocation failed')
      const region = computeBackdropCropRect(items, backdropIndices, curW, curH, dpr)
      const minU = Math.min(1, (region.x + 0.5) / curW)
      const minV = Math.min(1, (region.y + 0.5) / curH)
      cropUvScratch[0] = minU
      cropUvScratch[1] = minV
      cropUvScratch[2] = Math.max(minU, (region.x + region.w - 0.5) / curW)
      cropUvScratch[3] = Math.max(minV, (region.y + region.h - 0.5) / curH)
      device.queue.writeBuffer(cropUvBuf, 0, cropUvScratch)

      encoder.copyTextureToTexture(
        { texture: sourceTex, origin: [region.x, region.y] },
        { texture: tex, mipLevel: 0, origin: [region.x, region.y] },
        [region.w, region.h],
      )
      for (const lvl of levels) {
        const mipW = Math.max(1, curW >> lvl.level)
        const mipH = Math.max(1, curH >> lvl.level)
        const scale = 1 << lvl.level
        const sx = Math.max(0, Math.floor(region.x / scale) - 1)
        const sy = Math.max(0, Math.floor(region.y / scale) - 1)
        const sw = Math.max(1, Math.min(mipW - sx, Math.ceil((region.x + region.w) / scale) + 1 - sx))
        const sh = Math.max(1, Math.min(mipH - sy, Math.ceil((region.y + region.h) / scale) + 1 - sy))
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: lvl.dstView, loadOp: 'clear', storeOp: 'store' }],
        })
        pass.setPipeline(pipeline)
        pass.setScissorRect(sx, sy, sw, sh)
        pass.setBindGroup(0, lvl.bg)
        pass.draw(3)
        pass.end()
      }
      return fullBg
    },
    dispose() {
      tex?.destroy()
      cropUvBuf.destroy()
      tex = null
      levels = []
      fullBg = null
    },
  }
}
