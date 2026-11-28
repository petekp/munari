// Optical beveled glass refraction via Snell's law, C1 rounded-rect bevel SDF
// normal (in exact CSS pixels), subtle dispersion, and mip-blurred `@group(2)` backdrop.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  SurfaceFragmentIn,
  backdropLayout,
  createMaterialUniformLayout,
  defineGpuMaterial,
  sampleBackdropLinearLod,
  surfaceLayout,
} from '@petepetrash/munari-cli/author'

export const GlassRefractUniforms = d.struct({
  tint: d.vec3f,
  amount: d.f32,
  shift: d.vec2f,
  highlight: d.f32,
})

const customLayout = createMaterialUniformLayout(GlassRefractUniforms)

const refractOffsetPx = tgpu.fn([d.vec3f, d.f32, d.f32], d.vec2f)((n, ior, thickness) => {
  'use gpu'
  const refr = std.refract(d.vec3f(0.0, 0.0, -1.0), n, 1.0 / ior)
  const raw = refr.xy.mul(thickness / std.max(-refr.z, d.f32(0.35)))
  const mag = std.length(raw)
  const clampScale = std.min(d.f32(1.0), d.f32(14.0) / std.max(mag, d.f32(1e-4)))
  return raw.mul(clampScale)
})

const shade = tgpu.fn([SurfaceFragmentIn], d.vec4f)((ctx) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const u = customLayout.$.u
  const dims = std.max(d.vec2f(std.textureDimensions(backdropLayout.$.tex)), d.vec2f(1.0))
  const cssVp = std.max(frame.viewport, d.vec2f(1.0))

  // Top-down CSS pixel coordinates match screenPos (+X right, +Y down).
  const p = ctx.uv.sub(0.5).mul(frame.size)
  const halfSize = std.max(frame.size.mul(0.5), d.vec2f(1.0))
  const bevelW = d.f32(18.0)

  const top = p.y < 0.0
  const tl = std.select(frame.radii.w, frame.radii.x, top)
  const tr = std.select(frame.radii.z, frame.radii.y, top)
  const cornerR = std.select(tr, tl, p.x < 0.0)
  const rad = std.min(std.max(cornerR, bevelW), std.min(halfSize.x, halfSize.y))

  const q = std.abs(p).sub(halfSize).add(rad)
  const outside = std.max(q, d.vec2f(0.0))
  const outLen = std.length(outside)
  const dist = outLen + std.min(std.max(q.x, q.y), d.f32(0.0)) - rad
  const inCorner = q.x > 0.0 && q.y > 0.0
  const axis = std.select(d.vec2f(0.0, 1.0), d.vec2f(1.0, 0.0), q.x > q.y)
  const away = std.select(axis, outside.div(std.max(outLen, d.f32(1e-4))), inCorner)
  const outward = away.mul(std.sign(p))

  // C1 bevel profile: zero slope across interior-bevel boundary, smooth convex rolloff at rim.
  const towardRim = 1.0 - std.clamp(-dist / bevelW, d.f32(0.0), d.f32(1.0))
  const bevelRamp = std.smoothstep(d.f32(0.0), d.f32(0.35), towardRim)
  const bevelSlope = (towardRim / std.sqrt(std.max(1.0 - towardRim * towardRim * 0.78, d.f32(0.22)))) * bevelRamp
  const dome = p.div(halfSize).mul(0.10)
  const n = std.normalize(d.vec3f(outward.mul(bevelSlope).add(dome), d.f32(1.0)))

  const pxOffR = refractOffsetPx(n, d.f32(1.46), d.f32(14.0))
  const pxOffG = refractOffsetPx(n, d.f32(1.48), d.f32(14.0))
  const pxOffB = refractOffsetPx(n, d.f32(1.51), d.f32(14.0))

  const baseUv = ctx.screenPos.xy.div(dims)
  const uvR = std.clamp(baseUv.add(u.shift).add(pxOffR.div(cssVp)), d.vec2f(0.001), d.vec2f(0.999))
  const uvG = std.clamp(baseUv.add(u.shift).add(pxOffG.div(cssVp)), d.vec2f(0.001), d.vec2f(0.999))
  const uvB = std.clamp(baseUv.add(u.shift).add(pxOffB.div(cssVp)), d.vec2f(0.001), d.vec2f(0.999))
  const lod = std.mix(d.f32(0.45), d.f32(0.12), towardRim)

  const sR = sampleBackdropLinearLod(uvR, lod)
  const sG = sampleBackdropLinearLod(uvG, lod)
  const sB = sampleBackdropLinearLod(uvB, lod)
  const bgRgb = d.vec3f(sR.x, sG.y, sB.z)

  const tinted = bgRgb.mul(u.tint)
  const fresnel = std.pow(1.0 - std.clamp(n.z, d.f32(0.0), d.f32(1.0)), d.f32(2.6))
  const rimCatch = std.max(0.0, -n.y * 0.65 - n.x * 0.45)
  const specular = fresnel * (u.highlight * 1.4 + rimCatch * 0.35) + towardRim * 0.03
  const glassLinear = std.mix(bgRgb, tinted, u.amount).add(d.vec3f(specular))

  const glassAlpha = std.max(sG.w * 0.96, 0.24)
  const alpha = ctx.alpha + glassAlpha * (1.0 - ctx.alpha)
  const straightOut = ctx.color
    .mul(ctx.alpha)
    .add(glassLinear.mul(glassAlpha * (1.0 - ctx.alpha)))
    .div(std.max(alpha, d.f32(1e-4)))
  return d.vec4f(straightOut, alpha)
})

export default defineGpuMaterial({
  name: 'glass-refract',
  doubleSided: true,
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
  shade,
})
