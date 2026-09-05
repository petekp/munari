// @vitest-environment happy-dom
//
// The anchor transaction's reactive channel, pinned at the scope.
//
// The law (surfaceAnchorScope.ts preamble): an anchor set is ONE transaction
// against ONE paint, and matter placed from it is withheld until a COMPLETE
// set exists for the generation currently drawn on this geometry. The scope
// owns the only `subscribe`/`announce` channel an anchor consumer is wired
// to, so a change the consumer cares about reaches it through `announce` or
// not at all.
//
// The silent failure this file exists to catch: a live `mirrorU` flip
// activates no paint, advances no generation, and — before the bridge this
// scope now owns — fired no `announce` and re-issued no receipt. The texture
// flipped and the anchored matter stayed on the un-mirrored side, in a
// correctly sized box at a coherent spot, with nothing logging and `box()`
// ref-identical across the flip (introduced 2026-08-18 in commit 108c575).
// The fix is the scope-local re-issue and announce path on the runtime's
// mirror signal, and these tests hold it open.
//
// No JSX here: the runner only discovers `.test.ts` (surfaceHandle.test.ts
// carries the same note).

import { createElement, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DomPaintReceipt, SourceUvRect } from '@munari/core'
import { useSurfaceAnchorScope, type SurfaceAnchorScope } from './surfaceAnchorScope'
import type { SurfaceSourceRuntime } from './surfaceSourceRuntime'

// React reads this global to decide whether renders must be wrapped in
// `act`. It is React's own contract, not ours, so it is declared rather
// than asserted onto globalThis at the point of use.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false

let container: HTMLDivElement
let captureRoot: HTMLElement
let scope: SurfaceAnchorScope | null = null
let renderCount = 0
let lastPlaced: { u: number; v: number } | null = null

// The paint the fake runtime reports. `generation` is mutable so a test can
// advance it and re-collect against a new generation on `noteDrawn`.
let generation = 1
const currentPaint = (): DomPaintReceipt =>
  Object.freeze({
    frame: Object.freeze({ sourceId: 7, generation }),
    paintedSize: Object.freeze([200, 100] as const),
    storeSize: Object.freeze([400, 200] as const),
  })

/** The runtime members the scope reads. The rest are unreachable from it. */
type ScopeRuntime = Pick<SurfaceSourceRuntime, 'currentPaint' | 'mirrorU' | 'subscribeMirrorU'>

interface FakeRuntime {
  runtime: SurfaceSourceRuntime
  listeners: Set<(mirrorU: boolean) => void>
  flip(to: boolean): void
}

/** A runtime that answers only the three members the scope reads. */
function makeRuntime(start = false): FakeRuntime {
  let mirror = start
  const listeners = new Set<(mirrorU: boolean) => void>()
  const stub: ScopeRuntime = {
    currentPaint,
    mirrorU: () => mirror,
    subscribeMirrorU: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  // SAFETY: widening a `Pick` back to the interface it came from. The scope
  // reads only these three members; the rest are unreachable from it, and a
  // partial stub is what keeps the contract about the subscription rather
  // than about the paint pipeline.
  const runtime = stub as SurfaceSourceRuntime
  return {
    runtime,
    listeners,
    flip: (to: boolean) => {
      if (to === mirror) return
      mirror = to
      for (const listener of listeners) listener(to)
    },
  }
}

const rect = (
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  x: left,
  y: top,
  toJSON: () => ({}),
})

function buildCaptureRoot(): HTMLElement {
  const root = document.createElement('div')
  root.getBoundingClientRect = () => rect(10, 20, 200, 100)
  const knob = document.createElement('div')
  knob.dataset.munariAnchor = 'knob'
  // 50px of left margin inside a 200px root → uMin 0.25, uMax 0.65.
  knob.getBoundingClientRect = () => rect(60, 45, 80, 40)
  root.append(knob)
  return root
}

/** Mounts the hook alone, so the test can drive require/noteDrawn by hand. */
const ScopeHost = ({ runtime }: { runtime: SurfaceSourceRuntime }) => {
  scope = useSurfaceAnchorScope(runtime, captureRoot)
  return null
}

const mountScope = (runtime: SurfaceSourceRuntime) => {
  const reactRoot = createRoot(container)
  flushSync(() => reactRoot.render(createElement(ScopeHost, { runtime })))
  return reactRoot
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  scope = null
  renderCount = 0
  lastPlaced = null
  generation = 1
  captureRoot = buildCaptureRoot()
  document.body.append(captureRoot)
})

afterEach(() => {
  captureRoot.remove()
  container.remove()
  scope = null
})

describe('a live mirrorU flip', () => {
  it('announces and re-issues the committed receipt with fresh identity', () => {
    const fake = makeRuntime()
    const reactRoot = mountScope(fake.runtime)
    let announceCount = 0
    const unsubscribe = scope!.subscribe(() => {
      announceCount += 1
    })
    const release = scope!.require('knob')
    // require() collects and announces once; the committed set is still null
    // (require invalidates it), so box() is null until a draw promotes one.
    announceCount = 0
    expect(scope!.box('knob')).toBeNull()
    expect(scope!.mirrorU()).toBe(false)

    // Drawing the current generation promotes the collected set.
    scope!.noteDrawn(7, 1)
    expect(announceCount).toBe(1)
    const boxBefore = scope!.box('knob')
    expect(boxBefore).not.toBeNull()

    // Flip mirror. The live read sees it, the subscriber is told, and box()
    // returns a NEW reference — the consumer's setBox would not bail on
    // Object.is, so <Surface.Anchor> re-renders and `placed` re-reads mirrorU.
    fake.flip(true)
    expect(scope!.mirrorU()).toBe(true)
    expect(announceCount).toBe(2)
    const boxAfter = scope!.box('knob')
    expect(boxAfter).not.toBe(boxBefore)
    // The re-issue is content-preserving: the box moved by identity, not by
    // value. Mirror acts on the consumer's u, not on the source-UV rect.
    expect(boxAfter).toEqual(boxBefore)

    unsubscribe()
    release()
    flushSync(() => reactRoot.unmount())
  })

  it('does not re-announce a same-generation redraw after a flip', () => {
    const fake = makeRuntime()
    const reactRoot = mountScope(fake.runtime)
    let announceCount = 0
    const unsubscribe = scope!.subscribe(() => {
      announceCount += 1
    })
    const release = scope!.require('knob')
    scope!.noteDrawn(7, 1)
    announceCount = 0

    fake.flip(true)
    expect(announceCount).toBe(1)
    const reissued = scope!.box('knob')

    // The texture flip becomes visible on an unrelated redraw that still
    // describes the SAME generation. With `pending` kept in lockstep with the
    // re-issued `committed`, noteDrawn short-circuits: no second announce,
    // and box() stays at the re-issued reference — no churn for the consumer.
    scope!.noteDrawn(7, 1)
    expect(announceCount).toBe(1)
    expect(scope!.box('knob')).toBe(reissued)
    expect(scope!.mirrorU()).toBe(true)

    unsubscribe()
    release()
    flushSync(() => reactRoot.unmount())
  })

  it('promotes a new generation after a flip onto the mirrored side', () => {
    const fake = makeRuntime()
    const reactRoot = mountScope(fake.runtime)
    let announceCount = 0
    const unsubscribe = scope!.subscribe(() => {
      announceCount += 1
    })
    const release = scope!.require('knob')
    scope!.noteDrawn(7, 1)
    announceCount = 0

    fake.flip(true)
    expect(announceCount).toBe(1)

    // The source DOM next repaints: generation advances, noteDrawn sees a
    // generation the pending set does not describe, re-collects, and promotes
    // the fresh receipt. mirrorU is still true, so the consumer re-reads it
    // and the anchor lands on the mirrored side.
    generation = 2
    scope!.noteDrawn(7, 2)
    expect(announceCount).toBe(2)
    const promoted = scope!.box('knob')
    expect(promoted).not.toBeNull()
    expect(scope!.mirrorU()).toBe(true)

    // A subsequent same-generation redraw is again a no-op: pending and
    // committed are back in lockstep at the new generation.
    scope!.noteDrawn(7, 2)
    expect(announceCount).toBe(2)
    expect(scope!.box('knob')).toBe(promoted)

    unsubscribe()
    release()
    flushSync(() => reactRoot.unmount())
  })

  it('flips back and forth, announcing once per actual change', () => {
    const fake = makeRuntime()
    const reactRoot = mountScope(fake.runtime)
    let announceCount = 0
    const unsubscribe = scope!.subscribe(() => {
      announceCount += 1
    })
    const release = scope!.require('knob')
    scope!.noteDrawn(7, 1)
    announceCount = 0

    fake.flip(true)
    fake.flip(false)
    fake.flip(true)
    // One announce per actual flip (3). Each re-issue produces a fresh box
    // reference, so the consumer re-renders on every toggle.
    expect(announceCount).toBe(3)
    expect(scope!.mirrorU()).toBe(true)
    expect(scope!.box('knob')).not.toBeNull()

    // A no-op flip (the value already held) is silent, the way the runtime's
    // setMirrorU short-circuits on an unchanged value.
    fake.flip(true)
    expect(announceCount).toBe(3)

    unsubscribe()
    release()
    flushSync(() => reactRoot.unmount())
  })

  it('is a no-op when the runtime has no committed set yet', () => {
    const fake = makeRuntime()
    const reactRoot = mountScope(fake.runtime)
    let announceCount = 0
    const unsubscribe = scope!.subscribe(() => {
      announceCount += 1
    })
    const release = scope!.require('knob')
    // A collected-but-not-yet-drawn set: pending is set, committed is null.
    announceCount = 0
    expect(scope!.box('knob')).toBeNull()

    fake.flip(true)
    // Nothing committed means nothing to re-issue; announce does not fire.
    // The consumer's box is null either way, and the next noteDrawn promotes
    // a set the consumer reads against the now-current mirrorU.
    expect(announceCount).toBe(0)
    expect(scope!.box('knob')).toBeNull()

    scope!.noteDrawn(7, 1)
    expect(announceCount).toBe(1)
    expect(scope!.box('knob')).not.toBeNull()
    expect(scope!.mirrorU()).toBe(true)

    unsubscribe()
    release()
    flushSync(() => reactRoot.unmount())
  })
})

describe('the subscription bridges runtime -> scope -> consumer', () => {
  it('re-subscribes when the runtime is replaced (source lifetime, not mirror)', () => {
    const first = makeRuntime()
    const second = makeRuntime()
    const reactRoot = createRoot(container)
    flushSync(() => reactRoot.render(createElement(ScopeHost, { runtime: first.runtime })))
    const release = scope!.require('knob')
    scope!.noteDrawn(7, 1)
    let announceCount = 0
    const unsubscribe = scope!.subscribe(() => {
      announceCount += 1
    })

    // Replace the runtime. The effect re-runs: it unsubscribes from `first`
    // and subscribes to `second`. The scope object is stable (the memo's deps
    // did not change), and the committed set carries over because it lives on
    // a ref, so a flip on the new runtime re-issues against it.
    flushSync(() => reactRoot.render(createElement(ScopeHost, { runtime: second.runtime })))
    expect(first.listeners.size).toBe(0)
    expect(second.listeners.size).toBe(1)

    first.flip(true)
    expect(announceCount).toBe(0)
    second.flip(true)
    expect(announceCount).toBe(1)
    expect(scope!.mirrorU()).toBe(true)

    unsubscribe()
    release()
    flushSync(() => reactRoot.unmount())
  })

  it('unsubscribes from the runtime when the scope unmounts', () => {
    const fake = makeRuntime()
    const reactRoot = mountScope(fake.runtime)
    expect(fake.listeners.size).toBe(1)
    flushSync(() => reactRoot.unmount())
    expect(fake.listeners.size).toBe(0)
  })
})

/**
 * A consumer that mirrors `<Surface.Anchor>`'s reactive pattern (deps
 * `[box, scope]`, mirrorU() read passively inside the memo) — to prove the
 * scope-level fix reaches the consumer without any change to the consumer.
 * If the scope re-issues with fresh identity, setBox does not bail and the
 * memo recomputes reading the now-current mirrorU(); if it does not, the
 * memo never recomputes and the anchor stays on the un-mirrored side.
 */
function AnchorProbe({ scope, name }: { scope: SurfaceAnchorScope; name: string }) {
  useEffect(() => scope.require(name), [scope, name])
  const [box, setBox] = useState<SourceUvRect | null>(() => scope.box(name))
  useEffect(() => {
    const read = () => setBox(scope.box(name))
    read()
    return scope.subscribe(read)
  }, [scope, name])
  const placed = useMemo(() => {
    if (!box) return null
    const u = scope.mirrorU() ? 1 - (box.uMin + box.uMax) / 2 : (box.uMin + box.uMax) / 2
    const v = (box.vMin + box.vMax) / 2
    return { u, v }
  }, [box, scope])
  renderCount += 1
  lastPlaced = placed
  return null
}

const Tree = ({ runtime }: { runtime: SurfaceSourceRuntime }) => {
  scope = useSurfaceAnchorScope(runtime, captureRoot)
  return createElement(AnchorProbe, { scope, name: 'knob' })
}

describe('the consumer re-renders onto the mirrored side', () => {
  it('recomputes placed.u when mirrorU flips, with no consumer-side change', () => {
    const fake = makeRuntime()
    const reactRoot = createRoot(container)
    flushSync(() => reactRoot.render(createElement(Tree, { runtime: fake.runtime })))
    // The anchor's own require effect ran on mount; draw the generation to
    // commit a complete set the consumer can read.
    flushSync(() => scope!.noteDrawn(7, 1))
    expect(lastPlaced).not.toBeNull()
    const countsAfterDraw = renderCount
    // Mirror off: u is the box centre, (uMin+uMax)/2 = 0.45.
    expect(lastPlaced!.u).toBeCloseTo(0.45, 12)

    // Flip. The scope re-issues, the consumer's read listener fires, setBox
    // sees a non-Object.is reference, the component re-renders, and placed
    // recomputes reading mirrorU() === true → u = 1 - 0.45 = 0.55. Wrapped in
    // flushSync because the consumer's re-render is a React state update the
    // flip schedules (the real path batches it inside the source-host effect).
    flushSync(() => fake.flip(true))
    expect(renderCount).toBeGreaterThan(countsAfterDraw)
    expect(lastPlaced!.u).toBeCloseTo(0.55, 12)

    // Flip back. The anchor returns to the un-mirrored side, one re-render
    // per flip, no stray state.
    flushSync(() => fake.flip(false))
    expect(lastPlaced!.u).toBeCloseTo(0.45, 12)

    flushSync(() => reactRoot.unmount())
  })
})
