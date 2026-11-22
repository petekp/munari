// Directional ridge/valley concertina paper TSL materials (`SignatureConcertina`) —
// shades 3D pleated board facets using world-space normals (`normalWorld`) for
// live tilt/orbit light response while reading `normalLocal.z` to distinguish
// pleated slopes from flat bookend columns, paired with a sawtooth accordion
// ground shadow.

import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  abs,
  attribute,
  clamp,
  dot,
  float,
  Fn,
  fract,
  length,
  max,
  mix,
  normalLocal,
  normalWorld,
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
import { CONCERTINA_COLS } from './signatureConcertinaLaw'

export function createConcertinaUniforms() {
  return {
    avgPleat: uniform(0.86),
    boardSpanRatio: uniform(0.58),
  }
}

export type ConcertinaUniforms = ReturnType<typeof createConcertinaUniforms>

export function createConcertinaMaterial(
  surface: SurfaceNodes,
  u: ConcertinaUniforms,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const base = surface.map.sample(st)
    const nLocal = normalize(normalLocal)
    const nWorld = normalize(normalWorld)
    const stripIdx = attribute('aStripIndex', 'float')

    // `nLocal.z` tells whether this facet is pleated relative to the board;
    // `nWorld` drives live directional shading & specular sheen as the user orbits!
    const slopeTilt = clamp(float(1).sub(abs(nLocal.z)), float(0), float(1))
    const foldMask = smoothstep(float(0.05), float(0.35), slopeTilt)

    const keyDir = normalize(vec3(-0.72, 0.28, 0.64))
    const fillDir = normalize(vec3(0.56, -0.18, 0.81))
    const ndl = max(dot(nWorld, keyDir), float(0))
    const ndf = max(dot(nWorld, fillDir), float(0))

    const flatShade = float(0.95).add(ndl.mul(0.06))
    const pleatedShade = float(0.52).add(ndl.mul(0.58)).add(ndf.mul(0.10))
    const shade = mix(flatShade, pleatedShade, foldMask)

    // Local coordinate within each column (`0.5` = mountain ridge, `0`/`1` = valley crease)
    const colPhase = fract(st.x.mul(CONCERTINA_COLS))
    const distRidge = abs(colPhase.sub(0.5)).mul(2.0)

    // Suppress white paper-fiber highlight over dark typography strokes so letters never bleach
    const baseLuma = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722))
    const onLightPaper = smoothstep(float(0.28), float(0.66), baseLuma)

    const mountainGlow = float(1)
      .sub(smoothstep(float(0.0), float(0.08), distRidge))
      .mul(foldMask)
      .mul(onLightPaper)
      .mul(0.17)

    // Deep ambient-occlusion crease shadow tucked into the valley fold (`distRidge ~ 1`)
    const valleyAo = smoothstep(float(0.80), float(1.0), distRidge)
      .mul(foldMask)
      .mul(mix(float(0.22), float(0.46), u.avgPleat))

    const halfVec = normalize(keyDir.add(vec3(0, 0, 1)))
    const spec = pow(max(dot(nWorld, halfVec), float(0.0001)), float(28))
      .mul(mix(float(0.03), float(0.14), foldMask))
      .mul(onLightPaper)

    const parity = fract(stripIdx.mul(0.5)).mul(2.0)
    const slopeTint = mix(
      vec3(1.02, 1.005, 0.98),
      vec3(0.90, 0.93, 0.99),
      parity.mul(foldMask),
    )

    const litRgb = clamp(
      base.rgb
        .mul(shade.sub(valleyAo))
        .mul(slopeTint)
        .add(vec3(1.0, 0.98, 0.94).mul(mountainGlow.add(spec)).mul(base.a)),
      vec3(0),
      vec3(1),
    )

    return premultipliedOutput(vec4(litRgb, base.a))
  })()

  return mat
}

export function createConcertinaShadowMaterial(
  u: ConcertinaUniforms,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const p = uv().sub(0.5).mul(2.0)
    const spanW = max(u.boardSpanRatio, float(0.36))
    const normX = p.x.div(spanW)

    // Sawtooth zig-zag modulation across the interior pleated zone (`|normX| < 0.56`)
    const inInterior = float(1).sub(smoothstep(float(0.36), float(0.62), abs(normX)))
    const sawPhase = abs(fract(normX.add(0.5).mul(4.0)).sub(0.5)).mul(2.0)
    const zigOffset = sawPhase.sub(0.5).mul(0.085).mul(u.avgPleat).mul(inInterior)

    const q = vec2(abs(normX), abs(p.y.sub(zigOffset)).div(0.84))
    const d = length(max(q.sub(vec2(0.76, 0.72)), vec2(0, 0)))
    const soft = float(1).sub(smoothstep(float(0.0), float(0.30), d))
    const valleyTight = float(1).add(float(1).sub(sawPhase).mul(inInterior).mul(u.avgPleat).mul(0.35))
    const alpha = clamp(soft.mul(mix(float(0.12), float(0.26), u.avgPleat)).mul(valleyTight), float(0), float(0.38))
    const ink = vec3(0.06, 0.08, 0.12)
    return premultipliedOutput(vec4(ink.mul(alpha), alpha))
  })()

  return mat
}
