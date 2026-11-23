// Cutaway product — a procedural fixed-lens compact whose casing the sheet's
// plane cuts away while its parts stay whole.
//
// The law: casing and parts differ in one way only. Casing takes the cut
// material, so it vanishes on the viewer's side of the sheet and shows a
// hatched red face where it was cut. Parts are ordinary lit meshes, so as the
// sheet moves deeper they cross in front of the text and cast shadows on it.
//
// Ownership: this module owns geometry and materials. The scene owns the
// plane's depth, which reaches the materials through the shared uniforms.

import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { useSurfaceTextureOf, type SurfaceHandle } from '@petepetrash/munari'
import {
  BODY,
  BODY_FRONT_Z,
  CAVITY,
  DIVIDER,
  FILTER,
  LENS_ELEMENTS,
  MAIN_BOARD,
  OPTICAL_AXIS,
  SENSOR_BOARD,
  SENSOR_SIZE,
  SENSOR_Z,
  SHUTTER,
  TOP_PLATE_Y,
  type LensElement,
} from './cutawayModel'
import {
  createCasingMaterial,
  createGhostMaterial,
  createGlassMaterial,
  FILTER_TINT_RGB,
  type CutawayUniforms,
} from './cutawayNodes'

const noRaycast = () => {}

/** Reverse a closed shell's winding and normals so its front faces look inward. */
function inverted(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flipped = geometry
  const index = flipped.index
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1)
      index.setX(i + 1, index.getX(i + 2))
      index.setX(i + 2, b)
    }
  } else {
    const position = flipped.getAttribute('position')
    const normal = flipped.getAttribute('normal')
    const uvs = flipped.getAttribute('uv')
    for (let i = 0; i < position.count; i += 3) {
      for (const attribute of [position, normal, uvs]) {
        if (!attribute) continue
        for (let c = 0; c < attribute.itemSize; c++) {
          const a = attribute.getComponent(i + 1, c)
          attribute.setComponent(i + 1, c, attribute.getComponent(i + 2, c))
          attribute.setComponent(i + 2, c, a)
        }
      }
    }
  }
  const normal = flipped.getAttribute('normal')
  for (let i = 0; i < normal.count; i++) {
    normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i))
  }
  return flipped
}

function lensGeometry(element: LensElement): THREE.LatheGeometry {
  const steps = 18
  const { radius, thickness, frontSag, backSag } = element
  const points: THREE.Vector2[] = []
  for (let i = 0; i <= steps; i++) {
    const r = (radius * i) / steps
    const k = (r / radius) ** 2
    points.push(new THREE.Vector2(r, -thickness / 2 + backSag * k))
  }
  for (let i = steps; i >= 0; i--) {
    const r = (radius * i) / steps
    const k = (r / radius) ** 2
    points.push(new THREE.Vector2(r, thickness / 2 - frontSag * k))
  }
  return new THREE.LatheGeometry(points, 72)
}

function roundedRectLoop(halfW: number, halfH: number, radius: number, z: number, out: number[]): void {
  const corners: [number, number, number][] = [
    [halfW - radius, halfH - radius, 0],
    [-halfW + radius, halfH - radius, Math.PI / 2],
    [-halfW + radius, -halfH + radius, Math.PI],
    [halfW - radius, -halfH + radius, (3 * Math.PI) / 2],
  ]
  const loop: THREE.Vector3[] = []
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= 6; i++) {
      const a = start + ((Math.PI / 2) * i) / 6
      loop.push(new THREE.Vector3(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, z))
    }
  }
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    if (a && b) out.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }
}

function circleLoop(cx: number, cy: number, radius: number, z: number, out: number[]): void {
  const steps = 64
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const b = ((i + 1) / steps) * Math.PI * 2
    out.push(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, z, cx + Math.cos(b) * radius, cy + Math.sin(b) * radius, z)
  }
}

/** Outline of the casing and lens barrel the cut removes. */
function ghostGeometry(): THREE.BufferGeometry {
  const out: number[] = []
  const halfW = BODY.width / 2
  const halfH = BODY.height / 2
  roundedRectLoop(halfW, halfH, BODY.radius, BODY_FRONT_Z, out)
  roundedRectLoop(halfW, halfH, BODY.radius, -BODY_FRONT_Z, out)
  for (const [x, y] of [[halfW, halfH], [-halfW, halfH], [-halfW, -halfH], [halfW, -halfH]] as const) {
    out.push(x - Math.sign(x) * 1.5, y - Math.sign(y) * 1.5, BODY_FRONT_Z, x - Math.sign(x) * 1.5, y - Math.sign(y) * 1.5, -BODY_FRONT_Z)
  }
  out.push(-halfW, TOP_PLATE_Y, BODY_FRONT_Z, halfW, TOP_PLATE_Y, BODY_FRONT_Z)
  const { x, y } = OPTICAL_AXIS
  for (const [radius, z] of [[17.5, BODY_FRONT_Z], [16.5, 27], [15.5, 37.5], [13.5, 37.5]] as const) {
    circleLoop(x, y, radius, z, out)
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    out.push(x + Math.cos(a) * 24, y + Math.sin(a) * 24, BODY_FRONT_Z, x + Math.cos(a) * 23, y + Math.sin(a) * 23, 49.5)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
  return geometry
}

function shutterGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, SHUTTER.outerRadius, 0, Math.PI * 2, false)
  const hole = new THREE.Path()
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    const px = Math.cos(a) * SHUTTER.apertureRadius
    const py = Math.sin(a) * SHUTTER.apertureRadius
    if (i === 0) hole.moveTo(px, py)
    else hole.lineTo(px, py)
  }
  shape.holes.push(hole)
  return new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: false, curveSegments: 48 })
}

function batteryLabel(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 280
  canvas.height = 1040
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('battery label needs a 2D canvas')
  ctx.fillStyle = '#2a2b2d'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#d8d6cf'
  ctx.fillRect(0, 70, canvas.width, 6)
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#a9a79f'
  ctx.font = '600 38px Archivo, sans-serif'
  ctx.fillText('Li-ion  7.2 V', 0, -16)
  ctx.font = '400 30px Archivo, sans-serif'
  ctx.fillText('1260 mAh · 9.1 Wh', 0, 28)
  ctx.restore()
  ctx.font = '700 60px Archivo, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ecebe6'
  ctx.fillText('+', canvas.width / 2, 56)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** Deterministic scatter of 0402 passives around the sensor package. */
function passivePlacements(count: number, seed: number): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = []
  let s = seed
  const next = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  const [sw, sh] = SENSOR_SIZE
  while (out.length < count) {
    const x = (next() - 0.5) * (SENSOR_BOARD.width - 6)
    const y = (next() - 0.5) * (SENSOR_BOARD.height - 6)
    if (Math.abs(x) < sw / 2 + 6 && Math.abs(y) < sh / 2 + 7) continue
    const m = new THREE.Matrix4()
    m.makeRotationZ(next() > 0.5 ? 0 : Math.PI / 2)
    m.setPosition(x, y, SENSOR_BOARD.thickness / 2 + 0.25)
    out.push(m)
  }
  return out
}

function Casing({ uniforms }: { readonly uniforms: CutawayUniforms }) {
  const materials = useMemo(() => ({
    body: createCasingMaterial(uniforms, 'body'),
    interior: createCasingMaterial(uniforms, 'interior'),
    metal: createCasingMaterial(uniforms, 'metal'),
  }), [uniforms])
  const geometry = useMemo(() => {
    const outer = new RoundedBoxGeometry(BODY.width, BODY.height, BODY.depth, 4, BODY.radius)
    const inner = inverted(new RoundedBoxGeometry(CAVITY.halfWidth * 2, CAVITY.halfHeight * 2, CAVITY.halfDepth * 2, 3, 2.5))
    const divider = new THREE.BoxGeometry(DIVIDER.thickness, CAVITY.halfHeight * 2, CAVITY.halfDepth * 2)
    return { outer, inner, divider }
  }, [])
  useLayoutEffect(() => () => {
    for (const m of Object.values(materials)) m.dispose()
    for (const g of Object.values(geometry)) g.dispose()
  }, [materials, geometry])
  const top = BODY.height / 2
  return (
    <group raycast={noRaycast}>
      <mesh geometry={geometry.outer} material={materials.body} raycast={noRaycast} />
      <mesh geometry={geometry.inner} material={materials.interior} raycast={noRaycast} />
      <mesh geometry={geometry.divider} material={materials.interior} position={[DIVIDER.x, 0, 0]} raycast={noRaycast} />
      {/* Mode dial, shutter button and hot shoe: solid, so their back faces cap them too. */}
      <mesh material={materials.metal} position={[-34, top + 1.1, -3]} raycast={noRaycast}>
        <cylinderGeometry args={[10, 10, 2.2, 64]} />
      </mesh>
      <mesh material={materials.metal} position={[-34, top + 4.4, -3]} raycast={noRaycast}>
        <cylinderGeometry args={[9, 9, 4.4, 48]} />
      </mesh>
      <mesh material={materials.metal} position={[-12, top + 0.7, -1]} raycast={noRaycast}>
        <cylinderGeometry args={[6, 6, 1.4, 48]} />
      </mesh>
      <mesh material={materials.body} position={[-12, top + 2.4, -1]} raycast={noRaycast}>
        <cylinderGeometry args={[4.2, 4.2, 2.2, 48]} />
      </mesh>
      <mesh material={materials.metal} position={[12, top + 1.1, -2]} raycast={noRaycast}>
        <boxGeometry args={[19, 2.2, 18]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} material={materials.metal} position={[side * (BODY.width / 2 + 1.6), 20, 0]} rotation={[0, 0, Math.PI / 2]} raycast={noRaycast}>
          <cylinderGeometry args={[2.6, 2.6, 3.2, 32]} />
        </mesh>
      ))}
    </group>
  )
}

function Ghost({ uniforms }: { readonly uniforms: CutawayUniforms }) {
  const material = useMemo(() => createGhostMaterial(uniforms), [uniforms])
  const geometry = useMemo(ghostGeometry, [])
  useLayoutEffect(() => () => {
    material.dispose()
    geometry.dispose()
  }, [material, geometry])
  return <lineSegments geometry={geometry} material={material} raycast={noRaycast} />
}

function Optics({ uniforms }: { readonly uniforms: CutawayUniforms }) {
  const elements = useMemo(
    () => LENS_ELEMENTS.map((element, i) => ({
      element,
      geometry: lensGeometry(element),
      material: createGlassMaterial(uniforms, {
        ior: i % 2 === 0 ? 1.62 : 1.72,
        rimRadius: element.radius,
        element: { z: element.z, focalLength: element.focalLength },
        tint: new THREE.Color(i === 0 ? 0.86 : 0.93, i === 0 ? 0.95 : 0.96, i === 0 ? 0.9 : 0.98),
      }),
    })),
    [uniforms],
  )
  const filter = useMemo(
    () => createGlassMaterial(uniforms, { ior: 1.52, tint: new THREE.Color(...FILTER_TINT_RGB) }),
    [uniforms],
  )
  const shutter = useMemo(shutterGeometry, [])
  useLayoutEffect(() => () => {
    for (const { geometry, material } of elements) {
      geometry.dispose()
      material.dispose()
    }
    filter.dispose()
    shutter.dispose()
  }, [elements, filter, shutter])
  return (
    <group position={[OPTICAL_AXIS.x, OPTICAL_AXIS.y, 0]}>
      {elements.map(({ element, geometry, material }) => (
        <mesh key={element.z} geometry={geometry} material={material} position={[0, 0, element.z]} rotation={[Math.PI / 2, 0, 0]} />
      ))}
      <mesh geometry={shutter} position={[0, 0, SHUTTER.z - 0.35]} castShadow>
        <meshStandardMaterial color="#18191c" roughness={0.42} metalness={0.8} />
      </mesh>
      <mesh material={filter} position={[0, 0, FILTER.z]}>
        <boxGeometry args={[FILTER.width, FILTER.height, FILTER.thickness]} />
      </mesh>
    </group>
  )
}

function SensorBoard() {
  const passives = useRef<THREE.InstancedMesh>(null)
  const placements = useMemo(() => passivePlacements(56, 7), [])
  useLayoutEffect(() => {
    const mesh = passives.current
    if (!mesh) return
    placements.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceMatrix.needsUpdate = true
  }, [placements])
  const [sw, sh] = SENSOR_SIZE
  const half = SENSOR_BOARD.thickness / 2
  return (
    <group position={[OPTICAL_AXIS.x, OPTICAL_AXIS.y, SENSOR_BOARD.z]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[SENSOR_BOARD.width, SENSOR_BOARD.height, SENSOR_BOARD.thickness]} />
        <meshStandardMaterial color="#123d2a" roughness={0.5} metalness={0.05} />
      </mesh>
      {/* Ceramic package, gold bond fingers, then the die under its cover glass. */}
      <mesh position={[0, 0, half + 0.2]} castShadow receiveShadow>
        <boxGeometry args={[sw + 8.5, sh + 10.4, 0.4]} />
        <meshStandardMaterial color="#d9d2c0" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, half + 0.42]}>
        <boxGeometry args={[sw + 3, sh + 3, 0.05]} />
        <meshStandardMaterial color="#c9a043" roughness={0.3} metalness={1} />
      </mesh>
      <mesh position={[0, 0, SENSOR_Z - SENSOR_BOARD.z - 0.04]}>
        <boxGeometry args={[sw, sh, 0.08]} />
        <meshStandardMaterial color="#2a2233" roughness={0.12} metalness={0.55} />
      </mesh>
      <instancedMesh ref={passives} args={[undefined, undefined, placements.length]} castShadow>
        <boxGeometry args={[1, 0.5, 0.5]} />
        <meshStandardMaterial color="#8a6f4e" roughness={0.6} />
      </instancedMesh>
      {/* Amber polyimide flex down to the main board. */}
      <mesh position={[0, -SENSOR_BOARD.height / 2 - 0.4, (MAIN_BOARD.z - SENSOR_BOARD.z) / 2]} castShadow>
        <boxGeometry args={[16, 0.25, SENSOR_BOARD.z - MAIN_BOARD.z]} />
        <meshStandardMaterial color="#b8701e" roughness={0.45} />
      </mesh>
    </group>
  )
}

function MainBoard() {
  const half = MAIN_BOARD.thickness / 2
  return (
    <group position={[OPTICAL_AXIS.x + 3, OPTICAL_AXIS.y + 2, MAIN_BOARD.z]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[MAIN_BOARD.width, MAIN_BOARD.height, MAIN_BOARD.thickness]} />
        <meshStandardMaterial color="#0f3323" roughness={0.5} />
      </mesh>
      <mesh position={[-10, 14, half + 0.7]} castShadow>
        <boxGeometry args={[14, 14, 1.4]} />
        <meshStandardMaterial color="#101113" roughness={0.35} />
      </mesh>
      <mesh position={[-10, 14, half + 1.45]}>
        <boxGeometry args={[11, 11, 0.1]} />
        <meshStandardMaterial color="#9c9ea3" roughness={0.25} metalness={1} />
      </mesh>
      <mesh position={[6, 16, half + 0.5]} castShadow>
        <boxGeometry args={[12, 8, 1]} />
        <meshStandardMaterial color="#141517" roughness={0.4} />
      </mesh>
      <mesh position={[12, -14, half + 1.1]} castShadow>
        <boxGeometry args={[18, 16, 2.2]} />
        <meshStandardMaterial color="#b9bbbf" roughness={0.3} metalness={1} />
      </mesh>
    </group>
  )
}

function Battery() {
  const label = useMemo(batteryLabel, [])
  useLayoutEffect(() => () => label.dispose(), [label])
  const width = CAVITY.halfWidth + DIVIDER.x - DIVIDER.thickness / 2 - 1
  const x = (-CAVITY.halfWidth + DIVIDER.x - DIVIDER.thickness / 2) / 2
  const depth = 20
  return (
    <group position={[x, -2, -3]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, 54, depth]} />
        <meshStandardMaterial color="#2a2b2d" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0, depth / 2 + 0.02]}>
        <planeGeometry args={[width, 54]} />
        <meshStandardMaterial map={label} roughness={0.55} />
      </mesh>
    </group>
  )
}

function RearDisplay() {
  return (
    <mesh position={[10, 0, -CAVITY.halfDepth + 1.2]} receiveShadow>
      <boxGeometry args={[76, 51, 2.4]} />
      <meshStandardMaterial color="#07080a" roughness={0.2} metalness={0.3} />
    </mesh>
  )
}

export function CutawayProduct({ uniforms, sheet }: { readonly uniforms: CutawayUniforms; readonly sheet: SurfaceHandle }) {
  const capture = useSurfaceTextureOf(sheet)
  useLayoutEffect(() => {
    if (!capture) return
    uniforms.sheetCapture.value = capture
    uniforms.captureReady.value = 1
  }, [capture, uniforms])
  return (
    <group>
      <Casing uniforms={uniforms} />
      <Ghost uniforms={uniforms} />
      <Optics uniforms={uniforms} />
      <SensorBoard />
      <MainBoard />
      <Battery />
      <RearDisplay />
    </group>
  )
}
