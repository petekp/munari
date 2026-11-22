// Refractive polymer Cmd+K nodes — crystal-clear 30 px outer Snell bevel with RGB
// prism dispersion surrounding a calm frosted interior well, plus caustic shadow skirt.
//
// Optical law: `bodyOpacity` is ~0.58 in the flat interior for WCAG text contrast and
// drops to ~0.06 across the curved outer rim (`rimT -> 1`) so bent background rules
// and chromatic fringes shine through unoccluded.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type TextureNode } from 'three/webgpu'
import {
  abs,
  clamp,
  dot,
  float,
  Fn,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput, type SurfaceNodes } from '@petepetrash/munari'

export const CMDK_SHADOW_PAD = 92

export function createCmdkUniforms() {
  return {
    panelSize: uniform(new THREE.Vector2(520, 360)),
    bgUvRect: uniform(new THREE.Vector4(0.15, 0.2, 0.5, 0.5)),
    bgTexAspect: uniform(1.4),
    lightDeltaCss: uniform(new THREE.Vector3(-220, -240, 440)),
    cornerRadius: uniform(24),
    bevelWidth: uniform(30),
    refractStrength: uniform(0.115),
    dispersion: uniform(0.44),
    frostRadius: uniform(0.0058),
    polymerOpacity: uniform(0.60),
    elevation: uniform(26),
    shadowOpacity: uniform(0.22),
    tintColor: uniform(new THREE.Color('#fbfaf7')),
  }
}

export type CmdkUniforms = ReturnType<typeof createCmdkUniforms>

export function createCmdkMaterial(
  surface: SurfaceNodes,
  bgMap: TextureNode,
  u: CmdkUniforms,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const size = max(u.panelSize, vec2(1, 1))
    const halfSize = size.mul(0.5)
    const p = vec2(st.x.sub(0.5).mul(size.x), float(0.5).sub(st.y).mul(size.y))

    const r = min(u.cornerRadius, min(halfSize.x, halfSize.y).sub(1))
    const b = halfSize.sub(r)
    const q = abs(p).sub(b)
    const outside = max(q, vec2(0, 0))
    const outLen = length(outside)
    const sdf = outLen.add(min(max(q.x, q.y), float(0))).sub(r)
    const mask = float(1).sub(smoothstep(float(-0.8), float(0.8), sdf))

    const safeOutGrad = outside.div(max(outLen, float(0.0001)))
    const inGrad = vec2(
      q.x.greaterThan(q.y).select(float(1), float(0)),
      q.x.greaterThan(q.y).select(float(0), float(1)),
    )
    const signP = vec2(
      p.x.greaterThanEqual(0).select(float(1), float(-1)),
      p.y.greaterThanEqual(0).select(float(1), float(-1)),
    )
    const grad2 = outLen.greaterThan(0.001).select(safeOutGrad, inGrad).mul(signP)

    const bevelW = max(u.bevelWidth, float(4))
    const rimT = smoothstep(bevelW.negate(), float(0), sdf)
    const clearBevel = smoothstep(float(0.08), float(0.88), rimT)
    const slope = rimT.mul(float(1.35))
    const normal = normalize(vec3(grad2.x.mul(slope), grad2.y.negate().mul(slope), float(1)))

    const baseBgUv = vec2(
      u.bgUvRect.x.add(st.x.mul(u.bgUvRect.z)),
      u.bgUvRect.y.add(st.y.mul(u.bgUvRect.w)),
    )

    // Aspect-corrected isotropic Snell rim bend + RGB chromatic dispersion
    const safeAspect = max(u.bgTexAspect, float(0.25))
    const bendDir = vec2(grad2.x.negate().div(safeAspect), grad2.y)
    const bendAmt = pow(max(rimT, float(0.0001)), float(1.35)).mul(u.refractStrength)
    const bend = bendDir.mul(bendAmt)

    const frost = u.frostRadius.mul(float(1).sub(clearBevel.mul(0.92)))
    const o1 = vec2(frost.div(safeAspect), frost)
    const o2 = vec2(frost.negate().div(safeAspect), frost)

    const uvR = clamp(baseBgUv.add(bend.mul(float(1).sub(u.dispersion))), vec2(0.002), vec2(0.998))
    const uvG = clamp(baseBgUv.add(bend), vec2(0.002), vec2(0.998))
    const uvB = clamp(baseBgUv.add(bend.mul(float(1).add(u.dispersion))), vec2(0.002), vec2(0.998))

    const centerG = bgMap.sample(uvG).rgb
    const tapA = bgMap.sample(clamp(uvG.add(o1), vec2(0.002), vec2(0.998))).rgb
    const tapB = bgMap.sample(clamp(uvG.sub(o1), vec2(0.002), vec2(0.998))).rgb
    const tapC = bgMap.sample(clamp(uvG.add(o2), vec2(0.002), vec2(0.998))).rgb
    const tapD = bgMap.sample(clamp(uvG.sub(o2), vec2(0.002), vec2(0.998))).rgb
    const frostedRgb = centerG.mul(0.28).add(tapA.add(tapB).add(tapC).add(tapD).mul(0.18))

    const dispersedRgb = vec3(
      bgMap.sample(uvR).r,
      bgMap.sample(uvG).g,
      bgMap.sample(uvB).b,
    )
    const refractedBg = mix(frostedRgb, dispersedRgb, clearBevel)

    const lightVec = normalize(
      vec3(u.lightDeltaCss.x.sub(p.x), u.lightDeltaCss.y.negate().add(p.y), max(u.lightDeltaCss.z, float(90))),
    )
    const halfVec = normalize(lightVec.add(vec3(0, 0, 1)))
    const ndotl = clamp(dot(normal, lightVec), float(-1), float(1))
    const spec = pow(max(dot(normal, halfVec), float(0.0001)), float(44)).mul(0.58)
    const fresnel = pow(max(rimT, float(0.0001)), float(3.2)).mul(0.32)

    // Subtle machined step hairline separating the 28 px crystal collar from the frosted well
    const innerStep = smoothstep(float(0.02), float(0.10), rimT)
      .mul(float(1).sub(smoothstep(float(0.10), float(0.20), rimT)))
      .mul(0.16)

    // Inverted opacity: calm frosted center (~0.60), crystal-clear bevel (~0.06)!
    const bodyOpacity = mix(u.polymerOpacity, float(0.06), clearBevel)
    const litTint = u.tintColor.mul(float(0.96).add(ndotl.mul(0.07)))
    const housingRgb = mix(refractedBg, litTint, bodyOpacity)
      .add(vec3(1, 0.99, 0.96).mul(spec.add(fresnel).add(innerStep)))
      .sub(vec3(0.14).mul(smoothstep(float(-1.8), float(0), sdf)))

    // Clamp linear RGB to [0, 1] BEFORE premultiplying by edge anti-aliasing `mask`
    const fg = surface.map.sample(st)
    const compositeRgb = clamp(fg.rgb.add(housingRgb.mul(float(1).sub(fg.a))), vec3(0), vec3(1))
    return premultipliedOutput(vec4(compositeRgb.mul(mask), mask))
  })()

  return mat
}

export function createCmdkShadowMaterial(u: CmdkUniforms): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const pad = float(CMDK_SHADOW_PAD)
    const totalSize = u.panelSize.add(pad.mul(2))
    const p = vec2(st.x.sub(0.5).mul(totalSize.x), float(0.5).sub(st.y).mul(totalSize.y))

    const halfCard = u.panelSize.mul(0.5)
    const r = min(u.cornerRadius, min(halfCard.x, halfCard.y).sub(1))

    const lz = max(u.lightDeltaCss.z, float(140))
    const rawShift = vec2(u.lightDeltaCss.x.negate(), u.lightDeltaCss.y.negate()).mul(u.elevation.div(lz))
    const shiftLen = length(rawShift)
    const shift = shiftLen.greaterThan(48).select(rawShift.mul(float(48).div(max(shiftLen, float(0.001)))), rawShift)

    const sp = p.sub(shift)
    const b = halfCard.sub(r)
    const q = abs(sp).sub(b)
    const sdfShadow = length(max(q, vec2(0, 0))).add(min(max(q.x, q.y), float(0))).sub(r)

    const qSelf = abs(p).sub(b)
    const sdfSelf = length(max(qSelf, vec2(0, 0))).add(min(max(qSelf.x, qSelf.y), float(0))).sub(r)
    const outsideBody = smoothstep(float(-1), float(3), sdfSelf)

    const penumbra = max(float(16), u.elevation.mul(1.3))
    const cast = float(1).sub(smoothstep(penumbra.mul(-0.3), penumbra, sdfShadow))
    const contact = float(1).sub(smoothstep(float(-1), float(9), sdfSelf))

    // Subtle focused caustic bright-band inside the shadow edge
    const causticBand = smoothstep(float(-6), float(4), sdfShadow)
      .mul(float(1).sub(smoothstep(float(4), float(18), sdfShadow)))
      .mul(outsideBody)
      .mul(0.14)

    const edgeDist = min(
      min(st.x.mul(totalSize.x), float(1).sub(st.x).mul(totalSize.x)),
      min(st.y.mul(totalSize.y), float(1).sub(st.y).mul(totalSize.y)),
    )
    const skirtFade = smoothstep(float(0), float(24), edgeDist)

    const shadowAlpha = clamp(
      cast.mul(u.shadowOpacity).add(contact.mul(0.12)).mul(outsideBody).mul(skirtFade),
      float(0),
      float(0.55),
    )
    const totalAlpha = clamp(shadowAlpha.add(causticBand.mul(skirtFade)), float(0), float(0.62))
    const rgb = vec3(0.03, 0.04, 0.06)
      .mul(shadowAlpha)
      .add(vec3(1, 0.97, 0.90).mul(causticBand.mul(skirtFade)))
    return premultipliedOutput(vec4(clamp(rgb, vec3(0), vec3(1)), totalAlpha))
  })()

  return mat
}
