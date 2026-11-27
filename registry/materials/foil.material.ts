// Iridescent thin-film holographic foil overlay driven by pointer tilt and phase shift.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  createMaterialUniformLayout,
  defineManifestMaterial,
  sampleSurface,
  srgbOetf,
  surfaceLayout,
  surfaceRadiusMask,
} from '@petepetrash/munari-cli/author'

export const FoilUniforms = d.struct({
  tilt: d.vec2f,
  intensity: d.f32,
  phase: d.f32,
})

const customLayout = createMaterialUniformLayout(FoilUniforms)

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
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const u = customLayout.$.u
  const c = sampleSurface(input.uv)
  const centered = input.uv.sub(0.5)
  const sweep = std.dot(centered, u.tilt) * 4.2 + input.uv.x * 2.1 + u.phase
  const spectrum = srgbOetf(
    std.max(
      d.vec3f(0.0),
      std.cos(d.vec3f(0.0, 2.094, 4.188).add(sweep * 6.28318)).mul(0.5).add(0.5),
    ),
  )
  const diag = std.exp(-std.pow((centered.x * 0.7 - centered.y * 0.9 - u.tilt.x * 0.45) * 4.2, 2.0))
  const shimmer = spectrum.mul((0.18 + diag * 0.55) * u.intensity * c.a)
  const mask = surfaceRadiusMask(input.uv, frame.size, frame.radii)
  const outCol = d.vec4f(c.rgb.add(shimmer).mul(mask), c.a * mask)
  if (outCol.a < 0.004) std.discard()
  return outCol
})

export default defineManifestMaterial({
  name: 'foil',
  sampleViewFormat: 'rgba8unorm',
  doubleSided: false,
  depthTest: true,
  depthWrite: false,
  uniforms: {
    schema: FoilUniforms,
    layout: customLayout,
    initial: {
      tilt: [0.35, -0.25],
      intensity: 0.45,
      phase: 0.2,
    },
    sampleValue: {
      tilt: [-0.4, 0.3],
      intensity: 0.65,
      phase: 0.75,
    },
  },
  vertex,
  fragment,
})
