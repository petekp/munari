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
import {
  createBounceTuningUniforms,
  type BounceTuning,
  type BounceTuningUniforms,
  type FloatUniform,
} from './frontierBounceTuning'

// Precomputed 12-tap Golden-Angle (`2.399963 rad`) Vogel disk offsets in `[-1, 1]^2`
const VOGEL_TAPS: readonly (readonly [number, number])[] = Array.from({ length: 12 }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / 12)
  const theta = i * 2.399963229728653
  return [Math.cos(theta) * r, Math.sin(theta) * r] as const
})

const QUADRANT_TAPS = [0.25, 0.75] as const

export interface BounceLookUniforms {
  readonly tuning: BounceTuningUniforms
  readonly emitterRectCss: ReturnType<typeof vec4Uniform>
  readonly emitterReady: FloatUniform
  readonly baseColor: ReturnType<typeof colorUniform>
}

export interface BouncePaneUniforms {
  readonly panelRectCss: ReturnType<typeof vec4Uniform>
  readonly cornerRadius: FloatUniform
}

const vec4Uniform = (value: THREE.Vector4) => uniform(value)
const colorUniform = (value: THREE.Color) => uniform(value)

/** What all three panes share: the tuning, the emitter, and the glass color. */
export function createBounceLookUniforms(tuning: BounceTuning): BounceLookUniforms {
  return {
    tuning: createBounceTuningUniforms(tuning),
    emitterRectCss: vec4Uniform(new THREE.Vector4(290, 110, 512, 356)),
    emitterReady: uniform(0),
    baseColor: colorUniform(new THREE.Color('#191b20')),
  }
}

export function createBouncePaneUniforms(cornerRadius: number): BouncePaneUniforms {
  return {
    panelRectCss: vec4Uniform(new THREE.Vector4(8, 8, 216, 560)),
    cornerRadius: uniform(cornerRadius),
  }
}

export function createBounceMaterial(
  surface: SurfaceNodes,
  emitterMap: TextureNode,
  look: BounceLookUniforms,
  pane: BouncePaneUniforms,
): MeshBasicNodeMaterial {
  const t = look.tuning
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const size = max(vec2(pane.panelRectCss.z, pane.panelRectCss.w), vec2(1, 1))
    const halfSize = size.mul(0.5)
    // CSS pixel space inside the container (+x right, +y down)
    const localCss = vec2(st.x.mul(size.x), float(1).sub(st.y).mul(size.y))
    const pCss = localCss.sub(halfSize)
    const worldCss = vec2(pane.panelRectCss.x, pane.panelRectCss.y).add(localCss)

    // Rounded-box SDF used strictly for silhouette anti-aliasing & 1.25 px outer rim
    const r = min(pane.cornerRadius, min(halfSize.x, halfSize.y).sub(1))
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

    const emitMin = vec2(look.emitterRectCss.x, look.emitterRectCss.y)
    const emitSize = max(vec2(look.emitterRectCss.z, look.emitterRectCss.w), vec2(8, 8))
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
    const panelMin = vec2(pane.panelRectCss.x, pane.panelRectCss.y)
    const panelMax = panelMin.add(size)
    const seamGapX = max(emitMin.x.sub(panelMax.x), panelMin.x.sub(emitMax.x))
    const seamGapY = max(emitMin.y.sub(panelMax.y), panelMin.y.sub(emitMax.y))
    const paneBesideEmitter = seamGapX.greaterThanEqual(seamGapY)
    const dxOut = max(emitMin.x.sub(worldCss.x), max(worldCss.x.sub(emitMax.x), float(0)))
    const dyOut = max(emitMin.y.sub(worldCss.y), max(worldCss.y.sub(emitMax.y), float(0)))
    const offAxis = paneBesideEmitter.select(dyOut, dxOut)
    const spanRatio = offAxis.div(max(t.spanSigmaPx, float(16)))
    const spanFade = exp(spanRatio.mul(spanRatio).negate())

    // Chroma-weight emitter radiance so white borders/discs don't wash out rich hues
    const chromaVibrant = (texelRgb: Node<'vec3'>): Node<'vec3'> => {
      const raw = max(texelRgb.sub(t.blackFloor), vec3(0))
      const maxC = max(raw.r, max(raw.g, raw.b))
      const minC = min(raw.r, min(raw.g, raw.b))
      const chroma = maxC.sub(minC)
      const cWeight = mix(t.chromaFloor, float(1.0), smoothstep(t.chromaLow, t.chromaHigh, chroma))
      const luma = dot(raw, vec3(0.2126, 0.7152, 0.0722))
      return max(mix(vec3(luma), raw, t.chromaBoost), vec3(0)).mul(cWeight)
    }

    const mipLod = clamp(t.baseMip.add(distToEmit.mul(t.mipPerPx)), t.mipMin, t.mipMax)

    const sampleCssVibrant = (sampleCss: Node<'vec2'>): Node<'vec3'> => {
      const eu = clamp(sampleCss.x.sub(emitMin.x).div(emitSize.x), float(0.015), float(0.985))
      const ev = clamp(float(1).sub(sampleCss.y.sub(emitMin.y).div(emitSize.y)), float(0.015), float(0.985))
      return chromaVibrant(emitterMap.sample(vec2(eu, ev)).level(mipLod).rgb)
    }

    // Lobe 1: Seam-normal 12-tap trilinear-mip Vogel diffusion (velvet glow, 1:1 band alignment)
    const minHalf = min(emitSize.x, emitSize.y).mul(0.46)
    const penetratePx = clamp(t.penetrateBasePx.add(distToEmit.mul(t.penetratePerPx)), float(24), minHalf)
    const inset = min(vec2(24, 24), emitSize.mul(0.25))
    const scatterCenter = clamp(
      closestCss.add(dirToEmit.mul(penetratePx)),
      emitMin.add(inset),
      emitMax.sub(inset),
    )

    const radNormal = t.blurNormalPx.add(distToEmit.mul(t.roughnessScale))
    const radParallel = t.blurParallelPx.add(
      distToEmit.mul(t.roughnessScale.mul(t.parallelRatio)),
    )

    let vogelAcc: Node<'vec3'> = vec3(0, 0, 0)
    for (const [vx, vy] of VOGEL_TAPS) {
      const offsetCss = dirToEmit
        .mul(radNormal.mul(vx))
        .add(perpDir.mul(radParallel.mul(vy)))
      vogelAcc = vogelAcc.add(sampleCssVibrant(scatterCenter.add(offsetCss)))
    }
    const vogelAvg = vogelAcc.mul(float(1 / 12))

    const falloff = max(t.falloffPx, float(40))
    const distDecay = exp(distToEmit.negate().div(falloff)).div(
      float(1).add(distToEmit.div(t.distanceKneePx)),
    )
    // Optional subtle micro-brushed modulation for Anodized finish (`brushStrength > 0`)
    const brushCoord = dot(worldCss, perpDir)
    const brushMod = float(1).add(sin(brushCoord.mul(t.brushFrequency)).mul(t.brushStrength))
    const scatterRgb = vogelAvg.mul(distDecay).mul(spanFade).mul(brushMod).mul(t.scatterGain).mul(0.56)

    // Lobe 2: 4-tap wide quadrant ambient fill using pre-filtered mip level & span locality
    let ambientAcc: Node<'vec3'> = vec3(0, 0, 0)
    for (const sy of QUADRANT_TAPS) {
      for (const sx of QUADRANT_TAPS) {
        const patchCss = emitMin.add(vec2(emitSize.x.mul(sx), emitSize.y.mul(sy)))
        const d = length(worldCss.sub(patchCss))
        const dr = d.div(t.ambientReachPx)
        const w = exp(d.negate().div(falloff.mul(1.25))).div(float(1).add(dr.mul(dr)))
        const c = chromaVibrant(emitterMap.sample(vec2(float(sx), float(1 - sy))).level(t.ambientMip).rgb)
        ambientAcc = ambientAcc.add(c.mul(w))
      }
    }
    const ambientRgb = ambientAcc.mul(spanFade).mul(t.ambientGain).mul(0.24)

    // Lobe 3: Crisp 1.25 px Tahoe bevel hairline catchlight on emitter-facing edge
    const bevelBand = smoothstep(float(-1.6), float(-0.15), sdf)
    const subtleEdge = smoothstep(float(-4.5), float(0), sdf).mul(0.06)
    const ambientRim = float(0.022).add(grad2.y.negate().mul(0.012)).mul(bevelBand)
    const facing = pow(max(dot(grad2, dirToEmit), float(0.0001)), t.rimFacingPower)
    const rimProx = exp(distToEmit.negate().div(t.rimReachPx)).mul(spanFade)
    const rimRgb = vogelAvg
      .add(vec3(0.06))
      .mul(bevelBand.mul(0.95).add(subtleEdge))
      .mul(facing)
      .mul(rimProx)
      .mul(t.rimGain)

    // Soft perceptual Reinhard shoulder preserves WCAG contrast under white sidebar text
    const rawBounce = scatterRgb.add(ambientRgb).add(rimRgb).mul(t.emitBoost).mul(look.emitterReady)
    const compressedBounce = rawBounce.div(vec3(1).add(rawBounce.mul(t.toneShoulder)))

    const verticalLift = float(1.04).sub(float(1).sub(st.y).mul(t.verticalLift))
    const glassRgb = look.baseColor
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
