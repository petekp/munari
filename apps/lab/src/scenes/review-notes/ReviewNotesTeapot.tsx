// Review teapot — a stoneware teapot turned on a lathe, standing on a
// cast-iron banding wheel. Procedural, so no model licence is involved.
// The wheel coasts with friction after a flick; the notes ride its group.
// Ownership: this file owns the meshes, the lights and the wheel's spin;
// the board owns the spin state the page writes into.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { BODY, FOOT_PROFILE, KNOB_PROFILE, LID_PROFILE, bodyArcAtHeight, clampAnchor, freeAnchor, onBody, TEAPOT_SCALE, wrappedPoint, type BodyAnchor } from './reviewNotesLaw'
import type { Board } from './reviewNotesBoard'

// A cast-iron wheel's coast-down: velocity halves in about 0.8 s.
const SPIN_DECAY_S = 1.15
// Turning to a note: the remaining angle shrinks by e every 1/6 s.
const TURN_RATE = 6

const WHEEL_RADIUS = 236
const WHEEL_TOP = -2

function lathe(profile: readonly (readonly [number, number])[] | readonly THREE.Vector2[], segments = 160): THREE.LatheGeometry {
  const points = profile.map(p => p instanceof THREE.Vector2 ? p : new THREE.Vector2(p[0], p[1]))
  const geometry = new THREE.LatheGeometry(points, segments)
  geometry.computeVertexNormals()
  return geometry
}

/** A tube whose radius tapers along its curve, for the spout. */
function taperedTube(curve: THREE.Curve<THREE.Vector3>, radius: (t: number) => number, rings = 48, sides = 32): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(rings, false)
  const positions: number[] = []
  const uvs: number[] = []
  const index: number[] = []
  const p = new THREE.Vector3(), n = new THREE.Vector3()
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    curve.getPointAt(t, p)
    const r = radius(t)
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a))
      positions.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r)
      uvs.push(j / sides, t)
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j, b = a + sides + 1
      index.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** The machined top of the wheel: turning grooves and a degree ring. */
function wheelTexture(): THREE.CanvasTexture {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable for the banding wheel texture')
  const c = size / 2
  g.fillStyle = '#4a4b4d'
  g.fillRect(0, 0, size, size)
  for (let r = 4; r < c; r += 3) {
    g.strokeStyle = `rgba(255,255,255,${0.025 + 0.03 * Math.abs(Math.sin(r * 0.37))})`
    g.lineWidth = 1
    g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke()
  }
  g.strokeStyle = 'rgba(236,232,222,0.7)'
  for (let d = 0; d < 360; d += 5) {
    const a = (d * Math.PI) / 180
    const long = d % 30 === 0
    const r0 = c - 10, r1 = c - (long ? 34 : 22)
    g.lineWidth = long ? 3 : 1.5
    g.beginPath()
    g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0)
    g.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1)
    g.stroke()
    if (long) {
      g.save()
      g.translate(c + Math.sin(a) * (c - 56), c - Math.cos(a) * (c - 56))
      // Numerals stand with their feet to the rim, so the ones nearest the viewer read upright.
      g.rotate(a + Math.PI)
      g.fillStyle = 'rgba(236,232,222,0.8)'
      g.font = '600 22px "Courier Prime", monospace'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(String(d), 0, 0)
      g.restore()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

// The pointer bridge raycasts only Surface meshes, so a press on the spout
// would reach a note hidden behind it. Nearer meshes that stop propagation
// end R3F's delivery before it reaches the paper (23 Nov 2026: without them
// a click on the spout focused the note wrapped behind it).
const stop = (event: ThreeEvent<PointerEvent | MouseEvent>) => event.stopPropagation()
const occluder = { onPointerDown: stop, onPointerUp: stop, onPointerMove: stop, onClick: stop }

export function Teapot({ board }: { board: Board }) {
  const turntable = useRef<THREE.Group>(null)
  const body = useRef<THREE.Mesh>(null)
  const spout = useRef<THREE.Mesh>(null)
  const handle = useRef<THREE.Mesh>(null)
  const lid = useRef<THREE.Mesh>(null)
  const geometry = useMemo(() => {
    const spoutCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(150, 118, 0), new THREE.Vector3(196, 148, 0), new THREE.Vector3(232, 200, 0), new THREE.Vector3(258, 252, 0), new THREE.Vector3(270, 268, 0),
    ])
    const handleCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-168, 252, 0), new THREE.Vector3(-232, 262, 0), new THREE.Vector3(-268, 214, 0), new THREE.Vector3(-262, 140, 0), new THREE.Vector3(-214, 92, 0), new THREE.Vector3(-186, 84, 0),
    ])
    const wheelTop = new THREE.CircleGeometry(WHEEL_RADIUS, 128).rotateX(-Math.PI / 2)
    return {
      foot: lathe(FOOT_PROFILE),
      body: lathe(BODY.points, 192),
      lid: lathe(LID_PROFILE),
      knob: lathe(KNOB_PROFILE, 64),
      spout: taperedTube(spoutCurve, t => 31 - 19 * t + (t > 0.94 ? (t - 0.94) * 60 : 0)),
      handle: new THREE.TubeGeometry(handleCurve, 64, 12.5, 24, false),
      wheelTop,
      wheelRim: new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS - 6, 20, 128, 1, true),
      wheelBase: new THREE.CylinderGeometry(132, 156, 36, 96),
      wheelSpindle: new THREE.CylinderGeometry(30, 30, 40, 32),
    }
  }, [])
  const materials = useMemo(() => ({
    // Kaki: an iron-saturated tenmoku that fires to persimmon rust, light
    // enough for the key light to show the belly's curve.
    glaze: new THREE.MeshPhysicalMaterial({ color: '#8a4424', roughness: 0.34, clearcoat: 0.7, clearcoatRoughness: 0.18, metalness: 0 }),
    rim: new THREE.MeshPhysicalMaterial({ color: '#5a2e17', roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
    bisque: new THREE.MeshStandardMaterial({ color: '#c7ae8b', roughness: 0.92 }),
    wheel: new THREE.MeshStandardMaterial({ map: wheelTexture(), roughness: 0.55, metalness: 0.55 }),
    iron: new THREE.MeshStandardMaterial({ color: '#3a3b3d', roughness: 0.6, metalness: 0.6 }),
  }), [])
  useEffect(() => () => {
    for (const g of Object.values(geometry)) g.dispose()
    for (const m of Object.values(materials)) { m.dispose(); if ('map' in m && m.map) m.map.dispose() }
  }, [geometry, materials])

  useEffect(() => {
    board.turntable = turntable.current
    board.body = body.current
    board.hitTargets = [body.current, spout.current, handle.current, lid.current].filter((o): o is THREE.Mesh => o !== null)
    return () => { board.turntable = null; board.body = null; board.hitTargets = [] }
  }, [board])

  useFrame((_, delta) => {
    const spin = board.spin
    const dt = Math.min(delta, 1 / 20)
    if (!spin.dragging && spin.target !== null) {
      const remaining = spin.target - spin.angle
      spin.angle += remaining * (1 - Math.exp(-dt * TURN_RATE))
      spin.velocity = 0
      if (Math.abs(remaining) < 0.0005) { spin.angle = spin.target; spin.target = null }
    } else if (!spin.dragging) {
      spin.angle += spin.velocity * dt
      spin.velocity *= Math.exp(-dt / SPIN_DECAY_S)
      if (Math.abs(spin.velocity) < 0.002) spin.velocity = 0
    }
    if (turntable.current) turntable.current.rotation.y = spin.angle
  })

  return (
    <group ref={turntable} scale={TEAPOT_SCALE}>
      <mesh geometry={geometry.foot} material={materials.bisque} castShadow receiveShadow />
      <mesh ref={body} geometry={geometry.body} material={materials.glaze} castShadow receiveShadow />
      <mesh ref={lid} geometry={geometry.lid} material={materials.rim} castShadow {...occluder} />
      <mesh geometry={geometry.knob} material={materials.glaze} castShadow {...occluder} />
      <mesh ref={spout} geometry={geometry.spout} material={materials.glaze} castShadow receiveShadow {...occluder} />
      <mesh ref={handle} geometry={geometry.handle} material={materials.glaze} castShadow receiveShadow {...occluder} />
      <mesh geometry={geometry.wheelTop} material={materials.wheel} position-y={WHEEL_TOP} receiveShadow />
      <mesh geometry={geometry.wheelRim} material={materials.iron} position-y={WHEEL_TOP - 10} />
      <mesh geometry={geometry.wheelSpindle} material={materials.iron} position-y={WHEEL_TOP - 40} />
      <mesh geometry={geometry.wheelBase} material={materials.iron} position-y={WHEEL_TOP - 72} receiveShadow />
    </group>
  )
}

const _ray = new THREE.Raycaster()
const _ndc = new THREE.Vector2()
const _inverse = new THREE.Matrix4()

/** Finds the glazed body under the held note's pointer each frame. The spout
 *  and handle count as misses, so a note cannot stick through them. */
export function BodyFinder({ board, noteWidth, noteHeight }: { board: Board; noteWidth: number; noteHeight: number }) {
  const camera = useThree(s => s.camera)
  const size = useThree(s => s.size)
  const canvas = useThree(s => s.gl.domElement)
  useEffect(() => {
    board.project = (id, x, y) => {
      const anchor = board.notes.get(id)?.anchor
      if (!anchor || !board.turntable) return null
      const p = wrappedPoint(onBody(x), onBody(y), onBody(noteWidth), onBody(noteHeight), anchor, new THREE.Vector3()).applyMatrix4(board.turntable.matrixWorld).project(camera)
      const c = canvas.getBoundingClientRect()
      return { x: c.left + (p.x + 1) / 2 * c.width, y: c.top + (1 - p.y) / 2 * c.height }
    }
    return () => { board.project = null }
  }, [board, camera, canvas, noteWidth, noteHeight])
  useFrame(() => {
    const held = [...board.notes.values()].some(note => note.phase === 'held')
    if (!held || !board.turntable || !board.body) { board.hit = null; return }
    _ndc.set((board.pointer.x / size.width) * 2 - 1, -(board.pointer.y / size.height) * 2 + 1)
    _ray.setFromCamera(_ndc, camera)
    const first = _ray.intersectObjects(board.hitTargets, false)[0]
    if (!first || first.object !== board.body) { board.hit = null; return }
    _inverse.copy(board.turntable.matrixWorld).invert()
    const local = first.point.clone().applyMatrix4(_inverse)
    const anchor: BodyAnchor = { theta: Math.atan2(local.x, local.z), s: bodyArcAtHeight(local.y) }
    const others = [...board.notes.values()].filter(note => note.phase === 'landing' || note.phase === 'stuck').flatMap(note => note.anchor ? [note.anchor] : [])
    board.hit = freeAnchor(clampAnchor(anchor, onBody(noteHeight)), others, onBody(noteWidth), onBody(noteHeight))
  })
  return null
}

/** Studio light: a raking key from the left, so the belly shades across each note, and a cool rim from behind right. */
export function StudioLights() {
  return (
    <>
      <hemisphereLight args={['#fbf7ef', '#8f8170', 1.1]} />
      <directionalLight
        position={[-980, 760, 520]}
        intensity={2.9}
        color="#fff5e6"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-640}
        shadow-camera-right={640}
        shadow-camera-top={640}
        shadow-camera-bottom={-640}
        shadow-camera-near={100}
        shadow-camera-far={3000}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[700, 380, -620]} intensity={1.6} color="#dfe8ff" />
      <pointLight position={[240, 520, 520]} intensity={0.25} distance={0} decay={0} color="#ffffff" />
    </>
  )
}
