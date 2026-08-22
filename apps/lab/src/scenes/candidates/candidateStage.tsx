// The candidates' shared rig — one camera, one lift, one clock.
//
// Seven prototypes share this file so that what differs between them is
// only the deformation, never the plumbing. Each candidate is a page with
// an overlay canvas over it: ordinary DOM until something is touched, a
// mesh standing exactly where that DOM stood for as long as the effect
// runs, ordinary DOM again afterwards.
//
// The law is the one flight states: the world unit is a CSS pixel. The
// camera is fitted so the plane z = 0 IS the viewport, which means a
// `getBoundingClientRect()` is already a world pose and no candidate
// carries a conversion function. Every displacement below is therefore
// written in pixels and means pixels.
//
// Ownership: this module owns the camera fit, the page→world reading, the
// lift handle's view state, and the 0→1 clock. It owns no geometry, no
// material, and no opinion about what an effect looks like.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  useSurface,
  useSurfaceState,
  type SurfaceHandle,
  type SurfaceState,
  type SurfaceView,
} from '@petepetrash/munari'
import { cameraDistance } from '@petepetrash/munari/advanced'

/** Shared by every candidate so a mesh can move between them unchanged. */
export const FOV = 42

// ── the camera: 1 world unit = 1 CSS px ─────────────────────────────────

export function PixelPerfect() {
  // SAFETY: r3f types the store's camera as the base class and hands back a
  // PerspectiveCamera unless the Canvas asks for `orthographic`, which none
  // of these candidates do — fitting the frustum to the viewport is what
  // makes a CSS pixel a world unit, and orthographic has no fov to fit.
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const setDpr = useThree((s) => s.setDpr)
  const dpr = useThree((s) => s.viewport.dpr)
  useEffect(() => {
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(size.height, FOV))
    camera.near = 1
    camera.far = camera.position.z * 3
    camera.updateProjectionMatrix()
  }, [camera, size.height])
  // The buffer follows the REAL devicePixelRatio, no ceiling. Browser zoom
  // multiplies dpr while shrinking the CSS viewport by the same factor, so
  // the buffer stays at physical-screen size at any zoom — a cap buys no
  // memory back, it only lowers quality. 2026-08-21: with the usual [1, 2]
  // clamp, a bench inspected at ~290% zoom drew the bead's silhouette in
  // ~3px stair steps while the DOM heading beside it — rasterized by the
  // page at the full zoomed density — stayed razor sharp. Polled per frame
  // like the knobs dial: zoom fires no dedicated event.
  useFrame(() => {
    const want = Math.max(1, window.devicePixelRatio)
    if (Math.abs(want - dpr) > 1e-3) setDpr(want)
  })
  return null
}

// ── page boxes, read as world poses ─────────────────────────────────────

export interface WorldBox {
  /** Center, in world units (= CSS px), origin at the viewport center. */
  x: number
  y: number
  w: number
  h: number
}

/** Where an element stands, in the scene's coordinates. */
export function worldBoxOf(el: HTMLElement | null): WorldBox | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return {
    x: r.left + r.width / 2 - window.innerWidth / 2,
    y: window.innerHeight / 2 - (r.top + r.height / 2),
    w: r.width,
    h: r.height,
  }
}

/** A viewport point (a click, the cursor) in the same coordinates. */
export function worldPoint(clientX: number, clientY: number): [number, number] {
  return [clientX - window.innerWidth / 2, window.innerHeight / 2 - clientY]
}

// ── the lift: a Surface that spends most of its life as page DOM ────────

export interface Lift {
  surface: SurfaceHandle
  view: SurfaceView
  state: SurfaceState
  /** True while the WebGL side should be mounted, including the linger. */
  mounted: boolean
  lift(): void
  drop(): void
  /** Wire to `onWebGLReleased` — unmounts the mesh after the pixels are back. */
  released(): void
}

/**
 * One piece of content that can change hands and change back.
 *
 * `mounted` is deliberately not `view === 'webgl'`: the protocol keeps the
 * presenter alive through its reclaim linger, and unmounting on the view
 * change instead would tear the mesh down inside the very commit that is
 * handing the pixels back — a one-frame hole where neither side draws.
 */
export function useLift(name: string): Lift {
  const surface = useSurface({ name })
  const state = useSurfaceState(surface)
  const [view, setView] = useState<SurfaceView>('dom')
  const [mounted, setMounted] = useState(false)
  const lift = useCallback(() => {
    setMounted(true)
    setView('webgl')
  }, [])
  const drop = useCallback(() => setView('dom'), [])
  const released = useCallback(() => setMounted(false), [])
  return { surface, view, state, mounted, lift, drop, released }
}

// ── uniforms the material actually reads ────────────────────────────────

/**
 * Give the material the uniform bag this component owns.
 *
 * r3f 9.7 stopped adopting the `uniforms` prop and started copying it entry
 * by entry into the material's own container ("uniforms must keep a stable
 * target reference"). An OBJECT-valued uniform survives that copy, because
 * both containers end up holding the same Vector or Texture instance. A
 * NUMBER does not: the material keeps its own `{ value }` box, and every
 * per-frame write to the memoized bag lands in an object nothing samples.
 *
 * The fault, 2026-08-20: five of seven candidates drew their t = 0 frame
 * forever. Their clocks were correct — phase.t reached 0.89 — and the
 * material's own uT read 0 on every frame. Only the two effects driven by
 * CPU vertex writes worked, because those never go through a uniform.
 *
 * Swapping the container back is one assignment and restores the pre-9.7
 * behavior. It runs on every render rather than on a dependency, because a
 * material remounted by a `key` change is a new material that nothing here
 * would otherwise be told about.
 */
export function useOwnUniforms<T extends object>(uniforms: T) {
  const ref = useRef<THREE.ShaderMaterial>(null)
  useLayoutEffect(() => {
    const material = ref.current
    if (!material) return
    // SAFETY: a uniform bag is `{ [name]: { value } }` by construction, and
    // every bag passed here is built from `textureSlot()` and literals of
    // that shape. The parameter stays generic because widening it to an
    // open dictionary would discard the exact per-material shape each
    // component relies on when it writes to its own uniforms.
    material.uniforms = uniforms as THREE.ShaderMaterial['uniforms']
  })
  return ref
}

// ── the clock ───────────────────────────────────────────────────────────

export interface Phase {
  /** 0 at the trigger, 1 at the end of the effect. */
  t: number
  running: boolean
}

export function usePhase(): React.RefObject<Phase> {
  return useRef<Phase>({ t: 0, running: false })
}

/**
 * Advance a phase inside the render loop, once.
 *
 * Mounted with the mesh and keyed with it, so a second trigger gets a
 * second clock rather than a finished one that never fires again.
 */
export function PhaseDrive({
  phase,
  durationMs,
  onDone,
}: {
  phase: React.RefObject<Phase>
  durationMs: number
  onDone: () => void
}) {
  const fired = useRef(false)
  useFrame((_, delta) => {
    const p = phase.current
    if (!p.running || fired.current) return
    // Clamped: a tab that was backgrounded hands back a delta of seconds,
    // and an effect that "already finished" while nobody was looking is a
    // piece of the page that vanishes on return.
    p.t = Math.min(1, p.t + (Math.min(delta, 1 / 30) * 1000) / durationMs)
    if (p.t >= 1) {
      fired.current = true
      p.running = false
      onDone()
    }
  })
  return null
}

// ── easings, shared so the candidates feel like one hand ────────────────

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function easeOutBack(t: number): number {
  const c = 1.70158
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}
