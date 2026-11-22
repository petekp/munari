// Optical Liquid-Crystal Cmd+K TSL materials (`FrontierCmdk`).
//
// Separates the two physical regimes cleanly so neither compromises the other:
// 1. Outer 16 px convex crystal meniscus (`cornerRadius = 26 px`, keeping a
//    10 px inner radius with zero 90-degree corner pinch): jewel-like outer ~6 px
//    5-tap 1D spectral Snell bevel (`d(sample)/d(pixel) > 0` everywhere) that melts
//    smoothly into satin frost well before reaching the 18 px padded UI well.
// 2. Inner calm frosted reading well: 16-tap symmetric concentric Gaussian kernel
//    at `mip 4.35` with pure neutral scalar weights (zero RGB stippling!) plus
//    high-pass neutral-ink lift so dark text underneath melts into clean crystal
//    while chromatic color fields bloom vividly.
// 3. True sRGB-unpremultiplied foreground ink decode (`surfaceOutput.ts`) so
//    translucent white UI capsules stay luminous crystal white rather than turning
//    dingy gray when composited over the glass housing, plus multiplicative ND
//    transmission (`0.062x` on Smoked Quartz) before Fresnel and diamond specular.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type TextureNode } from 'three/webgpu'
import {
  abs,
  clamp,
  dot,
  float,
  Fn,
  fwidth,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  refract,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  smoothstep,
  sqrt,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput, type SurfaceNodes } from '@petepetrash/munari'

export const CMDK_SHADOW_PAD = 84

export type CmdkLensId = 'crown' | 'flint' | 'smoked'

export interface CmdkLensTuning {
  readonly label: string
  readonly specReadout: string
  readonly ior: number
  readonly spreadPx: number
  readonly dispersion: number
  readonly frostRadiusPx: number
  readonly frostMip: number
  readonly transmissionScale: number
  readonly tintHex: string
  readonly tintAmount: number
  readonly chromaBoost: number
  readonly inkLift: number
  readonly edgeReflect: number
  readonly edgeLight: number
  readonly specular: number
}

export const CMDK_LENSES = {
  crown: {
    label: 'Crown crystal',
    specReadout: 'Crown Crystal · n = 1.52',
    ior: 1.52,
    spreadPx: 18.5,
    dispersion: 0.11,
    frostRadiusPx: 30,
    frostMip: 4.35,
    transmissionScale: 1.0,
    tintHex: '#fcfbf9',
    tintAmount: 0.64,
    chromaBoost: 1.32,
    inkLift: 0.72,
    edgeReflect: 0.42,
    edgeLight: 0.18,
    specular: 0.48,
  },
  flint: {
    label: 'Flint prism',
    specReadout: 'Flint Prism · n = 1.68',
    ior: 1.68,
    spreadPx: 19.5,
    dispersion: 0.28,
    frostRadiusPx: 28,
    frostMip: 4.25,
    transmissionScale: 1.0,
    tintHex: '#fbfaf7',
    tintAmount: 0.56,
    chromaBoost: 1.42,
    inkLift: 0.68,
    edgeReflect: 0.50,
    edgeLight: 0.24,
    specular: 0.60,
  },
  smoked: {
    label: 'Smoked quartz',
    specReadout: 'Smoked Quartz · n = 1.58',
    ior: 1.58,
    spreadPx: 19.0,
    dispersion: 0.16,
    frostRadiusPx: 32,
    frostMip: 4.45,
    // True optical neutral-density absorption (`~6.2%` linear transmission) keeps Smoked Quartz
    // deep `#171a24` obsidian even directly over `#f6f4ee` white paper!
    transmissionScale: 0.062,
    tintHex: '#12151f',
    tintAmount: 0.74,
    chromaBoost: 1.65,
    inkLift: 0.45,
    edgeReflect: 0.24,
    edgeLight: 0.20,
    specular: 0.54,
  },
} as const satisfies Record<CmdkLensId, CmdkLensTuning>

// Symmetric 16-tap 2-ring Gaussian stencil (`8` inner ring + `8` outer ring) —
// isotropic, zero directional bias, and weighted strictly with neutral scalars.
const FROST_GAUSS_16: readonly (readonly [number, number, number])[] = [
  ...Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4
    return [Math.cos(a) * 0.46, Math.sin(a) * 0.46, 0.078] as const
  }),
  ...Array.from({ length: 8 }, (_, i) => {
    const a = ((i + 0.5) * Math.PI) / 4
    return [Math.cos(a) * 0.94, Math.sin(a) * 0.94, 0.047] as const
  }),
]

const PRISM_TAPS = 5

function spectralWeight(f: number): Node<'vec3'> {
  return max(
    vec3(
      float(1).sub(smoothstep(0, 0.62, f)),
      float(1).sub(abs(float(f).sub(0.5)).mul(2)),
      smoothstep(0.38, 1, f),
    ),
    vec3(0),
  )
}

export function createCmdkUniforms() {
  const d = CMDK_LENSES.crown
  return {
    panelRectCss: uniform(new THREE.Vector4(200, 74, 548, 356)),
    bgSizeCss: uniform(new THREE.Vector2(960, 640)),
    lightDeltaCss: uniform(new THREE.Vector3(-240, -220, 440)),
    cornerRadius: uniform(26),
    bevelWidth: uniform(16),
    ior: uniform(d.ior),
    spreadPx: uniform(d.spreadPx),
    dispersion: uniform(d.dispersion),
    frostRadiusPx: uniform(d.frostRadiusPx),
    frostMip: uniform(d.frostMip),
    transmissionScale: uniform(d.transmissionScale),
    tintColor: uniform(new THREE.Color(d.tintHex)),
    tintAmount: uniform(d.tintAmount),
    chromaBoost: uniform(d.chromaBoost),
    inkLift: uniform(d.inkLift),
    edgeReflect: uniform(d.edgeReflect),
    edgeLight: uniform(d.edgeLight),
    specular: uniform(d.specular),
    elevation: uniform(24),
    shadowOpacity: uniform(0.20),
    bgReady: uniform(0),
  }
}

export type CmdkUniforms = ReturnType<typeof createCmdkUniforms>

export function applyCmdkLens(u: CmdkUniforms, lens: CmdkLensId): void {
  const t = CMDK_LENSES[lens]
  u.ior.value = t.ior
  u.spreadPx.value = t.spreadPx
  u.dispersion.value = t.dispersion
  u.frostRadiusPx.value = t.frostRadiusPx
  u.frostMip.value = t.frostMip
  u.transmissionScale.value = t.transmissionScale
  u.tintColor.value.set(t.tintHex)
  u.tintAmount.value = t.tintAmount
  u.chromaBoost.value = t.chromaBoost
  u.inkLift.value = t.inkLift
  u.edgeReflect.value = t.edgeReflect
  u.edgeLight.value = t.edgeLight
  u.specular.value = t.specular
}

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
    const size = max(vec2(u.panelRectCss.z, u.panelRectCss.w), vec2(1, 1))
    const bgSize = max(u.bgSizeCss, vec2(1, 1))
    const halfSize = size.mul(0.5)

    const p = vec2(st.x.sub(0.5).mul(size.x), float(0.5).sub(st.y).mul(size.y))
    const panelPixelCss = vec2(
      u.panelRectCss.x.add(st.x.mul(size.x)),
      u.panelRectCss.y.add(float(1).sub(st.y).mul(size.y)),
    )

    const r = min(u.cornerRadius, min(halfSize.x, halfSize.y).sub(1))
    const d = abs(p).sub(halfSize.sub(r))
    const sdf = min(max(d.x, d.y), float(0)).add(length(max(d, vec2(0, 0)))).sub(r)
    const aa = max(fwidth(sdf), float(0.65))
    const cov = float(1).sub(smoothstep(aa.negate(), aa, sdf))

    // Exact outward unit gradient (`+X` right, `+Y` down)
    const sx = p.x.greaterThanEqual(0).select(float(1), float(-1))
    const sy = p.y.greaterThanEqual(0).select(float(1), float(-1))
    const gradCss = d.x
      .greaterThan(0)
      .and(d.y.greaterThan(0))
      .select(
        vec2(sx, sy).mul(normalize(max(d, vec2(0.0001, 0.0001)))),
        d.x.greaterThan(d.y).select(vec2(sx, float(0)), vec2(float(0), sy)),
      )

    // Strictly magnifying convex optical meniscus (`bevelWidth = 16 px` inside `r = 26 px` ->
    // 10 px smooth inner radius; `pow(k, 1.55) * 0.78` with `spreadPx = 18..19` keeps radial
    // Jacobian `d(sample)/d(pixel) > 0` everywhere so edges magnify upright without folding)
    const bevelW = max(u.bevelWidth, float(6))
    const e = clamp(sdf.negate().div(bevelW), float(0), float(1))
    const k = float(1).sub(e)
    const sinTheta = pow(max(k, float(0.0001)), float(1.55))
      .mul(0.78)
      .mul(k.greaterThan(0.001).select(float(1), float(0)))
    const cosTheta = sqrt(max(float(1).sub(sinTheta.mul(sinTheta)), float(0.08)))
    const normal = vec3(gradCss.x.mul(sinTheta), gradCss.y.negate().mul(sinTheta), cosTheta)
    const viewRay = vec3(0, 0, -1)

    // Regime 1: 5-tap 1D spectral Snell refraction for the outer jewel bevel (`mip 0..1.4`
    // progressive optical defocus inward so prose lines never clutter the UI footer)
    const rimMip = smoothstep(float(0.08), float(0.58), e).mul(1.6)
    let rimAcc: Node<'vec3'> = vec3(0, 0, 0)
    let rimW: Node<'vec3'> = vec3(0, 0, 0)
    for (let i = 0; i < PRISM_TAPS; i++) {
      const f = (i + 0.5) / PRISM_TAPS
      const iorSample = max(u.ior.add(float((f - 0.5) * 2).mul(u.dispersion)), float(1.02))
      const bent = refract(viewRay, normal, float(1).div(iorSample))
      const refractCss = vec2(bent.x, bent.y.negate()).mul(u.spreadPx)
      const rimCss = panelPixelCss.add(refractCss)
      const rimUv = clamp(
        vec2(rimCss.x.div(bgSize.x), float(1).sub(rimCss.y.div(bgSize.y))),
        vec2(0.002, 0.002),
        vec2(0.998, 0.998),
      )
      const w = spectralWeight(f)
      rimAcc = rimAcc.add(bgMap.sample(rimUv).level(rimMip).rgb.mul(w))
      rimW = rimW.add(w)
    }
    const sharpRimRgb = rimAcc.div(max(rimW, vec3(0.0001)))

    // Regime 2: 16-tap symmetric neutral Gaussian frost (`mip 4.35`) aligned to the exact same
    // center ray (`1.0 * spreadPx`) so `mix(sharpRimRgb, vibrantFrost)` has zero double-image seam!
    const centerBent = refract(viewRay, normal, float(1).div(max(u.ior, float(1.02))))
    const baseRefractCss = vec2(centerBent.x, centerBent.y.negate()).mul(u.spreadPx)
    let frostAcc: Node<'vec3'> = vec3(0, 0, 0)
    for (const [gx, gy, gw] of FROST_GAUSS_16) {
      const sampleCss = panelPixelCss
        .add(baseRefractCss)
        .add(vec2(u.frostRadiusPx.mul(gx), u.frostRadiusPx.mul(gy)))
      const sampleUv = clamp(
        vec2(sampleCss.x.div(bgSize.x), float(1).sub(sampleCss.y.div(bgSize.y))),
        vec2(0.002, 0.002),
        vec2(0.998, 0.998),
      )
      frostAcc = frostAcc.add(bgMap.sample(sampleUv).level(u.frostMip).rgb.mul(gw))
    }

    // High-pass neutral-ink lift + vibrancy boost inside the frosted reading well:
    // melts dark grey text shadows into clean crystal while saturating color fields!
    const frostLuma = dot(frostAcc, vec3(0.2126, 0.7152, 0.0722))
    const maxC = max(frostAcc.r, max(frostAcc.g, frostAcc.b))
    const minC = min(frostAcc.r, min(frostAcc.g, frostAcc.b))
    const frostChroma = maxC.sub(minC)
    const isNeutralDark = float(1)
      .sub(smoothstep(float(0.04), float(0.24), frostChroma))
      .mul(float(1).sub(smoothstep(float(0.35), float(0.85), frostLuma)))
    const liftedFrost = mix(frostAcc, vec3(0.92, 0.915, 0.90), isNeutralDark.mul(u.inkLift))
    const liftedLuma = dot(liftedFrost, vec3(0.2126, 0.7152, 0.0722))
    const vibrantFrost = clamp(mix(vec3(liftedLuma), liftedFrost, u.chromaBoost), vec3(0), vec3(1))

    // Keep outer ~6 px chamfer crystal-sharp, melting smoothly into satin frost by ~9.5 px
    // (well outside the 16-20 px UI padding so prose lines never compete with footer copy!)
    const frostBlend = smoothstep(float(0.16), float(0.58), e)
    const rawTransmitted = mix(sharpRimRgb, vibrantFrost, frostBlend)

    const fallbackTint = vec3(u.tintColor.r, u.tintColor.g, u.tintColor.b)
    // Apply optical ND transmission (`0.062x` on Smoked Quartz) BEFORE surface Fresnel & specular!
    const scaledTransmitted = mix(fallbackTint, rawTransmitted.mul(u.transmissionScale), u.bgReady)
    const wellVeil = u.tintAmount.mul(mix(float(0.08), float(1.0), smoothstep(float(0.18), float(0.88), e)))
    const tintedGlass = mix(scaledTransmitted, fallbackTint, wellVeil)

    // Borrowed grazing Fresnel reflection of the surrounding scene along the curved outer meniscus
    const fres = pow(clamp(float(1).sub(cosTheta), float(0), float(1)), float(3.8))
    const reflCss = panelPixelCss.add(gradCss.mul(14))
    const reflUv = clamp(
      vec2(reflCss.x.div(bgSize.x), float(1).sub(reflCss.y.div(bgSize.y))),
      vec2(0.002, 0.002),
      vec2(0.998, 0.998),
    )
    const envRefl = mix(fallbackTint, bgMap.sample(reflUv).level(float(1.6)).rgb, u.bgReady)
    const withFresnel = mix(tintedGlass, envRefl, clamp(fres.mul(u.edgeReflect), float(0), float(0.55)))

    // Dual-lobe Leica optical specular: razor-thin `pow(210)` diamond rim arc + subtle counter-glint
    const lightVec = normalize(
      vec3(u.lightDeltaCss.x.sub(p.x), u.lightDeltaCss.y.negate().add(p.y), max(u.lightDeltaCss.z, float(160))),
    )
    const halfVec = normalize(lightVec.add(vec3(0, 0, 1)))
    const specPrimary = pow(max(dot(normal, halfVec), float(0.0001)), float(210)).mul(u.specular.mul(1.35))
    const counterDir = normalize(vec3(lightVec.x.negate(), lightVec.y.negate(), float(0.85)))
    const counterHalf = normalize(counterDir.add(vec3(0, 0, 1)))
    const specCounter = pow(max(dot(normal, counterHalf), float(0.0001)), float(130)).mul(0.14)

    // Crisp 1.15 px outermost piped-light hairline + delicate top-lit bevel gleam
    const pipedBand = float(1).sub(smoothstep(float(0.0), float(0.09), e))
    const topRimGleam = smoothstep(float(-1.4), float(-0.2), sdf)
      .mul(clamp(gradCss.y.negate().mul(0.5).add(0.5), float(0.12), float(1.0)))
      .mul(0.10)

    const housingRgb = withFresnel
      .mul(float(1).add(pipedBand.mul(u.edgeLight).mul(float(0.35).add(fres))))
      .add(vec3(1.0, 0.995, 0.98).mul(specPrimary.add(specCounter).add(topRimGleam)))

    // `surface.map` stores browser-premultiplied sRGB (`srgb = C_srgb * a`), so hardware sRGB
    // texture sampling yields `EOTF(C_srgb * a)` instead of `EOTF(C_srgb) * a` (`surfaceOutput.ts`).
    // Unpremultiply in sRGB before `EOTF` so translucent white capsules stay radiant white!
    const fg = surface.map.sample(st)
    // SAFETY: Three declares `sRGBTransferOETF` layout as vec3 -> vec3; published types leave return untyped.
    const fgSrgbPremul = sRGBTransferOETF(fg.rgb) as Node<'vec3'>
    // SAFETY: Three declares `sRGBTransferEOTF` layout as vec3 -> vec3; published types leave return untyped.
    const fgStraightLin = sRGBTransferEOTF(fgSrgbPremul.div(max(fg.a, float(1e-5)))) as Node<'vec3'>
    const fgLinearPremul = fgStraightLin.mul(fg.a)
    const compositeRgb = clamp(fgLinearPremul.add(housingRgb.mul(float(1).sub(fg.a))), vec3(0), vec3(1))
    return premultipliedOutput(vec4(compositeRgb.mul(cov), cov))
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
    const cardSize = vec2(u.panelRectCss.z, u.panelRectCss.w)
    const totalSize = cardSize.add(pad.mul(2))
    const p = vec2(st.x.sub(0.5).mul(totalSize.x), float(0.5).sub(st.y).mul(totalSize.y))

    const halfCard = cardSize.mul(0.5)
    const r = min(u.cornerRadius, min(halfCard.x, halfCard.y).sub(1))

    const lz = max(u.lightDeltaCss.z, float(180))
    const rawShift = vec2(u.lightDeltaCss.x.negate(), u.lightDeltaCss.y.negate()).mul(u.elevation.div(lz))
    const shiftLen = length(rawShift)
    const shift = shiftLen
      .greaterThan(32)
      .select(rawShift.mul(float(32).div(max(shiftLen, float(0.001)))), rawShift)

    const b = halfCard.sub(r)
    const q = abs(p.sub(shift)).sub(b)
    const sdfShadow = length(max(q, vec2(0, 0))).add(min(max(q.x, q.y), float(0))).sub(r)

    const qSelf = abs(p).sub(b)
    const sdfSelf = length(max(qSelf, vec2(0, 0))).add(min(max(qSelf.x, qSelf.y), float(0))).sub(r)
    const outsideBody = smoothstep(float(-0.4), float(1.0), sdfSelf)

    // Grounded two-layer studio shadow: tight 7.5 px perimeter contact occlusion + soft directional penumbra
    const contact = float(1).sub(smoothstep(float(0.0), float(7.5), sdfSelf)).mul(0.18)
    const penumbra = max(float(24), u.elevation.mul(1.5))
    const cast = float(1).sub(smoothstep(penumbra.mul(-0.3), penumbra, sdfShadow)).mul(u.shadowOpacity)

    const edgeDist = min(
      min(st.x.mul(totalSize.x), float(1).sub(st.x).mul(totalSize.x)),
      min(st.y.mul(totalSize.y), float(1).sub(st.y).mul(totalSize.y)),
    )
    const skirtFade = smoothstep(float(0), float(26), edgeDist)

    const shadowAlpha = clamp(cast.add(contact).mul(outsideBody).mul(skirtFade), float(0), float(0.42))
    const rgb = vec3(0.025, 0.032, 0.052).mul(shadowAlpha)
    return premultipliedOutput(vec4(rgb, shadowAlpha))
  })()

  return mat
}
