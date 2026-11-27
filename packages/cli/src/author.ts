// TypeGPU authoring helpers for *.material.ts files compiled AOT by `munari compile`.
//
// Standard surface contract:
// - Vertex inputs: `@location(0)` position (`d.vec3f`), `@location(1)` uv (`d.vec2f`).
//   Extra per-vertex attributes declared with `@location(2+)` in `vertex` (e.g.
//   `aSlope: d.location(2, d.f32)`) are automatically inferred by `munari compile`
//   and exposed at runtime via `onFrame({ setExtraAttribute(slot, data) })` where `slot`
//   is `location - 2`.
// - `@group(0)` (`surfaceLayout`): `{ frame: SurfaceFrameUniforms, samp, tex }`.
//   `SurfaceFrameUniforms` exposes `mvp` (`mat4x4f`), `modelWorld` (`mat4x4f`),
//   `size` (`vec2f`, logical px), and `radii` (`vec4f`, `[tl, tr, br, bl]` px).
// - `@group(1)` (`createMaterialUniformLayout(schema)`): optional custom uniform struct.
//   `d.mat3x3f` fields accept either 9 column-major floats or 12 WebGPU-padded floats.
// - `@group(2)` (`backdropLayout`): bound when `needsBackdrop: true` for transmissive/glass passes.
// - `sampleSurface(uv)` returns premultiplied sRGB RGBA; `sampleSurfaceLinear(uv)` unpremultiplies
//   and decodes to linear RGB (`rgba8unorm`); `sampleBackdropLinear(screenUv)` does the same for backdrop.

import tgpu, {
  type TgpuBindGroupLayout,
  type TgpuFragmentFn,
  type TgpuVertexFn,
} from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'

export const SurfaceFrameUniforms = d.struct({
  mvp: d.mat4x4f,
  modelWorld: d.mat4x4f,
  size: d.vec2f,
  radii: d.vec4f,
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
  return std.textureSample(surfaceLayout.$.tex, surfaceLayout.$.samp, d.vec2f(uv.x, 1.0 - uv.y))
})

/** Sample the DOM texture and decode premultiplied sRGB into straight linear RGB + alpha. */
export const sampleSurfaceLinear = tgpu.fn([d.vec2f], d.vec4f)((uv) => {
  'use gpu'
  const pm = sampleSurface(uv)
  const straight = std.select(d.vec3f(0.0), pm.rgb.div(std.max(pm.a, 1e-4)), pm.a > 0.002)
  return d.vec4f(srgbEotf(straight), pm.a)
})

/** Sample the `@group(2)` canvas backdrop snapshot at screen UV `(0..1, 0..1)`. */
export const sampleBackdrop = tgpu.fn([d.vec2f], d.vec4f)((screenUv) => {
  'use gpu'
  return std.textureSampleLevel(
    backdropLayout.$.tex,
    backdropLayout.$.samp,
    std.clamp(screenUv, d.vec2f(0.0), d.vec2f(1.0)),
    0.0,
  )
})

/** Sample `@group(2)` canvas backdrop and decode premultiplied sRGB into straight linear RGB + alpha. */
export const sampleBackdropLinear = tgpu.fn([d.vec2f], d.vec4f)((screenUv) => {
  'use gpu'
  const pm = sampleBackdrop(screenUv)
  const straight = std.select(d.vec3f(0.0), pm.rgb.div(std.max(pm.a, 1e-4)), pm.a > 0.002)
  return d.vec4f(srgbEotf(straight), pm.a)
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

export type SurfaceUniformLayout<TSchema extends d.AnyWgslStruct> = TgpuBindGroupLayout<{
  readonly u: { readonly uniform: TSchema }
}>

/** Create a `@group(1)` custom uniform bind group layout for `schema`. */
export function createMaterialUniformLayout<TSchema extends d.AnyWgslStruct>(
  schema: TSchema,
): SurfaceUniformLayout<TSchema> {
  return tgpu.bindGroupLayout({ u: { uniform: schema } }).$idx(1)
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
  readonly layout: SurfaceUniformLayout<TSchema>
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
  readonly extraAttributes?: readonly ExtraAttributeDef[]
  readonly uniforms?: MaterialUniformDefinition<TSchema>
  readonly vertex: TgpuVertexFn
  readonly fragment: TgpuFragmentFn
}

/** Declare a TypeGPU material to compile into a zero-dependency `*.material.gen.ts` manifest. */
export function defineManifestMaterial<TSchema extends d.AnyWgslStruct>(
  def: MaterialDefinition<TSchema>,
): MaterialDefinition<TSchema> {
  return def
}
