// The Surface handle — one piece of content's identity, independent of the
// trees that present it.
//
// The law: a handle owns NO DOM and NO renderer resource. It is a name, a
// controller ledger, a requested view, and the progress every presenter
// scales its motion by. That is what lets the same handle be declared in a
// page tree and consumed in a scene tree without either one owning the
// other, and it is why retaining a handle whose components have all
// unmounted leaks nothing.
//
// Semantic changes publish; the ramp does not. Progress moves every frame,
// and a handle that re-rendered React on each new value would put a commit
// between every pair of frames for the whole of a transition. So the ramp
// lives in a mutable cell read through `progress`, and subscribers hear
// only phase, readiness, and controller changes.
//
// The kernel owns the crossing itself (`@munari/core`'s crossing law) and
// the identity ledger. This module owns React's commit order, the latest-
// callback rule, and the development diagnostics.

import { use, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  CROSSING_DEFAULTS,
  crossingAtRest,
  crossingCurve,
  crossingDrive,
  crossingFrame,
  crossingPresentation,
  crossingProgress,
  crossingRange,
  crossingRequest,
  detectHtmlInCanvas,
  partSetEmpty,
  partSetExpect,
  partSetMissing,
  partSetRegister,
  readinessAtBirth,
  readinessProve,
  readinessReborn,
  readinessRegister,
  readinessSettled,
  readinessUnregister,
  surfaceAcquire,
  surfaceEpochCurrent,
  surfaceHolds,
  surfaceRelease,
  surfaceUnclaimed,
  type CrossingState,
  type CrossingTiming,
  type SurfaceIdentity,
  type SurfacePartId,
  type SurfacePresenterKey,
  type SurfaceReadiness,
} from '@munari/core'
import { surfaceViewPresentation, type SurfaceStatus } from './surfaceStatus'
import { useLatest } from '../useLatest'
import { SurfaceHandleContext } from './surfaceContext'
import type { SurfacePartPublication } from './surfaceSourceRuntime'

/** The presentations an application may ask a Surface to keep visible. */
export type SurfacePresentation = 'page' | 'canvas' | 'both' | 'none'

/** One endpoint of the Surface motion law. */
export type SurfaceDestination = 'page' | 'canvas'

export interface SurfaceTiming {
  /** Time for the caller's DOM-side motion to stop. Default: 450. */
  settleMs?: number
  /** Time for the built-in progress driver to move between 0 and 1. Default: 600. */
  durationMs?: number
}

/**
 * The excursion, 0 at DOM identity and 1 at the WebGL state. Read inside a
 * frame loop. Raw progress, an explicit eased read, interval ramps and
 * interval pulses are separate operations.
 */
export interface SurfaceProgress {
  /** Raw 0..1 motion, shared with driver input and frame reads. */
  get(): number
  /** The built-in eased curve, explicitly separate from the raw motion. */
  eased(): number
  between(start: number, end: number): number
  pulse(start: number, end: number): number
}

/** What an application can observe without subscribing to frames. */
export interface SurfaceState {
  /** What the application asked for. */
  readonly requested: SurfacePresentation
  /** Which declared presentations currently hold the content. */
  readonly presented: SurfacePresentation
  /** Every declared part has a presenter, and every registered presenter
   *  has completed its first eligible draw. */
  readonly ready: boolean
  /** A handoff is under way in either direction. */
  readonly isChanging: boolean
  /** This browser can capture DOM into a texture at all. */
  readonly supported: boolean
}

export interface SurfaceHandle {
  readonly progress: SurfaceProgress
}

// How long a landed WebGL side stays mounted — invisible, at progress zero
// — before its unmount commit. Tearing a renderer group down is heavy
// main-thread work (measured at ~280ms for a full renderer, 2026-08-14),
// and a carried motion writes its samples from that same thread, so a
// teardown sharing the swap commit holds the content still at exactly the
// handoff it was promised to cross.
const RECLAIM_LINGER_MS = 300

// Callbacks are `SurfaceCallbacks` rather than a bag of optional functions
// so the store has one named type to hold, and so replacing them is one
// assignment — the latest-callback rule is that the newest set runs without
// resetting anything else about the handle.
interface SurfaceCallbacks {
  onPresentationChange?: (presentation: SurfacePresentation) => void
  onMotionComplete?: (destination: SurfaceDestination) => void
  onReady?: () => void
  onError?: (error: Error) => void
}

/**
 * The controlled half of a Surface — everything `<Surface>` owns and a
 * handle deliberately does not. One declaration writes all of it.
 */
export interface SurfaceControls extends SurfaceCallbacks {
  /** Where this Surface's declared presentations should render. */
  renderIn?: SurfacePresentation
  timing?: SurfaceTiming
}

/**
 * The private half of a handle. Presenters, source hosts, and the Canvas
 * host all reach the handle through this; the public `SurfaceHandle` is
 * deliberately just `progress`, so nothing a consumer holds can drive the
 * protocol behind the components' backs.
 */
export interface SurfaceStore {
  readonly handle: SurfaceHandle
  readonly name: string | undefined
  /** Claim the identity. `false` is the duplicate-controller fault. */
  acquire(token: number): boolean
  release(token: number): void
  /** The live lifetime. Registrations and receipts carry it. */
  epoch(): number
  hasController(): boolean
  setCallbacks(next: SurfaceCallbacks): void
  setTiming(next: CrossingTiming): void
  request(presentation: SurfacePresentation): void
  registerPresenter(key: SurfacePresenterKey): () => void
  /**
   * Declare a part id in the expected set; the return forgets it. The
   * all-or-none gates read this ledger — a declared part with no presenter
   * holds the handoff (decisions.md #37).
   */
  expectPart(id: SurfacePartId): () => void
  /** A presenter arrived covering a part; the return withdraws it. */
  registerPartPresenter(id: SurfacePartId): () => void
  /**
   * Stage one: one presenter completed an eligible draw of uploaded pixels.
   * A write-free warm-up qualifies — it compiled the program and sampled the
   * texture, which is what the lift gate is asking about. The receipt carries
   * both stamps it was earned under and is refused if either has moved on.
   */
  prove(key: SurfacePresenterKey, lifetime: number, epoch: number): void
  /**
   * Stage two: one presenter wrote color where it will be composited. The
   * page copy is released the moment every presenter has, synchronously,
   * inside the post-draw callback and before the browser composites.
   */
  present(key: SurfacePresenterKey, epoch: number): void
  /**
   * May the canvas write color this frame? The crossing's answer, and the
   * one a presenter's draw is gated on. It turns BEFORE the page lets go:
   * the draw it authorizes is what releases the page, so reading the page's
   * side here would be a deadlock — the mesh waiting for a release that its
   * own draw has to cause.
   */
  canvasPresents(): boolean
  /** Is the page copy currently the policy-visible presentation? */
  pagePresents(): boolean
  /**
   * May the canvas HEAR the pointer this frame? Input follows the eye
   * (crossingPointer): during 'lifting' the mesh is registered and drawing
   * warm, but the page copy is the one on screen, so it is the one a click
   * must reach. A presenter reads this in its raycast — an intersection
   * declined there is one r3f never counts, so neither the pointer gate nor
   * the relay ever hears about matter that is not the presented copy.
   */
  canvasHearsPointer(): boolean
  /** Does the page copy still hold the pixels? Read from a frame, not a render. */
  holdsPage(): boolean
  /**
   * The page hold changing hands. Fired synchronously from the draw or the
   * frame that moved it, because a React commit lands a frame later and the
   * whole point of the two stages is that no frame passes with the content
   * in nobody's hands.
   */
  subscribeHold(listener: () => void): () => void
  /** The source was replaced: every proof is void, the presenters remain. */
  replaceSource(): void
  readinessLifetime(): number
  /**
   * Hand the ramp to a scene. The driver answers a ramp per frame; the
   * phase machine and the lift gate are unchanged, so a driver decides how
   * the excursion moves and never whether the page may let go. `null`
   * gives the ramp back to the built-in timed motion.
   */
  drive(step: SurfaceDriverStep | null): void
  /** The accepted raw motion value for a scene that owns the driver. */
  motionProgress(): number
  /** Advance the protocol one renderer frame. */
  tick(dtMs: number): void
  /** Is this an exclusive handoff or a shared presentation? */
  exclusive(): boolean
  /** Private canvas presence, including the return linger. */
  canvasMounted(): boolean
  /** Private frame-work predicate for the shared Canvas scheduler. */
  hasProtocolWork(): boolean
  subscribeWork(listener: () => void): () => void
  setRendererAvailable(available: boolean): void
  canPrepareCanvas(): boolean
  preparationWait(): string | null
  subscribePresence(listener: () => void): () => void
  /** A direct declaration, separate from a mounted presenter. */
  declarePresentation(presentation: SurfaceDestination): () => void
  /** A manual mesh requires an advanced presenter for this part. */
  expectManualPresenter(part: SurfacePartId): () => void
  /** The advanced presenter covering a manual mesh part. */
  registerManualPresenter(part: SurfacePartId): () => void
  /** Report a requested presentation that has no matching declaration. */
  validatePresentation(includeCanvas?: boolean): void
  /** Announce one part's source to every presenter holding this handle. */
  publishPart(id: SurfacePartId, value: SurfacePartPublication | null): void
  part(id: SurfacePartId): SurfacePartPublication | null
  parts(): readonly SurfacePartPublication[]
  subscribeParts(listener: () => void): () => void
  getState(): SurfaceState
  /** Author intent is separate from a capability-filtered protocol request. */
  setAuthorIntent(owner: symbol, requestedInScene: boolean, reason: string | null): void
  clearAuthorIntent(owner: symbol): void
  authorRequestedInScene(): boolean
  getStatus(): SurfaceStatus
  subscribe(listener: () => void): () => void
  reportError(error: Error): void
}

/** What a driver is told about the frame it is answering for. */
export interface SurfaceDriverFrame {
  /** The frame's honest delta, already clamped by the host. */
  readonly dtMs: number
  /** The ramp as the protocol currently holds it, 0 at the page, 1 airborne. */
  readonly progress: number
  /** Where the crossing is trying to get to. */
  readonly target: SurfaceDestination
}

/** A scene's answer for one frame: the ramp it wants, 0..1. */
export type SurfaceDriverStep = (frame: SurfaceDriverFrame) => number

let nextControllerToken = 0

/** Mint a controller token. Distinct per component instance, never reused. */
export function mintControllerToken(): number {
  return ++nextControllerToken
}

/**
 * Which renderer may be SEEN, per the crossing. A Twin has no exclusive
 * hold to move, so it reads as the page throughout — the WebGL side is an
 * additional presentation of the content, never a replacement for it.
 */
/**
 * The private store behind one handle.
 *
 * Nothing here allocates. The store is plain state and a listener set, so a
 * handle that is created and never mounted, or mounted and then unmounted,
 * holds no renderer, no DOM, and no timer — which is the property that lets
 * a data store own handles for content that is not on screen.
 */
export function createSurfaceStore(name?: string): SurfaceStore {
  let identity: SurfaceIdentity = surfaceUnclaimed()
  let readiness: SurfaceReadiness = readinessAtBirth()
  let crossing: CrossingState = crossingAtRest()
  let driver: SurfaceDriverStep | null = null
  let timing: CrossingTiming = { settleMs: CROSSING_DEFAULTS.settleMs, rampMs: CROSSING_DEFAULTS.rampMs }
  let callbacks: SurfaceCallbacks = {}
  let requested: SurfacePresentation = 'page'
  let target: SurfaceDestination = 'page'
  let lingerUntilMs = 0
  let elapsedMs = 0
  let exclusive = true
  const declared = new Map<SurfaceDestination, number>()
  const reportedMissing = new Set<SurfaceDestination>()
  const manualExpected = new Map<SurfacePartId, number>()
  const manualRegistered = new Map<SurfacePartId, number>()
  const reportedManual = new Set<SurfacePartId>()
  // Stage two's ledger: presenters that have written color since the canvas
  // took presentation authority. Cleared whenever it gives that authority
  // back, so a return and a second lift do not inherit the first one's proof.
  const presenting = new Set<SurfacePresenterKey>()
  // The multi-part ledger: parts declared, parts covered by a presenter.
  // The gates read `partSetMissing` — a declared part with no presenter is
  // a requirement nothing can prove, which is what keeps a five-part word
  // from crossing four-fifths whole. Counts on both sides, not booleans:
  // Strict Mode runs a remount's new registration before the old cleanup.
  let parts = partSetEmpty()
  const expectCounts = new Map<SurfacePartId, number>()
  const presenterCounts = new Map<SurfacePartId, number>()
  let pageHeld = true
  let canvasHeld = false
  const holdListeners = new Set<() => void>()
  const partMap = new Map<SurfacePartId, SurfacePartPublication>()
  // Snapshotted for `useSyncExternalStore`, which compares by reference —
  // a fresh array per read is an infinite render loop, not a slow one.
  let partSnapshot: readonly SurfacePartPublication[] = []
  const partListeners = new Set<() => void>()
  let state: SurfaceState = {
    requested: 'page',
    presented: 'none',
    ready: false,
    isChanging: false,
    supported: detectHtmlInCanvas().drawElementImage,
  }
  const listeners = new Set<() => void>()
  let authorIntent: { owner: symbol; requestedInScene: boolean; reason: string | null } | null = null
  let statusSnapshot: SurfaceStatus | null = null
  let statusState: SurfaceState | null = null
  let rendererAvailable = true
  const workListeners = new Set<() => void>()
  let canvasMounted = false
  const presenceListeners = new Set<() => void>()

  const presentedFrom = (pageVisible: boolean, canvasVisible: boolean): SurfacePresentation => {
    if (pageVisible && canvasVisible) return 'both'
    if (pageVisible) return 'page'
    if (canvasVisible) return 'canvas'
    return 'none'
  }

  const isResidentCanvas = (): boolean =>
    requested === 'canvas' && (declared.get('page') ?? 0) === 0

  const progressValue = (): number =>
    isResidentCanvas() ? 1 : crossing.ramp

  const nextCanvasPresence = (canCanvas: boolean): boolean =>
    canCanvas &&
    (requested === 'canvas' ||
      requested === 'both' ||
      crossing.phase !== 'page' ||
      elapsedMs < lingerUntilMs)

  const changing = (canCanvas: boolean): boolean => {
    if (!canCanvas) return false
    if (isResidentCanvas()) return false
    const seeksCanvas = requested === 'canvas' || requested === 'both'
    return seeksCanvas ? crossing.ramp < 1 || !canvasHeld : crossing.ramp > 0 || canvasHeld
  }

  const announcePresence = (next: boolean) => {
    if (next === canvasMounted) return
    canvasMounted = next
    for (const listener of presenceListeners) listener()
  }

  const observation = (): SurfaceState => {
    const pageDeclared = (declared.get('page') ?? 0) > 0
    const canvasDeclared = (declared.get('canvas') ?? 0) > 0
    const canCanvas = state.supported && rendererAvailable
    const pageVisible = pageDeclared && store.pagePresents()
    const canvasVisible = canvasDeclared && canCanvas && requested !== 'none' && canvasHeld
    return {
      requested,
      presented: presentedFrom(pageVisible, canvasVisible),
      ready: readinessSettled(readiness) && partSetMissing(parts).length === 0,
      isChanging: changing(canCanvas),
      supported: state.supported,
    }
  }

  const advanceCrossing = (before: CrossingState, dtMs: number) => {
    const evidence = {
      presented: readiness.proven.length,
      required: Math.max(1, readiness.registered.length + partSetMissing(parts).length),
    }
    if (!driver) return crossingFrame(before, evidence, dtMs, timing)
    const answer = driver({ dtMs, progress: before.ramp, target })
    if (!Number.isFinite(answer)) {
      store.reportError(
        new Error(
          `Surface${name ? ` "${name}"` : ''} driver answered ${String(answer)}. ` +
            'A driver returns the ramp it wants for this frame, 0..1.',
        ),
      )
    }
    return crossingDrive(before, evidence, dtMs, answer, timing)
  }

  const settleReturn = (before: CrossingState) => {
    if (isResidentCanvas() || requested === 'both') return
    const canvasHasAuthority = crossingPresentation(crossing.phase).gl
    if (crossing.phase === 'page' && before.phase === 'landing') {
      lingerUntilMs = elapsedMs + RECLAIM_LINGER_MS
    }
    if (canvasHasAuthority) return
    presenting.clear()
    const changed = !pageHeld || canvasHeld
    pageHeld = true
    canvasHeld = false
    if (changed) for (const listener of holdListeners) listener()
  }

  const requestedPresentations = (): readonly SurfaceDestination[] => {
    if (requested === 'page') return ['page']
    if (requested === 'canvas') return ['canvas']
    if (requested === 'both') return ['page', 'canvas']
    return []
  }

  const reportMissingPresentations = (includeCanvas = true) => {
    for (const presentation of requestedPresentations()) {
      if (presentation === 'canvas' && (!includeCanvas || !state.supported)) continue
      if ((declared.get(presentation) ?? 0) > 0 || reportedMissing.has(presentation)) continue
      reportedMissing.add(presentation)
      const component = presentation === 'page' ? '<Surface.HTML>' : '<Surface.Mesh> or <Surface.Scene>'
      store.reportError(
        new Error(
          `Surface${name ? ` "${name}"` : ''} requested ${presentation} but declared no ${component}.`,
        ),
      )
    }
    for (const [part, expected] of manualExpected) {
      if (expected === 0 || (manualRegistered.get(part) ?? 0) > 0 || reportedManual.has(part)) continue
      reportedManual.add(part)
      store.reportError(
        new Error(
          `Surface${name ? ` "${name}"` : ''} has a manual <Surface.Mesh> for part ` +
            `"${String(part)}" without a registered surfaceManualPresenter().`,
        ),
      )
    }
  }

  const hasProtocolWork = (): boolean => {
    if (elapsedMs < lingerUntilMs) return true
    if (!state.supported || !rendererAvailable) return false
    if (isResidentCanvas()) return false
    const canvasDeclared = (declared.get('canvas') ?? 0) > 0
    const seeksCanvas = requested === 'canvas' || requested === 'both'
    if (seeksCanvas) {
      if (!canvasDeclared) return false
      // Waiting for missing inputs cannot produce evidence by drawing again.
      // The finite settle dwell still runs; source and presenter changes wake us.
      if (crossing.phase === 'lifting' && crossing.heldMs >= timing.settleMs && !state.ready) return false
      return !canvasHeld || crossing.ramp < 1
    }
    return canvasHeld || crossing.ramp > 0
  }

  const destinationFor = (presentation: SurfacePresentation): SurfaceDestination =>
    presentation === 'canvas' || presentation === 'both' ? 'canvas' : 'page'

  const appliesExclusivePolicy = (presentation: SurfacePresentation): boolean =>
    presentation === 'page' || presentation === 'canvas'

  const applyPresentationPolicy = (presentation: SurfacePresentation): boolean => {
    if (presentation === 'both' && !pageHeld) {
      pageHeld = true
      return true
    }
    if (presentation === 'none') {
      const changed = !pageHeld || canvasHeld
      pageHeld = true
      canvasHeld = false
      presenting.clear()
      return changed
    }
    if (presentation === 'canvas' && canvasHeld && pageHeld) {
      pageHeld = false
      return true
    }
    return false
  }

  const notifyPolicyChange = (
    presentation: SurfacePresentation,
    holdChanged: boolean,
    wasPagePresented: boolean,
    wasCanvasHearing: boolean,
  ) => {
    const policyRequest = presentation === 'both' || presentation === 'none'
    const presentationChanged = wasPagePresented !== store.pagePresents()
    const pointerChanged = wasCanvasHearing !== store.canvasHearsPointer()
    if (!policyRequest && !holdChanged && !presentationChanged && !pointerChanged) return
    for (const listener of holdListeners) listener()
  }

  const requestCrossing = (presentation: SurfacePresentation) => {
    const wantsCanvas = presentation === 'canvas' || presentation === 'both'
    const next = crossingRequest(
      crossing,
      wantsCanvas && state.supported && rendererAvailable && !isResidentCanvas(),
    )
    if (next !== crossing) crossing = next
  }

  // The snapshot is rebuilt only when a semantic field actually changes, so
  // `useSyncExternalStore` can compare by reference. Rebuilding
  // unconditionally would re-render every subscriber on every frame the
  // protocol advanced, which is the cost this whole split exists to avoid.
  const publish = (wake = true) => {
    const next = observation()
    const nextMounted = nextCanvasPresence(next.supported && rendererAvailable)
    if (
      next.requested === state.requested &&
      next.presented === state.presented &&
      next.ready === state.ready &&
      next.isChanging === state.isChanging
    ) {
      announcePresence(nextMounted)
      if (wake) for (const listener of workListeners) listener()
      return
    }
    const previous = state
    state = next
    announcePresence(nextMounted)
    if (wake) for (const listener of workListeners) listener()
    for (const listener of listeners) listener()
    if (next.presented !== previous.presented) {
      callbacks.onPresentationChange?.(next.presented)
    }
    // The rising edge only. A source replacement voids every proof, so
    // readiness falls and rises again — and a consumer that arms something
    // once per set of proven pixels wants to hear both times.
    if (next.ready && !previous.ready) callbacks.onReady?.()
  }

  // Rebuilt from the counts through the law's own transitions, expecting
  // before registering, so a presenter that named its part before the
  // declaration arrived still lands once it does — the two declarations
  // live in different trees and commit in either order.
  const rebuildParts = () => {
    let next = partSetEmpty()
    for (const id of expectCounts.keys()) next = partSetExpect(next, id)
    for (const id of presenterCounts.keys()) next = partSetRegister(next, id)
    parts = next
    publish()
  }

  const counted = (counts: Map<SurfacePartId, number>) => (id: SurfacePartId) => {
    counts.set(id, (counts.get(id) ?? 0) + 1)
    rebuildParts()
    let released = false
    return () => {
      if (released) return
      released = true
      const count = counts.get(id) ?? 0
      if (count <= 1) counts.delete(id)
      else counts.set(id, count - 1)
      rebuildParts()
    }
  }

  const manualCounted = (counts: Map<SurfacePartId, number>) => (id: SurfacePartId) => {
    counts.set(id, (counts.get(id) ?? 0) + 1)
    reportedManual.delete(id)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = counts.get(id) ?? 0
      if (count <= 1) counts.delete(id)
      else counts.set(id, count - 1)
    }
  }

  const progress: SurfaceProgress = {
    get: progressValue,
    eased: () => crossingProgress(progressValue()),
    between: (start, end) =>
      crossingRange(progressValue(), start, end - start),
    pulse: (start, end) => crossingCurve(progressValue(), start, end - start),
  }

  const handle: SurfaceHandle = { progress }
  const store: SurfaceStore = {
    handle,
    name,
    acquire(token) {
      const next = surfaceAcquire(identity, token)
      if (next === identity) return surfaceHolds(identity, token)
      identity = next
      publish()
      return true
    },
    release(token) {
      const next = surfaceRelease(identity, token)
      if (next === identity) return
      identity = next
      publish()
    },
    epoch: () => identity.epoch,
    hasController: () => identity.controller !== null,
    setCallbacks(next) {
      callbacks = next
    },
    setTiming(next) {
      timing = next
    },
    request(presentation) {
      if (presentation === requested) return
      const wasPagePresented = store.pagePresents()
      const wasCanvasHearing = store.canvasHearsPointer()
      requested = presentation
      target = destinationFor(presentation)
      exclusive = appliesExclusivePolicy(presentation)
      const holdChanged = applyPresentationPolicy(presentation)
      notifyPolicyChange(presentation, holdChanged, wasPagePresented, wasCanvasHearing)
      requestCrossing(presentation)
      publish()
    },
    registerPresenter(key) {
      readiness = readinessRegister(readiness, key)
      publish()
      return () => {
        readiness = readinessUnregister(readiness, key)
        // Stage two leaves with stage one. A presenter that remounts before
        // the release keeps its old entry here otherwise, and the entry is
        // read as "already presented" — so the new instance's own draw
        // returns at the duplicate guard and the page is never let go. The
        // Genie desk found this: a presenter that mounts in the same commit
        // that starts the crossing races React's remount, and the window
        // that lost the race hung mid-flight with the sheet drawn and the
        // page copy still under it.
        presenting.delete(key)
        publish()
      }
    },
    expectPart: counted(expectCounts),
    registerPartPresenter: counted(presenterCounts),
    present(key, epoch) {
      if (!rendererAvailable || !surfaceEpochCurrent(identity, epoch)) return
      if (requested !== 'canvas' && requested !== 'both') return
      // Only while the canvas has presentation authority. A color-writing
      // draw before the lift gate opens is a resident presentation of a
      // Surface that is still the page's, and it releases nothing.
      if (
        requested !== 'both' &&
        !isResidentCanvas() &&
        !crossingPresentation(crossing.phase).gl
      ) {
        return
      }
      // A presenter that is not in the ledger cannot enter it. Strict Mode
      // remounts every presenter on a development mount, and one declared
      // in the same commit that starts a crossing can have a draw in flight
      // across the gap: recorded, that draw's entry belongs to an instance
      // that no longer exists, and the replacement's own draw then returns
      // at the duplicate guard below and never releases the page. The Genie
      // desk hung mid-flight this way, sheet drawn and page copy under it.
      if (!readiness.registered.includes(key)) return
      if (presenting.has(key)) return
      presenting.add(key)
      if (canvasHeld) return
      // Every registered presenter, not just this one. A multi-part Surface
      // releases all of its parts or none: a page copy hidden while one
      // letter is still warming is a word with a hole in it.
      if (readiness.registered.length === 0) return
      // A declared part with no presenter is the same hole with nobody
      // even warming it.
      if (partSetMissing(parts).length > 0) return
      for (const registered of readiness.registered) if (!presenting.has(registered)) return
      canvasHeld = true
      if (requested === 'canvas') pageHeld = false
      for (const listener of holdListeners) listener()
      publish()
    },
    canvasPresents: () =>
      rendererAvailable && state.supported &&
      requested !== 'none' &&
      (isResidentCanvas() || requested === 'both' || crossingPresentation(crossing.phase).gl),
    pagePresents: () =>
      requested !== 'none' &&
      (requested === 'both' || requested === 'page' ? pageHeld : !state.supported || pageHeld),
    // crossingPointer says hearing equals presentation, and presentation is
    // refined by the HOLD, not the phase: the phase turns at the top of a
    // frame, the pixels turn in that frame's draw. Reading the phase here
    // would open a window at gl entry — phase already 'gl', releasing draw
    // not yet run (mesh culled, host tail stalled) — where the canvas hears
    // clicks the page copy is still showing. Reading the hold also puts the
    // hearing flip at the exact moment subscribeHold fires, which is what
    // lets the edge bursts run at the boundary they describe.
    canvasHearsPointer: () =>
      rendererAvailable && state.supported && canvasHeld && (requested === 'both' || !pageHeld),
    holdsPage: () => pageHeld,
    subscribeHold(listener) {
      holdListeners.add(listener)
      return () => {
        holdListeners.delete(listener)
      }
    },
    prove(key, lifetime, epoch) {
      // A receipt is refused unless it was earned in the LIVE lifetime and
      // under the LIVE controller. The epoch check is what a deferred
      // host-tail receipt needs: it is minted during the draw and closed at
      // the end of the frame, and a Surface whose controller unmounted in
      // between must not be proven by pixels nobody speaks for any more.
      if (!surfaceEpochCurrent(identity, epoch)) return
      const next = readinessProve(readiness, key, lifetime)
      if (next === readiness) return
      readiness = next
      publish()
    },
    replaceSource() {
      readiness = readinessReborn(readiness)
      publish()
    },
    readinessLifetime: () => readiness.lifetime,
    drive(step) {
      driver = step
    },
    motionProgress: () => isResidentCanvas() ? 1 : crossing.ramp,
    tick(dtMs) {
      elapsedMs += dtMs
      const before = crossing
      crossing = advanceCrossing(before, dtMs)
      settleReturn(before)
      // Motion completes when the ramp reaches an endpoint, which is a
      // different moment from the hold changing hands: entering, WebGL
      // takes the hold before the ramp leaves zero; returning, the ramp
      // reaches zero before DOM takes it. Consumers cannot assume one order
      // for both directions, so the two callbacks are reported separately.
      if (before.ramp < 1 && crossing.ramp >= 1) callbacks.onMotionComplete?.('canvas')
      if (before.ramp > 0 && crossing.ramp <= 0) callbacks.onMotionComplete?.('page')
      publish(false)
    },
    getState: () => state,
    setAuthorIntent(owner, requestedInScene, reason) {
      if (authorIntent?.owner === owner && authorIntent.requestedInScene === requestedInScene && authorIntent.reason === reason) return
      authorIntent = { owner, requestedInScene, reason }
      statusSnapshot = null
      for (const listener of listeners) listener()
    },
    clearAuthorIntent(owner) {
      if (authorIntent?.owner !== owner) return
      authorIntent = null
      statusSnapshot = null
      for (const listener of listeners) listener()
    },
    authorRequestedInScene: () => authorIntent?.requestedInScene ?? requested === 'canvas',
    getStatus() {
      if (statusSnapshot && statusState === state) return statusSnapshot
      const presentation = surfaceViewPresentation(state.presented)
      statusState = state
      statusSnapshot = {
        requestedInScene: store.authorRequestedInScene(),
        presentation,
        sceneReady: rendererAvailable && state.ready && state.supported && !authorIntent?.reason,
        isTransitioning: state.isChanging,
        supported: state.supported && !authorIntent?.reason,
        reason: authorIntent?.reason ?? null,
      }
      return statusSnapshot
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    exclusive: () => exclusive,
    canvasMounted: () => canvasMounted,
    hasProtocolWork,
    subscribeWork(listener) {
      workListeners.add(listener)
      return () => { workListeners.delete(listener) }
    },
    canPrepareCanvas: () => rendererAvailable && state.supported,
    preparationWait() {
      if (!store.canPrepareCanvas() || (requested !== 'canvas' && requested !== 'both')) return null
      if ((declared.get('canvas') ?? 0) === 0 || state.ready) return null
      const missing = partSetMissing(parts)
      if (missing.length > 0) return `presenters for parts: ${missing.join(', ')}`
      if (readiness.registered.length === 0) return 'a scene presenter'
      return 'a usable source frame and preparation draw'
    },
    setRendererAvailable(available) {
      if (rendererAvailable === available) return
      rendererAvailable = available
      statusSnapshot = null
      if (!available) {
        crossing = crossingAtRest()
        lingerUntilMs = 0
        readiness = readinessReborn(readiness)
        presenting.clear()
        pageHeld = true
        canvasHeld = false
        for (const listener of holdListeners) listener()
      } else requestCrossing(requested)
      publish()
      for (const listener of listeners) listener()
    },
    subscribePresence(listener) {
      presenceListeners.add(listener)
      return () => presenceListeners.delete(listener)
    },
    declarePresentation(presentation) {
      declared.set(presentation, (declared.get(presentation) ?? 0) + 1)
      reportedMissing.delete(presentation)
      publish()
      let released = false
      return () => {
        if (released) return
        released = true
        const count = declared.get(presentation) ?? 0
        if (count <= 1) declared.delete(presentation)
        else declared.set(presentation, count - 1)
        publish()
      }
    },
    expectManualPresenter: manualCounted(manualExpected),
    registerManualPresenter: manualCounted(manualRegistered),
    validatePresentation: reportMissingPresentations,
    publishPart(id, value) {
      if (value === null) partMap.delete(id)
      else partMap.set(id, value)
      partSnapshot = Array.from(partMap.values())
      for (const listener of partListeners) listener()
    },
    part: (id) => partMap.get(id) ?? null,
    parts: () => partSnapshot,
    subscribeParts(listener) {
      partListeners.add(listener)
      return () => {
        partListeners.delete(listener)
      }
    },
    reportError(error) {
      const handler = callbacks.onError
      if (handler) {
        handler(error)
        return
      }
      console.error('[munari]', error)
    },
  }
  storeByHandle.set(handle, store)
  return store
}

// The handle a consumer holds is deliberately just `progress` — nothing in
// it can drive the protocol behind the components' backs. The components
// themselves need the store, and they have only the handle, so the link
// lives here rather than as a field. Weak, so a handle that goes out of
// scope takes its store with it.
const storeByHandle = new WeakMap<SurfaceHandle, SurfaceStore>()

/** The private half of a handle. Throws for anything Munari did not make. */
export function surfaceStoreOf(handle: SurfaceHandle): SurfaceStore {
  const store = storeByHandle.get(handle)
  if (!store) {
    throw new Error(
      'munari: this is not a Surface handle. Handles come from useSurfaceHandle() or ' +
        'from a <Surface> root; an object shaped like one carries no identity.',
    )
  }
  return store
}

/**
 * Create a Surface identity outside React.
 *
 * The handle is a name and a progress reader, nothing else. What it is
 * DOING — which renderer should hold it, how long the motion takes, who
 * hears about it — belongs to the `<Surface>` that declares it. The bare
 * name is what says so: there is no field here for a caller to put a view
 * in, so one Surface cannot be driven from two declarations.
 */
export function createSurface(name?: string): SurfaceHandle {
  return createSurfaceStore(name).handle
}

/**
 * Create explicit identity for separated wiring.
 *
 * The returned handle is stable for the component's lifetime, and `name` is
 * read once at creation: it names the handle rather than describing its
 * state. Pass the handle to the `<Surface>` that owns its view and timing.
 */
export function useSurfaceHandle(name?: string): SurfaceHandle {
  return useSurfaceStore(name).handle
}

/**
 * `useSurfaceHandle`, keeping the private store. The compound components use this;
 * consumers get the handle.
 */
export function useSurfaceStore(name?: string): SurfaceStore {
  // `name` is deliberately outside the deps: it is birth-only, and putting
  // it in would rebuild the handle — and drop every registration made
  // against it — because a caller renamed a Surface.
  const nameRef = useLatest(name)
  const [store] = useState(() => createSurfaceStore(nameRef.current))
  return store
}

/**
 * Install the controlled half of a Surface: presentation, timing, and callbacks.
 *
 * Callbacks and timing are installed in the layout phase. A handle can
 * advance a frame between a commit and its passive effects, so a passive
 * effect misses exactly the transition the caller just asked for. A layout
 * effect finishes before the renderer can draw and keeps render pure. The
 * view is requested from a passive effect because it starts protocol work.
 */
export function useSurfaceControls(store: SurfaceStore, controls: SurfaceControls): void {
  const {
    renderIn = 'page',
    timing,
    onPresentationChange,
    onMotionComplete,
    onReady,
    onError,
  } = controls
  useLayoutEffect(() => {
    store.setCallbacks({
      onPresentationChange,
      onMotionComplete,
      onReady,
      onError,
    })
    store.setTiming({
      settleMs: timing?.settleMs ?? CROSSING_DEFAULTS.settleMs,
      rampMs: timing?.durationMs ?? CROSSING_DEFAULTS.rampMs,
    })
    return () => store.setCallbacks({})
  }, [
    store,
    timing?.settleMs,
    timing?.durationMs,
    onPresentationChange,
    onMotionComplete,
    onReady,
    onError,
  ])

  useLayoutEffect(() => {
    store.request(renderIn)
  }, [store, renderIn])
}

/** The excursion, for a presenter or a custom material. */
export function useSurfaceProgress(handle?: SurfaceHandle): SurfaceProgress {
  const context = use(SurfaceHandleContext)
  const selected = handle ?? context?.handle
  if (!selected) {
    throw new Error('munari: useSurfaceProgress() needs a handle or an enclosing <Surface>.')
  }
  return selected.progress
}

/**
 * Semantic state, as React state. Subscribes to the store's published
 * snapshot, which changes only when a named field does — a component using
 * this does not re-render per frame.
 */
export function useSurfaceState(handle?: SurfaceHandle): SurfaceState {
  const context = use(SurfaceHandleContext)
  const store = handle ? surfaceStoreOf(handle) : context?.store
  if (!store) {
    throw new Error('munari: useSurfaceState() needs a handle or an enclosing <Surface>.')
  }
  const subscribe = useMemo(() => store.subscribe.bind(store), [store])
  const snapshot = useMemo(() => store.getState.bind(store), [store])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * Claim the identity for the lifetime of the calling component, and report
 * the duplicate-controller fault in development.
 *
 * The token is minted once per component instance, so Strict Mode's
 * mount → unmount → mount cannot let the first mount's cleanup release the
 * second mount's claim — the ledger refuses a release carrying a token that
 * is not the live one.
 */
export function useSurfaceController(store: SurfaceStore): void {
  const [token] = useState(mintControllerToken)
  useEffect(() => {
    if (!store.acquire(token)) {
      store.reportError(
        new Error(
          `Surface${store.name ? ` "${store.name}"` : ''} already has a controller. ` +
            'One handle is declared by exactly one <Surface>; pass the handle to ' +
            '<Surface.Mesh surface={…}> for the other tree instead.',
        ),
      )
      return
    }
    return () => store.release(token)
  }, [store, token])
}
