// Double-sided 3D cardstock & recycled kraft interior TSL material for Variant 01
// (`BeyondDieline`).
//
// Outer faces (`frontFacing = true`) shade live interactive HTML (`surface.map`)
// with studio key/fill lighting, satin spot-UV specular gloss, and fold-crease AO.
// Inner faces (`frontFacing = false`) shade unbleached kraft paperboard fiber that
// darkens naturally with interior ambient occlusion as the carton closes.

import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  Fn,
  frontFacing,
  length,
  max,
  mix,
  normalWorld,
  normalize,
  positionWorld,
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

export function createDielineUniforms() {
  return {
    foldAmount: uniform(0.82),
    kraftColor: uniform(new THREE.Color('#bc9668')),
    paperBase: uniform(new THREE.Color('#f7f4ec')),
  }
}

export type DielineUniforms = ReturnType<typeof createDielineUniforms>

export function createDielineMaterial(
  surface: SurfaceNodes,
  u: DielineUniforms,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  })

  mat.outputNode = Fn(() => {
    const st = uv()
    const crease = attribute('aCrease', 'float')
    const fold = clamp(u.foldAmount, float(0), float(1))

    const rawN = normalize(normalWorld)
    const n = frontFacing.select(rawN, rawN.negate())
    const viewDir = normalize(cameraPosition.sub(positionWorld))

    const keyDir = normalize(vec3(-0.44, 0.66, 0.86))
    const fillDir = normalize(vec3(0.68, -0.28, 0.42))
    const halfVec = normalize(keyDir.add(viewDir))

    const ndotl = max(dot(n, keyDir), float(0))
    const fill = max(dot(n, fillDir), float(0))

    // Flat sheet (`fold = 0`) stays near-uniform 1.0 paper brightness; 3D fold brings studio contrast
    const studioShade = mix(
      float(1.0),
      float(0.54).add(ndotl.mul(0.48)).add(fill.mul(0.14)),
      fold,
    )
    const spec = pow(max(dot(n, halfVec), float(0.0001)), float(26))
      .mul(0.16)
      .mul(fold)
    const creaseAo = float(1).sub(crease.mul(fold).mul(0.12))

    // Printed outer HTML cardstock
    const fg = surface.map.sample(st)
    const baseSheet = fg.rgb.add(u.paperBase.mul(float(1).sub(fg.a)))
    const outerRgb = baseSheet
      .mul(studioShade)
      .mul(creaseAo)
      .add(vec3(1, 0.98, 0.94).mul(spec))

    // Unbleached recycled kraft paperboard interior (`frontFacing = false`)
    const grain = sin(st.x.mul(410).add(st.y.mul(95)))
      .mul(sin(st.y.mul(370).sub(st.x.mul(60))))
      .mul(0.035)
    const interiorAo = float(1).sub(fold.mul(0.36))
    const innerShade = float(0.58).add(ndotl.mul(0.42))
    const kraftRgb = u.kraftColor
      .mul(float(1).add(grain))
      .mul(innerShade)
      .mul(interiorAo)

    const finalRgb = clamp(frontFacing.select(outerRgb, kraftRgb), vec3(0), vec3(1))
    return premultipliedOutput(vec4(finalRgb, float(1)))
  })()

  return mat
}

export function createDielineShadowMaterial(u: DielineUniforms): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const fold = clamp(u.foldAmount, float(0), float(1))
    const p = vec2(st.x.sub(0.5).mul(2), st.y.sub(0.5).mul(2))
    const d = length(vec2(p.x, p.y.mul(1.35)))
    const soft = float(1).sub(smoothstep(float(0.18), float(0.96), d))
    const alpha = soft.mul(mix(float(0.06), float(0.42), fold))
    return premultipliedOutput(vec4(vec3(0.02, 0.03, 0.03).mul(alpha), alpha))
  })()

  return mat
}
