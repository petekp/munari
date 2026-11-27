// Fisheye magnification lens material using auto-inferred @location(2) aSlope and @location(3) aLens.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  defineManifestMaterial,
  encodeSurfaceOutput,
  sampleSurfaceLinear,
  surfaceLayout,
} from '@petepetrash/munari-cli/author'

const vertex = tgpu.vertexFn({
  in: {
    position: d.location(0, d.vec3f),
    uv: d.location(1, d.vec2f),
    aSlope: d.location(2, d.f32),
    aLens: d.location(3, d.f32),
  },
  out: {
    pos: d.builtin.position,
    uv: d.vec2f,
    slope: d.f32,
    lens: d.f32,
  },
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  return {
    pos: frame.mvp.mul(d.vec4f(input.position, 1.0)),
    uv: input.uv,
    slope: input.aSlope,
    lens: input.aLens,
  }
})

const fragment = tgpu.fragmentFn({
  in: {
    uv: d.vec2f,
    slope: d.f32,
    lens: d.f32,
  },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const c = sampleSurfaceLinear(input.uv)
  const n = std.normalize(d.vec3f(0.0, input.slope, 1.0))
  const L = std.normalize(d.vec3f(-0.3, 0.42, 0.86))
  const shade = std.mix(0.94, 1.0, std.max(std.dot(n, L), 0.0))
  const H = std.normalize(L.add(d.vec3f(0.0, 0.0, 1.0)))
  const spec = std.pow(std.max(std.dot(n, H), 0.0), 64.0)
  const rim = std.smoothstep(0.02, 0.14, input.lens) * (1.0 - std.smoothstep(0.14, 0.5, input.lens))
  const lit = c.rgb.mul(shade).add(d.vec3f(spec * 0.22 + rim * 0.08))
  return encodeSurfaceOutput(lit, c.a, input.uv)
})

export default defineManifestMaterial({
  name: 'fisheye-lens',
  sampleViewFormat: 'rgba8unorm',
  doubleSided: false,
  depthTest: true,
  depthWrite: false,
  vertex,
  fragment,
})
