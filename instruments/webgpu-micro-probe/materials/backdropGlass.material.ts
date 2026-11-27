// TypeGPU frosted/tinted glass material sampling decoded premultiplied @group(2) backdrop.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  backdropLayout,
  createMaterialUniformLayout,
  defineManifestMaterial,
  sampleBackdropLinear,
  srgbOetf,
  surfaceLayout,
  surfaceRadiusMask,
} from '../engine/materialDef'

export const BackdropGlassUniforms = d.struct({
  tint: d.vec3f,
  amount: d.f32,
  shift: d.vec2f,
  highlight: d.f32,
})

const customLayout = createMaterialUniformLayout(BackdropGlassUniforms)

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
  const screenUv = input.pos.xy.div(std.max(dims, d.vec2f(1.0))).add(u.shift)
  const bg = sampleBackdropLinear(screenUv)
  const tinted = bg.rgb.mul(u.tint)
  const edge = std.clamp(std.abs(input.uv.x - 0.5) * 2.0, 0.0, 1.0)
  const rim = std.pow(edge, 3.0) * u.highlight
  const rgb = srgbOetf(std.mix(bg.rgb, tinted, u.amount).add(d.vec3f(rim)))
  const mask = surfaceRadiusMask(input.uv, frame.size, frame.radii)
  const outCol = d.vec4f(rgb.mul(bg.a * mask), bg.a * mask)
  if (outCol.a < 0.004) {
    std.discard()
  }
  return outCol
})

export default defineManifestMaterial({
  name: 'backdrop-glass',
  sampleViewFormat: 'rgba8unorm',
  doubleSided: true,
  depthTest: true,
  depthWrite: false,
  needsBackdrop: true,
  uniforms: {
    schema: BackdropGlassUniforms,
    layout: customLayout,
    initial: {
      tint: [0.85, 0.94, 1.0],
      amount: 1.0,
      shift: [0, 0],
      highlight: 0.08,
    },
    sampleValue: {
      tint: [0.65, 0.85, 1.0],
      amount: 0.85,
      shift: [0.015, 0.005],
      highlight: 0.12,
    },
  },
  vertex,
  fragment,
})
