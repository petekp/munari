// <SurfaceCanvas> — an R3F Canvas that also hosts DOM sources.
//
// The law: the Canvas is shared, so nothing about it may be moved on behalf
// of ONE Surface. Canvas opacity, visibility, and pointer-events belong to
// the host, because several independent handoffs composite here at once and
// hiding the canvas to warm one of them takes every other Surface's pixels
// off screen with it (the shared-Canvas warm-up law). A Surface warms by
// drawing write-free instead, which is a per-object property.
//
// The fault that produced the reference-counted scheduler, 2026-08-16: a
// boolean `busy` flag on a `frameloop="demand"` Canvas let the first
// Surface to settle write `false` while a second was still warming. The
// second never presented, its handoff hung in `lifting` forever, and the
// page it was lifting from stayed visible under a canvas that had stopped
// drawing. Claims are counted; the caller's idle mode returns when the last
// one is released.
//
// Ownership: this component owns renderer scheduling, both registration
// directions, context loss, and cleanup. It owns nothing about what is
// drawn — camera, lights, controls, post-processing, and every scene child
// stay the caller's, and an arbitrary existing scene may be wrapped in this
// without changing a line of it.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useFrame, useThree, type CanvasProps } from '@react-three/fiber'
import {
  createSurfaceHost,
  mountSurfaceHost,
  type SurfaceCanvasId,
  type SurfaceHost,
} from './surfaceHostRegistry'
import { SurfaceHostContext } from './surfaceHostContext'
import { CanvasPointerGate } from '../CanvasPointerGate'

/**
 * Canvas style, minus the fields the host reserves.
 *
 * These three are not stylistic preferences here — they are the mechanism
 * the warm-up law forbids using per-Surface, and the mechanism the pointer
 * gate drives. A caller who sets them is describing a Surface-level
 * behavior in a Canvas-level place, and the type says so rather than
 * letting the two fight at runtime.
 */
export type SurfaceCanvasStyle = Omit<
  React.CSSProperties,
  'opacity' | 'visibility' | 'pointerEvents'
>

export interface SurfaceCanvasProps
  extends Omit<CanvasProps, 'children' | 'fallback' | 'style'> {
  /** Names this host for a page-side `Surface canvas={…}`. */
  id?: SurfaceCanvasId
  children?: React.ReactNode
  style?: SurfaceCanvasStyle
  /**
   * `scene` keeps ordinary R3F input over the full canvas. `surfaces` makes
   * an overlay canvas transparent except over registered Surface meshes.
   */
  pointerMode?: 'scene' | 'surfaces'
  /** Shown instead of the scene when the renderer cannot be created or is lost. */
  fallback?: React.ReactNode
}

// The reserved style fields, as a runtime list for the development check.
// The type above catches an authored literal; this catches a spread style
// object, which is how a real application usually gets here.
const RESERVED_STYLE = ['opacity', 'visibility', 'pointerEvents'] as const

const isDevelopment = (): boolean =>
  // SAFETY: `import.meta.env` is the bundler's, not the language's — Vite
  // defines it, Node and a bare tsc do not. Every member is optional
  // because absence is the normal answer outside a dev server.
  (import.meta as ImportMeta & { readonly env?: { readonly DEV?: boolean } }).env?.DEV === true

/**
 * The renderer half of the host, mounted inside the Canvas.
 *
 * Everything that needs `gl`, `invalidate`, or `setFrameloop` lives here
 * because those exist only under R3F's provider. The bridge installs the
 * runtime on the registry entry and clears it on unmount, which is what
 * makes a registration that outlives its Canvas harmless rather than a
 * null dereference in someone else's frame loop.
 */
function SurfaceHostBridge({
  host,
  frameloop,
  onContextLost,
  onContextRestored,
}: {
  host: SurfaceHost
  frameloop: CanvasProps['frameloop']
  onContextLost: () => void
  onContextRestored: () => void
}) {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const setFrameloop = useThree((s) => s.setFrameloop)
  // The caller's idle mode, captured so a promotion can be undone exactly.
  // `undefined` means R3F's own default, which is 'always'.
  const idleMode = frameloop ?? 'always'

  useEffect(() => {
    const runtime = {
      invalidate: () => invalidate(),
      setBusy: (busy: boolean) => {
        // Promoting an 'always' Canvas is a no-op, and demoting one would
        // silently stop a scene the caller asked to run continuously.
        if (idleMode === 'always') return
        setFrameloop(busy ? 'always' : idleMode)
      },
    }
    // First Canvas to arrive keeps the id. A second one under the same id
    // is the duplicate-id fault, reported by the registry; installing over
    // the first would send every invalidate to the impostor and leave the
    // Canvas the Surfaces actually draw in asleep — a scene that stops
    // updating with nothing on screen saying why.
    const owned = host.runtime === null
    if (owned) {
      host.setRuntime(runtime)
      // A host that already has claims when its renderer arrives — a page
      // tree that committed first — is promoted now rather than at the next
      // claim, which may never come.
      if (host.workClaims() > 0) runtime.setBusy(true)
      invalidate()
    }
    return () => {
      // Identity-checked: a remount installs the replacement before this
      // cleanup runs, and clearing it here would leave a live Canvas with
      // no way to be invalidated.
      if (host.runtime === runtime) host.setRuntime(null)
    }
  }, [host, invalidate, setFrameloop, idleMode])

  // One frame callback for every Surface on this host. It runs at the
  // default priority, so capture and protocol both land before the render,
  // which is what lets a paint uploaded this frame be drawn this frame
  // rather than next.
  useFrame((_, delta) => {
    // A new frame begins here, so anything still waiting on the tail
    // belongs to a frame that ended without reaching the screen — a
    // composite pass that never ran, a renderer that bailed. Discarded at
    // the START of the next frame rather than at the end of its own,
    // because a post-processed frame's LAST draw is the one that presents
    // and nothing announces which draw that will be until it happens.
    host.discardFrameTail()
    const dtMs = Math.min(delta, 1 / 30) * 1000
    for (const tick of host.ticks()) tick(dtMs)
    // The frameloop promotion alone does not survive: R3F re-applies the
    // `frameloop` prop on every Canvas re-render, so a parent that renders
    // during a crossing demotes the loop back to 'demand' and the protocol
    // stops mid-phase with the page released over a frozen mesh. Asking for
    // the next frame from inside this one cannot be undone that way.
    if (host.workClaims() > 0) invalidate()
  })

  // The frame tail. A presenter that wrote color into a render target
  // cannot close its own presentation — the pixels have not reached the
  // screen yet, and a composite pass could still discard them — so it
  // defers to here. `render` is wrapped rather than watched because three
  // emits nothing at the end of a frame, and an effect composer's final
  // pass is an ordinary `render` call with the target set back to null.
  useEffect(() => {
    const original = gl.render.bind(gl)
    gl.render = (scene, camera) => {
      original(scene, camera)
      host.closeFrameTail(gl.getRenderTarget() === null)
    }
    return () => {
      gl.render = original
      // A renderer going away ends the frame with nothing on screen, so
      // whatever deferred to this tail is discarded rather than proven.
      host.discardFrameTail()
    }
  }, [gl, host])

  useEffect(() => {
    const canvas = gl.domElement
    const lost = (event: Event) => {
      // Preventing the default is what lets the browser restore the
      // context at all; without it the canvas is dead for good.
      event.preventDefault()
      // Nothing on this canvas will reach the screen again on the lost
      // context, so the deferrals of the frame that died are void.
      host.discardFrameTail()
      onContextLost()
    }
    const restored = () => {
      // A demand Canvas asleep when the context died has no frame queued to
      // draw the recovered scene in, and the fallback would stay up over a
      // renderer that works.
      invalidate()
      onContextRestored()
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    return () => {
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
    }
  }, [gl, host, invalidate, onContextLost, onContextRestored])

  return null
}

/** The R3F-side rendering of every page-declared WebGL presentation. */
function SurfaceInwardPresenters({ host }: { host: SurfaceHost }) {
  const entries = useSyncExternalStore(
    useMemo(() => host.subscribePresenters.bind(host), [host]),
    useMemo(() => host.presenters.bind(host), [host]),
    useMemo(() => host.presenters.bind(host), [host]),
  )
  return (
    <>
      {entries.map((entry) => (
        <group key={entry.key}>{entry.element}</group>
      ))}
    </>
  )
}

/** Keep the shared Canvas transparent to input except over a Surface mesh. */
function SurfacePointerBridge({ host }: { host: SurfaceHost }) {
  const isTarget = useMemo(
    () => (object: import('three').Object3D) => host.objects().includes(object),
    [host],
  )
  return <CanvasPointerGate isTarget={isTarget} />
}

/**
 * The react-dom-side rendering of every Canvas-declared source.
 *
 * The portals are rendered HERE — in the page tree, above the Canvas —
 * rather than from a React root created inside the parked element, and that
 * placement is the whole reason this component exists: a portal keeps the
 * source content in one reconciler, so a provider mounted above
 * `SurfaceCanvas` reaches a `<Surface source>` declared deep in the scene.
 * A second root would not, and every scene would have to re-plumb its
 * theme, store, and router by hand.
 */
function SurfaceOutwardSources({ host }: { host: SurfaceHost }) {
  const entries = useSyncExternalStore(
    useMemo(() => host.subscribeSources.bind(host), [host]),
    useMemo(() => host.sources.bind(host), [host]),
    useMemo(() => host.sources.bind(host), [host]),
  )
  return (
    <>
      {entries.map((entry) => createPortal(entry.content, entry.container, entry.key))}
    </>
  )
}

export function SurfaceCanvas({
  id,
  children,
  style,
  fallback,
  frameloop,
  onCreated,
  pointerMode = 'scene',
  ...canvasProps
}: SurfaceCanvasProps) {
  const candidate = useMemo(() => createSurfaceHost(id), [id])
  const [mounted, setMounted] = useState<{
    readonly candidate: SurfaceHost
    readonly host: SurfaceHost
  }>(() => ({ candidate, host: candidate }))
  // An id change mints a new candidate before its mount effect runs. Do not
  // render one commit through the previous id's host while state catches up.
  const host = mounted.candidate === candidate ? mounted.host : candidate
  const [contextLost, setContextLost] = useState(false)
  const [created, setCreated] = useState(false)

  useEffect(() => {
    const mount = mountSurfaceHost(candidate)
    setMounted({ candidate, host: mount.host })
    return () => {
      mount.release()
    }
  }, [candidate])

  useEffect(() => {
    if (!isDevelopment() || !style) return
    // SAFETY: the reserved fields are exactly what `SurfaceCanvasStyle`
    // omits, so the declared type cannot index them. A spread style object
    // can still carry one at runtime, which is the case this check exists
    // for, and reading it through the full CSS shape is how to see it.
    const authored = style as React.CSSProperties
    for (const field of RESERVED_STYLE) {
      if (authored[field] === undefined) continue
      console.error(
        `[munari] <SurfaceCanvas${id ? ` id="${id}"` : ''}> reserves style.${field}. ` +
          'Several Surfaces composite in one Canvas, so a Canvas-level ' +
          'visibility change cannot describe one of them — use the Surface\'s ' +
          'own presentation instead.',
      )
    }
  }, [style, id])

  // Chained, not replaced: the host needs the store the moment it exists,
  // and a caller's own onCreated (renderer configuration, tone mapping,
  // shadow setup) must still run — after ours, so it has the last word
  // over anything the host touched.
  const handleCreated = useCallback<NonNullable<CanvasProps['onCreated']>>(
    (state) => {
      setCreated(true)
      setContextLost(false)
      onCreated?.(state)
    },
    [onCreated],
  )

  // Stable, so the bridge's listener effect is not torn down and rebuilt on
  // every parent render — a context loss arriving in that gap is a canvas
  // that never says it died.
  const handleContextLost = useCallback(() => setContextLost(true), [])
  const handleContextRestored = useCallback(() => setContextLost(false), [])

  const showFallback = fallback !== undefined && (contextLost || !created)

  // The wrapper is CLEAR and the canvas inside re-enables itself.
  //
  // R3F writes `pointer-events: auto` onto its own div, and a Canvas laid
  // over a page — the normal shape for an overlay scene — is then a
  // full-viewport element that swallows every click, selection and scroll
  // the page was supposed to get. The caller cannot fix it: the reserved
  // fields say this belongs to the host, and the host's answer is a clear
  // parent with the gate driving the canvas itself, which is the one
  // arrangement where "solid only over a Surface" is true of the whole
  // element stack rather than just the innermost one.
  const wrapperStyle = useMemo(
    () => ({ ...style, pointerEvents: pointerMode === 'surfaces' ? ('none' as const) : ('auto' as const) }),
    [style, pointerMode],
  )

  return (
    <>
      <SurfaceOutwardSources host={host} />
      <SurfaceHostContext value={host}>
        <Canvas
          {...canvasProps}
          frameloop={frameloop}
          onCreated={handleCreated}
          style={wrapperStyle}
        >
          <SurfaceHostBridge
            host={host}
            frameloop={frameloop}
            onContextLost={handleContextLost}
            onContextRestored={handleContextRestored}
          />
          {children}
          <SurfaceInwardPresenters host={host} />
          {pointerMode === 'surfaces' ? <SurfacePointerBridge host={host} /> : null}
        </Canvas>
      </SurfaceHostContext>
      {showFallback ? fallback : null}
    </>
  )
}
