// Shared TypeGPU PBR finish lighting, studio environment, LTC softbox,
// Khronos PBR Neutral tone mapping, and DOM composite helpers matching Three.js finishRig & finishNodes.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import { ltcEvaluate } from './ltcAuthor'

const RECIPROCAL_PI = d.f32(1.0 / Math.PI)
// Studio light scalars & Charlie sheen denominator floor matching finishRig.tsx.
const STUDIO_KEY_POWER = d.f32(1.55)
const STUDIO_RIM_POWER = d.f32(1.2)
const STUDIO_ENV_GAIN = d.f32(1.35)
const VELVET_KEY_SHARPNESS_EPS = d.f32(1e-4)

export const FinishUniforms = d.struct({
  bodyColor: d.vec4f,
  rimColor: d.vec4f,
  sheenColor: d.vec4f,
  pbr: d.vec4f,
  coat: d.vec4f,
  anisoFilm: d.vec4f,
  filmParams: d.vec4f,
  detail: d.vec4f,
  crackleLight: d.vec4f,
  sheenTrans: d.vec4f,
})

export const FINISH_UNIFORMS_DEFAULT = {
  bodyColor: [0.26, 0.008, 0.022, 1],
  rimColor: [0.26, 0.008, 0.022, 0],
  sheenColor: [1, 1, 1, 0],
  pbr: [0.3, 0, 1.5, 0],
  coat: [1, 0.02, 6, 1],
  anisoFilm: [0, 0, 0, 1.4],
  filmParams: [380, 0.3, 120, 0],
  detail: [1, 18, 0.004, 0],
  crackleLight: [40, 0, 1, 1],
  sheenTrans: [0.35, 0, 0, 0],
} as const

/** Khronos PBR Neutral tone mapping matching Three's neutralToneMapping(c, 1.0). */
export const finishNeutralToneMap = tgpu.fn([d.vec3f], d.vec3f)((col) => {
  'use gpu'
  const startCompression = d.f32(0.76)
  const desat = d.f32(0.15)
  const x = std.min(col.x, std.min(col.y, col.z))
  const offset = std.select(d.f32(0.04), x - 6.25 * x * x, x < 0.08)
  const c = col.sub(offset)
  const peak = std.max(c.x, std.max(c.y, c.z))
  if (peak < startCompression) return c
  const k = 1.0 - startCompression
  const newPeak = 1.0 - (k * k) / (peak + k - startCompression)
  const scaled = c.mul(newPeak / peak)
  const g = 1.0 - 1.0 / (desat * (peak - newPeak) + 1.0)
  return std.mix(scaled, d.vec3f(newPeak), g)
})

const studioEnvSample = tgpu.fn([d.vec3f, d.f32, d.f32], d.f32)((dir, roughness, isGrad) => {
  'use gpu'
  const r2 = roughness * roughness
  const blur = 0.014 + r2 * 1.65
  let env = d.f32(0.22)
  if (dir.y > -0.15) {
    const ySpan = 0.12 + r2 * 0.9
    const skyMix = std.smoothstep(-ySpan * 0.3, 0.35 + ySpan, dir.y)
    const tTop = 5.9 / std.max(dir.y, d.f32(0.15))
    const gx = 1.0 - std.smoothstep(5.0 - blur * tTop, 5.0 + blur * tTop, std.abs(dir.x * tTop))
    const gz = 1.0 - std.smoothstep(5.0 - blur * tTop, 5.0 + blur * tTop, std.abs(dir.z * tTop))
    env = std.mix(env, d.f32(1.2), std.mix(gx * gz, skyMix * 0.65, r2))
  }
  if (dir.z > 0.01) {
    const tBack = 7.0 / std.max(dir.z, d.f32(0.01))
    const hy = dir.y * tBack
    const bx = 1.0 - std.smoothstep(5.0 - blur * tBack, 5.0 + blur * tBack, std.abs(dir.x * tBack))
    const by = 1.0 - std.smoothstep(2.0 - blur * tBack, 2.0 + blur * tBack, std.abs(hy))
    const gradT = std.smoothstep(d.f32(-1.2), d.f32(1.2), hy)
    const panelVal = std.mix(d.f32(0.6), std.mix(d.f32(0.12), d.f32(2.6), gradT), isGrad)
    env = std.mix(env, panelVal, bx * by)
  }
  return env
})

const dfgApprox = tgpu.fn([d.f32, d.f32], d.vec2f)((roughness, ndotv) => {
  'use gpu'
  const r = d.vec4f(-1.0, -0.0275, -0.572, 0.022).mul(roughness).add(d.vec4f(1.0, 0.0425, 1.04, -0.04))
  const a004 = std.min(r.x * r.x, std.exp2(-9.28 * ndotv)) * r.x + r.y
  return d.vec2f(-1.04, 1.04).mul(a004).add(r.zw)
})

const fSchlick = tgpu.fn([d.vec3f, d.f32, d.f32], d.vec3f)((f0, f90, dotVH) => {
  'use gpu'
  const f = std.exp2((-5.55473 * dotVH - 6.98316) * dotVH)
  return f0.mul(1.0 - f).add(f90 * f)
})

const charlieD = tgpu.fn([d.f32, d.f32], d.f32)((sheenRough, dotNH) => {
  'use gpu'
  const alpha = std.max(sheenRough * sheenRough, d.f32(0.01))
  const invA = 1.0 / alpha
  const sin2h = std.max(1.0 - dotNH * dotNH, d.f32(0.0078125))
  return (2.0 + invA) * std.pow(sin2h, invA * 0.5) / d.f32(2.0 * Math.PI)
})

const neubeltV = tgpu.fn([d.f32, d.f32], d.f32)((dotNV, dotNL) => {
  'use gpu'
  return std.clamp(1.0 / std.max(4.0 * (dotNL + dotNV - dotNL * dotNV), d.f32(1e-4)), d.f32(0.0), d.f32(1.0))
})

const iblSheenBrdf = tgpu.fn([d.f32, d.f32], d.f32)((dotNV, r) => {
  'use gpu'
  const rInv = 1.0 / (r + 0.1)
  const a = -1.9362 + r * 1.0678 + r * r * 0.4573 - rInv * 0.8469
  const b = -0.6014 + r * 0.5538 - r * r * 0.467 - rInv * 0.1255
  return std.clamp(std.exp(a * dotNV + b), d.f32(0.0), d.f32(1.0))
})

export const FinishLightParams = d.struct({
  N: d.vec3f,
  Ncc: d.vec3f,
  V: d.vec3f,
  diffuseCol: d.vec3f,
  f0Dielectric: d.vec3f,
  f0Blended: d.vec3f,
  f90: d.f32,
  roughness: d.f32,
  metalness: d.f32,
  coatAmt: d.f32,
  coatRough: d.f32,
  sheenCol: d.vec3f,
  sheenRough: d.f32,
  anisoT: d.vec3f,
  anisoB: d.vec3f,
  anisoAmt: d.f32,
  scatterAmt: d.f32,
  bodyCol: d.vec3f,
  towardRim: d.f32,
  envGrad: d.f32,
  envInt: d.f32,
  lightGain: d.f32,
  uncovered: d.f32,
  textLit: d.f32,
})

const evalDirectPunctual = tgpu.fn([FinishLightParams, d.vec3f, d.vec3f], d.vec3f)((p, lightDir, lightCol) => {
  'use gpu'
  const dotNL = std.clamp(std.dot(p.N, lightDir), d.f32(0.0), d.f32(1.0))
  const dotNV = std.clamp(std.dot(p.N, p.V), d.f32(0.0), d.f32(1.0))
  const irrad = lightCol.mul(dotNL)
  const dfg = dfgApprox(p.roughness, dotNV)
  const ess = std.max(dfg.x + dfg.y, d.f32(1e-4))
  const msComp = p.f0Blended.mul(1.0 / ess - 1.0).add(1.0)

  const H = std.normalize(lightDir.add(p.V))
  const dotNH = std.clamp(std.dot(p.N, H), d.f32(0.0), d.f32(1.0))
  const dotVH = std.clamp(std.dot(p.V, H), d.f32(0.0), d.f32(1.0))

  const alphaB = std.max(p.roughness * p.roughness, d.f32(0.001))
  const alphaT = std.mix(alphaB, d.f32(1.0), p.anisoAmt * p.anisoAmt)
  const a2 = alphaT * alphaB
  const dotTH = std.dot(p.anisoT, H)
  const dotBH = std.dot(p.anisoB, H)
  const va = d.vec3f(alphaB * dotTH, alphaT * dotBH, a2 * dotNH)
  const va2 = std.dot(va, va)
  const w2 = a2 / std.max(va2, d.f32(1e-6))
  const dAniso = RECIPROCAL_PI * a2 * w2 * w2
  const gvA = dotNL * std.length(d.vec3f(alphaT * std.dot(p.anisoT, p.V), alphaB * std.dot(p.anisoB, p.V), dotNV))
  const glA = dotNV * std.length(d.vec3f(alphaT * std.dot(p.anisoT, lightDir), alphaB * std.dot(p.anisoB, lightDir), dotNL))
  const vAniso = 0.5 / std.max(gvA + glA, VELVET_KEY_SHARPNESS_EPS)

  const aIso2 = alphaB * alphaB
  const denom = dotNH * dotNH * (aIso2 - 1.0) + 1.0
  const dIso = aIso2 / (std.max(denom * denom, d.f32(1e-6)) * d.f32(Math.PI))
  const gvI = dotNL * std.sqrt(aIso2 + (1.0 - aIso2) * dotNV * dotNV)
  const glI = dotNV * std.sqrt(aIso2 + (1.0 - aIso2) * dotNL * dotNL)
  const vIso = 0.5 / std.max(gvI + glI, VELVET_KEY_SHARPNESS_EPS)

  const D = std.select(dIso, dAniso, p.anisoAmt > 0.001)
  const V = std.select(vIso, vAniso, p.anisoAmt > 0.001)
  const F = fSchlick(p.f0Dielectric, p.f90, dotVH)
  const fBlend = fSchlick(p.f0Blended, d.f32(1.0), dotVH)

  const sheenV = iblSheenBrdf(dotNV, p.sheenRough)
  const sheenL = iblSheenBrdf(dotNL, p.sheenRough)
  const maxSheen = std.max(p.sheenCol.x, std.max(p.sheenCol.y, p.sheenCol.z))
  const hasSheen = maxSheen > 0.001
  const sheenComp = std.select(d.f32(1.0), 1.0 - maxSheen * std.max(sheenV, sheenL), hasSheen)
  const irradComp = irrad.mul(sheenComp)

  const directDiff = irradComp.mul(p.diffuseCol.mul(RECIPROCAL_PI)).mul(d.vec3f(1.0).sub(F))
  const directSpec = irradComp.mul(fBlend.mul(D * V)).mul(msComp)
  let outLight = directDiff.add(directSpec)

  if (p.coatAmt > 0.001) {
    const dotNLcc = std.clamp(std.dot(p.Ncc, lightDir), d.f32(0.0), d.f32(1.0))
    const dotNVcc = std.clamp(std.dot(p.Ncc, p.V), d.f32(0.0), d.f32(1.0))
    const dotNHcc = std.clamp(std.dot(p.Ncc, H), d.f32(0.0), d.f32(1.0))
    const acc = std.max(p.coatRough * p.coatRough, d.f32(0.0004))
    const acc2 = acc * acc
    const denCc = dotNHcc * dotNHcc * (acc2 - 1.0) + 1.0
    const dCc = acc2 / (std.max(denCc * denCc, d.f32(1e-6)) * d.f32(Math.PI))
    const gvCc = dotNLcc * std.sqrt(acc2 + (1.0 - acc2) * dotNVcc * dotNVcc)
    const glCc = dotNVcc * std.sqrt(acc2 + (1.0 - acc2) * dotNLcc * dotNLcc)
    const vCc = 0.5 / std.max(gvCc + glCc, VELVET_KEY_SHARPNESS_EPS)
    const fCcSpec = fSchlick(d.vec3f(0.04), d.f32(1.0), dotVH)
    const fCcBase = fSchlick(d.vec3f(0.04), d.f32(1.0), dotNVcc)
    const ccSpec = lightCol.mul(dotNLcc).mul(fCcSpec.mul(dCc * vCc))
    outLight = outLight.mul(d.vec3f(1.0).sub(fCcBase.mul(p.coatAmt))).add(ccSpec.mul(p.coatAmt))
  }
  if (hasSheen) {
    const sD = charlieD(p.sheenRough, dotNH)
    const sV = neubeltV(dotNV, dotNL)
    outLight = outLight.add(irrad.mul(p.sheenCol.mul(sD * sV)))
  }
  return outLight
})

const evalDirectSoftbox = tgpu.fn(
  [FinishLightParams, d.vec3f, d.vec3f, d.vec3f, d.vec2f, d.mat3x3f, d.vec4f, d.mat3x3f, d.vec4f],
  d.vec3f,
)((p, worldPos, softCol, keyCenter, keyHalf, mInvBase, t2Base, mInvCc, t2Cc) => {
  'use gpu'
  const p0 = d.vec3f(keyCenter.x - keyHalf.x, keyCenter.y + keyHalf.y, keyCenter.z)
  const p1 = d.vec3f(keyCenter.x + keyHalf.x, keyCenter.y + keyHalf.y, keyCenter.z)
  const p2 = d.vec3f(keyCenter.x + keyHalf.x, keyCenter.y - keyHalf.y, keyCenter.z)
  const p3 = d.vec3f(keyCenter.x - keyHalf.x, keyCenter.y - keyHalf.y, keyCenter.z)

  const diffForm = ltcEvaluate(p.N, p.V, worldPos, d.mat3x3f.identity(), p0, p1, p2, p3)
  const specForm = ltcEvaluate(p.N, p.V, worldPos, mInvBase, p0, p1, p2, p3)
  const fresnel = p.f0Blended.mul(t2Base.x).add(d.vec3f(p.f90).sub(p.f0Blended).mul(t2Base.y))
  let outLight = softCol.mul(p.diffuseCol.mul(diffForm).add(fresnel.mul(specForm)))

  if (p.coatAmt > 0.001) {
    const specCc = ltcEvaluate(p.Ncc, p.V, worldPos, mInvCc, p0, p1, p2, p3)
    const fresCc = d.vec3f(0.04 * t2Cc.x + (1.0 - 0.04) * t2Cc.y)
    const dotNVcc = std.clamp(std.dot(p.Ncc, p.V), d.f32(0.0), d.f32(1.0))
    const fCcBase = fSchlick(d.vec3f(0.04), d.f32(1.0), dotNVcc)
    outLight = outLight.mul(d.vec3f(1.0).sub(fCcBase.mul(p.coatAmt))).add(softCol.mul(fresCc.mul(specCc * p.coatAmt)))
  }
  return outLight
})

/** Full direct (key point or LTC softbox + rim + sheen + scatter) & indirect studio lighting. */
export const evalFinishStudioLighting = tgpu.fn(
  [FinishLightParams, d.vec3f, d.vec4f, d.vec4f, d.vec4f, d.vec3f, d.mat3x3f, d.vec4f, d.mat3x3f, d.vec4f],
  d.vec3f,
)((p, worldPos, keyPos, keySize, rimDir, faceNormal, mInvBase, t2Base, mInvCc, t2Cc) => {
  'use gpu'
  const keyRgb = d.vec3f(1.0, 0.955973, 0.887923)
  const rimRgb = d.vec3f(1.0, 0.904661, 0.791298)
  const toKey = keyPos.xyz.sub(worldPos)
  const dist2 = std.max(std.dot(toKey, toKey), d.f32(0.01))
  const keyPower = STUDIO_KEY_POWER * keyPos.w
  const pointInt = keyPower * keyPos.z * keyPos.z
  const pointCol = keyRgb.mul((pointInt / dist2) * p.lightGain)
  const rimCol = rimRgb.mul(STUDIO_RIM_POWER * keySize.w * p.lightGain)

  let direct = evalDirectPunctual(p, std.normalize(rimDir.xyz), rimCol)
  if (keySize.x > 1.0) {
    const distZ = std.max(std.abs(keyPos.z), d.f32(1.0))
    const hx = std.max(keySize.x, d.f32(1.0)) * 0.5 / distZ
    const hy = std.max(keySize.y, d.f32(1.0)) * 0.5 / distZ
    const sx = std.sqrt(1.0 + hx * hx)
    const sy = std.sqrt(1.0 + hy * hy)
    const cff = ((hx / sx) * std.atan(hy / sx) + (hy / sy) * std.atan(hx / sy)) / d.f32(2.0 * Math.PI)
    const softLum = keyPower / std.max(d.f32(Math.PI * 4) * cff, d.f32(1e-4))
    const softCol = keyRgb.mul(softLum * p.lightGain)
    direct = direct.add(evalDirectSoftbox(p, worldPos, softCol, keyPos.xyz, keySize.xy.mul(0.5), mInvBase, t2Base, mInvCc, t2Cc))
    const maxSheen = std.max(p.sheenCol.x, std.max(p.sheenCol.y, p.sheenCol.z))
    if (maxSheen > 0.001) {
      const kl = std.normalize(toKey)
      const H = std.normalize(kl.add(p.V))
      const nl = std.clamp(std.dot(p.N, kl), d.f32(0.0), d.f32(1.0))
      const nv = std.clamp(std.dot(p.N, p.V), d.f32(0.0), d.f32(1.0))
      const nh = std.clamp(std.dot(p.N, H), d.f32(0.0), d.f32(1.0))
      direct = direct.add(p.sheenCol.mul(charlieD(p.sheenRough, nh) * neubeltV(nv, nl) * nl).mul(keyRgb.mul((pointInt / dist2) * p.lightGain)))
    }
  } else {
    direct = direct.add(evalDirectPunctual(p, std.normalize(toKey), pointCol))
  }

  if (p.scatterAmt > 0.001) {
    const kl = std.normalize(toKey)
    const dotNL = std.dot(p.N, kl)
    const wrapped = std.clamp((dotNL + 0.6) / 1.6, d.f32(0.0), d.f32(1.0))
    const beyond = wrapped - std.clamp(dotNL, d.f32(0.0), d.f32(1.0))
    const leak = std.clamp(std.dot(faceNormal, kl), d.f32(0.0), d.f32(1.0)) * p.towardRim * p.towardRim * 1.2
    const maxC = std.max(p.bodyCol.x, std.max(p.bodyCol.y, p.bodyCol.z))
    const deep = p.bodyCol.mul(p.bodyCol).div(std.max(maxC, d.f32(1e-3)))
    const scatWeight = std.select(d.f32(1.0), p.uncovered, p.textLit > 0.5)
    direct = direct.add(deep.mul((pointInt / dist2) * (beyond + leak) * (p.scatterAmt * p.lightGain * RECIPROCAL_PI) * scatWeight))
  }

  const dotNV = std.clamp(std.dot(p.N, p.V), d.f32(0.0), d.f32(1.0))
  const negV = d.vec3f(-p.V.x, -p.V.y, -p.V.z)
  const bnCross = std.cross(p.anisoB, p.V)
  const bnRaw = std.cross(bnCross, p.anisoB)
  const bnOrtho = std.select(p.N, std.normalize(bnRaw), std.dot(bnRaw, bnRaw) > d.f32(1e-6))
  const bnOneMinus = 1.0 - p.anisoAmt * (1.0 - p.roughness)
  const bnWeight = bnOneMinus * bnOneMinus * bnOneMinus * bnOneMinus
  const bentN = std.select(
    p.N,
    std.normalize(std.mix(bnOrtho, p.N, bnWeight)),
    p.anisoAmt > 0.001,
  )
  const reflBase = std.reflect(negV, bentN)
  const reflVec = std.normalize(std.mix(reflBase, bentN, std.pow(p.roughness, d.f32(4.0))))
  const envScale = STUDIO_ENV_GAIN * p.envInt
  const radiance = studioEnvSample(reflVec, p.roughness, p.envGrad) * envScale
  const backPanelIrr = std.mix(d.f32(0.6), d.f32(1.05), p.envGrad)
  const hemiEst = d.f32(0.22) * 0.56 + backPanelIrr * 0.27 + d.f32(1.2) * 0.17
  const irradScalar = (hemiEst + p.N.y * 0.14 + std.max(p.N.z, d.f32(0.0)) * 0.08) * envScale

  const dfg = dfgApprox(p.roughness, dotNV)
  const ess = dfg.x + dfg.y
  const ems = 1.0 - ess
  const ssDiel = p.f0Dielectric.mul(dfg.x).add(p.f90 * dfg.y)
  const ssMet = p.bodyCol.mul(dfg.x).add(dfg.y)
  const favgD = p.f0Dielectric.add(d.vec3f(1.0).sub(p.f0Dielectric).mul(0.047619))
  const favgM = p.bodyCol.add(d.vec3f(1.0).sub(p.bodyCol).mul(0.047619))
  const msDiel = ssDiel.mul(favgD).div(d.vec3f(1.0).sub(favgD.mul(ems))).mul(ems)
  const msMet = ssMet.mul(favgM).div(d.vec3f(1.0).sub(favgM.mul(ems))).mul(ems)
  const ss = std.mix(ssDiel, ssMet, p.metalness)
  const ms = std.mix(msDiel, msMet, p.metalness)
  const totalDiel = ssDiel.add(msDiel)

  let indSpec = ss.mul(radiance).add(ms.mul(irradScalar))
  let indDiff = p.diffuseCol.mul(d.vec3f(1.0).sub(totalDiel)).mul(irradScalar)
  let indSheen = d.vec3f(0.0)
  const maxSheenI = std.max(p.sheenCol.x, std.max(p.sheenCol.y, p.sheenCol.z))
  if (maxSheenI > 0.001) {
    const sa = iblSheenBrdf(dotNV, p.sheenRough)
    const ec = 1.0 - maxSheenI * sa
    indSheen = p.sheenCol.mul(sa * irradScalar * 0.9)
    indSpec = indSpec.mul(ec)
    indDiff = indDiff.mul(ec)
  }
  let indirect = indDiff.add(indSpec).add(indSheen)
  if (p.coatAmt > 0.001) {
    const dotNVcc = std.clamp(std.dot(p.Ncc, p.V), d.f32(0.0), d.f32(1.0))
    const negVcc = d.vec3f(-p.V.x, -p.V.y, -p.V.z)
    const reflCc = std.normalize(std.mix(std.reflect(negVcc, p.Ncc), p.Ncc, std.pow(p.coatRough, d.f32(4.0))))
    const ccRad = studioEnvSample(reflCc, p.coatRough, p.envGrad) * envScale
    const dfgCc = dfgApprox(p.coatRough, dotNVcc)
    const ccEnv = d.f32(0.04 * dfgCc.x + dfgCc.y) * ccRad
    const fCcBase = fSchlick(d.vec3f(0.04), d.f32(1.0), dotNVcc)
    indirect = indirect.mul(d.vec3f(1.0).sub(fCcBase.mul(p.coatAmt))).add(d.vec3f(ccEnv * p.coatAmt))
  }
  return direct.add(indirect)
})

export { ltcMatrixFromSample, ltcUv } from './ltcAuthor'
export {
  finishApplyThinFilm,
  finishBaseReliefSlope,
  finishCrackleLines,
  finishFilteredRoughness,
  finishLayeredRelief,
  surfaceEdgeProfile,
} from './finishReliefAuthor'
