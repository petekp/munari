// Optical halo glow material designed for `Surface` `bleed` aprons — draws
// retained DOM content cleanly inside [0, 1] while casting an in-plane rounded
// glow across the expanded `frame.uvRect` margin.

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

export const BleedGlowUniforms = d.struct({
  glowColor: d.vec3f,
  intensity: d.f32,
  falloffPx: d.f32,
})

const customLayout = createMaterialUniformLayout(BleedGlowUniforms)

const vertex = tgpu.vertexFn({
  in: { position: d.location(0, d.vec3f), uv: d.location(1, d.vec2f) },
  out: { pos: d.builtin.position, uv: d.vec2f },
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  return { pos: frame.mvp.mul(d.vec4f(input.position, 1.0)), uv: input.uv }
})

const fragment = tgpu.fragmentFn({
  in: { pos: d.builtin.position, uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const u = customLayout.$.u
  const cap = sampleSurface(input.uv)
  const mask = surfaceRadiusMask(input.uv, frame.size, frame.radii)

  const point = input.uv.sub(0.5).mul(frame.size)
  const left = std.select(frame.radii.w, frame.radii.x, point.y > 0.0)
  const right = std.select(frame.radii.z, frame.radii.y, point.y > 0.0)
  const rad = std.select(right, left, point.x < 0.0)
  const q = std.abs(point).sub(frame.size.mul(0.5)).add(d.vec2f(rad))
  const sd = std.min(std.max(q.x, q.y), d.f32(0.0)) + std.length(std.max(q, d.vec2f(0.0))) - rad

  const outDist = std.max(sd, d.f32(0.0))
  const spread = std.max(u.falloffPx, d.f32(1.0))
  const hasBleed = frame.uvRect.z > 1.001 || frame.uvRect.w > 1.001
  const halfOuter = frame.size.mul(frame.uvRect.xy.add(0.5))
  const edgeMargin = halfOuter.sub(std.abs(point))
  const edgeFade = std.smoothstep(d.f32(0.0), spread * 1.5, std.min(edgeMargin.x, edgeMargin.y))
  const auraAlpha = std.select(
    d.f32(0.0),
    std.exp(-outDist / spread) * u.intensity * (1.0 - mask) * edgeFade,
    hasBleed && outDist < spread * 3.0,
  )
  const auraEnc = srgbOetf(std.clamp(u.glowColor, d.vec3f(0.0), d.vec3f(1.0)))
  const outRgb = cap.rgb.mul(mask).add(auraEnc.mul(auraAlpha))
  const outAlpha = std.clamp(cap.a * mask + auraAlpha, d.f32(0.0), d.f32(1.0))
  if (outAlpha < 0.004) std.discard()
  return d.vec4f(outRgb, outAlpha)
})

export default defineManifestMaterial({
  name: 'bleed-glow',
  sampleViewFormat: 'rgba8unorm',
  doubleSided: false,
  depthWrite: false,
  uniforms: {
    schema: BleedGlowUniforms,
    layout: customLayout,
    initial: {
      glowColor: [0.22, 0.56, 1.0],
      intensity: 0.72,
      falloffPx: 10,
    },
  },
  vertex,
  fragment,
})
