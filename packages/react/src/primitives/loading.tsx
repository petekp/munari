// Loading boundary — <Loading> reports once everything inside it is complete:
// every Surface shown, every SurfaceCanvas drawn with its pipelines built,
// every app wait done.
//
// The law: the boundary finishes at a page animation frame where its layout
// effect has run, no entry waits or has failed, and the check one frame
// earlier saw the same with no entry joining, leaving or changing between.
// That recheck catches a wait added by a commit's passive effects
// (decision #57). Time never finishes a load: past `late.afterMs` of frame
// time the boundary sends one notice and keeps waiting (docs/loading/
// decisions.md D3).
//
// The fault it answers, measured 2026-11-26 on m2 (instruments/loading-
// matrix): the lab revealed each demo at its iframe's load event, 0.4-0.6 s
// in, while Knobs' panel and Light's lamp were still building for 1.6-3.3 s.
// Nothing in the library said when a scene was complete.
//
// Frame time adds page frame deltas clamped to 1/30 s, so a hidden tab or a
// stalled frame adds little. The per-frame check stops at the later of
// `late.afterMs` and 10 s of frame time; after that the boundary checks only on
// the frame after a change, and a stalled boundary costs nothing.
//
// Ownership: this module owns membership, the check and the callbacks. Each
// entry derives its status on read from state its owner keeps: a Surface's
// store, a SurfaceCanvas's renderer and compiler, an app wait's value.
// Covering, fading and fallbacks are the app's.
import { createContext, use, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { isDevelopmentRuntime } from '../lib/developmentRuntime'

export type LoadingEntryKind = 'surface' | 'scene-surface' | 'surface-canvas' | 'loading' | 'wait'

export type LoadingWaitReason =
  /** The canvas's renderer is starting, or a Surface's canvas has none yet. */
  | 'renderer'
  /** Not every presenter has drawn, or the canvas still builds pipelines. */
  | 'presentation'
  /** A nested Loading boundary has not loaded. */
  | 'loading'
  /** An app wait is false. */
  | 'app'

/** Why a Surface shows its page presentation instead of the scene. */
export type LoadingFallbackReason = { readonly cause: 'support'; readonly message: string }

export type LoadingEntryState =
  | { readonly status: 'waiting'; readonly waitingFor: LoadingWaitReason }
  | { readonly status: 'shown'; readonly presentation: 'scene'; readonly engine: string | null }
  | { readonly status: 'shown'; readonly presentation: 'page'; readonly reason: LoadingFallbackReason | null }
  /** A lazy Surface outside its viewport margin. It does not hold the load, as a lazy image does not hold `load`. */
  | { readonly status: 'deferred' }
  | { readonly status: 'done' }
  | { readonly status: 'unavailable'; readonly reason: LoadingFallbackReason }
  | { readonly status: 'error'; readonly error: Error }

export type LoadingEntry = {
  readonly kind: LoadingEntryKind
  /** Surface name, canvas id, or wait label. Null when none was given. */
  readonly label: string | null
} & LoadingEntryState

export type LoadingStatus =
  | { readonly status: 'waiting'; readonly entries: readonly LoadingEntry[] }
  | { readonly status: 'loaded'; readonly entries: readonly LoadingEntry[] }

export interface LoadingReport {
  readonly entries: readonly LoadingEntry[]
  /** Frame time counted from the boundary's first layout effect, up to this report. */
  readonly visibleMs: number
}

export interface LoadingProps {
  readonly children?: ReactNode
  /** Once per mount, from a page animation frame, never inside a canvas draw. */
  readonly onLoaded?: (report: LoadingReport) => void
  /** One notice after `afterMs` of frame time while still loading. Never an error. */
  readonly late?: { readonly afterMs: number; readonly onLate: (report: LoadingReport) => void }
  /** True: an enclosing boundary does not wait for this one. Default false. */
  readonly independent?: boolean
}

/** What an owner registers: how to read its entry now. */
export interface LoadingMember {
  readonly kind: LoadingEntryKind
  readonly label: string | null
  read(): LoadingEntryState
}

interface LoadingBoundary {
  /** Join; returns the leave. */
  join(member: LoadingMember): () => void
  /** An entry's state may have changed. */
  changed(): void
  subscribe(listener: () => void): () => void
  getStatus(): LoadingStatus
}

const LoadingContext = createContext<LoadingBoundary | null>(null)

// The crossing clock's clamp (SurfaceCanvas.tsx), so a throttled frame adds little.
const FRAME_CLAMP_MS = 1000 / 30
// The development warning's delay, as surfaceValidation.ts's (decision #42).
const WARN_AFTER_MS = 10_000

const blocks = (entry: LoadingEntryState) => entry.status === 'waiting' || entry.status === 'error'
const signatureOf = (entries: readonly LoadingEntry[]) =>
  entries.map((entry) => entry.kind + ':' + entry.label + ':' + entry.status + ('waitingFor' in entry ? entry.waitingFor : '') + ('presentation' in entry ? entry.presentation : '')).join('|')

interface BoundaryCallbacks {
  onLoaded(report: LoadingReport): void
  onLate(report: LoadingReport): void
  lateAfterMs(): number | null
}

function createLoadingBoundary(callbacks: BoundaryCallbacks): LoadingBoundary & { start(): () => void } {
  const members = new Set<LoadingMember>()
  const listeners = new Set<() => void>()
  let status: LoadingStatus = { status: 'waiting', entries: [] }
  let signature = ''
  let mounted = false
  let loaded = false
  let frameTime = 0
  let lastFrame: number | null = null
  let passedLastCheck = false
  let changedSinceCheck = true
  let lateSent = false
  let warned = false
  let frame = 0

  const read = (): LoadingEntry[] => [...members].map((member) => ({ kind: member.kind, label: member.label, ...member.read() }))
  const publish = (next: LoadingStatus) => {
    status = next
    for (const listener of [...listeners]) listener()
  }
  const perFrame = () => frameTime < Math.max(callbacks.lateAfterMs() ?? 0, WARN_AFTER_MS)
  const schedule = () => {
    if (frame || !mounted || loaded) return
    frame = requestAnimationFrame(check)
  }
  const check = (now: number) => {
    frame = 0
    if (!mounted || loaded) return
    const looping = perFrame()
    if (looping && lastFrame !== null) frameTime += Math.min(Math.max(now - lastFrame, 0), FRAME_CLAMP_MS)
    lastFrame = looping ? now : null
    const entries = read()
    const next = signatureOf(entries)
    if (next !== signature) {
      signature = next
      changedSinceCheck = true
      publish({ status: 'waiting', entries })
    }
    const late = callbacks.lateAfterMs()
    if (!lateSent && late !== null && frameTime >= late) {
      lateSent = true
      callbacks.onLate({ entries, visibleMs: frameTime })
    }
    if (!warned && frameTime >= WARN_AFTER_MS && isDevelopmentRuntime()) {
      warned = true
      const waiting = entries.filter(blocks).map((entry) => entry.kind + (entry.label ? ' "' + entry.label + '"' : '') + ' (' + ('waitingFor' in entry ? entry.waitingFor : entry.status) + ')')
      console.warn('[munari] <Loading> has waited 10 s for: ' + waiting.join(', '))
    }
    const passes = !entries.some(blocks)
    if (passes && passedLastCheck && !changedSinceCheck) {
      loaded = true
      status = { status: 'loaded', entries }
      for (const listener of [...listeners]) listener()
      callbacks.onLoaded({ entries, visibleMs: frameTime })
      return
    }
    passedLastCheck = passes
    changedSinceCheck = false
    if (looping || passes) schedule()
  }
  return {
    join(member) {
      if (loaded) {
        if (isDevelopmentRuntime()) console.warn('[munari] a ' + member.kind + (member.label ? ' "' + member.label + '"' : '') + ' mounted after its <Loading> boundary loaded, so the boundary does not count it.')
        return () => {}
      }
      members.add(member)
      changedSinceCheck = true
      schedule()
      return () => {
        if (!members.delete(member) || loaded) return
        changedSinceCheck = true
        schedule()
      }
    },
    changed() {
      if (loaded) return
      changedSinceCheck = true
      schedule()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    getStatus: () => status,
    start() {
      mounted = true
      changedSinceCheck = true
      schedule()
      return () => {
        mounted = false
        if (frame) cancelAnimationFrame(frame)
        frame = 0
        lastFrame = null
      }
    },
  }
}

/**
 * Join the nearest Loading boundary for as long as this component is
 * mounted. `member` is read at every check; call the returned `changed` when
 * what it reads may have moved. Outside a boundary it joins nothing.
 */
export function useLoadingMember(member: LoadingMember | null): () => void {
  return useJoin(use(LoadingContext), member)
}

function useJoin(boundary: LoadingBoundary | null, member: LoadingMember | null): () => void {
  const changed = useRef(() => boundary?.changed())
  changed.current = () => boundary?.changed()
  useLayoutEffect(() => {
    if (!boundary || !member) return
    return boundary.join(member)
  }, [boundary, member])
  const [stable] = useState(() => () => changed.current())
  return stable
}

export function Loading({ children, onLoaded, late, independent = false }: LoadingProps): ReactNode {
  const parent = use(LoadingContext)
  const latest = useRef({ onLoaded, late })
  latest.current = { onLoaded, late }
  const [boundary] = useState(() =>
    createLoadingBoundary({
      onLoaded: (report) => latest.current.onLoaded?.(report),
      onLate: (report) => latest.current.late?.onLate(report),
      lateAfterMs: () => latest.current.late?.afterMs ?? null,
    }),
  )
  useLayoutEffect(() => boundary.start(), [boundary])
  const [member] = useState<LoadingMember>(() => ({
    kind: 'loading',
    label: null,
    read: () => (boundary.getStatus().status === 'loaded' ? { status: 'done' } : { status: 'waiting', waitingFor: 'loading' }),
  }))
  const changed = useJoin(parent, independent ? null : member)
  useLayoutEffect(() => boundary.subscribe(changed), [boundary, changed])
  return <LoadingContext value={boundary}>{children}</LoadingContext>
}

let warnedOutside = false
function warnOutside(hook: string): void {
  if (warnedOutside || !isDevelopmentRuntime()) return
  warnedOutside = true
  console.warn('[munari] ' + hook + ' was called outside any <Loading> boundary, so it does nothing.')
}

/**
 * An app wait on the nearest Loading boundary. `false` waits, `true` is done,
 * an Error is an error, which holds the boundary until it changes or the
 * component unmounts. Registered in the layout phase.
 */
export function useLoadingWait(label: string, state: boolean | Error): void {
  const boundary = use(LoadingContext)
  if (!boundary) warnOutside('useLoadingWait')
  const value = useRef(state)
  value.current = state
  const [member] = useState<LoadingMember>(() => ({
    kind: 'wait',
    label,
    read: () => {
      const current = value.current
      if (current instanceof Error) return { status: 'error', error: current }
      return current ? { status: 'done' } : { status: 'waiting', waitingFor: 'app' }
    },
  }))
  const changed = useJoin(boundary, member)
  useLayoutEffect(changed, [state, changed])
}

/** Waits while mounted. Made for a Suspense fallback, whose subtree cannot hold state. */
export function LoadingPending({ label }: { readonly label: string }): null {
  useLoadingWait(label, false)
  return null
}

const OUTSIDE: LoadingStatus = { status: 'waiting', entries: [] }
const noSubscription = () => () => {}

/** The nearest boundary's status: a stable snapshot, new only when an entry changed. */
export function useLoadingStatus(): LoadingStatus {
  const boundary = use(LoadingContext)
  if (!boundary) warnOutside('useLoadingStatus')
  const subscribe = boundary?.subscribe ?? noSubscription
  const getStatus = boundary?.getStatus ?? (() => OUTSIDE)
  return useSyncExternalStore(subscribe, getStatus, getStatus)
}
