// Opaque clearcoat car-paint lacquer using Heitz 2016 LTC rectangular softbox lighting.
// Compiles offline with @group(1) static 64x64 rgba16float LTC LUT tables (ltc1, ltc2).

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  LTC_STATIC_TEXTURES,
  SurfaceFragmentIn,
  createLtcMaterialLayout,
  defineGpuMaterial,
  ltcEvaluate,
  ltcMatrixFromSample,
  ltcUv,
  surfaceLayout,
} from '@petepetrash/munari-cli/author'

export const LacquerLtcUniforms = d.struct({
  bodyColor: d.vec3f,
  coatAmount: d.f32,
  coatRoughness: d.f32,
  edgeWidth: d.f32,
  peelScale: d.f32,
  peelDepth: d.f32,
  textLit: d.f32,
})

const customLayout = createLtcMaterialLayout(LacquerLtcUniforms)

const shade = tgpu.fn([SurfaceFragmentIn], d.vec4f)((ctx) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const u = customLayout.$.u
  const point = ctx.uv.sub(0.5).mul(frame.size)
  const halfSize = frame.size.mul(0.5)
  const leftR = std.select(frame.radii.w, frame.radii.x, point.y > 0.0)
  const rightR = std.select(frame.radii.z, frame.radii.y, point.y > 0.0)
  const rad = std.select(rightR, leftR, point.x < 0.0)
  const dBox = std.abs(point).sub(halfSize).add(d.vec2f(rad))
  const dist = std.min(std.max(dBox.x, dBox.y), 0.0) + std.length(std.max(dBox, d.vec2f(0.0))) - rad
  const edgeW = std.max(u.edgeWidth, d.f32(0.0))
  const bevelT = std.select(d.f32(0.0), std.smoothstep(-edgeW, d.f32(0.0), dist), edgeW > 0.1)
  const outCorner = std.max(dBox, d.vec2f(0.0))
  const sideX = std.select(d.f32(0.0), std.sign(point.x), dBox.x >= dBox.y)
  const sideY = std.select(d.f32(0.0), std.sign(point.y), dBox.y > dBox.x)
  const rawGrad = std.select(
    d.vec2f(sideX, sideY),
    outCorner.mul(std.sign(point)),
    outCorner.x > 0.0 && outCorner.y > 0.0,
  )
  const bevelDir = std.normalize(rawGrad.add(d.vec2f(1e-5, 0.0)))

  const peelFreq = d.f32(6.28318) / std.max(u.peelScale, d.f32(1.0))
  const peelX = std.cos(point.x * peelFreq) * std.sin(point.y * peelFreq)
  const peelY = std.sin(point.x * peelFreq) * std.cos(point.y * peelFreq)
  const nLocal = std.normalize(
    ctx.localNormal.add(
      d.vec3f(bevelDir.mul(bevelT * 0.45).add(d.vec2f(peelX, peelY).mul(u.peelDepth * 8.0)), d.f32(0.0)),
    ),
  )
  const n = std.normalize(frame.modelWorld.mul(d.vec4f(nLocal, 0.0)).xyz)
  const viewPos = d.vec3f(0.0, 0.0, frame.camera.x)
  const v = std.normalize(viewPos.sub(ctx.worldPos))
  const ndotv = std.clamp(std.dot(n, v), d.f32(0.0), d.f32(1.0))

  const kw = std.select(frame.keySize.x, d.f32(420.0), frame.keySize.x <= 1.0)
  const kh = std.select(frame.keySize.y, d.f32(260.0), frame.keySize.y <= 1.0)
  const hw = kw * 0.5
  const hh = kh * 0.5
  const kc = frame.keyPos.xyz
  const p0 = d.vec3f(kc.x - hw, kc.y + hh, kc.z)
  const p1 = d.vec3f(kc.x + hw, kc.y + hh, kc.z)
  const p2 = d.vec3f(kc.x + hw, kc.y - hh, kc.z)
  const p3 = d.vec3f(kc.x - hw, kc.y - hh, kc.z)

  const uvCoat = ltcUv(n, v, std.clamp(u.coatRoughness, d.f32(0.02), d.f32(1.0)))
  const t1 = std.textureSampleLevel(customLayout.$.ltc1, customLayout.$.ltcSamp, uvCoat, 0.0)
  const t2 = std.textureSampleLevel(customLayout.$.ltc2, customLayout.$.ltcSamp, uvCoat, 0.0)

  const diffForm = ltcEvaluate(n, v, ctx.worldPos, d.mat3x3f.identity(), p0, p1, p2, p3)
  const specForm = ltcEvaluate(n, v, ctx.worldPos, ltcMatrixFromSample(t1), p0, p1, p2, p3)

  const f0 = d.f32(0.04)
  const coatFresnel = f0 * t2.x + (1.0 - f0) * t2.y
  const keyGain = frame.keyPos.w * 2.2
  const envIntensity = frame.keySize.z
  const reflY = std.clamp(n.y * 0.5 + 0.5, d.f32(0.0), d.f32(1.0))
  const envFill = std.mix(d.f32(0.16), d.f32(0.48), reflY) * envIntensity
  const envCoat =
    (f0 + (1.0 - f0) * std.pow(d.f32(1.0) - ndotv, d.f32(5.0))) *
    std.mix(d.f32(0.12), d.f32(1.35), reflY) *
    envIntensity *
    u.coatAmount

  const litTextMask = std.select(d.f32(0.0), ctx.alpha, u.textLit > 0.5)
  const baseCol = std.mix(u.bodyColor, ctx.color, litTextMask)
  const shaded = baseCol
    .mul(envFill + diffForm * keyGain)
    .add(d.vec3f(specForm * coatFresnel * keyGain * u.coatAmount + envCoat))
  const finalRgb = std.select(std.mix(shaded, ctx.color, ctx.alpha), shaded, u.textLit > 0.5)
  return d.vec4f(finalRgb, d.f32(1.0))
})

export default defineGpuMaterial({
  name: 'lacquer-ltc',
  doubleSided: false,
  depthWrite: true,
  staticTextures: LTC_STATIC_TEXTURES,
  uniforms: {
    schema: LacquerLtcUniforms,
    layout: customLayout,
    initial: {
      bodyColor: [0.26, 0.008, 0.022],
      coatAmount: 1.0,
      coatRoughness: 0.04,
      edgeWidth: 6.0,
      peelScale: 18.0,
      peelDepth: 0.004,
      textLit: 1.0,
    },
    sampleValue: {
      bodyColor: [0.02, 0.14, 0.36],
      coatAmount: 0.9,
      coatRoughness: 0.08,
      edgeWidth: 8.0,
      peelScale: 14.0,
      peelDepth: 0.008,
      textLit: 0.0,
    },
  },
  shade,
})
