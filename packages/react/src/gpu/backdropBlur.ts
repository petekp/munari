// Lazy multi-level 5-tap Kawase downsample backdrop blur — imported dynamically
// only when a `needsBackdrop: true` Surface compiles so opaque pages ship zero blur code.
//
// The law: canvas backdrop pixels live in premultiplied sRGB (`decisions.md #72`),
// so each downsample pass reads mip `i - 1` via 5 taps, decodes EOTF before weighted
// averaging, then re-encodes OETF and premultiplies. Level views and bind groups
// rebuild only on resize, keeping per-frame JS work O(mips) with zero allocations.
// Hardware bilinear filtering operates within each mip's 2x2 footprint before EOTF.
//
// Ownership: `@petepetrash/munari/gpu`.

import { GPU_SHADER_STAGE, GPU_TEXTURE_USAGE, SURFACE_WGSL_COMMON } from './gpuGeometry'

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

fn samplePmLin(uv: vec2f) -> vec4f {
  let pm = textureSampleLevel(tex, samp, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
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

interface BlurLevel {
  readonly dstView: GPUTextureView
  readonly bg: GPUBindGroup
}

export interface BackdropBlurEngine {
  encode(encoder: GPUCommandEncoder, sourceTex: GPUTexture, width: number, height: number): GPUBindGroup
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
        ],
      })
      levels.push({ dstView, bg })
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
    encode(encoder, sourceTex, width, height) {
      ensureResources(width, height)
      if (!tex || !fullBg) throw new Error('Backdrop blur allocation failed')
      encoder.copyTextureToTexture({ texture: sourceTex }, { texture: tex, mipLevel: 0 }, [curW, curH])
      for (const lvl of levels) {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: lvl.dstView, loadOp: 'clear', storeOp: 'store' }],
        })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, lvl.bg)
        pass.draw(3)
        pass.end()
      }
      return fullBg
    },
    dispose() {
      tex?.destroy()
      tex = null
      levels = []
      fullBg = null
    },
  }
}
