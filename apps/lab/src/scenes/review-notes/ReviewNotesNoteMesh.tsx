// Review note presenter — one note's paper in the scene: held flat in
// front of the teapot, pressed onto the glaze, peeled off and flown home.
//
// The law: every pose is written into the Surface geometry's vertices
// (deformSurfaceGeometry), so a click on the curved paper lands on the
// same pixel of the note's HTML that the eye sees there. Poses are blended
// in world space and converted into the mesh's parent, because the flat
// pose belongs to the camera and the stuck pose belongs to the turntable.
//
// Ownership: this file advances each note's phase from the board; the
// page owns intent and content, and finishes a return by handing the
// note back to the thread.

import { useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { deformSurfaceGeometry, Surface, type SurfaceHandle } from '@petepetrash/munari'
import { readSurfaceFrameState, useSurfaceFinishMaterial } from '@petepetrash/munari/advanced'
import { enterPhase, type Board, type NoteMotion } from './reviewNotesBoard'
import { PAPER_LIFT, PAPER_STACK, clampAnchor, easeInOut, easeOut, flatPoint, onBody, peeledPoint, wrappedPoint, type BodyAnchor, type CanvasRect } from './reviewNotesLaw'

export const NOTE_W = 232
export const NOTE_H = 136
const COLUMNS = 28
const ROWS = 16
// Depth of the held note, world px: in front of the spout tip (z ≈ 270 when
// it faces the camera), so a held note is never buried in the teapot.
const HELD_DEPTH = 330
const LAND_S = 0.5
const PEEL_S = 0.95
const RETURN_S = 0.8
// Emission that brings flat paper in the scene up to the page's brightness:
// under StudioLights a flat note measured (204,195,181) against the page's
// (255,253,248), about 0.6 of it in linear light (r1 captures, 23 Nov 2026).
const FLAT_EMISSION = 0.42
const EMISSION_STEP = 0.03

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _inverse = new THREE.Matrix4()

function slotRect(slot: HTMLElement, canvas: HTMLCanvasElement, note: NoteMotion): CanvasRect {
  const r = slot.getBoundingClientRect()
  const c = canvas.getBoundingClientRect()
  return { left: r.left - c.left + note.dx, top: r.top - c.top + note.dy, width: r.width, height: r.height }
}

/** How far each vertex has pressed onto the glaze: the centre touches first
 *  and the corners follow, the way a sticker goes on under a thumb. */
function pressWeight(x: number, y: number, wrap: number): number {
  const d = Math.hypot((x / NOTE_W - 0.5) * 2, (y / NOTE_H - 0.5) * 2) / Math.SQRT2
  return easeInOut(THREE.MathUtils.clamp(wrap * 1.55 - d * 0.55, 0, 1))
}

function smoothAnchor(current: BodyAnchor | null, target: BodyAnchor, k: number): BodyAnchor {
  if (!current) return target
  let dTheta = target.theta - current.theta
  dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta))
  return { theta: current.theta + dTheta * k, s: current.s + (target.s - current.s) * k }
}

/** Moves a note to its next phase when the current one has run its course. */
function advancePhase(note: NoteMotion, board: Board, scene: boolean, dt: number, world: Float32Array, onStuck: (anchor: BodyAnchor) => void) {
  if (note.phase === 'page' && scene && note.pinAt && note.t > note.delay) {
    note.anchor = clampAnchor(note.pinAt, onBody(NOTE_H))
    note.pinAt = null
    note.layer = ++board.landings
    enterPhase(note, 'landing')
  }
  if (note.phase === 'held' && scene) {
    const target = board.hit
    if (target) note.anchor = smoothAnchor(note.anchor, target, 1 - Math.exp(-dt * 22))
    const goal = target ? 1 : 0
    note.wrap += (goal - note.wrap) * (1 - Math.exp(-dt * 9))
  }
  if (note.phase === 'landing') {
    note.wrap = Math.max(note.wrap, easeOut(Math.min(1, note.t / LAND_S)))
    if (note.t >= LAND_S && note.anchor) {
      note.wrap = 1
      enterPhase(note, 'stuck')
      onStuck(note.anchor)
    }
  }
  if (note.phase === 'peeling') {
    note.peel = Math.min(1, note.t / PEEL_S)
    if (note.peel >= 1) {
      note.from = world.slice()
      enterPhase(note, 'returning')
    }
  }
  if (note.phase === 'returning' && !note.from) note.from = world.slice()
}

/** How close the paper is to its page pose, 0 to 1. Paper near the page pose
 *  must match the page note's brightness, so the handoff does not dim it. */
function paperFlatness(note: NoteMotion, returnProgress: number): number {
  if (note.phase === 'returning') return returnProgress
  if (note.phase === 'page') return 1
  if (note.phase === 'held' || note.phase === 'landing') return 1 - note.wrap
  return 0
}

export function ReviewNoteMesh({ id, surface, board, slotRef, onStuck, onReturned }: {
  id: string
  surface: SurfaceHandle
  board: Board
  slotRef: React.RefObject<HTMLElement | null>
  onStuck: (anchor: BodyAnchor) => void
  onReturned: () => void
}) {
  const mesh = useRef<THREE.Mesh>(null)
  const canvas = useThree(s => s.gl.domElement)
  const camera = useThree(s => s.camera)
  const size = useThree(s => s.size)
  const world = useMemo(() => new Float32Array((COLUMNS + 1) * (ROWS + 1) * 3), [])
  const pointerOn = useRef(false)
  const [interactive, setInteractive] = useState(false)
  const emissionShown = useRef(FLAT_EMISSION)
  const [emission, setEmission] = useState(FLAT_EMISSION)

  useFrame((_, delta) => {
    const note = board.notes.get(id)
    const m = mesh.current
    const slot = slotRef.current
    const turntable = board.turntable
    if (!note || !m || !slot || !turntable || !m.parent) return
    const dt = Math.min(delta, 1 / 20)
    note.t += dt
    advancePhase(note, board, readSurfaceFrameState(surface).presentation === 'scene', dt, world, onStuck)

    // ── the pose, in world space ──
    const flat = slotRect(slot, canvas, note)
    const D = camera.position.z
    const returning = note.phase === 'returning'
    const u = returning ? easeInOut(Math.min(1, note.t / RETURN_S)) : 0
    if (returning) {
      note.dx *= 1 - u
      note.dy *= 1 - u
    }
    const anchor = note.anchor
    const peeling = note.phase === 'peeling'
    turntable.updateWorldMatrix(true, false)
    m.parent.updateWorldMatrix(true, false)
    _inverse.copy(m.parent.matrixWorld).invert()
    const from = note.from
    deformSurfaceGeometry(m.geometry, [NOTE_W, NOTE_H], (x, y, v) => {
      flatPoint(x, y, NOTE_W, NOTE_H, flat, size, D, returning ? HELD_DEPTH * (1 - u) : HELD_DEPTH, _a)
      if (returning && from) {
        _b.set(from[v * 3], from[v * 3 + 1], from[v * 3 + 2])
        // An arc toward the camera, so the paper clears the spout on its way home.
        _a.lerp(_b, 1 - u)
        _a.z += Math.sin(Math.PI * u) * 90
      } else if (anchor && (note.wrap > 0 || peeling)) {
        if (peeling) peeledPoint(onBody(x), onBody(y), onBody(NOTE_W), onBody(NOTE_H), anchor, note.peel, _b)
        else wrappedPoint(onBody(x), onBody(y), onBody(NOTE_W), onBody(NOTE_H), anchor, _b, onBody(PAPER_LIFT + note.layer * PAPER_STACK))
        _b.applyMatrix4(turntable.matrixWorld)
        const w = peeling ? 1 : pressWeight(x, y, note.wrap)
        _a.lerp(_b, w)
      }
      world[v * 3] = _a.x; world[v * 3 + 1] = _a.y; world[v * 3 + 2] = _a.z
      _a.applyMatrix4(_inverse)
      return { x: _a.x + NOTE_W / 2, y: NOTE_H / 2 - _a.y, z: _a.z }
    })
    m.geometry.computeVertexNormals()

    if (returning && note.t >= RETURN_S) {
      note.dx = note.dy = 0
      note.wrap = note.peel = 0
      note.from = null
      note.anchor = null
      enterPhase(note, 'page')
      onReturned()
    }
    const target = Math.round((paperFlatness(note, u) * FLAT_EMISSION) / EMISSION_STEP) * EMISSION_STEP
    if (target !== emissionShown.current) {
      emissionShown.current = target
      setEmission(target)
    }
    const stuck = note.phase === 'stuck'
    if (stuck !== pointerOn.current) {
      pointerOn.current = stuck
      setInteractive(stuck)
    }
  })

  return (
    <Surface.Mesh
      ref={mesh}
      surface={surface}
      placement="manual"
      alpha="source"
      frustumCulled={false}
      pointerEvents={interactive ? 'geometry' : 'none'}
      geometry={<planeGeometry args={[NOTE_W, NOTE_H, COLUMNS, ROWS]} />}
      material={<NotePaper emission={emission} />}
    />
  )
}

// Matte paper whose body is the note's capture. Its emission follows how flat
// the paper lies, so it is written here rather than on the note's Root.
function NotePaper({ emission }: { emission: number }) {
  const finish = useMemo(() => ({ color: null, roughness: 0.5, emissiveIntensity: emission }), [emission])
  const material = useSurfaceFinishMaterial({ finish })
  return material ? <primitive object={material} attach="material" /> : null
}

