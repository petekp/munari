// Compiled transmissive glass SurfaceFinish material sampling the lazy
// multi-level Kawase-downsample @group(2) backdrop with Beer-Lambert absorption and dispersion.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  LTC_STATIC_TEXTURES,
  backdropLayout,
  createLtcMaterialLayout,
  defineManifestMaterial,
  sampleBackdropLinearLod,
  sampleSurface,
  srgbEotf,
  srgbOetf,
  surfaceLayout,
  surfaceRadiusMask,
} from '@petepetrash/munari-cli/author'
import {
  FinishLightParams,
  FinishUniforms,
  evalFinishStudioLighting,
  finishFilteredRoughness,
  finishNeutralToneMap,
  ltcMatrixFromSample,
  ltcUv,
  surfaceEdgeProfile,
} from '@petepetrash/munari-cli/finish-author'

const customLayout = createLtcMaterialLayout(FinishUniforms)

const spectralWeight = tgpu.fn([d.f32], d.vec3f)((f) => {
  'use gpu'
  return std.max(
    d.vec3f(
      1.0 - std.smoothstep(d.f32(0.0), d.f32(0.62), f),
      1.0 - std.abs(f - 0.5) * 2.0,
      std.smoothstep(d.f32(0.38), d.f32(1.0), f),
    ),
    d.vec3f(0.0),
  )
})

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
  const bgDims = d.vec2f(std.textureDimensions(backdropLayout.$.tex))
  const screenUv = input.pos.xy.div(std.max(bgDims, d.vec2f(1.0)))

  const cdx = std.dpdx(content)
  const cdy = std.dpdy(content)
  const udx = std.dpdx(screenUv)
  const udy = std.dpdy(screenUv)
  const det = cdx.x * cdy.y - cdy.x * cdx.y
  const safeDet = std.select(d.f32(1e-8), det, std.abs(det) > 1e-8)

  const edge = surfaceEdgeProfile(content, frame.size.mul(0.5), frame.radii, u.coat.z)
  const edgeSlope = edge.xy
  const towardRim = edge.z

  const mw = frame.modelWorld
  const worldOut = std.normalize(mw.mul(d.vec4f(0.0, 0.0, 1.0, 0.0)).xyz)
  const worldRight = std.normalize(mw.mul(d.vec4f(1.0, 0.0, 0.0, 0.0)).xyz)
  const worldUp = std.normalize(std.cross(worldOut, worldRight))

  const nEdgeLocal = std.normalize(d.vec3f(edgeSlope.x, -edgeSlope.y, d.f32(1.0)))
  const nEdge = std.normalize(worldRight.mul(nEdgeLocal.x).add(worldUp.mul(nEdgeLocal.y)).add(worldOut.mul(nEdgeLocal.z)))

  const rawRough = std.clamp(u.pbr.x, d.f32(0.045), d.f32(1.0))
  const textLit = u.coat.w > 0.5
  const hasBody = u.bodyColor.w > 0.5
  const isLitText = hasBody && textLit
  const uncovered = 1.0 - cap.a

  const rBase = finishFilteredRoughness(std.select(rawRough, std.mix(rawRough, d.f32(0.5), cap.a), isLitText), nEdge)
  const rCoat = finishFilteredRoughness(std.clamp(u.coat.y, d.f32(0.045), d.f32(1.0)), nEdge)
  const V = std.normalize(d.vec3f(0.0, 0.0, frame.camera.x).sub(input.worldPos))
  const uvB = ltcUv(nEdge, V, rBase)
  const t1B = std.textureSampleLevel(customLayout.$.ltc1, customLayout.$.ltcSamp, uvB, 0.0)
  const t2B = std.textureSampleLevel(customLayout.$.ltc2, customLayout.$.ltcSamp, uvB, 0.0)
  const uvC = ltcUv(nEdge, V, rCoat)
  const t1C = std.textureSampleLevel(customLayout.$.ltc1, customLayout.$.ltcSamp, uvC, 0.0)
  const t2C = std.textureSampleLevel(customLayout.$.ltc2, customLayout.$.ltcSamp, uvC, 0.0)

  const capStraight = srgbEotf(std.select(d.vec3f(0.0), cap.rgb.div(std.max(cap.a, d.f32(1e-4))), cap.a > 0.002))
  const rimMix = towardRim * towardRim * u.rimColor.w
  const bodyCol = std.select(
    std.mix(capStraight, u.rimColor.rgb, rimMix),
    std.mix(u.bodyColor.rgb, u.rimColor.rgb, rimMix),
    hasBody,
  )

  const transAmt = std.clamp(u.sheenTrans.y, d.f32(0.0), d.f32(1.0))
  const thickness = std.max(u.sheenTrans.z, d.f32(0.0))
  const dispersion = std.max(u.sheenTrans.w, d.f32(0.0))
  const ior = std.max(u.pbr.z, d.f32(1.0001))

  const incident = d.vec3f(-V.x, -V.y, -V.z)
  const straightPath = incident.mul(thickness / std.max(-std.dot(incident, worldOut), d.f32(0.2)))
  const halfSpread = (ior - 1.0) * 0.025 * dispersion
  const blur = rawRough * rawRough * thickness * 4.0
  const lod = std.clamp(std.log2(std.max(blur * frame.camera.y * 0.45, d.f32(1.0))), d.f32(0.0), d.f32(4.5)) * 0.65

  let transLight = d.vec3f(0.0)
  let transCov = d.f32(0.0)
  const oneTap = blur < 0.35 && dispersion <= 0.001
  if (oneTap) {
    const refr = std.refract(incident, nEdge, 1.0 / ior)
    const path = refr.mul(thickness / std.max(-std.dot(refr, worldOut), d.f32(0.2))).sub(straightPath)
    const card = d.vec2f(std.dot(path, worldRight), -std.dot(path, worldUp))
    const reach = std.max(thickness * 3.0, d.f32(1e-3))
    const off = card.mul(std.min(d.f32(1.0), reach / std.max(std.length(card), d.f32(1e-4))))
    const px = d.vec2f(cdy.y * off.x - cdy.x * off.y, cdx.x * off.y - cdx.y * off.x).div(safeDet)
    const s = sampleBackdropLinearLod(screenUv.add(udx.mul(px.x).add(udy.mul(px.y))), 0.0)
    transLight = s.rgb.mul(s.a)
    transCov = s.a
  } else {
    const turn = std.fract(std.fract(std.dot(input.pos.xy, d.vec2f(0.06711056, 0.00583715))) * 52.9829189) * d.f32(Math.PI * 2)
    const tc = std.cos(turn)
    const ts = std.sin(turn)
    let sumCol = d.vec3f(0.0)
    let sumW = d.vec3f(0.0)
    let sumA = d.f32(0.0)
    for (let i = 0; i < 8; i++) {
      const fi = d.f32(i)
      const f = (fi + 0.5) / 8.0
      const radF = std.sqrt(f)
      const ang = fi * 2.39996323
      const sx = std.cos(ang) * radF
      const sy = std.sin(ang) * radF
      const spiral = d.vec2f(tc * sx - ts * sy, ts * sx + tc * sy)
      const tapIor = std.max(ior + halfSpread * ((f - 0.5) * 2.0), d.f32(1.0001))
      const refr = std.refract(incident, nEdge, 1.0 / tapIor)
      const path = refr.mul(thickness / std.max(-std.dot(refr, worldOut), d.f32(0.2))).sub(straightPath)
      const card = d.vec2f(std.dot(path, worldRight), -std.dot(path, worldUp))
      const reach = std.max(thickness * 3.0, d.f32(1e-3))
      const off = card.mul(std.min(d.f32(1.0), reach / std.max(std.length(card), d.f32(1e-4)))).add(spiral.mul(blur))
      const px = d.vec2f(cdy.y * off.x - cdy.x * off.y, cdx.x * off.y - cdx.y * off.x).div(safeDet)
      const s = sampleBackdropLinearLod(screenUv.add(udx.mul(px.x).add(udy.mul(px.y))), lod)
      const pmLin = s.rgb.mul(s.a)
      const w = std.select(d.vec3f(1.0), spectralWeight(f), dispersion > 0.001)
      sumCol = sumCol.add(pmLin.mul(w))
      sumW = sumW.add(w)
      sumA += s.a
    }
    transLight = sumCol.div(std.max(sumW, d.vec3f(1e-4)))
    transCov = sumA / 8.0
  }

  const centerRefr = std.refract(incident, nEdge, 1.0 / ior)
  const depth = std.clamp(1.0 / std.max(-std.dot(centerRefr, worldOut), d.f32(0.2)), d.f32(1.0), d.f32(3.0))
  const tint = std.select(d.vec3f(1.0), bodyCol, hasBody)
  const absorbed = std.pow(std.max(tint, d.vec3f(1e-4)), d.vec3f(depth))
  const f0 = ((ior - 1.0) / (ior + 1.0)) * ((ior - 1.0) / (ior + 1.0))
  const cosN = std.clamp(std.dot(nEdge, V), d.f32(0.0), d.f32(1.0))
  const frontF = f0 + (1.0 - f0) * std.pow(1.0 - cosN, d.f32(5.0))
  const passed = transAmt * (1.0 - frontF) * (1.0 - f0)
  const grayAbs = std.dot(absorbed, d.vec3f(0.2126, 0.7152, 0.0722))
  const glassLight = transLight.mul(absorbed).mul(passed)
  const seeThrough = passed * grayAbs * (1.0 - transCov)

  const diffBody = std.select(bodyCol, bodyCol.mul(1.0 - transAmt), hasBody)
  const bodySrgb = srgbOetf(std.clamp(diffBody, d.vec3f(0.0), d.vec3f(1.0)))
  const albedoLitText = srgbEotf(std.clamp(cap.rgb.add(bodySrgb.mul(uncovered)), d.vec3f(0.0), d.vec3f(1.0)))
  const effectiveCol = std.select(diffBody, albedoLitText, isLitText)

  const metalness = std.select(std.clamp(u.pbr.y, d.f32(0.0), d.f32(1.0)), u.pbr.y * uncovered, isLitText)
  const specInt = std.select(u.pbr.w, std.mix(u.pbr.w, d.f32(1.0), cap.a), isLitText)
  const f0Diel = d.vec3f(std.min(f0, d.f32(1.0)) * specInt)
  const f0Blend = std.mix(f0Diel, effectiveCol, metalness)
  const f90 = std.mix(specInt, d.f32(1.0), metalness)
  const tRaw = std.normalize(worldRight.sub(nEdge.mul(std.dot(nEdge, worldRight))))
  const bRaw = std.cross(nEdge, tRaw)

  const lp = FinishLightParams({
    N: nEdge,
    Ncc: nEdge,
    V,
    diffuseCol: effectiveCol.mul(1.0 - metalness),
    f0Dielectric: f0Diel,
    f0Blended: f0Blend,
    f90,
    roughness: rBase,
    metalness,
    coatAmt: u.coat.x,
    coatRough: rCoat,
    sheenCol: d.vec3f(0.0),
    sheenRough: d.f32(0.35),
    anisoT: tRaw,
    anisoB: bRaw,
    anisoAmt: d.f32(0.0),
    scatterAmt: d.f32(0.0),
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
    const alphaNoMask = cap.a + uncovered - seeThrough * uncovered
    const outAlpha = alphaNoMask * mask
    if (outAlpha < 0.004) std.discard()
    const straight = lit.add(glassLight.mul(uncovered)).div(std.max(alphaNoMask, d.f32(1e-4)))
    const enc = srgbOetf(std.clamp(straight, d.vec3f(0.0), d.vec3f(1.0)))
    return d.vec4f(enc.mul(outAlpha), outAlpha)
  }

  const rolled = finishNeutralToneMap(lit)
  if (isLitText) {
    const alphaNoMask = 1.0 - seeThrough * uncovered
    const outAlpha = alphaNoMask * mask
    if (outAlpha < 0.004) std.discard()
    const straight = rolled.add(glassLight.mul(uncovered)).div(std.max(alphaNoMask, d.f32(1e-4)))
    const enc = srgbOetf(std.clamp(straight, d.vec3f(0.0), d.vec3f(1.0)))
    return d.vec4f(enc.mul(outAlpha), outAlpha)
  }

  const coverage = 1.0 - seeThrough
  const glassLin = rolled.add(glassLight).div(std.max(coverage, d.f32(1e-4)))
  const glassEnc = srgbOetf(std.clamp(glassLin, d.vec3f(0.0), d.vec3f(1.0)))
  const outRgb = cap.rgb.add(glassEnc.mul(coverage * uncovered))
  const outAlpha = (cap.a + coverage * uncovered) * mask
  if (outAlpha < 0.004) std.discard()
  return d.vec4f(outRgb.mul(mask), outAlpha)
})

export default defineManifestMaterial({
  name: 'finish-transmissive',
  sampleViewFormat: 'rgba8unorm',
  doubleSided: false,
  depthWrite: false,
  needsBackdrop: true,
  staticTextures: LTC_STATIC_TEXTURES,
  uniforms: {
    schema: FinishUniforms,
    layout: customLayout,
    initial: {
      bodyColor: [0.855, 0.905, 0.88, 1],
      rimColor: [1, 1, 1, 0],
      sheenColor: [1, 1, 1, 0],
      pbr: [0.04, 0, 1.52, 1],
      coat: [0, 0.1, 10, 1],
      anisoFilm: [0, 0, 0, 1.4],
      filmParams: [380, 0.3, 120, 0],
      detail: [0, 24, 0.01, 0],
      crackleLight: [40, 0, 1, 1],
      sheenTrans: [0.35, 1, 14, 0],
    },
    sampleValue: {
      bodyColor: [0.046, 0.159, 0.67, 1],
      rimColor: [1, 1, 1, 0],
      sheenColor: [1, 1, 1, 0],
      pbr: [0.5, 0, 1.52, 1],
      coat: [0, 0.1, 8, 1],
      anisoFilm: [0, 0, 0, 1.4],
      filmParams: [380, 0.3, 120, 0],
      detail: [0, 24, 0.01, 0],
      crackleLight: [40, 0, 1, 1],
      sheenTrans: [0.35, 1, 18, 0],
    },
  },
  vertex,
  fragment,
})
