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

const latticeHash = tgpu.fn([d.vec2f], d.f32)((cell) => {
  'use gpu'
  return std.fract(std.sin(std.dot(cell, d.vec2f(127.1, 311.7))) * 43758.5453)
})

const valueNoise = tgpu.fn([d.vec2f], d.vec3f)((p) => {
  'use gpu'
  const cell = std.floor(p)
  const f = std.fract(p)
  const u = f.mul(f).mul(d.vec2f(3.0).sub(f.mul(2.0)))
  const du = f.mul(d.vec2f(1.0).sub(f)).mul(6.0)
  const a = latticeHash(cell)
  const b = latticeHash(cell.add(d.vec2f(1.0, 0.0)))
  const c = latticeHash(cell.add(d.vec2f(0.0, 1.0)))
  const k = a - b - c + latticeHash(cell.add(d.vec2f(1.0, 1.0)))
  const value = a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y
  const dx = du.x * (b - a + k * u.y)
  const dy = du.y * (c - a + k * u.x)
  return d.vec3f(value * 2.0 - 1.0, dx * 2.0, dy * 2.0)
})

const shade = tgpu.fn([SurfaceFragmentIn], d.vec4f)((ctx) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const u = customLayout.$.u
  const point = ctx.uv.sub(0.5).mul(frame.size)
  const halfSize = std.max(frame.size.mul(0.5), d.vec2f(1.0))
  const edgeW = std.max(u.edgeWidth, d.f32(0.0))

  const top = point.y < 0.0
  const tl = std.select(frame.radii.w, frame.radii.x, top)
  const tr = std.select(frame.radii.z, frame.radii.y, top)
  const cornerR = std.select(tr, tl, point.x < 0.0)
  const rad = std.min(std.max(cornerR, edgeW), std.min(halfSize.x, halfSize.y))

  const dBox = std.abs(point).sub(halfSize).add(rad)
  const outCorner = std.max(dBox, d.vec2f(0.0))
  const outLen = std.length(outCorner)
  const dist = outLen + std.min(std.max(dBox.x, dBox.y), d.f32(0.0)) - rad
  const inCorner = dBox.x > 0.0 && dBox.y > 0.0
  const axis = std.select(d.vec2f(0.0, 1.0), d.vec2f(1.0, 0.0), dBox.x > dBox.y)
  const away = std.select(axis, outCorner.div(std.max(outLen, d.f32(1e-4))), inCorner)
  const outward = away.mul(std.sign(point))
  const bevelDir = d.vec2f(outward.x, -outward.y)
  const bevelT = std.select(d.f32(0.0), std.smoothstep(-edgeW, d.f32(0.0), dist), edgeW > 0.1)

  const sc = std.max(u.peelScale, d.f32(1.0))
  const coarse = valueNoise(point.div(sc))
  const turned = d.vec2f(point.x * 0.8 - point.y * 0.6, point.x * 0.6 + point.y * 0.8)
  const fine = valueNoise(turned.div(sc * 0.43).add(17.3))
  const rawPeel = coarse.yz.add(fine.yz.mul(0.6)).mul(u.peelDepth * 2.5)
  const peelSlope = d.vec2f(rawPeel.x, -rawPeel.y)

  const nLocal = std.normalize(ctx.localNormal.add(d.vec3f(bevelDir.mul(bevelT * 0.45).add(peelSlope), d.f32(0.0))))
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
