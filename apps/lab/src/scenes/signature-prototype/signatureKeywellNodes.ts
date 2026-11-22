// Sculpted double-shot polycarbonate keycap & inter-key lateral light bounce TSL
// materials (`SignatureKeywell`).
//
// Uses physically calibrated linear-space obsidian anodized aluminum (`0.018..0.010`
// linear ≈ `#22252d..#191b22` sRGB) and dark smoked polycarbonate (`~0.022` linear ≈
// `#282c37` sRGB) so jewel-toned north-facing SMD LEDs and 12-key neighbor-to-neighbor
// 48-degree bevel light bounce ignite with high contrast — using 1 DOM texture fetch.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import {
  abs,
  clamp,
  dot,
  floor,
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

export const KEYWELL_W = 620
export const KEYWELL_H = 408
export const KEY_COLS = 4
export const KEY_ROWS = 3
export const KEY_COUNT = KEY_COLS * KEY_ROWS

export const KEY_W = 128
export const KEY_H = 82
export const KEY_GAP_X = 14
export const KEY_GAP_Y = 14
export const KEY_PITCH_X = KEY_W + KEY_GAP_X // 142
export const KEY_PITCH_Y = KEY_H + KEY_GAP_Y // 96
export const GRID_LEFT = 33
export const GRID_TOP = 104 // bottom of grid = 378 px; CNC tub ends at 380 px

export function keyCenterCss(index: number): readonly [number, number] {
  const col = index % KEY_COLS
  const row = Math.floor(index / KEY_COLS)
  return [
    GRID_LEFT + KEY_W * 0.5 + col * KEY_PITCH_X,
    GRID_TOP + KEY_H * 0.5 + row * KEY_PITCH_Y,
  ] as const
}

export function createKeywellUniforms() {
  return {
    keyGlow: Array.from({ length: KEY_COUNT }, () => uniform(new THREE.Vector4(0, 0, 0, 0))),
    keyTravel: Array.from({ length: KEY_COUNT }, () => uniform(0)),
    focusedIndex: uniform(5),
  }
}

export type KeywellUniforms = ReturnType<typeof createKeywellUniforms>

export function createKeywellMaterial(
  surface: SurfaceNodes,
  u: KeywellUniforms,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const pCss = vec2(st.x.mul(KEYWELL_W), float(1).sub(st.y).mul(KEYWELL_H))

    // Outer CNC machined billet aluminum deck mask (`r = 22 px`)
    const deckHalf = vec2(KEYWELL_W * 0.5, KEYWELL_H * 0.5)
    const deckCorner = float(22)
    const qDeck = abs(pCss.sub(deckHalf)).sub(deckHalf.sub(deckCorner))
    const sdfDeck = length(max(qDeck, vec2(0, 0)))
      .add(min(max(qDeck.x, qDeck.y), float(0)))
      .sub(deckCorner)
    const deckMask = float(1).sub(smoothstep(float(-0.85), float(0.85), sdfDeck))

    // Recessed CNC keywell tub (`x: 23..597, y: 96..382, r: 15`) — ends cleanly at `y = 382`
    // leaving `y = 385..404` unobstructed dark anodized aluminum for `.sk-chin-label`!
    const wellCenter = vec2(KEYWELL_W * 0.5, 239)
    const wellHalf = vec2(287, 143)
    const qWell = abs(pCss.sub(wellCenter)).sub(wellHalf.sub(15))
    const sdfWell = length(max(qWell, vec2(0, 0)))
      .add(min(max(qWell.x, qWell.y), float(0)))
      .sub(15)
    const inWell = float(1).sub(smoothstep(float(-1.0), float(1.0), sdfWell))
    const wellChamfer = smoothstep(float(-3.5), float(0.4), sdfWell)
      .mul(float(1).sub(smoothstep(float(0.4), float(2.8), sdfWell)))

    // 4 subtle recessed CNC corner fasteners at `(18, 18)` from outer corners
    const cornerDist = length(abs(pCss.sub(deckHalf)).sub(deckHalf.sub(vec2(17, 17))))
    const screwRing = smoothstep(float(3.8), float(2.6), cornerDist)
      .mul(smoothstep(float(1.4), float(2.4), cornerDist))

    // Closed-form nearest cell `(col, row)` in the 4x3 matrix
    const colF = clamp(
      floor(pCss.x.sub(GRID_LEFT - KEY_GAP_X * 0.5).div(KEY_PITCH_X)),
      float(0),
      float(KEY_COLS - 1),
    )
    const rowF = clamp(
      floor(pCss.y.sub(GRID_TOP - KEY_GAP_Y * 0.5).div(KEY_PITCH_Y)),
      float(0),
      float(KEY_ROWS - 1),
    )
    const cellIdxF = rowF.mul(KEY_COLS).add(colF)
    const cellCenter = vec2(
      colF.mul(KEY_PITCH_X).add(GRID_LEFT + KEY_W * 0.5),
      rowF.mul(KEY_PITCH_Y).add(GRID_TOP + KEY_H * 0.5),
    )

    let selfGlow: Node<'vec4'> = vec4(0, 0, 0, 0)
    let selfTravel: Node<'float'> = float(0)
    for (let k = 0; k < KEY_COUNT; k++) {
      const isThisCell = float(1).sub(smoothstep(float(0.1), float(0.4), abs(cellIdxF.sub(k))))
      selfGlow = selfGlow.add(u.keyGlow[k]!.mul(isThisCell))
      selfTravel = selfTravel.add(u.keyTravel[k]!.mul(isThisCell))
    }

    // Keycap outer skirt vs depressed top finger dish
    const keyHalf = vec2(KEY_W * 0.5, KEY_H * 0.5)
    const keyR = float(11)
    const pRelOuter = pCss.sub(cellCenter).add(vec2(0, selfTravel.negate().mul(1.1)))
    const qCap = abs(pRelOuter).sub(keyHalf.sub(keyR))
    const outCap = max(qCap, vec2(0, 0))
    const outCapLen = length(outCap)
    const sdfCap = outCapLen.add(min(max(qCap.x, qCap.y), float(0))).sub(keyR)
    const inCap = float(1).sub(smoothstep(float(-0.85), float(0.85), sdfCap)).mul(inWell)

    const dishOffset = vec2(0, float(-1.4).add(selfTravel.mul(2.8)))
    const pDish = pCss.sub(cellCenter).sub(dishOffset)
    const dishHalf = keyHalf.sub(vec2(11.5, 10.5))
    const dishR = float(7.5)
    const qDish = abs(pDish).sub(dishHalf.sub(dishR))
    const outDish = max(qDish, vec2(0, 0))
    const outDishLen = length(outDish)
    const sdfDish = outDishLen.add(min(max(qDish.x, qDish.y), float(0))).sub(dishR)
    const onSkirt = smoothstep(float(-1.2), float(1.2), sdfDish).mul(inCap)
    const inDish = float(1).sub(onSkirt).mul(inCap)

    // Outward 2D gradient on the 4-sided 48-degree polycarbonate skirt bevel
    const safeOutGrad = outCap.div(max(outCapLen, float(0.0001)))
    const inGrad = vec2(
      qCap.x.greaterThan(qCap.y).select(float(1), float(0)),
      qCap.x.greaterThan(qCap.y).select(float(0), float(1)),
    )
    const signCap = vec2(
      pRelOuter.x.greaterThanEqual(0).select(float(1), float(-1)),
      pRelOuter.y.greaterThanEqual(0).select(float(1), float(-1)),
    )
    const skirtDirCss = outCapLen.greaterThan(0.001).select(safeOutGrad, inGrad).mul(signCap)

    const nSkirt = normalize(vec3(skirtDirCss.x.mul(0.76), skirtDirCss.y.negate().mul(0.76), float(0.65)))
    const nDish = normalize(vec3(pDish.x.negate().mul(0.0045), pDish.y.mul(0.0065), float(1.0)))
    const nCap = normalize(mix(nDish, nSkirt, onSkirt))

    // Accumulate real 2D lateral light bounce from all 12 LEDs onto dark neighbor bevels & well moat!
    let bounceSkirtRgb: Node<'vec3'> = vec3(0, 0, 0)
    let bounceFloorRgb: Node<'vec3'> = vec3(0, 0, 0)

    for (let k = 0; k < KEY_COUNT; k++) {
      const [cx, cy] = keyCenterCss(k)
      const emitCenter = vec2(cx, cy)
      const g = u.keyGlow[k]!
      const emitRgb = vec3(g.x, g.y, g.z).mul(g.w)

      const dVec = emitCenter.sub(pCss)
      const qEmit = abs(dVec).sub(keyHalf.sub(keyR))
      const sdfEmit = length(max(qEmit, vec2(0, 0)))
        .add(min(max(qEmit.x, qEmit.y), float(0)))
        .sub(keyR)

      const outsideEmitter = smoothstep(float(-0.5), float(2.0), sdfEmit)
      const distPx = max(sdfEmit, float(0))
      const dirToEmitCss = dVec.div(max(length(dVec), float(0.001)))

      const bevelFacing = max(dot(skirtDirCss, dirToEmitCss), float(0))
      const skirtAtten = float(1)
        .div(float(1).add(distPx.mul(0.052)).add(distPx.mul(distPx).mul(0.0015)))
        .mul(outsideEmitter)

      // Strong directional grazing reflection on facing 48-degree neighbor skirts!
      bounceSkirtRgb = bounceSkirtRgb.add(
        emitRgb.mul(pow(bevelFacing, float(1.15))).mul(skirtAtten).mul(0.95),
      )

      const floorAtten = float(1)
        .div(float(1).add(distPx.mul(0.12)).add(distPx.mul(distPx).mul(0.006)))
        .mul(outsideEmitter)
      bounceFloorRgb = bounceFloorRgb.add(emitRgb.mul(floorAtten).mul(0.32))
    }

    // Single DOM texture sample, UV-shifted when key is physically depressed
    const uvShiftY = selfTravel.mul(inCap).mul(2.6 / KEYWELL_H)
    const domSample = surface.map.sample(vec2(st.x, clamp(st.y.sub(uvShiftY), float(0.001), float(0.999))))

    // 1. True linear-space dark anodized 6061-T6 obsidian chassis (`0.018 -> 0.010` linear ≈ `#22252d -> #191b22` sRGB)
    const studioLight = normalize(vec3(-0.35, 0.58, 0.73))
    const chassisGrad = mix(vec3(0.019, 0.021, 0.028), vec3(0.010, 0.011, 0.015), float(1).sub(st.y))
    const topDeckChamfer = smoothstep(float(-2.2), float(-0.2), sdfDeck)
      .mul(smoothstep(float(0.15), float(0.95), st.y))
      .mul(0.085)
    const wellDarken = mix(float(1.0), float(0.28), inWell) // `#0d0f14` recessed keywell moat!
    const capMoatAo = float(1).sub(
      float(1)
        .sub(smoothstep(float(0.0), float(7.0), max(sdfCap, float(0))))
        .mul(inWell)
        .mul(float(1).sub(inCap))
        .mul(0.65),
    )

    const aluminumRgb = chassisGrad
      .mul(wellDarken)
      .mul(capMoatAo)
      .add(vec3(0.07, 0.08, 0.10).mul(wellChamfer))
      .add(vec3(0.12, 0.13, 0.16).mul(topDeckChamfer))
      .add(vec3(0.025, 0.028, 0.036).mul(screwRing))
      .add(bounceFloorRgb.mul(inWell).mul(float(1).sub(inCap)))

    // 2. True dark smoked polycarbonate keycap body (`~0.022` linear ≈ `#282c37` sRGB when unlit!)
    const capNdl = max(dot(nCap, studioLight), float(0))
    const halfV = normalize(studioLight.add(vec3(0, 0, 1)))
    const capSpec = pow(max(dot(nCap, halfV), float(0.0001)), float(52)).mul(0.13)
    const dishRidgeLine = float(1)
      .sub(smoothstep(float(0.0), float(1.6), abs(sdfDish)))
      .mul(inCap)
      .mul(0.045)
    const isFocusedKey = float(1)
      .sub(smoothstep(float(0.1), float(0.4), abs(cellIdxF.sub(u.focusedIndex))))
      .mul(inCap)
    const focusRim = smoothstep(float(-2.2), float(-0.3), sdfCap).mul(isFocusedKey).mul(0.14)

    const polyBase = vec3(0.018, 0.020, 0.027)
      .add(vec3(0.022, 0.025, 0.033).mul(capNdl))
      .add(vec3(0.75, 0.82, 0.96).mul(capSpec.add(dishRidgeLine)))
      .add(vec3(0.28, 0.45, 0.85).mul(focusRim))

    // 3. Sculpted internal LED optics: rich frosted skirt light-piping + crisp north-facing SMD lens bar
    // while keeping the center finger-dish smoked so white legends stay high-contrast!
    const selfEmitColor = vec3(selfGlow.x, selfGlow.y, selfGlow.z)
    const stemDist = length(pDish.mul(vec2(0.020, 0.030)))
    const stemCore = float(1).div(float(1).add(stemDist.mul(stemDist).mul(1.6)))
    const wallPipe = smoothstep(float(-10.5), float(-0.8), sdfCap).mul(0.62)

    // Crisp `22 x 3.2 px` north-facing SMD diode window near top of dish (`pDish.y = -24.5`)
    const qDiode = abs(pDish.sub(vec2(0, -24.5))).sub(vec2(10.5, 1.4))
    const sdfDiode = length(max(qDiode, vec2(0, 0))).add(min(max(qDiode.x, qDiode.y), float(0))).sub(1.4)
    const diodeBar = float(1).sub(smoothstep(float(-0.8), float(1.4), sdfDiode)).mul(inDish)
    const unlitDiodeSlot = diodeBar.mul(float(1).sub(clamp(selfGlow.w, float(0), float(1)))).mul(0.018)

    const rawSelfGlow = selfEmitColor
      .mul(selfGlow.w)
      .mul(
        stemCore.mul(0.24)
          .add(onSkirt.mul(0.46))
          .add(wallPipe)
          .add(diodeBar.mul(0.95)),
      )
    // Chromatic-preserving shoulder prevents center blow-out while keeping hues jewel-saturated
    const glowLuma = dot(rawSelfGlow, vec3(0.2126, 0.7152, 0.0722))
    const subsurfaceGlow = rawSelfGlow.div(float(1).add(glowLuma.mul(0.58)))

    // Neighbor lateral bounce lands brightly on facing 48-deg polycarbonate skirts + dish ridge catchlight!
    const ridgeCatch = float(1).sub(smoothstep(float(0.0), float(2.8), abs(sdfDish)))
    const neighborBounceOnCap = bounceSkirtRgb.mul(
      onSkirt.mul(0.95).add(ridgeCatch.mul(0.55)).add(inDish.mul(smoothstep(float(-9), float(0), sdfDish)).mul(0.18)),
    )

    const capBodyRgb = polyBase
      .mul(float(1).sub(selfTravel.mul(0.14)))
      .add(vec3(unlitDiodeSlot))
      .add(subsurfaceGlow)
      .add(neighborBounceOnCap)

    const substrateRgb = mix(aluminumRgb, capBodyRgb, inCap)

    const legendBoost = mix(
      vec3(0.90, 0.93, 0.98),
      vec3(1.0, 1.0, 1.0),
      clamp(selfGlow.w, float(0), float(1)).mul(inCap),
    )
    const fgRgb = domSample.rgb.mul(legendBoost)
    const outRgb = clamp(
      fgRgb.add(substrateRgb.mul(float(1).sub(domSample.a))),
      vec3(0),
      vec3(1),
    )

    return premultipliedOutput(vec4(outRgb.mul(deckMask), deckMask))
  })()

  return mat
}

export function createKeywellShadowMaterial(): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const p = uv().sub(0.5).mul(2.0)
    const q = abs(p).sub(vec2(0.76, 0.72))
    const d = length(max(q, vec2(0, 0)))
    const soft = float(1).sub(smoothstep(float(0.0), float(0.26), d))
    const alpha = soft.mul(0.52)
    return premultipliedOutput(vec4(vec3(0.01, 0.012, 0.018).mul(alpha), alpha))
  })()

  return mat
}
