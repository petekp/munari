// Dichroic sundial & ray-projected caustic/typography shadow TSL materials
// (`SignatureSundial`).
//
// Two coupled shaders share the floating gnomon card's live DOM texture:
// 1. `createSundialCardMaterial`: Clear architectural crystal plate (`alpha 0.14..0.32`)
//    with directional solar bevel highlights so underlying shadows remain visible.
// 2. `createSundialProjectionMaterial`: Full-desk receiver plane (`raycast = noRaycast`)
//    casting crisp diagonal shadows of the top `<input>` headline alongside peak-normalized
//    stained-glass caustics with focal cusp filaments onto native HTML prose below.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type TextureNode } from 'three/webgpu'
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
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput, type SurfaceNodes } from '@petepetrash/munari'

const VOGEL_9: readonly (readonly [number, number])[] = Array.from({ length: 9 }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / 9)
  const theta = i * 2.399963229728653
  return [Math.cos(theta) * r, Math.sin(theta) * r] as const
})

export function createSundialUniforms() {
  return {
    deskSize: uniform(new THREE.Vector2(960, 560)),
    cardRectCss: uniform(new THREE.Vector4(36, 68, 346, 276)),
    sunShiftCss: uniform(new THREE.Vector2(368, 52)),
    sunDir3d: uniform(new THREE.Vector3(-0.76, 0.34, 0.55)),
    sunTint: uniform(new THREE.Color('#ffe8be')),
    cardReady: uniform(0),
    cornerRadius: uniform(18),
  }
}

export type SundialUniforms = ReturnType<typeof createSundialUniforms>

export function createSundialCardMaterial(
  surface: SurfaceNodes,
  u: SundialUniforms,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const size = max(vec2(u.cardRectCss.z, u.cardRectCss.w), vec2(1, 1))
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

    const safeOutGrad = outside.div(max(outLen, float(0.0001)))
    const inGrad = vec2(
      q.x.greaterThan(q.y).select(float(1), float(0)),
      q.x.greaterThan(q.y).select(float(0), float(1)),
    )
    const signP = vec2(
      pCss.x.greaterThanEqual(0).select(float(1), float(-1)),
      pCss.y.greaterThanEqual(0).select(float(1), float(-1)),
    )
    const grad2 = outLen.greaterThan(0.001).select(safeOutGrad, inGrad).mul(signP)

    // 13 px architectural crystal bevel catching solar angle while keeping interior clear (`0.14..0.32`)
    const rimT = smoothstep(float(-13), float(0), sdf)
    const normal = normalize(vec3(grad2.x.mul(rimT), grad2.y.negate().mul(rimT), float(1)))
    const lightDir = normalize(u.sunDir3d)
    const halfV = normalize(lightDir.add(vec3(0, 0, 1)))
    const spec = pow(max(dot(normal, halfV), float(0.0001)), float(44)).mul(0.75)
    const rimHairline = smoothstep(float(-1.8), float(-0.1), sdf).mul(0.36)

    const sunVec = vec3(u.sunTint.r, u.sunTint.g, u.sunTint.b)
    const glassBase = vec3(0.99, 0.99, 0.985).mul(sunVec.mul(0.22).add(0.78))
    const glassAlpha = mix(float(0.14), float(0.32), rimT)

    const fg = surface.map.sample(st)
    const outAlpha = clamp(fg.a.add(glassAlpha.mul(float(1).sub(fg.a))), float(0), float(1)).mul(mask)
    const outRgb = clamp(
      fg.rgb
        .add(glassBase.mul(glassAlpha).mul(float(1).sub(fg.a)))
        .add(sunVec.mul(spec.add(rimHairline)).mul(mask)),
      vec3(0),
      vec3(1),
    )

    return premultipliedOutput(vec4(outRgb.mul(mask), outAlpha))
  })()

  return mat
}

export function createSundialProjectionMaterial(
  cardMap: TextureNode,
  u: SundialUniforms,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const deskSize = max(u.deskSize, vec2(1, 1))
    const deskCss = vec2(st.x.mul(deskSize.x), float(1).sub(st.y).mul(deskSize.y))

    const cardMin = vec2(u.cardRectCss.x, u.cardRectCss.y)
    const cardSize = max(vec2(u.cardRectCss.z, u.cardRectCss.w), vec2(4, 4))
    const cardHalf = cardSize.mul(0.5)
    const cardCenter = cardMin.add(cardHalf)
    const r = min(u.cornerRadius, min(cardHalf.x, cardHalf.y).sub(1))
    const b = cardHalf.sub(r)

    // Back-project from paper desk along the sun ray to the elevated gnomon card
    const hitCenterCss = deskCss.sub(u.sunShiftCss)
    const shiftLen = length(u.sunShiftCss)
    const safeShiftDir = u.sunShiftCss.div(max(shiftLen, float(1)))
    const inkPenumbraPx = float(0.55).add(shiftLen.mul(0.0028))
    const causticSpreadPx = float(3.2).add(shiftLen.mul(0.011))

    // Restrict sharp dark typography shadows strictly to the bold `<input>` headline band (`y = 32..88 px`),
    // omitting the 10px kicker above it and the checkbox/row UI below it.
    const headlineMinY = float(32)
    const headlineMaxY = float(88)
    const filterMinY = float(94)

    let shadowAcc: Node<'float'> = float(0)
    let causticRgbAcc: Node<'vec3'> = vec3(0, 0, 0)
    let causticWeightAcc: Node<'float'> = float(0)

    for (const [vx, vy] of VOGEL_9) {
      const inkSampleCss = hitCenterCss.add(vec2(inkPenumbraPx.mul(vx), inkPenumbraPx.mul(vy)))
      const qInk = abs(inkSampleCss.sub(cardCenter)).sub(b)
      const sdfInk = length(max(qInk, vec2(0, 0))).add(min(max(qInk.x, qInk.y), float(0))).sub(r)
      const inCardInk = float(1).sub(smoothstep(float(-0.9), float(0.9), sdfInk))

      const localInkY = inkSampleCss.y.sub(cardMin.y)
      const inHeadlineZone = smoothstep(headlineMinY.sub(4), headlineMinY.add(2), localInkY).mul(
        float(1).sub(smoothstep(headlineMaxY.sub(4), headlineMaxY.add(4), localInkY)),
      )

      const iu = clamp(inkSampleCss.x.sub(cardMin.x).div(cardSize.x), float(0.002), float(0.998))
      const iv = clamp(float(1).sub(localInkY.div(cardSize.y)), float(0.002), float(0.998))
      const inkTex = cardMap.sample(vec2(iu, iv))
      const inkStraight = inkTex.rgb.div(max(inkTex.a, float(0.02)))
      const inkLuma = dot(inkStraight, vec3(0.2126, 0.7152, 0.0722))

      // Crisp solar shadow for bold display `<input>` letters + outer crystal bevel frame
      const isDarkHeadline = float(1)
        .sub(smoothstep(float(0.08), float(0.36), inkLuma))
        .mul(inHeadlineZone)
      const inkBlock = inkTex.a.mul(isDarkHeadline).mul(0.64)
      const rimBand = smoothstep(float(-12), float(0), sdfInk).mul(0.12)
      const frameShade = float(0.035).add(rimBand).add(inkBlock).mul(inCardInk)

      // Sample wider optical cone for stained-glass filter panes (`y >= 94 px`)
      const causticCss = hitCenterCss.add(vec2(causticSpreadPx.mul(vx), causticSpreadPx.mul(vy)))
      const qCaus = abs(causticCss.sub(cardCenter)).sub(b)
      const sdfCaus = length(max(qCaus, vec2(0, 0))).add(min(max(qCaus.x, qCaus.y), float(0))).sub(r)
      const inCardCaus = float(1).sub(smoothstep(float(-1.8), float(1.8), sdfCaus))
      const localCausY = causticCss.y.sub(cardMin.y)
      const inFilterZone = smoothstep(filterMinY.sub(4), filterMinY.add(6), localCausY)

      // Sample the unobstructed glass window (`x = 64%`, between row title and swatch pill)
      // so every active filter casts a pure, streak-free stained-glass ribbon!
      const rawCu = clamp(causticCss.x.sub(cardMin.x).div(cardSize.x), float(0.004), float(0.996))
      const ribbonCu = mix(rawCu, float(0.64), float(0.88))
      const cv = clamp(float(1).sub(localCausY.div(cardSize.y)), float(0.004), float(0.996))
      const cTex = cardMap.sample(vec2(ribbonCu, cv))

      // Compensate premultiplied sRGB EOTF (`linear * a^2.2`) by normalizing against peak channel
      const peakChan = max(cTex.r, max(cTex.g, max(cTex.b, float(0.004))))
      const normHue = cTex.rgb.div(peakChan)
      const minChan = min(normHue.r, min(normHue.g, normHue.b))
      const huePurity = float(1).sub(minChan)

      const isDichroic = smoothstep(float(0.28), float(0.58), huePurity)
        .mul(smoothstep(float(0.18), float(0.45), cTex.a))
        .mul(inCardCaus)
        .mul(inFilterZone)

      shadowAcc = shadowAcc.add(frameShade.mul(float(1).sub(isDichroic.mul(0.85))))
      causticRgbAcc = causticRgbAcc.add(normHue.mul(isDichroic))
      causticWeightAcc = causticWeightAcc.add(isDichroic)
    }

    const inv9 = float(1 / 9)
    const shadowAlpha = clamp(shadowAcc.mul(inv9), float(0), float(0.66))
    const rawCaustic = causticWeightAcc.mul(inv9)
    const avgHue = causticRgbAcc.div(max(causticWeightAcc, float(0.001)))
    const huePeak = max(avgHue.r, max(avgHue.g, max(avgHue.b, float(0.01))))
    const vividHue = clamp(avgHue.div(huePeak), vec3(0), vec3(1))

    // Optical caustic wave convergence filaments inside each stained-glass beam
    const waveA = sin(hitCenterCss.x.mul(0.055).add(hitCenterCss.y.mul(0.09)))
    const waveB = sin(hitCenterCss.x.mul(-0.042).add(hitCenterCss.y.mul(0.13)).add(1.7))
    const cuspFilament = pow(clamp(waveA.mul(0.5).add(waveB.mul(0.5)).mul(0.5).add(0.5), float(0), float(1)), float(3.2))
    const causticEnergy = clamp(rawCaustic.mul(float(0.62).add(cuspFilament.mul(0.38))), float(0), float(0.78))

    // Prismatic RGB caustic rim focused along the projected perimeter of the crystal bevel
    const dispVec = safeShiftDir.mul(2.8)
    const qR = abs(hitCenterCss.sub(dispVec).sub(cardCenter)).sub(b)
    const qG = abs(hitCenterCss.sub(cardCenter)).sub(b)
    const qB = abs(hitCenterCss.add(dispVec).sub(cardCenter)).sub(b)
    const sdfR = length(max(qR, vec2(0, 0))).add(min(max(qR.x, qR.y), float(0))).sub(r)
    const sdfG = length(max(qG, vec2(0, 0))).add(min(max(qG.x, qG.y), float(0))).sub(r)
    const sdfB = length(max(qB, vec2(0, 0))).add(min(max(qB.x, qB.y), float(0))).sub(r)
    const rimR = smoothstep(float(-10), float(-2.0), sdfR).mul(float(1).sub(smoothstep(float(-2.0), float(3.5), sdfR)))
    const rimG = smoothstep(float(-10), float(-2.0), sdfG).mul(float(1).sub(smoothstep(float(-2.0), float(3.5), sdfG)))
    const rimB = smoothstep(float(-10), float(-2.0), sdfB).mul(float(1).sub(smoothstep(float(-2.0), float(3.5), sdfB)))
    const prismRimRgb = vec3(rimR.mul(1.0), rimG.mul(0.92), rimB.mul(1.08)).mul(0.28)
    const prismRimAlpha = max(rimR, max(rimG, rimB)).mul(0.14)

    const sunVec = vec3(u.sunTint.r, u.sunTint.g, u.sunTint.b)
    const shadowInkRgb = vec3(0.05, 0.045, 0.065).mul(shadowAlpha)

    // Keep premultiplied caustic emission strictly bounded (`<= causticAlpha`) so sunlit white paper
    // tints into luminous stained-glass color while dark `#26231e` native prose stays dark and crisp!
    const causticAlpha = causticEnergy.mul(0.34)
    const stainedPremul = vividHue
      .mul(sunVec)
      .mul(causticAlpha.mul(0.92))
      .add(prismRimRgb.mul(sunVec))

    const totalAlpha = clamp(
      shadowAlpha.add(causticAlpha).add(prismRimAlpha).mul(u.cardReady),
      float(0),
      float(0.72),
    )
    const premulRgb = clamp(shadowInkRgb.add(stainedPremul).mul(u.cardReady), vec3(0), vec3(1))

    return premultipliedOutput(vec4(premulRgb, totalAlpha))
  })()

  return mat
}
