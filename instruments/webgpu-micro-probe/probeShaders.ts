// WGSL shaders, WebGPU readback/pipeline helpers, and sample math for probeEntry.

import type { DomTextureSource } from '@munari/core'

export const GPU_BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_DST: 0x0008,
} as const

export const GPU_TEXTURE_USAGE = {
  COPY_SRC: 0x0001,
  COPY_DST: 0x0002,
  TEXTURE_BINDING: 0x0004,
  RENDER_ATTACHMENT: 0x0010,
} as const

export const GPU_SHADER_STAGE = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
} as const

export const GPU_MAP_READ = 0x0001

export interface RgbaSample {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

const QUAD_WGSL = /* wgsl */ `
struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsMain(@builtin(vertex_index) vid: u32) -> VsOut {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0),
  );
  var out: VsOut;
  out.pos = vec4f(positions[vid], 0.0, 1.0);
  out.uv = uvs[vid];
  return out;
}

fn srgbOetf(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

fn srgbEotf(c: vec3f) -> vec3f {
  let lo = c / 12.92;
  let hi = pow((max(c, vec3f(0.0)) + 0.055) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}
`

export const UNLIT_SRGB_WGSL =
  QUAD_WGSL +
  /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSample(tex, samp, uv);
  return vec4f(srgbOetf(c.rgb), c.a);
}
`

export const LIT_RAW_UNPREMULT_WGSL =
  QUAD_WGSL +
  /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let raw = textureSample(tex, samp, uv);
  let straight = select(vec3f(0.0), raw.rgb / max(raw.a, 1e-6), raw.a > 0.001);
  let lin = srgbEotf(straight);
  return vec4f(srgbOetf(lin), 1.0);
}
`

export const LIT_BAD_SRGB_WGSL =
  QUAD_WGSL +
  /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSample(tex, samp, uv);
  let straight = select(vec3f(0.0), c.rgb / max(c.a, 1e-6), c.a > 0.001);
  return vec4f(srgbOetf(straight), 1.0);
}
`

export const SWAPCHAIN_RAW_WGSL =
  QUAD_WGSL +
  /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(tex, samp, uv);
}
`

export const GLOW_WGSL =
  QUAD_WGSL +
  /* wgsl */ `
@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let _u = uv.x * 0.0;
  return vec4f(0.5 + _u, 0.25, 0.0, 0.0);
}
`

export const MIPMAP_WGSL = /* wgsl */ `
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

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(tex, samp, uv);
}
`

export const MIP_SAMPLE_WGSL =
  QUAD_WGSL +
  /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(tex, samp, uv, 4.0);
  return vec4f(srgbOetf(c.rgb), c.a);
}
`

export const MIP_SAMPLE_RAW_WGSL =
  QUAD_WGSL +
  /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSampleLevel(tex, samp, uv, 2.0);
}
`

export const MIP_SAMPLE_SRGB_2_WGSL =
  QUAD_WGSL +
  /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fsMain(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(tex, samp, uv, 2.0);
  return vec4f(srgbOetf(c.rgb), c.a);
}
`

export function buildRealisticLitGlassWgsl(salt: number): string {
  return /* wgsl */ `
struct FrameUniforms {
  mvp: mat4x4f,
  modelWorld: mat4x4f,
  size: vec2f,
  radii: vec4f,
  lightDir: vec3f,
  time: f32,
};

struct MaterialUniforms {
  tint: vec3f,
  roughness: f32,
  ior: f32,
  thickness: f32,
  dispersion: f32,
  gloss: f32,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(1) @binding(0) var<uniform> mat: MaterialUniforms;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) worldPos: vec3f,
};

@vertex
fn vsMain(@location(0) pos: vec3f, @location(1) uv: vec2f) -> VsOut {
  var out: VsOut;
  let wave = sin(pos.x * 0.015 + frame.time + f32(${salt}u % 97u) * 0.001) * 1.5;
  let shifted = vec3f(pos.xy, pos.z + wave);
  out.pos = frame.mvp * vec4f(shifted, 1.0);
  out.uv = uv;
  out.worldPos = (frame.modelWorld * vec4f(shifted, 1.0)).xyz;
  return out;
}

fn roundedMask(uv: vec2f, size: vec2f, radii: vec4f) -> f32 {
  let halfSize = size * 0.5;
  let p = (uv - 0.5) * size;
  let rTop = select(radii.x, radii.y, p.x > 0.0);
  let rBot = select(radii.w, radii.z, p.x > 0.0);
  let r = select(rTop, rBot, p.y > 0.0);
  let q = abs(p) - (halfSize - vec2f(r));
  let sd = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
  return 1.0 - smoothstep(-0.75, 0.75, sd);
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4f {
  let base = textureSample(tex, samp, in.uv);
  let straight = select(vec3f(0.0), base.rgb / max(base.a, 1e-4), base.a > 0.002);
  let linBase = pow(max(straight, vec3f(0.0)), vec3f(2.2));
  let n = normalize(vec3f((in.uv - 0.5) * 0.45, 1.0));
  let v = normalize(vec3f(0.0, 0.0, 800.0) - in.worldPos);
  let l = normalize(frame.lightDir);
  let h = normalize(l + v);
  let fresnel = 0.04 + 0.96 * pow(clamp(1.0 - max(dot(n, v), 0.0), 0.0, 1.0), 5.0);
  let spec = pow(max(dot(n, h), 0.0), mix(128.0, 16.0, mat.roughness)) * mat.gloss;
  var accum = vec3f(0.0);
  for (var i = 0; i < 8; i++) {
    let angle = f32(i) * 2.3999632 + (in.uv.x * 17.0 + in.uv.y * 31.0);
    let offset = vec2f(cos(angle), sin(angle)) * (0.0025 * f32(i + 1) * (0.2 + mat.roughness));
    let refractUv = clamp(in.uv + offset * (1.0 / max(mat.ior, 1.0)) + vec2f(mat.dispersion * 0.001), vec2f(0.0), vec2f(1.0));
    let tap = textureSampleLevel(tex, samp, refractUv, 0.0);
    accum += tap.rgb * (1.0 / 8.0);
  }
  let beer = exp(-mat.thickness * 0.015 * (vec3f(1.0) - mat.tint));
  let lit = (linBase * max(dot(n, l), 0.15) + accum * beer * 0.45) + vec3f(spec + fresnel * 0.35);
  let srgb = pow(max(lit, vec3f(0.0)), vec3f(1.0 / 2.2));
  let mask = roundedMask(in.uv, frame.size, frame.radii);
  return vec4f(clamp(srgb, vec3f(0.0), vec3f(1.0)) * base.a * mask, base.a * mask);
}
`
}

export function maxChannelDelta(a: RgbaSample, b: RgbaSample): number {
  return Math.max(
    Math.abs(a.r - b.r),
    Math.abs(a.g - b.g),
    Math.abs(a.b - b.b),
    Math.abs(a.a - b.a),
  )
}

export function premultiplySample(s: RgbaSample): RgbaSample {
  const k = s.a / 255
  return { r: Math.round(s.r * k), g: Math.round(s.g * k), b: Math.round(s.b * k), a: s.a }
}

export function rgbDeltaMax(a: RgbaSample, b: RgbaSample): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
}

export function waitNextPaint(source: DomTextureSource): Promise<void> {
  const before = source.paintCount()
  if (source.painted() && before > 0) return Promise.resolve()
  return new Promise((resolve) => {
    const off = source.subscribePaint(() => {
      if (source.paintCount() > before || source.painted()) {
        off()
        resolve()
      }
    })
    source.repaint({ immediate: true })
  })
}

export function repaintAndWait(source: DomTextureSource): Promise<void> {
  const before = source.paintCount()
  return new Promise((resolve) => {
    const off = source.subscribePaint(() => {
      if (source.paintCount() > before) {
        off()
        resolve()
      }
    })
    source.repaint({ immediate: true })
  })
}

export function buildDualSwatchElement(width: number, height: number): HTMLDivElement {
  const root = document.createElement('div')
  root.style.cssText = `width:${width}px;height:${height}px;display:flex;flex-direction:column;background:transparent;`
  const top = document.createElement('div')
  top.style.cssText = 'flex:1;background:rgb(200, 80, 40);'
  const mid = document.createElement('div')
  mid.style.cssText = 'flex:1;background:rgba(200, 80, 40, 0.5);'
  const bot = document.createElement('div')
  bot.style.cssText = 'flex:1;background:transparent;color:#fff;font:700 18px/1 sans-serif;display:flex;align-items:center;padding-left:8px;'
  bot.textContent = 'Munari DualView'
  root.append(top, mid, bot)
  return root
}

export async function renderToReadback(
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  sampler: GPUSampler,
  view: GPUTextureView,
  width: number,
  height: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const target = device.createTexture({
    size: [width, height],
    format: 'rgba8unorm',
    usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.COPY_SRC,
  })
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: view },
    ],
  })
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256
  const staging = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ,
  })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: target.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.draw(6)
  pass.end()
  encoder.copyTextureToBuffer({ texture: target }, { buffer: staging, bytesPerRow }, [width, height])
  device.queue.submit([encoder.finish()])
  await staging.mapAsync(GPU_MAP_READ)
  const mapped = new Uint8Array(staging.getMappedRange())
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const srcOff = y * bytesPerRow
    out.set(mapped.subarray(srcOff, srcOff + width * 4), y * width * 4)
  }
  staging.unmap()
  staging.destroy()
  target.destroy()
  return out
}

export function sampleBuffer(buf: Uint8Array<ArrayBuffer>, width: number, x: number, y: number): RgbaSample {
  const i = (y * width + x) * 4
  return { r: buf[i] ?? 0, g: buf[i + 1] ?? 0, b: buf[i + 2] ?? 0, a: buf[i + 3] ?? 0 }
}

export function sampleCanvas2D(canvas: HTMLCanvasElement, x: number, y: number): RgbaSample {
  const ctx = canvas.getContext('2d')
  if (!ctx) return { r: 0, g: 0, b: 0, a: 0 }
  const data = ctx.getImageData(x, y, 1, 1).data
  return { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0, a: data[3] ?? 0 }
}

export async function createPipeline(device: GPUDevice, wgsl: string, format: GPUTextureFormat): Promise<GPURenderPipeline> {
  const module = device.createShaderModule({ code: wgsl })
  return device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module, entryPoint: 'vsMain' },
    fragment: { module, entryPoint: 'fsMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
}

export function allocateDualTexture(device: GPUDevice, canvas: HTMLCanvasElement): GPUTexture {
  const tex = device.createTexture({
    size: [canvas.width, canvas.height],
    format: 'rgba8unorm-srgb',
    viewFormats: ['rgba8unorm'],
    usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST | GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
  })
  device.queue.copyExternalImageToTexture(
    { source: canvas },
    { texture: tex, premultipliedAlpha: true },
    [canvas.width, canvas.height],
  )
  return tex
}

export function buildSaltedShaders(salt: number): readonly string[] {
  const prefix = `const PROBE_SALT: u32 = ${salt}u;\n`
  return [
    prefix + UNLIT_SRGB_WGSL,
    prefix + LIT_RAW_UNPREMULT_WGSL,
    prefix + SWAPCHAIN_RAW_WGSL,
    prefix + MIPMAP_WGSL,
  ]
}

export async function generateMipmaps(
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  sampler: GPUSampler,
  texture: GPUTexture,
  format: GPUTextureFormat,
  mipCount: number,
): Promise<void> {
  const encoder = device.createCommandEncoder()
  for (let level = 1; level < mipCount; level++) {
    const srcView = texture.createView({ format, baseMipLevel: level - 1, mipLevelCount: 1 })
    const dstView = texture.createView({ format, baseMipLevel: level, mipLevelCount: 1 })
    const bg = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: srcView },
      ],
    })
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: dstView, loadOp: 'clear', storeOp: 'store' }],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bg)
    pass.draw(3)
    pass.end()
  }
  device.queue.submit([encoder.finish()])
}
