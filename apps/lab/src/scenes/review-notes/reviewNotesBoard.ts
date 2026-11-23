// Review board — the motion state the page and the scene share.
// The page writes intent (a grab, a drop, a tick of "Resolved"); the scene
// advances each note's pose and the turntable from it every frame. React
// state holds content only, so a drag never re-renders the thread.

import type * as THREE from 'three'
import type { BodyAnchor } from './reviewNotesLaw'

/**
 * Where a note is in its life:
 * page → held (dragged, may preview on the body) → landing → stuck →
 * peeling → returning → page. A drop off the body goes held → returning.
 */
export type NotePhase = 'page' | 'held' | 'landing' | 'stuck' | 'peeling' | 'returning'

export interface NoteMotion {
  phase: NotePhase
  /** Seconds in the current phase. */
  t: number
  /** Drag offset from the thread slot, canvas px. */
  dx: number
  dy: number
  /** Where the note is (or is going) on the body. */
  anchor: BodyAnchor | null
  /** 0 flat in front of the camera, 1 stuck to the glaze. */
  wrap: number
  peel: number
  /** Opening: stick here once the scene holds the note, after `delay` s. */
  pinAt: BodyAnchor | null
  delay: number
  /** Stacking order on the body: the latest note to land lies on top. */
  layer: number
  /** World positions captured when a return flight starts. */
  from: Float32Array | null
}

export interface Board {
  notes: Map<string, NoteMotion>
  /** `target`: an angle the wheel is being turned to, or null when it runs free. */
  spin: { angle: number; velocity: number; dragging: boolean; target: number | null }
  /** The pointer in canvas px while a note is held. */
  pointer: { x: number; y: number }
  /** The body point under the pointer, written by the scene each frame. */
  hit: BodyAnchor | null
  turntable: THREE.Object3D | null
  hitTargets: THREE.Object3D[]
  body: THREE.Object3D | null
  /** Landings so far; the next note to land takes this as its layer. */
  landings: number
  /** Client px of content point (x, y) of a stuck note, for browser probes. */
  project: ((id: string, x: number, y: number) => { x: number; y: number } | null) | null
}

export function createBoard(): Board {
  return {
    notes: new Map(),
    spin: { angle: -0.35, velocity: 0, dragging: false, target: null },
    pointer: { x: 0, y: 0 },
    hit: null,
    turntable: null,
    hitTargets: [],
    body: null,
    landings: 0,
    project: null,
  }
}

export function noteMotion(pinAt: BodyAnchor | null, delay: number): NoteMotion {
  return { phase: 'page', t: 0, dx: 0, dy: 0, anchor: null, wrap: 0, peel: 0, pinAt, delay, layer: 0, from: null }
}

export function enterPhase(note: NoteMotion, phase: NotePhase): void {
  note.phase = phase
  note.t = 0
}
