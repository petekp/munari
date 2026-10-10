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
// Ownership: this component owns renderer creation and scheduling, both
// registration directions, renderer loss, and cleanup. It owns nothing about
// what is drawn — camera, lights, controls, post-processing, and every scene
// child stay the caller's.
//
// The renderer is Three's WebGPURenderer, which falls back to WebGL 2. Its
// default draws the frame into a linear target and converts it in a final
// pass that unpremultiplies, so light added over transparent pixels is lost
// and overlaps blend in linear space. Frames for the canvas therefore go
// through Three's DirectRenderPipeline, which draws to the canvas and
// converts each fragment, as WebGL did (decisions.md #72). Renderer tone
// mapping stays off so HTML keeps its source colors; a scene that wants tone
// mapping applies it in its own materials (decisions.md #69).
//
// A lost GPU ends the renderer for good on both backends, so the host
// remounts the Canvas with a new one, unless the replacement is lost too
// soon after it was created (decisions.md #73).

import { Component, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useFrame, useThree, type CanvasProps, type RootState } from '@react-three/fiber'
import { NoToneMapping, PCFShadowMap } from 'three'
import { DirectRenderPipeline, WebGPURenderer, type WebGPURendererParameters } from 'three/webgpu'
import {
  createSurfaceHost,
  mountSurfaceHost,
  type SurfaceCanvasId,
  type SurfaceHost,
} from './surfaceHostRegistry'
import { useSurfaceDevicePixelRatio } from './surfaceDevicePixelRatio'
import { watchSurfacePlacement } from './surfacePlacement'
import { surfaceCanvasPixelRatio, surfaceCanvasDisplayScale, counterSurfaceCanvasScale } from './surfacePixelDensity'
import { useLatest } from '../useLatest'
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

/** The parts of Fiber's renderer defaults the WebGPU renderer uses. */
interface FiberRendererDefaults {
  readonly canvas: object
  readonly antialias?: boolean
  readonly alpha?: boolean
}

export interface SurfaceCanvasProps
  extends Omit<CanvasProps, 'children' | 'fallback' | 'style' | 'gl' | 'flat' | 'shadows'> {
  /** Names this host for a page-side `Surface canvasId={…}`. */
  id?: SurfaceCanvasId
  /**
   * Parameters for the `WebGPURenderer` this Canvas creates, such as
   * `alpha`, `antialias`, or `forceWebGL`.
   */
  gl?: Omit<WebGPURendererParameters, 'canvas'>
  children?: React.ReactNode
  style?: SurfaceCanvasStyle
  /**
   * `scene` keeps ordinary R3F input over the full canvas. `surfaces` makes
   * an overlay canvas transparent except over registered Surface meshes.
   */
  pointerMode?: 'scene' | 'surfaces'
  /**
   * Fiber's shadow setting, without `'soft'`: Three 0.186 removed
   * `PCFSoftShadowMap`, so `true` means `PCFShadowMap`.
   */
  shadows?: Exclude<CanvasProps['shadows'], 'soft'>
  /** Shown instead of the scene when the renderer cannot be created or is lost. */
  fallback?: React.ReactNode
  /**
   * Called when the GPU is lost, after every Surface on this Canvas has
   * returned to the page. Scene state tied to the lost renderer ends here:
   * the Canvas then remounts its children on a new renderer, unless the
   * lost one was itself a replacement created under 10 s earlier.
   */
  onRendererLost?: () => void
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

const textureLimits = new WeakMap<RootState['gl'] | WebGPURenderer, number>()

/**
 * The largest texture side a SurfaceCanvas renderer accepts. Both backends
 * reject a larger upload and draw nothing, while Three still reports the
 * texture updated (decisions.md #70). Null for a renderer this file did not
 * create.
 */
export function surfaceTextureLimit(renderer: RootState['gl'] | WebGPURenderer): number | null {
  return textureLimits.get(renderer) ?? null
}

/**
 * The adapter's own texture limit. A WebGPU device otherwise gets the spec
 * default of 8192, below the 16384 WebGL used on the same hardware.
 */
async function adapterTextureLimit(powerPreference: GPUPowerPreference | undefined): Promise<number | null> {
  const gpu = globalThis.navigator?.gpu
  if (!gpu) return null
  // Three requests its adapter with these options; matching them asks the
  // same adapter. TypeScript's DOM types do not list `featureLevel` yet.
  const options: GPURequestAdapterOptions & { readonly featureLevel: 'compatibility' } = { powerPreference, featureLevel: 'compatibility' }
  const adapter = await gpu.requestAdapter(options)
  return adapter?.limits.maxTextureDimension2D ?? null
}

// Fiber 9.8.1 calls this factory once per root and queues the Canvas's
// `configure()` calls until it resolves (decisions.md #69).
function createSurfaceRenderer(
  parameters: Omit<WebGPURendererParameters, 'canvas'> | undefined,
): (defaults: FiberRendererDefaults) => Promise<WebGPURenderer> {
  return (defaults) => {
    // Fiber types its canvas with its own OffscreenCanvas stand-in.
    if (!(defaults.canvas instanceof HTMLCanvasElement)) return Promise.reject(new Error('[munari] SurfaceCanvas needs a DOM canvas'))
    return startSurfaceRenderer(parameters, defaults.canvas, defaults)
  }
}

class RendererStartError extends Error {}

/**
 * Keeps a renderer that could not start at the Canvas.
 *
 * Fiber 9.8.1 throws the factory's rejection while rendering the Canvas, so
 * without this a browser with no GPU unmounts the caller's whole tree, page
 * HTML included. A start failure is reported to the window's error handlers
 * and the Canvas renders nothing, which leaves `fallback` showing; any other
 * error goes on to the caller's boundaries.
 */
interface RendererStartState {
  readonly error: Error | null
}

class RendererStartBoundary extends Component<{ children: ReactNode }, RendererStartState> {
  state: RendererStartState = { error: null }

  static getDerivedStateFromError(error: Error): RendererStartState {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (error instanceof RendererStartError) reportError(error)
  }

  render() {
    const { error } = this.state
    if (error === null) return this.props.children
    if (error instanceof RendererStartError) return null
    throw error
  }
}

async function startSurfaceRenderer(
  parameters: Omit<WebGPURendererParameters, 'canvas'> | undefined,
  canvas: HTMLCanvasElement,
  { antialias, alpha }: FiberRendererDefaults,
): Promise<WebGPURenderer> {
  const powerPreference = parameters?.powerPreference ?? 'high-performance'
  const limit = parameters?.forceWebGL ? null : await adapterTextureLimit(powerPreference)
  const requiredLimits = limit === null ? parameters?.requiredLimits : { maxTextureDimension2D: limit, ...parameters?.requiredLimits }
  const renderer = new WebGPURenderer({ antialias, alpha, ...parameters, powerPreference, requiredLimits, canvas })
  try {
    await renderer.init()
  } catch (cause) {
    // Three reaches its WebGL 2 fallback before rejecting, and a missing
    // context surfaces there as a null dereference.
    throw new RendererStartError('[munari] SurfaceCanvas could not start WebGPU or its WebGL 2 fallback', { cause })
  }
  const context = renderer.getContext()
  textureLimits.set(
    renderer,
    context instanceof WebGL2RenderingContext
      ? context.getParameter(context.MAX_TEXTURE_SIZE)
      : requiredLimits?.maxTextureDimension2D ?? WEBGPU_DEFAULT_TEXTURE_LIMIT,
  )
  return renderer
}

// The WebGPU spec's default maxTextureDimension2D, granted when none is requested.
const WEBGPU_DEFAULT_TEXTURE_LIMIT = 8192

// A replacement renderer lost sooner than this after it was created is not
// replaced again, so a GPU that fails on every frame stops after one retry
// (decisions.md #73).
const REPEATED_LOSS_MS = 10_000

/**
 * Ask R3F for a frameloop mode only when it is not already the mode.
 *
 * `setFrameloop` in @react-three/fiber 9.8.1 restarts the shared clock
 * (`clock.elapsedTime = 0`) on every call, changed mode or not. The host
 * asks for a mode on every work-claim edge, twice per capture, so a scene
 * that poses itself as a function of `clock.elapsedTime` would snap to its
 * first frame at each one (measured 2026-09-11: 20 restarts in a 24-step
 * mouse sweep, none while idle). R3F's own prop re-apply has the same guard.
 */
export function settleFrameloop(
  state: Pick<RootState, 'frameloop' | 'setFrameloop'>,
  mode: NonNullable<CanvasProps['frameloop']>,
) {
  if (state.frameloop !== mode) state.setFrameloop(mode)
}

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
  onRendererLost,
  onDisplayScale,
  displaySized,
}: {
  host: SurfaceHost
  frameloop: CanvasProps['frameloop']
  onRendererLost: () => void
  onDisplayScale: (scale: number) => void
  displaySized:boolean
}) {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const get = useThree((s) => s.get)
  // The caller's idle mode, captured so a promotion can be undone exactly.
  // `undefined` means R3F's own default, which is 'always'.
  const idleMode = frameloop ?? 'always'
  const idleModeRef = useLatest(idleMode)
  useEffect(() => {
    const counter=counterSurfaceCanvasScale(gl.domElement)
    const update = () => { if(displaySized)counter.update(); onDisplayScale(displaySized?1:surfaceCanvasDisplayScale(gl.domElement)) }
    update()
    const stop=watchSurfacePlacement([() => gl.domElement.parentElement], update)
    return()=>{stop();counter.dispose()}
  }, [gl, onDisplayScale, displaySized])


  useEffect(() => {
    const runtime = {
      invalidate: () => invalidate(),
      setBusy: (busy: boolean) => {
        // Demoting an 'always' Canvas would silently stop a scene the
        // caller asked to run continuously, so idle returns the caller's mode.
        settleFrameloop(get(), busy ? 'always' : idleModeRef.current)
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
  }, [host, invalidate, get, idleModeRef])

  useEffect(() => {
    settleFrameloop(get(), host.workClaims() > 0 ? 'always' : idleMode)
  }, [host, idleMode, get])

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
    if (!(gl instanceof WebGPURenderer)) throw new Error('[munari] SurfaceCanvas needs its own WebGPURenderer')
    const original = gl.render.bind(gl)
    const pipeline = new DirectRenderPipeline(gl)
    // The pipeline's own render() calls gl.render; that inner call draws.
    let piping = false
    let notifying = false
    let warnedToneMapping = false
    gl.render = (scene, camera) => {
      if (piping) return original(scene, camera)
      if (gl.toneMapping !== NoToneMapping && !warnedToneMapping && isDevelopment()) {
        warnedToneMapping = true
        console.error(
          '[munari] <SurfaceCanvas> renderer tone mapping is on, which shifts every HTML pixel. ' +
            'Leave renderer.toneMapping at NoToneMapping and tone-map 3D materials instead: ' +
            'material.outputNode = toneMapping(mode, exposure, output).',
        )
      }
      const ownsPreparation = !notifying
      const automatic = scene.matrixWorldAutoUpdate
      let releaseRaster: (()=>void)|null = null
      let replacedSceneUpdate=false
      if(ownsPreparation)notifying=true
      try {
        if (ownsPreparation && (host.hasBeforeDraw() || host.hasRaster())) {
          if (automatic) scene.updateMatrixWorld()
          if (!camera.parent && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld()
          releaseRaster=host.prepareRaster(scene,camera,gl.getRenderTarget())
          if(host.hasBeforeDraw())host.beforeDraw(scene,camera,gl.getRenderTarget())
          // Without companion mutations, Three's pending traversal would repeat ours.
          // With them, retain its update so their new transforms reach this draw.
          else {scene.matrixWorldAutoUpdate=false;replacedSceneUpdate=true}
        }
        if (gl.getRenderTarget() === null) {
          piping = true
          try { pipeline.render(scene, camera) } finally { piping = false }
        } else original(scene, camera)
        host.closeFrameTail(gl.getRenderTarget()===null)
      } finally {
        if(ownsPreparation){if(replacedSceneUpdate)scene.matrixWorldAutoUpdate=automatic;releaseRaster?.();notifying=false}
      }
    }

    return () => {
      gl.render = original
      pipeline.dispose()
      // A renderer going away ends the frame with nothing on screen, so
      // whatever deferred to this tail is discarded rather than proven.
      host.discardFrameTail()
    }
  }, [gl, host])

  // Three reports a lost WebGPU device and a lost WebGL 2 context through
  // `onDeviceLost`, and that renderer draws nothing again: it has no restore
  // path on either backend. Reason "destroyed" is the renderer's own
  // dispose, which Three does not report.
  useEffect(() => {
    if (!(gl instanceof WebGPURenderer)) return
    // This bridge mounts only once its renderer exists, so a replacement's
    // mount is the end of the previous renderer's loss.
    host.setContextLost(false)
    const report = gl.onDeviceLost
    gl.onDeviceLost = (info) => {
      report.call(gl, info)
      // Nothing on this canvas will reach the screen again, so the
      // deferrals of the frame that died are void.
      host.discardFrameTail()
      host.setContextLost(true)
      // The canvas can keep compositing its last frame over the page HTML.
      gl.domElement.style.visibility = 'hidden'
      onRendererLost()
    }
    return () => {
      gl.onDeviceLost = report
    }
  }, [gl, host, onRendererLost])

  return null
}

/** The R3F-side rendering of every page-declared scene presentation. */
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
 * `SurfaceCanvas` reaches a `<SceneSurface.HTML>` declared deep in the scene.
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
  dpr,
  resize,
  onCreated,
  gl,
  pointerMode = 'scene',
  onRendererLost,
  shadows,
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
  const [rendererLost, setRendererLost] = useState(false)
  const [created, setCreated] = useState(false)
  const [displayScale, setDisplayScale] = useState(1)
  const nativeDpr=useSurfaceDevicePixelRatio()
  const drawingDpr = surfaceCanvasPixelRatio(dpr, nativeDpr, displayScale)
  // A Canvas mount keeps the first renderer it resolves and ignores a later
  // `gl`, so a new renderer after a loss is a new Canvas mount.
  const renderer = useMemo(() => createSurfaceRenderer(gl), [gl])
  // Fiber sets PCFSoftShadowMap for any boolean, false included. Three then
  // warns on the first render and draws PCFShadowMap.
  const fiberShadows = useMemo(
    () =>
      shadows === undefined || shadows === true || shadows === false
        ? { enabled: shadows === true, type: PCFShadowMap }
        : shadows,
    [shadows],
  )
  const [rendererMount, setRendererMount] = useState(0)
  const replacement = useRef<{ readonly createdAt: number } | null>(null)

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
  // and a caller's own onCreated (renderer configuration, shadow setup)
  // must still run — after ours, so it has the last word over anything the
  // host touched.
  const handleCreated = useCallback<NonNullable<CanvasProps['onCreated']>>(
    (state) => {
      setCreated(true)
      setRendererLost(false)
      if (replacement.current) replacement.current = { createdAt: performance.now() }
      onCreated?.(state)
    },
    [onCreated],
  )

  // Stable, so the bridge's listener effect is not torn down and rebuilt on
  // every parent render — a renderer loss arriving in that gap is a canvas
  // that never says it died.
  const onRendererLostRef = useLatest(onRendererLost)
  const handleRendererLost = useCallback(() => {
    setRendererLost(true)
    onRendererLostRef.current?.()
    const previous = replacement.current
    if (previous && performance.now() - previous.createdAt < REPEATED_LOSS_MS) return
    replacement.current = { createdAt: Number.POSITIVE_INFINITY }
    setRendererMount((mount) => mount + 1)
  }, [onRendererLostRef])

  const showFallback = fallback !== undefined && (rendererLost || !created)

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
        <RendererStartBoundary key={rendererMount}>
          <Canvas
            {...canvasProps}
            gl={renderer}
            shadows={fiberShadows}
            flat
            frameloop={frameloop}
            dpr={drawingDpr}
            resize={resize}
            onCreated={handleCreated}
            style={wrapperStyle}
          >
            <SurfaceHostBridge
              host={host}
              frameloop={frameloop}
              onRendererLost={handleRendererLost}
              onDisplayScale={setDisplayScale}
              displaySized={resize?.offsetSize!==true}
            />
            {children}
            <SurfaceInwardPresenters host={host} />
            {pointerMode === 'surfaces' ? <SurfacePointerBridge host={host} /> : null}
          </Canvas>
        </RendererStartBoundary>
      </SurfaceHostContext>
      {showFallback ? fallback : null}
    </>
  )
}
