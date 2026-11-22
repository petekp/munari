// Surface.Anchor 3D patchbay materials & zero-allocation catenary tube updater.
//
// Perturbs tube normals with a woven herringbone braid and keeps specular tight
// (`pow(..., 58)`) so linear-to-sRGB encoding preserves deep saturated cord colors.

import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  clamp,
  cos,
  dot,
  float,
  Fn,
  max,
  mix,
  normalWorld,
  normalize,
  pow,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput } from '@petepetrash/munari'

const TUBE_SEGMENTS = 36
const TUBE_RADIAL = 12

export function createPreallocatedTube(radius = 4.2): THREE.BufferGeometry {
  const vertCount = (TUBE_SEGMENTS + 1) * (TUBE_RADIAL + 1)
  const positions = new Float32Array(vertCount * 3)
  const normals = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const indices: number[] = []

  for (let i = 0; i <= TUBE_SEGMENTS; i++) {
    const u = i / TUBE_SEGMENTS
    for (let j = 0; j <= TUBE_RADIAL; j++) {
      const v = j / TUBE_RADIAL
      const idx2 = (i * (TUBE_RADIAL + 1) + j) * 2
      uvs[idx2] = u
      uvs[idx2 + 1] = v
    }
  }

  for (let i = 0; i < TUBE_SEGMENTS; i++) {
    for (let j = 0; j < TUBE_RADIAL; j++) {
      const a = i * (TUBE_RADIAL + 1) + j
      const b = (i + 1) * (TUBE_RADIAL + 1) + j
      const c = (i + 1) * (TUBE_RADIAL + 1) + (j + 1)
      const d = i * (TUBE_RADIAL + 1) + (j + 1)
      indices.push(a, b, d, b, c, d)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.userData.tubeRadius = radius
  return geo
}

const TMP_P = new THREE.Vector3()
const TMP_NEXT = new THREE.Vector3()
const TMP_PREV = new THREE.Vector3()
const TMP_TANGENT = new THREE.Vector3()
const TMP_NORMAL = new THREE.Vector3()
const TMP_BINORMAL = new THREE.Vector3()
const TMP_UP = new THREE.Vector3(0, 0, 1)
const TMP_ALT = new THREE.Vector3(0, 1, 0)

function evalCablePoint(
  out: THREE.Vector3,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  sagY: number,
  swayX: number,
  liftZ: number,
  t: number,
): void {
  const s = t * t * (3 - 2 * t)
  const arch = Math.sin(Math.PI * t)
  const shoulder0 = t < 0.28 ? Math.sin(Math.PI * (t / 0.28)) : 0
  const shoulder1 = t > 0.72 ? Math.sin(Math.PI * ((1 - t) / 0.28)) : 0

  out.x = p0.x + (p1.x - p0.x) * s + swayX * arch
  out.y = p0.y + (p1.y - p0.y) * s - sagY * arch * arch
  out.z = p0.z + (p1.z - p0.z) * s + liftZ * Math.pow(arch, 0.68) + (shoulder0 + shoulder1) * 10
}

export function updateCableTubeGeometry(
  geo: THREE.BufferGeometry,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  sagY: number,
  swayX: number,
  liftZ: number,
  radius = 4.2,
): void {
  const posAttr = geo.getAttribute('position')
  const normAttr = geo.getAttribute('normal')
  if (!(posAttr instanceof THREE.BufferAttribute) || !(normAttr instanceof THREE.BufferAttribute)) return

  for (let i = 0; i <= TUBE_SEGMENTS; i++) {
    const t = i / TUBE_SEGMENTS
    const eps = 1 / (TUBE_SEGMENTS * 2)
    evalCablePoint(TMP_P, p0, p1, sagY, swayX, liftZ, t)
    evalCablePoint(TMP_PREV, p0, p1, sagY, swayX, liftZ, Math.max(0, t - eps))
    evalCablePoint(TMP_NEXT, p0, p1, sagY, swayX, liftZ, Math.min(1, t + eps))

    TMP_TANGENT.subVectors(TMP_NEXT, TMP_PREV)
    if (TMP_TANGENT.lengthSq() < 1e-6) TMP_TANGENT.set(1, 0, 0)
    else TMP_TANGENT.normalize()

    const ref = Math.abs(TMP_TANGENT.dot(TMP_UP)) > 0.92 ? TMP_ALT : TMP_UP
    TMP_NORMAL.crossVectors(TMP_TANGENT, ref).normalize()
    TMP_BINORMAL.crossVectors(TMP_TANGENT, TMP_NORMAL).normalize()

    for (let j = 0; j <= TUBE_RADIAL; j++) {
      const theta = (j / TUBE_RADIAL) * Math.PI * 2
      const cosT = Math.cos(theta)
      const sinT = Math.sin(theta)
      const nx = TMP_NORMAL.x * cosT + TMP_BINORMAL.x * sinT
      const ny = TMP_NORMAL.y * cosT + TMP_BINORMAL.y * sinT
      const nz = TMP_NORMAL.z * cosT + TMP_BINORMAL.z * sinT
      const idx = i * (TUBE_RADIAL + 1) + j
      posAttr.setXYZ(idx, TMP_P.x + nx * radius, TMP_P.y + ny * radius, TMP_P.z + nz * radius)
      normAttr.setXYZ(idx, nx, ny, nz)
    }
  }

  posAttr.needsUpdate = true
  normAttr.needsUpdate = true
  geo.boundingSphere = null
}

export function createBraidedCordMaterial(hex: string) {
  const baseColor = uniform(new THREE.Color(hex))
  const pulseUniform = uniform(0)
  const mat = new MeshBasicNodeMaterial({
    transparent: false,
    depthWrite: true,
    depthTest: true,
  })

  mat.outputNode = Fn(() => {
    const st = uv()
    // Herringbone braid relief normal perturbation
    const braidA = sin(st.x.mul(210).add(st.y.mul(25.13)))
    const braidB = cos(st.x.mul(210).sub(st.y.mul(25.13)))
    const weave = braidA.mul(braidB)

    const n = normalize(
      normalWorld.add(vec3(braidA.mul(0.14), braidB.mul(0.14), weave.mul(0.08))),
    )
    const lightDir = normalize(vec3(-0.38, 0.64, 0.67))
    const halfVec = normalize(lightDir.add(vec3(0, 0, 1)))

    const ndotl = clamp(dot(n, lightDir), float(0), float(1))
    const cylShadow = clamp(n.z, float(0), float(1))
    const spec = pow(max(dot(n, halfVec), float(0.0001)), float(58)).mul(0.24)

    const pulseBand = smoothstep(float(0.12), float(0), st.x.sub(pulseUniform).abs())
      .mul(pulseUniform.greaterThan(0.001).select(float(0.65), float(0)))

    // Rich deep saturation: dark core shadow at grazing edges, vivid diffuse crest
    const shade = float(0.22).add(ndotl.mul(0.72)).add(cylShadow.mul(0.20)).mul(float(0.92).add(weave.mul(0.08)))
    const lit = baseColor
      .mul(shade)
      .add(vec3(1, 0.98, 0.94).mul(spec))
      .add(mix(baseColor, vec3(1, 0.98, 0.9), float(0.55)).mul(pulseBand))

    return premultipliedOutput(vec4(clamp(lit, vec3(0), vec3(1)), float(1)))
  })()

  return { material: mat, pulseUniform }
}

export function createCordShadowMaterial(): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const radialFade = sin(st.y.mul(Math.PI))
    const endFade = smoothstep(float(0), float(0.05), st.x).mul(smoothstep(float(1), float(0.95), st.x))
    const alpha = clamp(pow(max(radialFade, float(0.0001)), float(1.5)).mul(0.24).mul(endFade), float(0), float(0.30))
    const ink = vec3(0.015, 0.02, 0.035).mul(alpha)
    return premultipliedOutput(vec4(ink, alpha))
  })()

  return mat
}

export function createJackMetalMaterial(hex = '#b88928'): MeshBasicNodeMaterial {
  const tint = uniform(new THREE.Color(hex))
  const mat = new MeshBasicNodeMaterial({
    transparent: false,
    depthWrite: true,
    depthTest: true,
  })

  mat.outputNode = Fn(() => {
    const n = normalize(normalWorld)
    const lightDir = normalize(vec3(-0.42, 0.65, 0.63))
    const halfVec = normalize(lightDir.add(vec3(0, 0, 1)))
    const ndotl = clamp(dot(n, lightDir), float(0), float(1))
    const spec = pow(max(dot(n, halfVec), float(0.0001)), float(44)).mul(0.62)
    const rgb = tint.mul(float(0.26).add(ndotl.mul(0.84))).add(vec3(1, 0.97, 0.88).mul(spec))
    return premultipliedOutput(vec4(clamp(rgb, vec3(0), vec3(1)), float(1)))
  })()

  return mat
}
