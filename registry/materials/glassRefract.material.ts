// Refractive frosted glass sampling the two-pass @group(2) canvas backdrop with Fresnel highlight.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  backdropLayout,
  createMaterialUniformLayout,
  defineManifestMaterial,
  sampleBackdropLinear,
  sampleSurface,
  srgbOetf,
  surfaceLayout,
  surfaceRadiusMask,
} from '@petepetrash/munari-cli/author'

export const GlassRefractUniforms = d.struct({
  tint: d.vec3f,
  amount: d.f32,
  shift: d.vec2f,
  highlight: d.f32,
})

const customLayout = createMaterialUniformLayout(GlassRefractUniforms)

const vertex = tgpu.vertexFn({
  in: {
    position: d.location(0, d.vec3f),
    uv: d.location(1, d.vec2f),
  },
  out: {
    pos: d.builtin.position,
    uv: d.vec2f,
  },
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  return {
    pos: frame.mvp.mul(d.vec4f(input.position, 1.0)),
    uv: input.uv,
  }
})

const fragment = tgpu.fragmentFn({
  in: {
    pos: d.builtin.position,
    uv: d.vec2f,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const u = customLayout.$.u
  const dims = d.vec2f(std.textureDimensions(backdropLayout.$.tex))
  const edgeBias = (input.uv.sub(0.5)).mul(0.03)
  const screenUv = input.pos.xy.div(std.max(dims, d.vec2f(1.0))).add(u.shift).sub(edgeBias)
  const bg = sampleBackdropLinear(screenUv)
  const dom = sampleSurface(input.uv)
  const tinted = bg.rgb.mul(u.tint)
  const fresnel = std.pow(std.clamp(std.length(input.uv.sub(0.5)) * 1.9, 0.0, 1.0), 2.5) * u.highlight
  const straightGlass = srgbOetf(std.mix(bg.rgb, tinted, u.amount).add(d.vec3f(fresnel)))
  const glassAlpha = std.max(bg.a * 0.92, 0.18)
  const premulGlass = straightGlass.mul(glassAlpha)
  const blendedRgb = dom.rgb.add(premulGlass.mul(1.0 - dom.a))
  const alpha = dom.a + glassAlpha * (1.0 - dom.a)
  const mask = surfaceRadiusMask(input.uv, frame.size, frame.radii)
  const outCol = d.vec4f(blendedRgb.mul(mask), alpha * mask)
  if (outCol.a < 0.004) std.discard()
  return outCol
})

export default defineManifestMaterial({
  name: 'glass-refract',
  sampleViewFormat: 'rgba8unorm',
  doubleSided: true,
  depthTest: true,
  depthWrite: false,
  needsBackdrop: true,
  uniforms: {
    schema: GlassRefractUniforms,
    layout: customLayout,
    initial: {
      tint: [0.85, 0.94, 1.0],
      amount: 0.72,
      shift: [0.008, -0.004],
      highlight: 0.14,
    },
    sampleValue: {
      tint: [0.65, 0.86, 1.0],
      amount: 0.85,
      shift: [0.014, 0.005],
      highlight: 0.18,
    },
  },
  vertex,
  fragment,
})
