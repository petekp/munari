// Pure WebGPU SurfaceFinish renderer — shades physical finishes with key, rim,
// environment reflection, relief detail, crackle, and optional @group(2) glass
// transmission using zero Three.js runtime code.
//
// The law: finish values pack directly into uniforms (`@group(1)`) so editing
// roughness/color/layer amounts triggers zero pipeline rebuilds (`decisions.md #79`).
// Glass finishes enable `needsBackdrop` and decode premultiplied sRGB backdrop
// samples before Beer–Lambert absorption and 8-tap frosted dispersion (`#80`).
// Non-finish apps never load this module (dynamic import from `Surface.tsx`).
//
// Ownership: `surfaceFinish.ts` owns defaults/types; `surfaceLight.ts` owns
// studio key handles; this module compiles static WGSL and packs finish uniforms.

import {
  KEY_HEIGHT_PX,
  KEY_REST_Y,
  isSurfaceLight,
  type SurfaceLighting,
} from '../primitives/surface/surfaceLight'
import {
  resolveFinish,
  type SurfaceDetailKind,
  type SurfaceFinish,
} from '../primitives/surface/surfaceFinish'
import {
  FRAME_UNIFORM_BYTES,
  SURFACE_WGSL_COMMON,
  type GpuMaterial,
  type GpuRenderer,
} from './webgpu'
import type { Mat4 } from './math'

const GPU_BUFFER_USAGE = {
  UNIFORM: 0x0040,
  COPY_DST: 0x0008,
} as const

const GPU_COLOR_WRITE_ALL = 0xf
const FINISH_UNIFORM_BYTES = 256

const DETAIL_ID = {
  'orange-peel': 1,
  brushed: 2,
  pile: 3,
  glaze: 4,
  crumple: 5,
  fiber: 6,
  dots: 7,
  honeycomb: 8,
} as const satisfies Record<SurfaceDetailKind, number>

const FINISH_WGSL =
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

struct FinishUniforms {
  bodyColor: vec4f,      // xyz linear, w = hasBodyColor (1.0 vs 0.0)
  rimColor: vec4f,       // xyz linear, w = hasRimColor (1.0 vs 0.0)
  sheenColor: vec4f,     // xyz linear, w = sheenAmount
  pbr: vec4f,            // roughness, metalness, ior, specularIntensity
  coat: vec4f,           // amount, roughness, edgeWidth, textLit (1/0)
  anisoFilm: vec4f,      // anisoAmt, anisoRot, filmAmt, filmIor
  filmParams: vec4f,     // thickness, variation, scale, scatterAmt
  detail: vec4f,         // kind (0..8), scale, depth, crackleAmt
  crackleLight: vec4f,   // crackleScale, emissive, envGradient (1/0), lightGain
  keyPos: vec4f,         // world xyz, keyBrightness
  rimDir: vec4f,         // world dir xyz, rimBrightness
  trans: vec4f,          // transAmt, thickness, dispersion, envIntensity
  keySize: vec4f,        // width, height, cameraZ, _pad
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(1) @binding(0) var<uniform> u: FinishUniforms;
@group(2) @binding(0) var bgSamp: sampler;
@group(2) @binding(1) var bgTex: texture_2d<f32>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) worldPos: vec3f,
  @location(2) worldNormal: vec3f,
};

@vertex
fn vsMain(@location(0) position: vec3f, @location(1) uv: vec2f) -> VsOut {
  var out: VsOut;
  let wp = frame.modelWorld * vec4f(position, 1.0);
  out.pos = frame.mvp * vec4f(position, 1.0);
  out.uv = uv;
  out.worldPos = wp.xyz;
  out.worldNormal = normalize((frame.modelWorld * vec4f(0.0, 0.0, 1.0, 0.0)).xyz);
  return out;
}

fn hash21(p: vec2f) -> f32 {
  let q = fract(p * vec2f(123.34, 456.21));
  return fract(dot(q, q + 45.32));
}

fn valueNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u2 = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), u2.x),
    mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u2.x),
    u2.y,
  );
}

fn detailHeight(px: vec2f, kind: i32, scale: f32) -> f32 {
  if (kind <= 0) {
    return 0.0;
  }
  let q = px / max(scale, 1.0);
  if (kind == 1 || kind == 4) {
    return valueNoise(q * 3.1) * 0.7 + valueNoise(q * 6.3) * 0.3;
  }
  if (kind == 2) {
    return valueNoise(vec2f(q.x * 0.45, q.y * 12.0));
  }
  if (kind == 5) {
    let cell = floor(q);
    return hash21(cell);
  }
  return valueNoise(q * 4.0);
}

fn sampleBgLin(screenUv: vec2f) -> vec4f {
  let pm = textureSampleLevel(bgTex, bgSamp, clamp(screenUv, vec2f(0.0), vec2f(1.0)), 0.0);
  let straight = select(vec3f(0.0), pm.rgb / max(pm.a, 1e-4), pm.a > 0.002);
  return vec4f(srgbEotf(straight), pm.a);
}

fn thinFilmTint(nm: f32, ndotv: f32) -> vec3f {
  let phase = nm * (0.012 + 0.006 * (1.0 - ndotv));
  return vec3f(0.5) + 0.5 * cos(phase + vec3f(0.0, 2.094, 4.188));
}

@fragment
fn fsMain(in: VsOut) -> @location(0) vec4f {
  let cap = sampleSurface(tex, samp, in.uv);
  let straightCap = select(vec3f(0.0), cap.rgb / max(cap.a, 1e-4), cap.a > 0.002);
  let linCap = srgbEotf(straightCap);

  let point = (in.uv - 0.5) * frame.size;
  let edgeWidth = max(u.coat.z, 0.0);
  let halfSize = frame.size * 0.5;
  let leftR = select(frame.radii.w, frame.radii.x, point.y > 0.0);
  let rightR = select(frame.radii.z, frame.radii.y, point.y > 0.0);
  let rad = select(rightR, leftR, point.x < 0.0);
  let dBox = abs(point) - halfSize + vec2f(rad);
  let dist = min(max(dBox.x, dBox.y), 0.0) + length(max(dBox, vec2f(0.0))) - rad;
  let aaEdge = max(fwidth(dist), 1e-4);
  let mask = 1.0 - smoothstep(-aaEdge, aaEdge, dist);
  if (mask < 0.004) {
    discard;
  }

  let bevelT = select(0.0, smoothstep(-edgeWidth, 0.0, dist), edgeWidth > 0.1);
  let gradX = dpdx(dist);
  let gradY = dpdy(dist);
  let bevelDir = normalize(vec2f(gradX, -gradY) + vec2f(1e-5, 0.0));
  let kind = i32(u.detail.x + 0.5);
  let dhdx = (detailHeight(point + vec2f(0.8, 0.0), kind, u.detail.y) - detailHeight(point - vec2f(0.8, 0.0), kind, u.detail.y)) * u.detail.z * 28.0;
  let dhdy = (detailHeight(point + vec2f(0.0, 0.8), kind, u.detail.y) - detailHeight(point - vec2f(0.0, 0.8), kind, u.detail.y)) * u.detail.z * 28.0;

  let nLocal = normalize(vec3f(bevelDir * bevelT * 0.55 - vec2f(dhdx, dhdy), 1.0));
  let n = normalize((frame.modelWorld * vec4f(nLocal, 0.0)).xyz);
  let viewPos = vec3f(0.0, 0.0, u.keySize.z);
  let v = normalize(viewPos - in.worldPos);
  let ndotv = max(dot(n, v), 1e-3);

  let toKey = u.keyPos.xyz - in.worldPos;
  let keyDist = length(toKey);
  let lKey = normalize(toKey);
  let softRadius = (u.keySize.x + u.keySize.y) * 0.25;
  let roughness = clamp(u.pbr.x + select(0.0, 0.08, softRadius > 1.0), 0.04, 1.0);
  let metalness = clamp(u.pbr.y, 0.0, 1.0);
  let ior = max(u.pbr.z, 1.0);

  let hasBody = u.bodyColor.w > 0.5;
  var baseCol = select(linCap, u.bodyColor.rgb, hasBody);
  if (hasBody && u.rimColor.w > 0.5) {
    baseCol = mix(baseCol, u.rimColor.rgb, bevelT);
  }
  if (hasBody && u.coat.w > 0.5) {
    baseCol = mix(baseCol, linCap, cap.a);
  }
  if (u.detail.w > 0.001) {
    let cellNoise = abs(valueNoise(point / max(u.crackleLight.x, 4.0) * 6.0) - 0.5);
    let crack = 1.0 - smoothstep(0.02, 0.08, cellNoise);
    baseCol = baseCol * (1.0 - crack * u.detail.w * 0.65);
  }

  let lDiff = max(dot(n, lKey), 0.0);
  let hKey = normalize(lKey + v);
  let ndoth = max(dot(n, hKey), 0.0);
  let specPow = mix(192.0, 8.0, roughness * roughness);
  let f0Scalar = pow((ior - 1.0) / (ior + 1.0), 2.0) * u.pbr.w;
  let f0 = mix(vec3f(f0Scalar), baseCol, metalness);
  let fresnel = f0 + (vec3f(1.0) - f0) * pow(1.0 - ndotv, 5.0);
  let anisoStretch = 1.0 + u.anisoFilm.x * abs(sin((in.uv.x - 0.5) * 3.14159 + u.anisoFilm.y));
  let spec = pow(ndoth, specPow / anisoStretch) * (0.28 + 0.72 * fresnel) * u.keyPos.w * u.crackleLight.w;

  let lRim = normalize(u.rimDir.xyz);
  let rimNdotl = max(dot(n, lRim), 0.0);
  let rimSpec = pow(max(dot(n, normalize(lRim + v)), 0.0), specPow * 0.6) * u.rimDir.w * u.crackleLight.w;

  let envTone = mix(0.28, 0.42 + 0.25 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0), u.crackleLight.z) * u.trans.w;
  let diffWeight = (1.0 - metalness) * (1.0 - u.trans.x * 0.85);
  let scatter = u.filmParams.w * (1.0 - lDiff) * 0.22 * u.keyPos.w;
  let atten = 1.0 / (1.0 + 0.0000004 * keyDist * keyDist);
  let directDiff = baseCol * diffWeight * (lDiff * u.keyPos.w * atten + rimNdotl * 0.25 * u.rimDir.w + scatter) * u.crackleLight.w;

  let coatRough = max(u.coat.y, 0.03);
  let coatSpec = pow(ndoth, mix(256.0, 18.0, coatRough * coatRough)) * (0.04 + 0.96 * pow(1.0 - ndotv, 5.0)) * u.coat.x * u.keyPos.w * u.crackleLight.w;
  let sheenTerm = u.sheenColor.rgb * pow(1.0 - ndotv, 4.0) * u.sheenColor.w * u.keyPos.w * u.crackleLight.w;
  let filmTerm = thinFilmTint(u.filmParams.x * (1.0 - 0.4 * u.filmParams.y), ndotv) * fresnel * u.anisoFilm.z * 0.45;

  var litRgb = baseCol * diffWeight * envTone + directDiff + spec + vec3f(rimSpec + coatSpec) + sheenTerm + filmTerm + baseCol * u.crackleLight.y;

  var finalAlpha = mask;
  if (!hasBody) {
    finalAlpha = cap.a * mask;
  } else if (u.coat.w < 0.5) {
    litRgb = mix(litRgb, linCap, cap.a);
    finalAlpha = mask;
  }

  if (u.trans.x > 0.001) {
    let dims = vec2f(textureDimensions(bgTex));
    let screenUv = in.pos.xy / max(dims, vec2f(1.0));
    let refractOffset = nLocal.xy * (0.015 + u.trans.y * 0.0006);
    var glassBg = vec3f(0.0);
    var glassBgA = 0.0;
    if (roughness < 0.08 && u.trans.z < 0.001) {
      let s = sampleBgLin(screenUv - refractOffset);
      glassBg = s.rgb;
      glassBgA = s.a;
    } else {
      for (var i = 0; i < 8; i++) {
        let ang = f32(i) * 2.3999632 + (in.pos.x * 0.37 + in.pos.y * 0.71);
        let radTap = (0.0015 + roughness * 0.008) * (f32(i + 1) / 8.0);
        let disp = (f32(i) - 3.5) * u.trans.z * 0.0004;
        let uvTap = screenUv - refractOffset + vec2f(cos(ang), sin(ang)) * radTap + vec2f(disp, 0.0);
        let s = sampleBgLin(uvTap);
        glassBg += s.rgb * (1.0 / 8.0);
        glassBgA += s.a * (1.0 / 8.0);
      }
    }
    let absorb = exp(-max(u.trans.y, 0.0) * 0.025 * (vec3f(1.0) - u.bodyColor.rgb));
    let transRgb = glassBg * absorb;
    litRgb = mix(litRgb, transRgb + spec + vec3f(coatSpec + rimSpec) + filmTerm, u.trans.x);
    finalAlpha = mix(finalAlpha, max(cap.a, glassBgA) * mask, u.trans.x);
  }

  let encoded = srgbOetf(clamp(litRgb, vec3f(0.0), vec3f(1.0)));
  let outCol = vec4f(encoded * finalAlpha, finalAlpha);
  if (outCol.a < 0.004) {
    discard;
  }
  return outCol;
}
`

function hexToLinearRgb(hex: string | null): readonly [number, number, number] {
  if (!hex) return [1, 1, 1]
  const clean = hex.startsWith('#') ? hex.slice(1) : hex
  const num = Number.parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16)
  if (!Number.isFinite(num)) return [1, 1, 1]
  const eotf = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return [eotf(((num >> 16) & 255) / 255), eotf(((num >> 8) & 255) / 255), eotf((num & 255) / 255)]
}

function resolveLightingRig(lighting: SurfaceLighting, vw: number, vh: number) {
  let keyX = vw / 2
  let keyY = vh * KEY_REST_Y
  let keyZ = KEY_HEIGHT_PX
  let keyBrightness = lighting === 'none' ? 0 : 1
  let keyW = 0
  let keyH = 0
  let rimBrightness = lighting === 'none' ? 0 : 1
  let rimElev = 15
  let envIntensity = lighting === 'none' ? 0 : 1

  if (lighting !== 'studio' && lighting !== 'none') {
    const k = lighting.key
    if (k) {
      const pos = isSurfaceLight(k) ? k.get() : k
      keyX = pos.x ?? vw / 2
      keyY = pos.y ?? vh * KEY_REST_Y
      keyZ = pos.z ?? KEY_HEIGHT_PX
      keyBrightness = pos.brightness ?? 1
      if (pos.size) {
        keyW = pos.size[0]
        keyH = pos.size[1]
      }
    }
    if (lighting.rim === false) rimBrightness = 0
    else if (lighting.rim) {
      rimBrightness = lighting.rim.brightness ?? 1
      rimElev = lighting.rim.elevation ?? 15
    }
    envIntensity = lighting.environmentIntensity ?? 1
  }

  return {
    wx: keyX - vw / 2,
    wy: vh / 2 - keyY,
    keyZ,
    keyBrightness,
    keyW,
    keyH,
    rimBrightness,
    rimElev,
    envIntensity,
  }
}

export interface GpuFinishHandle extends GpuMaterial {
  readonly updateFinish: (
    finish: SurfaceFinish,
    lighting: SurfaceLighting,
    viewportW: number,
    viewportH: number,
    cameraZ: number,
  ) => void
}

type ResolvedFinish = ReturnType<typeof resolveFinish>
type ResolvedRig = ReturnType<typeof resolveLightingRig>

function writeColorUniforms(resolved: ResolvedFinish, staging: Float32Array): void {
  const body = hexToLinearRgb(resolved.color)
  const rim = hexToLinearRgb(resolved.edge.rimColor)
  const sheen = resolved.sheen
  const sheenColor = hexToLinearRgb(sheen ? sheen.color : '#ffffff')
  staging.set(
    [
      body[0], body[1], body[2], resolved.color !== null ? 1 : 0,
      rim[0], rim[1], rim[2], resolved.edge.rimColor !== null ? 1 : 0,
      sheenColor[0], sheenColor[1], sheenColor[2], sheen ? sheen.amount : 0,
    ],
    0,
  )
}

function writeMaterialUniforms(resolved: ResolvedFinish, staging: Float32Array): void {
  const { coat, anisotropy, film, scatter, detail, crackle } = resolved
  staging.set(
    [
      resolved.roughness, resolved.metalness, resolved.ior, resolved.specularIntensity,
      coat ? coat.amount : 0, coat ? coat.roughness : 0.1, resolved.edge.width, resolved.text === 'lit' ? 1 : 0,
      anisotropy ? anisotropy.amount : 0, anisotropy ? anisotropy.rotation : 0, film ? film.amount : 0, film ? film.ior : 1.4,
      film ? film.thickness : 380, film ? film.variation : 0.3, film ? film.scale : 120, scatter ? scatter.amount : 0,
      detail ? DETAIL_ID[detail.kind] : 0, detail ? detail.scale : 24, detail ? detail.depth : 0.01, crackle ? crackle.amount : 0,
      crackle ? crackle.scale : 40, resolved.emissiveIntensity, resolved.environment === 'gradient' ? 1 : 0, resolved.lightGain,
    ],
    12,
  )
}

function writeRigUniforms(resolved: ResolvedFinish, rig: ResolvedRig, camZ: number, staging: Float32Array): void {
  const rimRad = (rig.rimElev * Math.PI) / 180
  const transmission = resolved.transmission
  staging.set(
    [
      rig.wx, rig.wy, rig.keyZ, rig.keyBrightness,
      -0.35, Math.sin(rimRad) + 0.55, Math.cos(rimRad), rig.rimBrightness,
      transmission ? transmission.amount : 0, transmission ? transmission.thickness : 0, transmission ? transmission.dispersion : 0, rig.envIntensity,
      rig.keyW, rig.keyH, camZ, 0,
    ],
    36,
  )
}

export function createGpuFinishMaterial(renderer: GpuRenderer, initialFinish: SurfaceFinish): GpuFinishHandle {
  const { device, format } = renderer
  let resolved = resolveFinish(initialFinish)

  const uniformBuf = device.createBuffer({
    size: FINISH_UNIFORM_BYTES,
    usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
  })
  const staging = new Float32Array(FINISH_UNIFORM_BYTES / 4)
  const prevStaging = new Float32Array(FINISH_UNIFORM_BYTES / 4)
  let uniformsUploaded = false
  const customBg = device.createBindGroup({
    layout: renderer.customBindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
  })

  const cullMode: GPUCullMode = resolved.side === 'double' ? 'none' : 'back'
  const vertexBuffers: GPUVertexBufferLayout[] = [
    { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
    { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
  ]

  let colorPipe: GPURenderPipeline | null = null
  let warmPipe: GPURenderPipeline | null = null
  let built = false
  let disposed = false
  let cachedView: GPUTextureView | null = null
  let cachedSampler: GPUSampler | null = null
  let cachedFrameBuffer: GPUBuffer | null = null
  let cachedBg: GPUBindGroup | null = null

  const packUniforms = (finish: SurfaceFinish, lighting: SurfaceLighting, vw: number, vh: number, camZ: number) => {
    resolved = resolveFinish(finish)
    const rig = resolveLightingRig(lighting, vw, vh)
    writeColorUniforms(resolved, staging)
    writeMaterialUniforms(resolved, staging)
    writeRigUniforms(resolved, rig, camZ, staging)
    let dirty = !uniformsUploaded
    for (let i = 0; i < staging.length; i++) {
      if (staging[i] !== prevStaging[i]) {
        dirty = true
        prevStaging[i] = staging[i]!
      }
    }
    if (!dirty) return
    uniformsUploaded = true
    device.queue.writeBuffer(uniformBuf, 0, staging)
  }

  packUniforms(initialFinish, 'studio', 1200, 860, 1000)

  const ready = renderer
    .getOrCreatePipelines(`munari-finish|${cullMode}|${format}`, async () => {
      const module = device.createShaderModule({ label: 'munari-finish-shader', code: FINISH_WGSL })
      const pipelineLayout = device.createPipelineLayout({
        label: 'munari-finish-layout',
        bindGroupLayouts: [renderer.surfaceBindGroupLayout, renderer.customBindGroupLayout, renderer.backdropBindGroupLayout],
      })
      const buildPipe = (colorWrite: boolean) =>
        device.createRenderPipelineAsync({
          label: colorWrite ? 'munari-finish-color' : 'munari-finish-warm',
          layout: pipelineLayout,
          vertex: { module, entryPoint: 'vsMain', buffers: vertexBuffers },
          fragment: {
            module,
            entryPoint: 'fsMain',
            targets: [
              {
                format,
                writeMask: colorWrite ? GPU_COLOR_WRITE_ALL : 0,
                blend: {
                  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                },
              },
            ],
          },
          primitive: { topology: 'triangle-list', cullMode },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
        })
      const [color, warm] = await Promise.all([buildPipe(true), buildPipe(false)])
      return { color, warm }
    })
    .then((pipes) => {
      if (disposed) return
      colorPipe = pipes.color
      warmPipe = pipes.warm
      built = true
    })

  return {
    ready,
    isReady: () => built,
    usesDynamicFrameOffset: true,
    get needsBackdrop() {
      return Boolean(resolved.transmission && resolved.transmission.amount > 0)
    },
    writeCustomUniforms() {},
    updateFrameUniforms(_m: Mat4, _w: Mat4) {},
    updateFinish: packUniforms,
    ensureBindGroup(view, sampler) {
      if (!colorPipe) return null
      const fb = renderer.frameUniformBuffer
      if (cachedBg && cachedView === view && cachedSampler === sampler && cachedFrameBuffer === fb) {
        return cachedBg
      }
      cachedView = view
      cachedSampler = sampler
      cachedFrameBuffer = fb
      cachedBg = device.createBindGroup({
        layout: renderer.surfaceBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: fb, offset: 0, size: FRAME_UNIFORM_BYTES } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: view },
        ],
      })
      return cachedBg
    },
    extraBindGroups: () =>
      resolved.transmission && resolved.transmission.amount > 0
        ? [customBg]
        : [customBg, renderer.dummyBackdropBindGroup],
    pipelineFor: (colorWrite) => (colorWrite ? colorPipe : warmPipe),
    dispose() {
      disposed = true
      uniformBuf.destroy()
      cachedBg = null
    },
  }
}
