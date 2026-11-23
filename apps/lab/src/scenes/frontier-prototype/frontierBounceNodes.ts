// Lateral light-bounce container nodes — dark Liquid-Glass Surface material that
// integrates chroma-weighted 2D lateral radiance, seam-aligned Vogel diffusion,
// and a crisp 1.25 px directional bevel catchlight from adjacent native HTML.
//
// Why CSS cannot do this: `backdrop-filter` only samples pixels at the same `(x, y)`
// directly behind an overlapping box. Adjacent navigation sidebars, toolbars, and
// inspectors have zero Z-overlap with center-stage content, so light transport must
// integrate across Stage CSS space (`worldCss -> emitterRectCss`) in linear light.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type TextureNode } from 'three/webgpu'
import {
  abs,
  clamp,
  dot,
  exp,
  float,
  Fn,
  length,
  max,
  min,
  mix,
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

export type BounceFinishId = 'satin' | 'obsidian' | 'frost'

export interface BounceFinishTuning {
  readonly label: string
  readonly shortPill: string
  readonly scatterGain: number
  readonly ambientGain: number
  readonly blurNormalPx: number
  readonly blurParallelPx: number
  readonly parallelRatio: number
  readonly roughnessScale: number
  readonly baseMip: number
  readonly falloffPx: number
  readonly spanSigmaPx: number
  readonly rimGain: number
  readonly chromaBoost: number
  readonly brushStrength: number
}

export const BOUNCE_FINISHES = {
  satin: {
    label: 'Liquid satin',
    shortPill: 'Satin',
    scatterGain: 1.04,
    ambientGain: 0.28,
    blurNormalPx: 44,
    blurParallelPx: 44,
    parallelRatio: 1.0,
    roughnessScale: 0.30,
    baseMip: 2.1,
    falloffPx: 146,
    spanSigmaPx: 44,
    rimGain: 0.94,
    chromaBoost: 1.38,
    brushStrength: 0,
  },
  obsidian: {
    label: 'Brushed anodized',
    shortPill: 'Anodized',
    scatterGain: 1.22,
    ambientGain: 0.16,
    blurNormalPx: 68,
    blurParallelPx: 12,
    parallelRatio: 0.20,
    roughnessScale: 0.22,
    baseMip: 1.35,
    falloffPx: 170,
    spanSigmaPx: 32,
    rimGain: 1.38,
    chromaBoost: 1.32,
    brushStrength: 0.06,
  },
  frost: {
    label: 'Deep acrylic',
    shortPill: 'Frost',
    scatterGain: 1.24,
    ambientGain: 0.44,
    blurNormalPx: 64,
    blurParallelPx: 64,
    parallelRatio: 1.0,
    roughnessScale: 0.44,
    baseMip: 2.65,
    falloffPx: 220,
    spanSigmaPx: 62,
    rimGain: 0.76,
    chromaBoost: 1.44,
    brushStrength: 0,
  },
} as const satisfies Record<BounceFinishId, BounceFinishTuning>

// Precomputed 12-tap Golden-Angle (`2.399963 rad`) Vogel disk offsets in `[-1, 1]^2`
const VOGEL_TAPS: readonly (readonly [number, number])[] = Array.from({ length: 12 }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / 12)
  const theta = i * 2.399963229728653
  return [Math.cos(theta) * r, Math.sin(theta) * r] as const
})

const QUADRANT_TAPS = [0.25, 0.75] as const

export function createBounceUniforms(cornerRadius = 18) {
  const d = BOUNCE_FINISHES.satin
  return {
    panelRectCss: uniform(new THREE.Vector4(8, 8, 216, 560)),
    emitterRectCss: uniform(new THREE.Vector4(290, 110, 512, 356)),
    emitterReady: uniform(0),
    emitBoost: uniform(1),
    cornerRadius: uniform(cornerRadius),
    scatterGain: uniform(d.scatterGain),
    ambientGain: uniform(d.ambientGain),
    blurNormalPx: uniform(d.blurNormalPx),
    blurParallelPx: uniform(d.blurParallelPx),
    parallelRatio: uniform(d.parallelRatio),
    roughnessScale: uniform(d.roughnessScale),
    baseMip: uniform(d.baseMip),
    falloffPx: uniform(d.falloffPx),
    spanSigmaPx: uniform(d.spanSigmaPx),
    rimGain: uniform(d.rimGain),
    chromaBoost: uniform(d.chromaBoost),
    brushStrength: uniform(d.brushStrength),
    baseColor: uniform(new THREE.Color('#191b20')),
  }
}

export type BounceUniforms = ReturnType<typeof createBounceUniforms>

export function applyBounceFinish(u: BounceUniforms, finish: BounceFinishId, boost: number): void {
  const t = BOUNCE_FINISHES[finish]
  u.scatterGain.value = t.scatterGain
  u.ambientGain.value = t.ambientGain
  u.blurNormalPx.value = t.blurNormalPx
  u.blurParallelPx.value = t.blurParallelPx
  u.parallelRatio.value = t.parallelRatio
  u.roughnessScale.value = t.roughnessScale
  u.baseMip.value = t.baseMip
  u.falloffPx.value = t.falloffPx
  u.spanSigmaPx.value = t.spanSigmaPx
  u.rimGain.value = t.rimGain
  u.chromaBoost.value = t.chromaBoost
  u.brushStrength.value = t.brushStrength
  u.emitBoost.value = boost
}

export function createBounceMaterial(
  surface: SurfaceNodes,
  emitterMap: TextureNode,
  u: BounceUniforms,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const size = max(vec2(u.panelRectCss.z, u.panelRectCss.w), vec2(1, 1))
    const halfSize = size.mul(0.5)
    // CSS pixel space inside the container (+x right, +y down)
    const localCss = vec2(st.x.mul(size.x), float(1).sub(st.y).mul(size.y))
    const pCss = localCss.sub(halfSize)
    const worldCss = vec2(u.panelRectCss.x, u.panelRectCss.y).add(localCss)

    // Rounded-box SDF used strictly for silhouette anti-aliasing & 1.25 px outer rim
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

    const emitMin = vec2(u.emitterRectCss.x, u.emitterRectCss.y)
    const emitSize = max(vec2(u.emitterRectCss.z, u.emitterRectCss.w), vec2(8, 8))
    const emitMax = emitMin.add(emitSize)

    const closestCss = clamp(worldCss, emitMin, emitMax)
    const seamVec = closestCss.sub(worldCss)
    const distToEmit = length(seamVec)
    const dirToEmit = seamVec.div(max(distToEmit, float(0.001)))
    const perpDir = vec2(dirToEmit.y.negate(), dirToEmit.x)

    // Out-of-span overshoot is measured along the seam only: vertical for a pane beside
    // the emitter, horizontal for one above or below it. `min(dxOut, dyOut)` creased
    // the reflection along the 45° diagonal from each emitter corner (Pete, 2026-11-22):
    // sidebar points above the emitter's top took the small horizontal distance, so
    // light ran up the seam edge and left a dark wedge beside it.
    const panelMin = vec2(u.panelRectCss.x, u.panelRectCss.y)
    const panelMax = panelMin.add(size)
    const seamGapX = max(emitMin.x.sub(panelMax.x), panelMin.x.sub(emitMax.x))
    const seamGapY = max(emitMin.y.sub(panelMax.y), panelMin.y.sub(emitMax.y))
    const paneBesideEmitter = seamGapX.greaterThanEqual(seamGapY)
    const dxOut = max(emitMin.x.sub(worldCss.x), max(worldCss.x.sub(emitMax.x), float(0)))
    const dyOut = max(emitMin.y.sub(worldCss.y), max(worldCss.y.sub(emitMax.y), float(0)))
    const offAxis = paneBesideEmitter.select(dyOut, dxOut)
    const spanRatio = offAxis.div(max(u.spanSigmaPx, float(16)))
    const spanFade = exp(spanRatio.mul(spanRatio).negate())

    // Chroma-weight emitter radiance so white borders/discs don't wash out rich hues
    const chromaVibrant = (texelRgb: Node<'vec3'>): Node<'vec3'> => {
      const raw = max(texelRgb.sub(vec3(0.013)), vec3(0))
      const maxC = max(raw.r, max(raw.g, raw.b))
      const minC = min(raw.r, min(raw.g, raw.b))
      const chroma = maxC.sub(minC)
      const cWeight = mix(float(0.11), float(1.0), smoothstep(float(0.03), float(0.24), chroma))
      const luma = dot(raw, vec3(0.2126, 0.7152, 0.0722))
      return max(mix(vec3(luma), raw, u.chromaBoost), vec3(0)).mul(cWeight)
    }

    const mipLod = clamp(u.baseMip.add(distToEmit.mul(0.011)), float(1.0), float(4.2))

    const sampleCssVibrant = (sampleCss: Node<'vec2'>): Node<'vec3'> => {
      const eu = clamp(sampleCss.x.sub(emitMin.x).div(emitSize.x), float(0.015), float(0.985))
      const ev = clamp(float(1).sub(sampleCss.y.sub(emitMin.y).div(emitSize.y)), float(0.015), float(0.985))
      return chromaVibrant(emitterMap.sample(vec2(eu, ev)).level(mipLod).rgb)
    }

    // Lobe 1: Seam-normal 12-tap trilinear-mip Vogel diffusion (velvet glow, 1:1 band alignment)
    const minHalf = min(emitSize.x, emitSize.y).mul(0.46)
    const penetratePx = clamp(float(30).add(distToEmit.mul(0.38)), float(24), minHalf)
    const inset = min(vec2(24, 24), emitSize.mul(0.25))
    const scatterCenter = clamp(
      closestCss.add(dirToEmit.mul(penetratePx)),
      emitMin.add(inset),
      emitMax.sub(inset),
    )

    const radNormal = u.blurNormalPx.add(distToEmit.mul(u.roughnessScale))
    const radParallel = u.blurParallelPx.add(
      distToEmit.mul(u.roughnessScale.mul(u.parallelRatio)),
    )

    let vogelAcc: Node<'vec3'> = vec3(0, 0, 0)
    for (const [vx, vy] of VOGEL_TAPS) {
      const offsetCss = dirToEmit
        .mul(radNormal.mul(vx))
        .add(perpDir.mul(radParallel.mul(vy)))
      vogelAcc = vogelAcc.add(sampleCssVibrant(scatterCenter.add(offsetCss)))
    }
    const vogelAvg = vogelAcc.mul(float(1 / 12))

    const falloff = max(u.falloffPx, float(40))
    const distDecay = exp(distToEmit.negate().div(falloff)).div(
      float(1).add(distToEmit.div(float(180))),
    )
    // Optional subtle micro-brushed modulation for Anodized finish (`brushStrength > 0`)
    const brushCoord = dot(worldCss, perpDir)
    const brushMod = float(1).add(sin(brushCoord.mul(1.25)).mul(u.brushStrength))
    const scatterRgb = vogelAvg.mul(distDecay).mul(spanFade).mul(brushMod).mul(u.scatterGain).mul(0.56)

    // Lobe 2: 4-tap wide quadrant ambient fill using pre-filtered mip level & span locality
    let ambientAcc: Node<'vec3'> = vec3(0, 0, 0)
    for (const sy of QUADRANT_TAPS) {
      for (const sx of QUADRANT_TAPS) {
        const patchCss = emitMin.add(vec2(emitSize.x.mul(sx), emitSize.y.mul(sy)))
        const d = length(worldCss.sub(patchCss))
        const w = exp(d.negate().div(falloff.mul(1.25))).div(float(1).add(d.mul(d).div(float(22000))))
        const c = chromaVibrant(emitterMap.sample(vec2(float(sx), float(1 - sy))).level(float(2.8)).rgb)
        ambientAcc = ambientAcc.add(c.mul(w))
      }
    }
    const ambientRgb = ambientAcc.mul(spanFade).mul(u.ambientGain).mul(0.24)

    // Lobe 3: Crisp 1.25 px Tahoe bevel hairline catchlight on emitter-facing edge
    const bevelBand = smoothstep(float(-1.6), float(-0.15), sdf)
    const subtleEdge = smoothstep(float(-4.5), float(0), sdf).mul(0.06)
    const ambientRim = float(0.022).add(grad2.y.negate().mul(0.012)).mul(bevelBand)
    const facing = pow(max(dot(grad2, dirToEmit), float(0.0001)), float(1.75))
    const rimProx = exp(distToEmit.negate().div(float(120))).mul(spanFade)
    const rimRgb = vogelAvg
      .add(vec3(0.06))
      .mul(bevelBand.mul(0.95).add(subtleEdge))
      .mul(facing)
      .mul(rimProx)
      .mul(u.rimGain)

    // Soft perceptual Reinhard shoulder preserves WCAG contrast under white sidebar text
    const rawBounce = scatterRgb.add(ambientRgb).add(rimRgb).mul(u.emitBoost).mul(u.emitterReady)
    const compressedBounce = rawBounce.div(vec3(1).add(rawBounce.mul(1.45)))

    const verticalLift = float(1.04).sub(float(1).sub(st.y).mul(0.07))
    const glassRgb = u.baseColor
      .mul(verticalLift)
      .add(vec3(0.86, 0.90, 0.98).mul(ambientRim))
      .add(compressedBounce)

    // Composite live crisp foreground DOM (`surface.map`) over lit glass via Porter-Duff `over`
    const fg = surface.map.sample(st)
    const compositeRgb = clamp(fg.rgb.add(glassRgb.mul(float(1).sub(fg.a))), vec3(0), vec3(1))
    return premultipliedOutput(vec4(compositeRgb.mul(mask), mask))
  })()

  return mat
}
