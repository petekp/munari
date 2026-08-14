// The custody crossing, bound to React and r3f.
//
// The kernel owns the protocol (packages/core/src/transfer/crossing.ts):
// phases, the evidence gate, reversal, the amplitude law. This hook owns
// what the kernel is not allowed to know — React commits and renderer
// frames. It collects the post-draw receipts (`Surface.onFirstPresented`)
// that constitute evidence, advances the reducer once per rendered frame,
// and publishes phase changes as React state so both custody swaps land
// inside single commits:
//
//   forward — the reducer leaves 'lifting' during a frame in which the
//   canvas is already presenting proven pixels underneath the page; the
//   setState publishes, and the consumer's next commit hides the DOM.
//   The page was never dark: the mesh it reveals was already there.
//
//   reverse — the reducer reaches ramp 0, phase 'dom'; the consumer's
//   next commit shows the DOM and hides the canvas together. One
//   commit, so the browser cannot composite between the two. The canvas
//   UNMOUNTS a beat later, in its own commit: tearing a renderer down
//   is heavy main-thread work — a ~280ms longtask under crossing-flash's
//   throttle (2026-08-14) — and a carried motion writes its samples
//   from that same thread, so a teardown sharing the swap commit would
//   hold the word still at exactly the handoff it was promised to
//   cross. Reclamation is deferred, never skipped.
//
// The consumer's obligations are four attributes wide: mount the canvas
// while `rendererMounted`, COMPOSITE it only while `rendererHolds` (an
// invisible canvas still draws — that is the whole warm-up), hide the
// page's pixels while `!domHolds`, and scale every mesh-side motion by
// `amplitude()`. Everything else — receipts, dwell, reversal — arrives
// through `request` and `present`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  CROSSING_DEFAULTS,
  crossingAmplitude,
  crossingAtRest,
  crossingFrame,
  crossingPresentation,
  crossingRequest,
  type CrossingPhase,
  type CrossingState,
  type CrossingTiming,
} from '@munari/core'

// How long a landed canvas stays mounted — invisible, at amplitude
// zero — before its unmount commit. Long enough that the swap frame and
// its neighbors are composited before teardown touches the main
// thread; short enough that the renderer's memory is not hoarded. The
// crossing-flash carry clause photographs the frames this protects.
const RECLAIM_LINGER_MS = 300

export interface CustodyCrossingOptions {
  /** How many incoming presenters must prove before the DOM may release. */
  presenters: number
  /**
   * Protocol timing overrides. A page whose idle motion eases flat over
   * N ms owes the crossing `settleMs ≥ N` — the settle dwell is the
   * contract between this hook and that CSS transition.
   */
  timing?: Partial<CrossingTiming>
}

export interface CustodyCrossing {
  phase: CrossingPhase
  /** The page presents this phase — keep the DOM's pixels visible. */
  domHolds: boolean
  /** The canvas side should be mounted: every phase but 'dom', plus a
   *  short linger after landing so teardown's longtask lands in a
   *  commit of its own, clear of the frames that hand the page its
   *  motion back. */
  rendererMounted: boolean
  /** The canvas is COMPOSITED this phase — wire it to the canvas
   *  element's visibility, never to mount. While lifting, the twins
   *  draw warm and UNSEEN; a canvas composited early puts a second copy
   *  of the content on screen while the page is still easing flat, and
   *  the pair reads as a ghost (crossingPresentation). */
  rendererHolds: boolean
  /** The standing ask, for controls: true once a lift is requested,
   *  false once a landing is. */
  requested: boolean
  /** Ask for the renderer (true) or the page (false). Mid-crossing asks
   *  reverse; they never skip. */
  request: (wantRenderer: boolean) => void
  /** Report one presenter's `onFirstPresented`, keyed so remounts and
   *  repeats count once per crossing. */
  present: (key: string | number) => void
  /** Smoothstepped custody amplitude — read inside useFrame, multiply
   *  every mesh-side motion by it. */
  amplitude: () => number
  /** Advance the protocol one frame; `CustodyCrossingDriver` calls this. */
  tick: (dtMs: number) => void
}

export function useCustodyCrossing(options: CustodyCrossingOptions): CustodyCrossing {
  const { presenters } = options
  const settleMs = options.timing?.settleMs ?? CROSSING_DEFAULTS.settleMs
  const rampMs = options.timing?.rampMs ?? CROSSING_DEFAULTS.rampMs
  const timing = useMemo<CrossingTiming>(() => ({ settleMs, rampMs }), [settleMs, rampMs])

  // The reducer state lives in a ref because the ramp moves every frame
  // and must not re-render React; only PHASE changes are commits.
  const stateRef = useRef<CrossingState>(crossingAtRest())
  const [phase, setPhase] = useState<CrossingPhase>(stateRef.current.phase)

  // Receipts are keyed, not counted: a Surface that remounts mid-warm-up
  // fires onFirstPresented again, and counting would double it.
  const receiptsRef = useRef(new Set<string | number>())

  const publish = useCallback((next: CrossingState, prev: CrossingState) => {
    stateRef.current = next
    if (next.phase !== prev.phase) setPhase(next.phase)
  }, [])

  const request = useCallback(
    (wantRenderer: boolean) => {
      const prev = stateRef.current
      const next = crossingRequest(prev, wantRenderer)
      if (next === prev) return
      publish(next, prev)
    },
    [publish],
  )

  const present = useCallback((key: string | number) => {
    receiptsRef.current.add(key)
  }, [])

  const tick = useCallback(
    (dtMs: number) => {
      const prev = stateRef.current
      const next = crossingFrame(
        prev,
        { presented: receiptsRef.current.size, required: presenters },
        dtMs,
        timing,
      )
      if (next !== prev) publish(next, prev)
    },
    [presenters, timing, publish],
  )

  // Reclamation is deferred off the swap commit: when phase returns to
  // 'dom' the canvas — already invisible — stays mounted for a linger,
  // then unmounts in a commit of its own, so teardown's main-thread
  // cost never delays the first frames the page holds. Receipts reset
  // at the ACTUAL unmount, not at the next lift: a lift that arrives
  // during the linger reuses the warm canvas, whose presenters proved
  // themselves once and will not fire onFirstPresented again — their
  // standing receipts are still evidence about the meshes on screen.
  const [lingering, setLingering] = useState(false)
  useEffect(() => {
    if (phase !== 'dom') {
      setLingering(true)
      return
    }
    const id = setTimeout(() => {
      setLingering(false)
      receiptsRef.current = new Set()
    }, RECLAIM_LINGER_MS)
    return () => clearTimeout(id)
  }, [phase])

  // Both visibility facts come from the presentation law — who may be
  // SEEN — not the custody law, which says who must draw. The two agree
  // on the DOM and differ on the renderer during lifting, and it is
  // exactly that difference this hook exists to hand the consumer.
  const shown = crossingPresentation(phase)
  const amplitude = useCallback(() => crossingAmplitude(stateRef.current.ramp), [])

  return useMemo(
    () => ({
      phase,
      domHolds: shown.dom,
      rendererMounted: phase !== 'dom' || lingering,
      rendererHolds: shown.renderer,
      requested: phase === 'lifting' || phase === 'renderer',
      request,
      present,
      amplitude,
      tick,
    }),
    [phase, lingering, shown.dom, shown.renderer, request, present, amplitude, tick],
  )
}

/**
 * The crossing's clock: mount one inside the Canvas the crossing
 * governs. It runs exactly when the protocol has anything to advance —
 * the canvas is mounted for every phase but 'dom', and 'dom' needs no
 * frames. The delta clamp keeps a background-tab hiccup from teleporting
 * the ramp; the protocol slows down under stall, it never jumps.
 */
export function CustodyCrossingDriver({ crossing }: { crossing: CustodyCrossing }) {
  useFrame((_, delta) => {
    crossing.tick(Math.min(delta, 1 / 30) * 1000)
  })
  return null
}
