// Authoring helper for *.material.ts files compiled by cli/compile.mjs.
// Runs TypeGPU shaders against Munari's @group(0) surface layout and optional @group(1) uniforms.

import tgpu, {
  type TgpuBindGroupLayout,
  type TgpuFragmentFn,
  type TgpuVertexFn,
} from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import { sampleSurface, srgbEotf, srgbOetf, surfaceLayout, surfaceRadiusMask } from './typegpuMaterial'

export { sampleSurface, srgbEotf, srgbOetf, surfaceLayout, surfaceRadiusMask }

export const backdropLayout = tgpu
  .bindGroupLayout({
    samp: { sampler: 'filtering' },
    tex: { texture: d.texture2d(d.f32) },
  })
  .$idx(2)

export const sampleBackdrop = tgpu.fn([d.vec2f], d.vec4f)((screenUv) => {
  'use gpu'
  return std.textureSampleLevel(
    backdropLayout.$.tex,
    backdropLayout.$.samp,
    std.clamp(screenUv, d.vec2f(0.0), d.vec2f(1.0)),
    0.0,
  )
})

export const sampleBackdropLinear = tgpu.fn([d.vec2f], d.vec4f)((screenUv) => {
  'use gpu'
  const pm = sampleBackdrop(screenUv)
  const straight = std.select(d.vec3f(0.0), pm.rgb.div(std.max(pm.a, 1e-4)), pm.a > 0.002)
  return d.vec4f(srgbEotf(straight), pm.a)
})

export type SurfaceUniformLayout<TSchema extends d.AnyWgslStruct> = TgpuBindGroupLayout<{
  readonly u: { readonly uniform: TSchema }
}>

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

export function defineManifestMaterial<TSchema extends d.AnyWgslStruct>(
  def: MaterialDefinition<TSchema>,
): MaterialDefinition<TSchema> {
  return def
}
