// Compiled opaque SurfaceFinish material using Heitz LTC softboxes, punctual
// point/rim GGX, Charlie sheen, anisotropy, scatter, and analytical studio IBL.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  LTC_STATIC_TEXTURES,
  createLtcMaterialLayout,
  defineManifestMaterial,
  sampleSurface,
  srgbEotf,
  srgbOetf,
  surfaceLayout,
  surfaceRadiusMask,
} from '@petepetrash/munari-cli/author'
import {
  FINISH_UNIFORMS_DEFAULT,
  FinishLightParams,
  FinishUniforms,
  evalFinishStudioLighting,
  finishBaseReliefSlope,
  finishFilteredRoughness,
  finishNeutralToneMap,
  ltcMatrixFromSample,
  ltcUv,
  surfaceEdgeProfile,
} from '@petepetrash/munari-cli/finish-author'

const customLayout = createLtcMaterialLayout(FinishUniforms)

const vertex = tgpu.vertexFn({
  in: { position: d.location(0, d.vec3f), uv: d.location(1, d.vec2f) },
  out: { pos: d.builtin.position, uv: d.vec2f, worldPos: d.vec3f },
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const wp = frame.modelWorld.mul(d.vec4f(input.position, 1.0))
  return { pos: frame.mvp.mul(d.vec4f(input.position, 1.0)), uv: input.uv, worldPos: wp.xyz }
})

const fragment = tgpu.fragmentFn({
  in: { pos: d.builtin.position, uv: d.vec2f, worldPos: d.vec3f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const u = customLayout.$.u
  const cap = sampleSurface(input.uv)
  const mask = surfaceRadiusMask(input.uv, frame.size, frame.radii)

  const content = d.vec2f(input.uv.x - 0.5, 0.5 - input.uv.y).mul(frame.size)
  const edge = surfaceEdgeProfile(content, frame.size.mul(0.5), frame.radii, u.coat.z)
  const edgeSlope = edge.xy
  const towardRim = edge.z
  const relief = finishBaseReliefSlope(content, u.detail.x, u.detail.y, u.detail.z)
  const slopeFaded = relief.div(1.0 + std.dot(edgeSlope, edgeSlope))

  const mw = frame.modelWorld
  const worldOut = std.normalize(mw.mul(d.vec4f(0.0, 0.0, 1.0, 0.0)).xyz)
  const worldRight = std.normalize(mw.mul(d.vec4f(1.0, 0.0, 0.0, 0.0)).xyz)
  const worldUp = std.normalize(std.cross(worldOut, worldRight))

  const nEdgeLocal = std.normalize(d.vec3f(edgeSlope.x, -edgeSlope.y, d.f32(1.0)))
  const nRelLocal = std.normalize(d.vec3f(edgeSlope.x + slopeFaded.x, -(edgeSlope.y + slopeFaded.y), d.f32(1.0)))
  const nEdge = std.normalize(worldRight.mul(nEdgeLocal.x).add(worldUp.mul(nEdgeLocal.y)).add(worldOut.mul(nEdgeLocal.z)))
  const nRel = std.normalize(worldRight.mul(nRelLocal.x).add(worldUp.mul(nRelLocal.y)).add(worldOut.mul(nRelLocal.z)))

  const inCoat = u.detail.x > 0.5 && u.detail.x < 1.5
  const nBase = std.select(nRel, nEdge, inCoat)
  const nCoat = std.select(nEdge, nRel, inCoat)

  const rawRough = std.clamp(u.pbr.x, d.f32(0.045), d.f32(1.0))
  const textLit = u.coat.w > 0.5
  const hasBody = u.bodyColor.w > 0.5
  const isLitText = hasBody && textLit
  const uncovered = 1.0 - cap.a

  const baseRoughInput = std.select(rawRough, std.mix(rawRough, d.f32(0.5), cap.a), isLitText)
  const rBase = finishFilteredRoughness(baseRoughInput, nBase)
  const rCoat = finishFilteredRoughness(std.clamp(u.coat.y, d.f32(0.045), d.f32(1.0)), nCoat)

  const V = std.normalize(d.vec3f(0.0, 0.0, frame.camera.x).sub(input.worldPos))
  const uvB = ltcUv(nBase, V, rBase)
  const t1B = std.textureSampleLevel(customLayout.$.ltc1, customLayout.$.ltcSamp, uvB, 0.0)
  const t2B = std.textureSampleLevel(customLayout.$.ltc2, customLayout.$.ltcSamp, uvB, 0.0)
  const uvC = ltcUv(nCoat, V, rCoat)
  const t1C = std.textureSampleLevel(customLayout.$.ltc1, customLayout.$.ltcSamp, uvC, 0.0)
  const t2C = std.textureSampleLevel(customLayout.$.ltc2, customLayout.$.ltcSamp, uvC, 0.0)

  const capStraight = srgbEotf(std.select(d.vec3f(0.0), cap.rgb.div(std.max(cap.a, d.f32(1e-4))), cap.a > 0.002))
  const rimMix = towardRim * towardRim * u.rimColor.w
  const bodyCol = std.select(
    std.mix(capStraight, u.rimColor.rgb, rimMix),
    std.mix(u.bodyColor.rgb, u.rimColor.rgb, rimMix),
    hasBody,
  )
  const bodySrgb = srgbOetf(std.clamp(bodyCol, d.vec3f(0.0), d.vec3f(1.0)))
  const albedoLitText = srgbEotf(std.clamp(cap.rgb.add(bodySrgb.mul(uncovered)), d.vec3f(0.0), d.vec3f(1.0)))
  const effectiveCol = std.select(bodyCol, albedoLitText, isLitText)

  const metalness = std.select(std.clamp(u.pbr.y, d.f32(0.0), d.f32(1.0)), u.pbr.y * uncovered, isLitText)
  const specInt = std.select(u.pbr.w, std.mix(u.pbr.w, d.f32(1.0), cap.a), isLitText)
  const iorFactor = ((u.pbr.z - 1.0) / (u.pbr.z + 1.0)) * ((u.pbr.z - 1.0) / (u.pbr.z + 1.0))
  const f0Diel = d.vec3f(std.min(iorFactor, d.f32(1.0)) * specInt)
  const f0Blend = std.mix(f0Diel, effectiveCol, metalness)
  const f90 = std.mix(specInt, d.f32(1.0), metalness)

  const tRaw = std.normalize(worldRight.sub(nBase.mul(std.dot(nBase, worldRight))))
  const bRaw = std.cross(nBase, tRaw)
  const ca = std.cos(u.anisoFilm.y)
  const sa = std.sin(u.anisoFilm.y)
  const anisoT = tRaw.mul(ca).add(bRaw.mul(sa))
  const anisoB = bRaw.mul(ca).sub(tRaw.mul(sa))

  const lp = FinishLightParams({
    N: nBase,
    Ncc: nCoat,
    V,
    diffuseCol: effectiveCol.mul(1.0 - metalness),
    f0Dielectric: f0Diel,
    f0Blended: f0Blend,
    f90,
    roughness: rBase,
    metalness,
    coatAmt: u.coat.x,
    coatRough: rCoat,
    sheenCol: u.sheenColor.rgb.mul(u.sheenColor.w),
    sheenRough: std.clamp(u.sheenTrans.x, d.f32(0.05), d.f32(1.0)),
    anisoT,
    anisoB,
    anisoAmt: std.clamp(u.anisoFilm.x, d.f32(0.0), d.f32(1.0)),
    scatterAmt: u.filmParams.w,
    bodyCol: effectiveCol,
    towardRim,
    envGrad: u.crackleLight.z,
    envInt: frame.keySize.z,
    lightGain: u.crackleLight.w,
    uncovered,
    textLit: u.coat.w,
  })

  const lit = evalFinishStudioLighting(
    lp,
    input.worldPos,
    frame.keyPos,
    frame.keySize,
    frame.rimDir,
    worldOut,
    ltcMatrixFromSample(t1B),
    t2B,
    ltcMatrixFromSample(t1C),
    t2C,
  ).add(effectiveCol.mul(u.crackleLight.y))

  if (!hasBody) {
    const outAlpha = cap.a * mask
    if (outAlpha < 0.004) std.discard()
    const enc = srgbOetf(std.clamp(lit, d.vec3f(0.0), d.vec3f(1.0)))
    return d.vec4f(enc.mul(outAlpha), outAlpha)
  }

  const rolled = std.clamp(finishNeutralToneMap(lit), d.vec3f(0.0), d.vec3f(1.0))
  const encodedBody = srgbOetf(rolled)
  if (isLitText) {
    if (mask < 0.004) std.discard()
    return d.vec4f(encodedBody.mul(mask), mask)
  }
  const composited = cap.rgb.add(encodedBody.mul(uncovered))
  if (mask < 0.004) std.discard()
  return d.vec4f(composited.mul(mask), mask)
})

export default defineManifestMaterial({
  name: 'finish-opaque',
  sampleViewFormat: 'rgba8unorm',
  doubleSided: false,
  depthWrite: false,
  staticTextures: LTC_STATIC_TEXTURES,
  uniforms: {
    schema: FinishUniforms,
    layout: customLayout,
    initial: FINISH_UNIFORMS_DEFAULT,
    sampleValue: {
      bodyColor: [0.02, 0.03, 0.14, 1],
      rimColor: [0.02, 0.03, 0.14, 0],
      sheenColor: [0.48, 0.56, 1.0, 1],
      pbr: [0.9, 0, 1.5, 0],
      coat: [0, 0.1, 48, 1],
      anisoFilm: [0, 0, 0, 1.4],
      filmParams: [380, 0.3, 120, 0],
      detail: [3, 24, 0.08, 0],
      crackleLight: [40, 0, 0, 2.5],
      sheenTrans: [0.5, 0, 0, 0],
    },
  },
  vertex,
  fragment,
})
