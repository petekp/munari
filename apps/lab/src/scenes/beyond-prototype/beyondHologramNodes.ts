// Wave-optics Bragg diffraction grating + cylindrical stereo lenticular TSL
// material (`BeyondHologram`).
//
// Combines four optical layers on one live interactive `<Surface>` pass:
// 1. Matte anodized titanium stock with 1 px spirograph guilloche parallax hairlines
// 2. Spectral Bragg rainbow interference foil + radial kinetigram seal sectors
// 3. Per-ridge cylindrical lenticular optical slicer between `<Surface.HTML>` & `<CaptureContent>`
// 4. Spatially sweeping polycarbonate clearcoat highlight + grounded 3D shadow.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type TextureNode } from 'three/webgpu'
import {
  abs,
  atan,
  clamp,
  cos,
  dot,
  exp,
  float,
  Fn,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput, type SurfaceNodes } from '@petepetrash/munari'

export const HOLO_W = 468
export const HOLO_H = 304

export const LENTICULAR_RECT = { x: 26, y: 164, w: 306, h: 64 } as const

export function createHologramUniforms() {
  return {
    cardSize: uniform(new THREE.Vector2(HOLO_W, HOLO_H)),
    tiltVec: uniform(new THREE.Vector2(-0.31, 0.16)),
    twinReady: uniform(0),
    foilIntensity: uniform(1.0),
    cornerRadius: uniform(20),
    titaniumBase: uniform(new THREE.Color('#13161e')),
  }
}

export type HologramUniforms = ReturnType<typeof createHologramUniforms>

export function createHologramMaterial(
  surface: SurfaceNodes,
  twinMap: TextureNode,
  u: HologramUniforms,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const size = max(u.cardSize, vec2(1, 1))
    const halfSize = size.mul(0.5)
    const localCss = vec2(st.x.mul(size.x), float(1).sub(st.y).mul(size.y))
    const pCss = localCss.sub(halfSize)

    const r = min(u.cornerRadius, min(halfSize.x, halfSize.y).sub(1))
    const b = halfSize.sub(r)
    const q = abs(pCss).sub(b)
    const outside = max(q, vec2(0, 0))
    const outLen = length(outside)
    const sdf = outLen.add(min(max(q.x, q.y), float(0))).sub(r)
    const mask = float(1).sub(smoothstep(float(-0.85), float(0.85), sdf))

    // 1 px continuous spirograph banknote guilloche hairlines (`4 mm` subsurface parallax)
    const paraPos = localCss.add(u.tiltVec.mul(20))
    const dA = paraPos.sub(vec2(184, 152))
    const rA = length(dA)
    const angA = atan(dA.y, dA.x)
    const waveA = sin(rA.mul(0.24).add(sin(angA.mul(8)).mul(2.1)))
    const hairA = float(1).sub(smoothstep(float(0.0), float(0.085), abs(waveA)))

    const dB = paraPos.sub(vec2(290, 96))
    const rB = length(dB)
    const angB = atan(dB.y, dB.x)
    const waveB = sin(rB.mul(0.20).sub(cos(angB.mul(6)).mul(1.8)))
    const hairB = float(1).sub(smoothstep(float(0.0), float(0.085), abs(waveB)))

    const subsurfaceRgb = vec3(0.16, 0.56, 0.74).mul(max(hairA, hairB)).mul(0.055)

    // Foil zones: vertical security ribbon (`358..416`), rosette kinetigram seal (`387, 74`), & bevel rim
    const ribbonDist = max(float(358).sub(localCss.x), localCss.x.sub(float(416)))
    const inRibbon = float(1).sub(smoothstep(float(-0.8), float(0.8), ribbonDist))

    const sealDelta = localCss.sub(vec2(387, 74))
    const sealDist = length(sealDelta)
    const inSeal = float(1).sub(smoothstep(float(33), float(35), sealDist))
    const bevelRim = smoothstep(float(-2.0), float(-0.1), sdf)
    const foilMask = clamp(max(max(inRibbon.mul(0.92), inSeal), bevelRim.mul(0.82)), float(0), float(1))

    // Bragg spectral interference + 10-sector radial kinetigram starburst inside the seal
    const sealAngle = atan(sealDelta.y, sealDelta.x)
    const tiltShift = u.tiltVec.x.mul(2.6).add(u.tiltVec.y.mul(1.7))
    const kinetigram = float(0.5).add(
      float(0.5).mul(sin(sealAngle.mul(10).sub(tiltShift.mul(4.5)).add(sin(sealDist.mul(0.32))))),
    )
    const spatialGrating = localCss.y
      .mul(0.015)
      .add(localCss.x.mul(0.006))
      .add(sealAngle.mul(inSeal).mul(0.64))
      .add(sin(sealDist.mul(0.28)).mul(inSeal).mul(0.24))
    const phase = spatialGrating.add(tiltShift)

    const tau = float(6.283185)
    const spectral = vec3(
      float(0.54).add(float(0.46).mul(cos(tau.mul(phase)))),
      float(0.54).add(float(0.46).mul(cos(tau.mul(phase.add(0.33))))),
      float(0.54).add(float(0.46).mul(cos(tau.mul(phase.add(0.67))))),
    )

    const ribbonWave = float(0.42).add(
      float(0.58).mul(
        pow(
          max(float(0.5).add(float(0.5).mul(sin(localCss.y.mul(0.038).sub(tiltShift.mul(2.8))))), float(0.0001)),
          float(1.6),
        ),
      ),
    )
    const lobeStrength = mix(ribbonWave, kinetigram.mul(0.65).add(0.35), inSeal)
    const foilRgb = mix(vec3(0.24, 0.27, 0.34), spectral, lobeStrength.mul(0.84)).mul(u.foilIntensity)

    // Spatially sweeping polycarbonate clearcoat sheen across `pCss`
    const viewDir = normalize(vec3(pCss.x.negate(), pCss.y, float(560)))
    const coatN = normalize(vec3(u.tiltVec.x.mul(1.15), u.tiltVec.y.negate().mul(1.15), float(1)))
    const lightDir = normalize(vec3(-0.34, 0.52, 0.86))
    const halfV = normalize(lightDir.add(viewDir))
    const clearcoat = pow(max(dot(coatN, halfV), float(0.0001)), float(26)).mul(0.20)

    const baseVec = vec3(u.titaniumBase.r, u.titaniumBase.g, u.titaniumBase.b)
    const cardSubstrate = mix(baseVec.add(subsurfaceRgb), foilRgb, foilMask).add(
      vec3(0.95, 0.98, 1.0).mul(clearcoat),
    )

    // Cylindrical lenticular stereo window (`[26..332, 164..228]`)
    const lx0 = float(LENTICULAR_RECT.x)
    const ly0 = float(LENTICULAR_RECT.y)
    const lw = float(LENTICULAR_RECT.w)
    const lh = float(LENTICULAR_RECT.h)
    const lCenter = vec2(lx0.add(lw.mul(0.5)), ly0.add(lh.mul(0.5)))
    const lHalf = vec2(lw.mul(0.5), lh.mul(0.5)).sub(6)
    const lQ = abs(localCss.sub(lCenter)).sub(lHalf)
    const lSdf = length(max(lQ, vec2(0, 0))).add(min(max(lQ.x, lQ.y), float(0))).sub(6)
    const inLenticular = float(1).sub(smoothstep(float(-0.8), float(0.8), lSdf))

    const twinUv = vec2(
      clamp(localCss.x.sub(lx0).div(lw), float(0.005), float(0.995)),
      clamp(float(1).sub(localCss.y.sub(ly0).div(lh)), float(0.005), float(0.995)),
    )
    const twinSample = twinMap.sample(twinUv)

    // Wide cylindrical ridge swing (`0.19`) across a sharp optical slice (`±0.022`) so
    // 0 deg slices pure per-ridge columns with a bright lenticule specular flash instead of 50% text soup
    const ridge = sin(localCss.x.mul(2.25))
    const stereoMix = smoothstep(float(-0.022), float(0.022), u.tiltVec.x.add(ridge.mul(0.19))).mul(
      u.twinReady,
    )
    const nearZeroTilt = exp(u.tiltVec.x.div(float(0.10)).mul(u.tiltVec.x.div(float(0.10))).negate())
    const ridgeCaustic = pow(max(ridge, float(0.0001)), float(4))
      .mul(0.24)
      .mul(nearZeroTilt)
      .add(ridge.mul(0.022))
      .mul(inLenticular)

    const fgMain = surface.map.sample(st)
    const fgBlended = mix(fgMain, twinSample, stereoMix.mul(inLenticular))

    const compositeRgb = clamp(
      fgBlended.rgb
        .add(cardSubstrate.mul(float(1).sub(fgBlended.a)))
        .add(vec3(0.82, 0.94, 1.0).mul(ridgeCaustic)),
      vec3(0),
      vec3(1),
    )
    return premultipliedOutput(vec4(compositeRgb.mul(mask), mask))
  })()

  return mat
}

export function createHologramShadowMaterial(): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const p = vec2(st.x.sub(0.5).mul(2), st.y.sub(0.5).mul(2))
    const q = max(abs(p).sub(vec2(0.68, 0.58)), vec2(0, 0))
    const d = length(q)
    const alpha = float(1).sub(smoothstep(float(0.0), float(0.32), d)).mul(0.46)
    return premultipliedOutput(vec4(vec3(0.01, 0.02, 0.04).mul(alpha), alpha))
  })()

  return mat
}
