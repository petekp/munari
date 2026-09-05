// The shared mechanism under every physical control: a 1-DOF body driven by
// a force field (@munari/core's physics1D), coupled kinematically to the
// hand during a drag, free-running otherwise.
//
// Interaction contracts baked in (each one paid for in an earlier lab):
// - Drags compute from e.ray ∩ a drag plane on the control's face — never
//   from e.point, which freezes at the mesh boundary under pointer capture.
// - Pointer capture on the event object keeps the drag alive off-mesh.
// - Gesture velocity is tracked (lerp-smoothed) and handed to the field on
//   release — flicks are real momentum, not synthesized animation.
// - Camera controls are disabled for the duration of a drag.

import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { step, type Body1D, type Field } from '@munari/core'
import { useLatest } from '../useLatest'

export interface Use1DOFOptions {
  field: Field
  initialQ?: number
  /** Convert a drag-plane point in the handler object's local space to q. */
  localToQ: (local: THREE.Vector3) => number
  /** Delta wrapper: pass wrapAngle for rotary controls; identity default. */
  wrapDelta?: (delta: number) => number
  /** Clamp kinematic q during drag (a hand can't pull past hard limits). */
  clampQ?: (q: number) => number
  /** Every frame: apply q to transforms, emit live values. */
  onFrame?: (q: number, v: number, dragging: boolean) => void
  /** Once, when the body comes to rest after any disturbance. */
  onSettle?: (q: number) => void
}

// Rest = |v| under SETTLE_V for SETTLE_FRAMES consecutive frames. The
// consecutive count matters: a body reversing direction passes through
// v≈0, and that instant must not read as rest. Both values are verbatim
// from the pre-repo oracle port; no measurement pins them.
const SETTLE_V = 1e-3
const SETTLE_FRAMES = 15

// A drag whose release lands more than STILL_RELEASE_S after its last
// pointermove was a still hand, not a flick. pointermove is the only writer
// of `b.v` while a drag is active and useFrame skips the integrator then,
// so a hand held still after its last move leaves the smoothed velocity
// frozen at a stale estimate instead of decaying to the hand's actual
// (zero) speed — release would hand the field a synthesized fling. The
// guard in endDrag zeros it across that gap; a genuine flick's last move
// lands inside the gate, so its tracked momentum still flows into the
// field (file header: "flicks are real momentum"). 0.1s sits well past
// inter-event spacing during active motion (pointermove fires at 60-120Hz,
// ≈ 8-16ms) and short enough that a hand held still for even a beat reads
// as still.
export const STILL_RELEASE_S = 0.1

export function use1DOF(opts: Use1DOFOptions) {
  // SAFETY: r3f's store types `controls` as a bare event target — whatever
  // the app set, if anything. Every control set this hook suspends carries
  // `enabled`; the key stays optional so one that does not is simply never
  // disabled, not a crash.
  const controls = useThree((s) => s.controls as { enabled?: boolean } | null)
  const body = useRef<Body1D>({ q: opts.initialQ ?? 0, v: 0 })
  // Latest options in a ref so handlers/useFrame never see stale closures.
  const optsRef = useLatest(opts)

  const drag = useRef({ active: false, offset: 0, lastT: 0 })
  const rest = useRef({ settled: true, frames: 0 })
  const plane = useRef(new THREE.Plane())
  const hit = useRef(new THREE.Vector3())

  const disturb = () => {
    rest.current.settled = false
    rest.current.frames = 0
  }

  const rawQ = (e: ThreeEvent<PointerEvent>) => {
    if (!e.ray.intersectPlane(plane.current, hit.current)) return null
    return optsRef.current.localToQ(e.eventObject.worldToLocal(hit.current))
  }

  const wrap = (d: number) => optsRef.current.wrapDelta?.(d) ?? d

  const bind = useMemo(
    () => ({
      onPointerDown: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        const obj = e.eventObject
        plane.current.setFromNormalAndCoplanarPoint(
          obj.getWorldDirection(new THREE.Vector3()),
          obj.getWorldPosition(new THREE.Vector3()),
        )
        const raw = rawQ(e)
        if (raw === null) return
        if (e.target instanceof Element) e.target.setPointerCapture(e.pointerId)
        if (controls) controls.enabled = false
        const d = drag.current
        d.active = true
        d.offset = wrap(body.current.q - raw)
        d.lastT = e.timeStamp
        body.current.v = 0
        disturb()
      },
      onPointerMove: (e: ThreeEvent<PointerEvent>) => {
        const d = drag.current
        if (!d.active) return
        e.stopPropagation()
        const raw = rawQ(e)
        if (raw === null) return
        const b = body.current
        let delta = wrap(raw + d.offset - b.q)
        const clamp = optsRef.current.clampQ
        if (clamp) delta = clamp(b.q + delta) - b.q
        const dt = Math.max((e.timeStamp - d.lastT) / 1000, 1e-4)
        b.v = THREE.MathUtils.lerp(b.v, delta / dt, 0.35)
        b.q += delta
        d.lastT = e.timeStamp
      },
      onPointerUp: (e: ThreeEvent<PointerEvent>) => endDrag(e),
      onLostPointerCapture: (e: ThreeEvent<PointerEvent>) => endDrag(e),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controls],
  )

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d.active) return
    d.active = false
    body.current.v = releaseVelocity(
      body.current.v,
      (e.timeStamp - d.lastT) / 1000,
      STILL_RELEASE_S,
    )
    if (e.target instanceof Element) e.target.releasePointerCapture?.(e.pointerId)
    if (controls) controls.enabled = true
  }

  /** Kick the body (a toggle tap, a scripted nudge). */
  const impulse = (dv: number) => {
    body.current.v += dv
    disturb()
  }

  useFrame((_, delta) => {
    const b = body.current
    const d = drag.current
    if (!d.active) step(b, optsRef.current.field, Math.min(delta, 1 / 30), 2)
    const r = rest.current
    if (!r.settled) {
      if (!d.active && Math.abs(b.v) < SETTLE_V) {
        if (++r.frames >= SETTLE_FRAMES) {
          r.settled = true
          optsRef.current.onSettle?.(b.q)
        }
      } else {
        r.frames = 0
      }
    }
    optsRef.current.onFrame?.(b.q, b.v, d.active)
  })

  return { bind, body, impulse }
}

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * Release velocity after the still-handed-release guard. Returns 0 when
 * the gap since the last pointermove exceeds `stillS` — a still hand
 * carries no momentum, so the field must inherit the hand's actual
 * (zero) speed, not the frozen pre-pause estimate (see STILL_RELEASE_S).
 * Otherwise returns `v` unchanged so a genuine flick keeps its tracked
 * momentum.
 */
export const releaseVelocity = (v: number, moveGapS: number, stillS: number): number =>
  moveGapS > stillS ? 0 : v
