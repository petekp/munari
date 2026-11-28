// Aerodynamic card bend and gloss material compiled AOT to `flightCardManifest`.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  SurfaceFragmentIn,
  SurfaceVertexIn,
  SurfaceVertexOut,
  createMaterialUniformLayout,
  defineGpuMaterial,
} from '@petepetrash/munari-cli/author'

export const FlightCardUniforms = d.struct({
  aeroDir: d.vec2f,
  aeroAmt: d.f32,
  aeroReach: d.f32,
  gloss: d.f32,
})

const customLayout = createMaterialUniformLayout(FlightCardUniforms)

const displace = tgpu.fn([SurfaceVertexIn], SurfaceVertexOut)((input) => {
  'use gpu'
  const custom = customLayout.$.u
  const dir = custom.aeroDir
  const amt = custom.aeroAmt
  const reach = std.max(custom.aeroReach, 1.0)
  const s = std.dot(input.position.xy, dir)
  const t = std.clamp(s / reach, -1.0, 1.0)
  const lead = std.max(t, 0.0)
  const bow = t * t + lead * 0.45 * lead
  const dzds = (amt * (t * 2.0 + lead * 0.9)) / reach
  const localNormal = std.normalize(d.vec3f(dir.mul(-dzds), 1.0))
  const position = d.vec3f(input.position.xy, input.position.z + amt * bow)
  return SurfaceVertexOut({ position, localNormal })
})

const shade = tgpu.fn([SurfaceFragmentIn], d.vec4f)((ctx) => {
  'use gpu'
  const custom = customLayout.$.u
  const L = std.normalize(d.vec3f(-0.45, 0.62, 0.65))
  const baseBand = std.pow(L.z, 6.0)
  const sw = std.max(std.dot(ctx.worldNormal, L), 0.0)
  const band = std.pow(sw, 6.0) - baseBand
  const glossed = ctx.color.add(d.vec3f(custom.gloss * band))
  const sl = std.max(std.dot(ctx.localNormal, L), 0.0)
  const flexBand = std.pow(sl, 6.0) - baseBand
  const flexed = glossed.mul(std.min(1.0, 2.5 * flexBand + 1.0))
  return d.vec4f(flexed, ctx.alpha)
})

export default defineGpuMaterial({
  name: 'flight-card',
  doubleSided: true,
  uniforms: {
    schema: FlightCardUniforms,
    layout: customLayout,
    initial: {
      aeroDir: [0.707, 0.707],
      aeroAmt: 0,
      aeroReach: 160,
      gloss: 0,
    },
    sampleValue: {
      aeroDir: [0.6, -0.8],
      aeroAmt: 26,
      aeroReach: 180,
      gloss: 0.48,
    },
  },
  displace,
  shade,
})
