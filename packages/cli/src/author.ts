// TypeGPU authoring helpers for *.material.ts files compiled AOT by `munari compile`.
//
// Standard surface contract:
// - Vertex inputs: `@location(0)` position (`d.vec3f`), `@location(1)` uv (`d.vec2f`).
//   Extra per-vertex attributes declared with `@location(2+)` in `vertex` (e.g.
//   `aSlope: d.location(2, d.f32)`) are automatically inferred by `munari compile`
//   and exposed at runtime via `onFrame({ setExtraAttribute(slot, data) })` where `slot`
//   is `location - 2`.
// - `@group(0)` (`surfaceLayout`): `{ frame: SurfaceFrameUniforms, samp, tex }`.
//   `SurfaceFrameUniforms` (`256 B`) exposes `mvp`, `modelWorld`, `size`, `viewport`,
//   `radii`, `camera` (`[cameraZ, dpr, timeSec, dtSec]`), `keyPos`, `keySize`, `rimDir`.
// - `@group(1)` (`createMaterialUniformLayout(schema)` or `createLtcMaterialLayout(schema)`):
//   optional custom uniforms + static LUT textures (`ltc1`, `ltc2`).
// - `@group(2)` (`backdropLayout`): bound when `needsBackdrop: true` for transmissive passes.
// - `defineGpuMaterial`: linear-color builder — author `shade` takes/returns straight linear
//   RGB + alpha while Munari owns `sampleSurfaceLinear`, `surfaceRadiusMask`, `srgbOetf`,
//   premultiplication, and discard.

import tgpu, {
  type TgpuBindGroupLayout,
  type TgpuFn,
  type TgpuFragmentFn,
  type TgpuVertexFn,
} from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'

export {
  ltcClippedSphereFormFactor,
  ltcEdgeVectorFormFactor,
  ltcEvaluate,
  ltcMatrixFromSample,
  ltcUv,
} from './ltcAuthor'

export const SurfaceFrameUniforms = d.struct({
  mvp: d.mat4x4f,
  modelWorld: d.mat4x4f,
  size: d.vec2f,
  viewport: d.vec2f,
  radii: d.vec4f,
  camera: d.vec4f,
  keyPos: d.vec4f,
  keySize: d.vec4f,
  rimDir: d.vec4f,
  uvRect: d.vec4f,
  _r1: d.vec4f,
})

/** Group 0 bindings supplied by `@petepetrash/munari/gpu` for every surface draw. */
export const surfaceLayout = tgpu
  .bindGroupLayout({
    frame: { uniform: SurfaceFrameUniforms },
    samp: { sampler: 'filtering' },
    tex: { texture: d.texture2d(d.f32) },
  })
  .$idx(0)

/** Group 2 backdrop snapshot bindings active when `needsBackdrop: true`. */
export const backdropLayout = tgpu
  .bindGroupLayout({
    samp: { sampler: 'filtering' },
    tex: { texture: d.texture2d(d.f32) },
  })
  .$idx(2)

export const srgbOetf = tgpu.fn([d.vec3f], d.vec3f)((c) => {
  'use gpu'
  const lo = c.mul(12.92)
  const hi = std.pow(std.max(c, d.vec3f(0.0)), d.vec3f(1.0 / 2.4)).mul(1.055).sub(0.055)
  return std.select(hi, lo, std.le(c, d.vec3f(0.0031308)))
})

export const srgbEotf = tgpu.fn([d.vec3f], d.vec3f)((c) => {
  'use gpu'
  const lo = c.div(12.92)
  const hi = std.pow(std.max(c, d.vec3f(0.0)).add(0.055).div(1.055), d.vec3f(2.4))
  return std.select(hi, lo, std.le(c, d.vec3f(0.04045)))
})

/** Sample the DOM capture texture at surface UV `(0..1, 0..1)` with WebGPU Y-flip. */
export const sampleSurface = tgpu.fn([d.vec2f], d.vec4f)((uv) => {
  'use gpu'
  const c = std.textureSample(surfaceLayout.$.tex, surfaceLayout.$.samp, d.vec2f(uv.x, 1.0 - uv.y))
  const inside = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0
  return std.select(d.vec4f(0.0), c, inside)
})

/** Sample the DOM texture and decode premultiplied sRGB into straight linear RGB + alpha. */
export const sampleSurfaceLinear = tgpu.fn([d.vec2f], d.vec4f)((uv) => {
  'use gpu'
  const pm = sampleSurface(uv)
  const straight = std.select(d.vec3f(0.0), pm.rgb.div(std.max(pm.a, 1e-4)), pm.a > 0.002)
  return d.vec4f(srgbEotf(straight), pm.a)
})

/** Sample the `@group(2)` canvas backdrop snapshot at screen UV `(0..1, 0..1)` and explicit mip `lod`. */
export const sampleBackdropLod = tgpu.fn([d.vec2f, d.f32], d.vec4f)((screenUv, lod) => {
  'use gpu'
  return std.textureSampleLevel(
    backdropLayout.$.tex,
    backdropLayout.$.samp,
    std.clamp(screenUv, d.vec2f(0.0), d.vec2f(1.0)),
    lod,
  )
})

/** Sample `@group(2)` backdrop at explicit mip `lod` and decode premultiplied sRGB to linear RGB + alpha. */
export const sampleBackdropLinearLod = tgpu.fn([d.vec2f, d.f32], d.vec4f)((screenUv, lod) => {
  'use gpu'
  const pm = sampleBackdropLod(screenUv, lod)
  const straight = std.select(d.vec3f(0.0), pm.rgb.div(std.max(pm.a, 1e-4)), pm.a > 0.002)
  return d.vec4f(srgbEotf(straight), pm.a)
})

/** Sample the `@group(2)` canvas backdrop snapshot at screen UV `(0..1, 0..1)`. */
export const sampleBackdrop = tgpu.fn([d.vec2f], d.vec4f)((screenUv) => {
  'use gpu'
  return sampleBackdropLod(screenUv, 0.0)
})

/** Sample `@group(2)` canvas backdrop and decode premultiplied sRGB into straight linear RGB + alpha. */
export const sampleBackdropLinear = tgpu.fn([d.vec2f], d.vec4f)((screenUv) => {
  'use gpu'
  return sampleBackdropLinearLod(screenUv, 0.0)
})

/** Signed-distance rounded-corner mask over logical surface `size` and CSS corner `radii`. */
export const surfaceRadiusMask = tgpu.fn([d.vec2f, d.vec2f, d.vec4f], d.f32)((uv, size, radii) => {
  'use gpu'
  const point = uv.sub(0.5).mul(size)
  const left = std.select(radii.w, radii.x, point.y > 0.0)
  const right = std.select(radii.z, radii.y, point.y > 0.0)
  const radius = std.select(right, left, point.x < 0.0)
  const dBox = std.abs(point).sub(size.mul(0.5)).add(d.vec2f(radius))
  const dist = std.min(std.max(dBox.x, dBox.y), 0.0) + std.length(std.max(dBox, d.vec2f(0.0))) - radius
  const edge = std.max(std.fwidth(dist), 1e-4)
  return 1.0 - std.smoothstep(-edge, edge, dist)
})

/** Rounded-corner mask, linear-to-sRGB OETF, premultiply, and alpha discard. */
export const encodeSurfaceOutput = tgpu.fn([d.vec3f, d.f32, d.vec2f], d.vec4f)((linearRgb, alpha, uv) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const mask = surfaceRadiusMask(uv, frame.size, frame.radii)
  const finalAlpha = alpha * mask
  if (finalAlpha < 0.004) std.discard()
  const encoded = srgbOetf(std.clamp(linearRgb, d.vec3f(0.0), d.vec3f(1.0)))
  return d.vec4f(encoded.mul(finalAlpha), finalAlpha)
})

export const SurfaceVertexIn = d.struct({
  position: d.vec3f,
  uv: d.vec2f,
})

export const SurfaceVertexOut = d.struct({
  position: d.vec3f,
  localNormal: d.vec3f,
})

export const SurfaceFragmentIn = d.struct({
  uv: d.vec2f,
  worldPos: d.vec3f,
  worldNormal: d.vec3f,
  localNormal: d.vec3f,
  screenPos: d.vec4f,
  color: d.vec3f,
  alpha: d.f32,
})

export type SurfaceDisplaceFn = TgpuFn<(input: typeof SurfaceVertexIn) => typeof SurfaceVertexOut>
export type SurfaceShadeFn = TgpuFn<(ctx: typeof SurfaceFragmentIn) => d.Vec4f>

/** Compose multiple straight-linear `SurfaceShadeFn` hooks cleanly left-to-right. */
export function composeShades(...shades: readonly SurfaceShadeFn[]): SurfaceShadeFn {
  if (shades.length === 0) throw new Error('composeShades requires at least one shade function')
  let acc = shades[0]!
  for (let i = 1; i < shades.length; i++) {
    const first = acc
    const second = shades[i]!
    acc = tgpu.fn([SurfaceFragmentIn], d.vec4f)((ctx) => {
      'use gpu'
      const out1 = first(ctx)
      return second(
        SurfaceFragmentIn({
          uv: ctx.uv,
          worldPos: ctx.worldPos,
          worldNormal: ctx.worldNormal,
          localNormal: ctx.localNormal,
          screenPos: ctx.screenPos,
          color: out1.rgb,
          alpha: out1.a,
        }),
      )
    })
  }
  return acc
}

export interface SurfaceStaticTextureSpec {
  readonly name: string
  readonly cacheKey: string
  readonly loader: 'ltc-1' | 'ltc-2'
  readonly textureBinding: number
  readonly samplerBinding?: number
  readonly filter?: 'linear' | 'nearest'
  readonly addressMode?: GPUAddressMode
}

export const LTC_STATIC_TEXTURES: readonly SurfaceStaticTextureSpec[] = [
  {
    name: 'ltc1',
    cacheKey: 'munari:ltc-1',
    loader: 'ltc-1',
    samplerBinding: 1,
    textureBinding: 2,
    filter: 'linear',
    addressMode: 'clamp-to-edge',
  },
  {
    name: 'ltc2',
    cacheKey: 'munari:ltc-2',
    loader: 'ltc-2',
    textureBinding: 3,
    filter: 'linear',
    addressMode: 'clamp-to-edge',
  },
]

export type SurfaceUniformLayout<TSchema extends d.AnyWgslStruct> = TgpuBindGroupLayout<{
  readonly u: { readonly uniform: TSchema }
}>

export type LtcMaterialLayout<TSchema extends d.AnyWgslStruct> = TgpuBindGroupLayout<{
  readonly u: { readonly uniform: TSchema }
  readonly ltcSamp: { readonly sampler: 'filtering' }
  readonly ltc1: { readonly texture: d.WgslTexture2d<d.F32> }
  readonly ltc2: { readonly texture: d.WgslTexture2d<d.F32> }
}>

/** Create a `@group(1)` custom uniform bind group layout for `schema`. */
export function createMaterialUniformLayout<TSchema extends d.AnyWgslStruct>(
  schema: TSchema,
): SurfaceUniformLayout<TSchema> {
  return tgpu.bindGroupLayout({ u: { uniform: schema } }).$idx(1)
}

/** Create `@group(1)` bindings for custom uniforms plus Heitz `ltc1`/`ltc2` half-float tables. */
export function createLtcMaterialLayout<TSchema extends d.AnyWgslStruct>(
  schema: TSchema,
): LtcMaterialLayout<TSchema> {
  return tgpu
    .bindGroupLayout({
      u: { uniform: schema },
      ltcSamp: { sampler: 'filtering' },
      ltc1: { texture: d.texture2d(d.f32) },
      ltc2: { texture: d.texture2d(d.f32) },
    })
    .$idx(1)
}

export interface ExtraAttributeDef {
  readonly name: string
  readonly location: number
  readonly format: GPUVertexFormat
  readonly stride: number
  readonly layout: ReturnType<typeof tgpu.vertexLayout>
}

/** Optional explicit vertex attribute helper (locations 2+ in `vertex` are auto-inferred by `munari compile`). */
export function defineScalarAttribute(name: string, location: number): ExtraAttributeDef {
  return {
    name,
    location,
    format: 'float32',
    stride: 4,
    layout: tgpu.vertexLayout((n) => d.arrayOf(d.f32, n)),
  }
}

export interface MaterialUniformDefinition<TSchema extends d.AnyWgslStruct> {
  readonly schema: TSchema
  readonly layout: SurfaceUniformLayout<TSchema> | LtcMaterialLayout<TSchema>
  readonly initial: d.InferInput<TSchema>
  readonly sampleValue?: d.InferInput<TSchema>
}

export interface MaterialDefinition<TSchema extends d.AnyWgslStruct = d.AnyWgslStruct> {
  readonly name: string
  readonly sampleViewFormat?: 'rgba8unorm' | 'rgba8unorm-srgb'
  readonly doubleSided?: boolean
  readonly depthTest?: boolean
  readonly depthWrite?: boolean
  readonly needsBackdrop?: boolean
  readonly animated?: boolean
  readonly staticTextures?: readonly SurfaceStaticTextureSpec[]
  readonly extraAttributes?: readonly ExtraAttributeDef[]
  readonly uniforms?: MaterialUniformDefinition<TSchema>
  readonly vertex: TgpuVertexFn
  readonly fragment: TgpuFragmentFn
}

export interface GpuMaterialDefinition<TSchema extends d.AnyWgslStruct = d.AnyWgslStruct> {
  readonly name: string
  readonly doubleSided?: boolean
  readonly depthTest?: boolean
  readonly depthWrite?: boolean
  readonly needsBackdrop?: boolean
  readonly animated?: boolean
  readonly staticTextures?: readonly SurfaceStaticTextureSpec[]
  readonly uniforms?: MaterialUniformDefinition<TSchema>
  readonly displace?: SurfaceDisplaceFn
  readonly shade?: SurfaceShadeFn
  readonly shades?: readonly SurfaceShadeFn[]
}

/** Declare a TypeGPU material to compile into a zero-dependency `*.material.gen.ts` manifest. */
export function defineManifestMaterial<TSchema extends d.AnyWgslStruct>(
  def: MaterialDefinition<TSchema>,
): MaterialDefinition<TSchema> {
  return def
}

/**
 * Linear-color material builder: `shade` hooks receive and return straight linear RGB + alpha
 * while Munari owns `sampleSurfaceLinear`, `surfaceRadiusMask`, `srgbOetf`, premultiply, and discard.
 */
export function defineGpuMaterial<TSchema extends d.AnyWgslStruct>(
  def: GpuMaterialDefinition<TSchema>,
): MaterialDefinition<TSchema> {
  const resolvedShade = def.shades?.length ? composeShades(...def.shades) : def.shade
  if (!resolvedShade) throw new Error(`${def.name}: defineGpuMaterial requires \`shade\` or \`shades\``)
  const displaceFn = def.displace

  const vertex = displaceFn
    ? tgpu.vertexFn({
        in: { position: d.location(0, d.vec3f), uv: d.location(1, d.vec2f) },
        out: {
          pos: d.builtin.position,
          uv: d.vec2f,
          worldPos: d.vec3f,
          worldNormal: d.vec3f,
          localNormal: d.vec3f,
        },
      })((input) => {
        'use gpu'
        const frame = surfaceLayout.$.frame
        const disp = displaceFn(SurfaceVertexIn({ position: input.position, uv: input.uv }))
        const wp = frame.modelWorld.mul(d.vec4f(disp.position, 1.0))
        const wn = std.normalize(frame.modelWorld.mul(d.vec4f(disp.localNormal, 0.0)).xyz)
        return {
          pos: frame.mvp.mul(d.vec4f(disp.position, 1.0)),
          uv: input.uv,
          worldPos: wp.xyz,
          worldNormal: wn,
          localNormal: disp.localNormal,
        }
      })
    : tgpu.vertexFn({
        in: { position: d.location(0, d.vec3f), uv: d.location(1, d.vec2f) },
        out: {
          pos: d.builtin.position,
          uv: d.vec2f,
          worldPos: d.vec3f,
          worldNormal: d.vec3f,
          localNormal: d.vec3f,
        },
      })((input) => {
        'use gpu'
        const frame = surfaceLayout.$.frame
        const wp = frame.modelWorld.mul(d.vec4f(input.position, 1.0))
        const wn = std.normalize(frame.modelWorld.mul(d.vec4f(0.0, 0.0, 1.0, 0.0)).xyz)
        return {
          pos: frame.mvp.mul(d.vec4f(input.position, 1.0)),
          uv: input.uv,
          worldPos: wp.xyz,
          worldNormal: wn,
          localNormal: d.vec3f(0.0, 0.0, 1.0),
        }
      })

  const fragment = tgpu.fragmentFn({
    in: {
      pos: d.builtin.position,
      uv: d.vec2f,
      worldPos: d.vec3f,
      worldNormal: d.vec3f,
      localNormal: d.vec3f,
    },
    out: d.vec4f,
  })((input) => {
    'use gpu'
    const cap = sampleSurfaceLinear(input.uv)
    const out = resolvedShade(
      SurfaceFragmentIn({
        uv: input.uv,
        worldPos: input.worldPos,
        worldNormal: std.normalize(input.worldNormal),
        localNormal: std.normalize(input.localNormal),
        screenPos: input.pos,
        color: cap.rgb,
        alpha: cap.a,
      }),
    )
    return encodeSurfaceOutput(out.rgb, out.a, input.uv)
  })

  return {
    name: def.name,
    sampleViewFormat: 'rgba8unorm',
    doubleSided: def.doubleSided,
    depthTest: def.depthTest,
    depthWrite: def.depthWrite,
    needsBackdrop: def.needsBackdrop,
    animated: def.animated,
    staticTextures: def.staticTextures,
    uniforms: def.uniforms,
    vertex,
    fragment,
  }
}
