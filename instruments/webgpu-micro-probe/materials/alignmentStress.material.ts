// Stress-test material for WGSL std140 uniform packing: vec3f + trailing f32,
// mat3x3f column-padded columns, and fixed-size vec4f array.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  createMaterialUniformLayout,
  defineManifestMaterial,
  sampleSurface,
  surfaceLayout,
  surfaceRadiusMask,
} from '../engine/materialDef'

export const AlignmentStressUniforms = d.struct({
  tint: d.vec3f,
  gain: d.f32,
  basis: d.mat3x3f,
  taps: d.arrayOf(d.vec4f, 3),
})

const customLayout = createMaterialUniformLayout(AlignmentStressUniforms)

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
    uv: d.vec2f,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const custom = customLayout.$.u
  const c = sampleSurface(input.uv)
  const rotated = custom.basis.mul(c.rgb)
  const weighted = rotated.mul(custom.tint).mul(custom.gain).add(custom.taps[0]!.xyz)
  const clamped = std.min(std.max(weighted, d.vec3f(0.0)), d.vec3f(1.0))
  const mask = surfaceRadiusMask(input.uv, frame.size, frame.radii)
  return d.vec4f(clamped.mul(mask), c.a * mask)
})

export default defineManifestMaterial({
  name: 'alignment-stress',
  sampleViewFormat: 'rgba8unorm',
  doubleSided: false,
  depthTest: true,
  depthWrite: false,
  uniforms: {
    schema: AlignmentStressUniforms,
    layout: customLayout,
    initial: {
      tint: [1, 1, 1],
      gain: 1,
      basis: d.mat3x3f.identity(),
      taps: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    },
    sampleValue: {
      tint: [0.9, 0.8, 0.7],
      gain: 1.25,
      basis: d.mat3x3f(1, 0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 1),
      taps: [
        [0.01, 0.02, 0.03, 0.04],
        [0.11, 0.12, 0.13, 0.14],
        [0.21, 0.22, 0.23, 0.24],
      ],
    },
  },
  vertex,
  fragment,
})
