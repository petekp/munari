// Peel-to-inspect TSL materials — single-pass double-sided cardstock shader with
// `Discard` outside rounded corners, `cornerMask`-premultiplied front RGB, and a
// procedural 16 px architectural registration grid printed on `!frontFacing` reverse stock.

import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  abs,
  clamp,
  Discard,
  float,
  Fn,
  fract,
  frontFacing,
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

export const PEEL_SHADOW_PAD = 44

export function createPeelUniforms() {
  return {
    cardSize: uniform(new THREE.Vector2(620, 360)),
    peelNormal: uniform(new THREE.Vector2(Math.cos(0.52), Math.sin(0.52))),
    lineDist: uniform(420),
    radiusPx: uniform(40),
    peelAmount: uniform(0.54),
  }
}

export type PeelUniforms = ReturnType<typeof createPeelUniforms>

export function createPeelCardMaterial(
  surface: SurfaceNodes,
  u: PeelUniforms,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const px = vec2(st.x.mul(u.cardSize.x), float(1).sub(st.y).mul(u.cardSize.y))
    const d = px.x.mul(u.peelNormal.x).add(px.y.mul(u.peelNormal.y)).sub(u.lineDist)
    const r = max(u.radiusPx, float(12))
    const piR = r.mul(Math.PI)

    const cornerMask = surface.radiusMask()
    const sample = surface.map.sample(st)
    const frontAlpha = sample.a.mul(cornerMask)
    const chosenAlpha = frontFacing.select(frontAlpha, cornerMask)
    Discard(chosenAlpha.lessThan(0.004))

    const inRoll = d.greaterThan(0).and(d.lessThanEqual(piR))
    const alpha = clamp(d.div(r), float(0), float(Math.PI))
    const rollCrest = inRoll.select(sin(alpha), float(0))
    const specCrest = pow(max(rollCrest, float(0.0001)), float(4.2)).mul(0.28)
    const creaseAo = smoothstep(float(-26), float(10), d)
      .mul(float(1).sub(smoothstep(float(10), float(46), d)))
      .mul(u.peelAmount.greaterThan(0.01).select(float(0.13), float(0)))

    // Multiply frontRgb by cornerMask so rounded corners never produce HDR white halos
    const frontRgb = clamp(
      sample.rgb
        .mul(cornerMask)
        .mul(float(1).sub(creaseAo))
        .add(vec3(1, 0.99, 0.96).mul(specCrest).mul(frontAlpha)),
      vec3(0),
      vec3(1),
    )

    // Reverse face (`!frontFacing`): cream rag stock with 16 px registration grid that foreshortens around the 3D cylinder
    const minorCell = abs(fract(px.div(16)).sub(0.5))
    const minorDist = min(minorCell.x, minorCell.y).mul(16)
    const minorLine = float(1).sub(smoothstep(float(0.2), float(1.1), minorDist))

    const majorCell = abs(fract(px.div(64)).sub(0.5))
    const majorDist = min(majorCell.x, majorCell.y).mul(64)
    const majorLine = float(1).sub(smoothstep(float(0.3), float(1.3), majorDist))

    const stockBase = mix(
      vec3(0.945, 0.926, 0.885),
      vec3(0.76, 0.74, 0.69),
      clamp(minorLine.mul(0.35).add(majorLine.mul(0.45)), float(0), float(0.72)),
    )
    const cylShade = inRoll.select(
      float(0.68).add(rollCrest.mul(0.38)),
      float(0.86),
    )
    const printBleed = mix(vec3(1), sample.rgb, float(0.06))
    const backRgb = clamp(
      stockBase.mul(printBleed).mul(cylShade).add(vec3(1, 0.98, 0.94).mul(specCrest.mul(0.65))),
      vec3(0),
      vec3(1),
    ).mul(cornerMask)

    const chosenRgb = frontFacing.select(frontRgb, backRgb)
    return premultipliedOutput(vec4(chosenRgb, chosenAlpha))
  })()

  return mat
}

export function createPeelShadowMaterial(u: PeelUniforms): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const pad = float(PEEL_SHADOW_PAD)
    const totalSize = u.cardSize.add(pad.mul(2))
    const px = vec2(
      st.x.mul(totalSize.x).sub(pad),
      float(1).sub(st.y).mul(totalSize.y).sub(pad),
    )

    const halfCard = u.cardSize.mul(0.5)
    const centered = px.sub(halfCard)
    const qBox = abs(centered).sub(halfCard.sub(16))
    const boxSdf = length(max(qBox, vec2(0, 0))).add(min(max(qBox.x, qBox.y), float(0))).sub(16)
    const footprintMask = float(1).sub(smoothstep(float(-2), float(34), boxSdf))

    const d = px.x.mul(u.peelNormal.x).add(px.y.mul(u.peelNormal.y)).sub(u.lineDist)
    const r = max(u.radiusPx, float(12))
    const active = smoothstep(float(0.01), float(0.08), u.peelAmount)

    const underCurl = smoothstep(r.mul(-1.1), float(6), d).mul(
      float(1).sub(smoothstep(float(10), r.mul(2.1), d)),
    )
    const alpha = clamp(underCurl.mul(0.42).mul(active).mul(footprintMask), float(0), float(0.48))
    const ink = vec3(0.01, 0.015, 0.03).mul(alpha)
    return premultipliedOutput(vec4(ink, alpha))
  })()

  return mat
}
