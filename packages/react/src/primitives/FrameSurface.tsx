// FrameSurface — a caller-owned canvas presented on a scene mesh.
//
// This is the React half of the frame path (decisions.md #24, #25).
// The kernel names pixels (FrameSource: sourceId + generation) and
// judges receipts (presentationReceiptSatisfies); this file owns the
// only Three objects in the path — one CanvasTexture and the mesh that
// draws it — and turns renderer callbacks into the receipts the kernel
// judges. Publish, upload, draw, and presentation are four different
// events with four different evidence points:
//
//   publish       source.subscribe()   → needsUpdate + invalidate
//   upload        texture.onUpdate     → label the pixels Three took
//   draw          mesh.onAfterRender   → FrameDrawReceipt
//   presentation  onBeforeRender gate  → PresentationReceipt, only for
//                 + host frame tail      a color-writing draw in a frame
//                                        that reached the canvas
//
// The gate exists because Three fires onAfterRender for off-screen
// render targets and colorWrite:false materials too. Those draws move
// pixels, but they cannot have reached the screen, so a transfer that
// released the page on one would flicker (decisions.md #25: drawing is
// not showing). WebGPURenderer draws every frame into an internal target,
// so no draw shows a null target; the SurfaceCanvas tail decides, and a
// plain Canvas issues no presentation receipts (#69). Rejections are
// counted per transfer and warned once, so a mis-wired transfer is
// diagnosable without a console flood.
//
// The runtime is split from the component so this ordering is testable
// without mocking a renderer. The component's job is lifecycle: build
// the replacement runtime before releasing the current one, swap in
// the layout phase so no renderer frame lands between the two, and
// never let a disposed runtime's mesh report into the new source's
// callbacks.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeElements } from '@react-three/fiber'
import {
  presentationReceiptSatisfies,
  uploadNeedsRealloc,
  type FrameId,
  type FrameSource,
  type PresentationReceipt,
  type PresentationRequirement,
} from '@munari/core'
import { SurfaceContext, type SurfaceContextValue } from './SurfaceContext'
import { surfaceStoreOf, type SurfaceHandle } from './surface/surfaceHandle'
import { useSurfaceHostContext } from './surface/surfaceHostContext'
import { surfaceTextureLimit } from './surface/SurfaceCanvas'
import { useLatest } from './useLatest'

export interface FrameDrawReceipt {
  readonly surfaceEpoch: number
  readonly frame: FrameId
}

export interface FrameSurfaceProps
  extends Omit<
    ThreeElements['mesh'],
    'children' | 'material' | 'onAfterRender' | 'onBeforeRender' | 'ref'
  > {
  /** Use Surface for retained HTML; FrameSurface accepts caller-owned frames. */
  html?: never
  frame: FrameSource
  /**
   * The handoff this mesh participates in, when it represents a Surface.
   * While the page copy is the presented one the
   * mesh declines every ray — input follows the eye (decisions.md #33) —
   * exactly as `<Surface.Mesh>` does. An authored `raycast` prop wins.
   */
  surface?: SurfaceHandle
  children: React.ReactNode
  onFrameDrawn?: (receipt: FrameDrawReceipt) => void
  /** Optional proof requested by a presentation-authority transfer. */
  presentation?: PresentationRequirement
  /** Fires only after an eligible output draw satisfies `presentation`. */
  onPresented?: (receipt: PresentationReceipt) => void
  mirrorU?: boolean
  /** Logical surface size in CSS pixels. Defaults to the canvas backing size. */
  width?: number
  height?: number
  side?: THREE.Side
  /** Used only by `material="standard"`. */
  roughness?: number
  /** Used only by `material="standard"`. */
  metalness?: number
  /**
   * Honor source alpha with a built-in material. Any premultiplied frame
   * source must use `material="none"`, even when this is false: its RGB is
   * already weighted by alpha. Mask the full vec4 and blend
   * ONE / ONE_MINUS_SRC_ALPHA.
   */
  transparent?: boolean
  /**
   * `unlit` (default) preserves source color and bypasses tone mapping.
   * `standard` deliberately applies scene lighting. `none` lets children
   * supply a custom material through `/advanced`'s `useFrameTexture()`.
   */
  material?: 'unlit' | 'standard' | 'none'
}

export interface FrameSurfaceRuntime {
  readonly source: FrameSource
  readonly surfaceEpoch: number
  readonly texture: THREE.CanvasTexture
  takeDrawReceipt(): FrameDrawReceipt | null
  beginPresentationPass(
    requirement: PresentationRequirement | undefined,
    pass: PresentationPass,
    warn?: (message: string) => void,
  ): void
  takePresentationReceipt(warn?: (message: string) => void): PresentationReceipt | null
  /** True the first time a receipt is delivered; a deferred one may never be. */
  deliverPresentation(receipt: PresentationReceipt): boolean
  rejectedPresentationDraws(transferId: number): number
  dispose(): void
}

/** What one draw of the mesh can prove, read in its pre-draw callback. */
export interface PresentationPass {
  /** The frame this draw belongs to can reach the canvas. */
  readonly outputEligible: boolean
  readonly colorWrite: boolean
  /** The geometry has at least one element to draw. */
  readonly drawable: boolean
}

/**
 * Whether a draw of this geometry can produce any primitive. Three runs the
 * mesh callbacks for an empty draw too, and the canvas keeps its old pixels.
 * FrameSurface draws one material, so no geometry group narrows the range.
 */
export function geometryDraws(geometry: THREE.BufferGeometry): boolean {
  const elements = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0
  const end = Math.min(elements, geometry.drawRange.start + geometry.drawRange.count)
  return end > geometry.drawRange.start
}

/** Internal runtime split out so the upload/draw ordering can be tested without a renderer mock. */
export function createFrameSurfaceRuntime(
  source: FrameSource,
  surfaceEpoch: number,
  mirrorU: boolean,
  invalidate: () => void,
  /** The renderer's largest texture side, when it rejects larger uploads. */
  textureLimit: number | null = null,
): FrameSurfaceRuntime {
  let active = true
  let pendingFrame: FrameId | null = null
  let lastUploadedFrame: FrameId | null = null
  let pendingPresentation: PresentationRequirement | null = null
  const presented = new Set<string>()
  const rejected = new Map<number, number>()
  const warned = new Set<number>()
  let allocation = {
    width: source.canvas.width,
    height: source.canvas.height,
  }
  let reportedOversize = false
  const oversized = () => {
    if (textureLimit === null) return false
    const { width, height } = source.canvas
    if (width <= textureLimit && height <= textureLimit) return false
    if (!reportedOversize && isDevelopmentRuntime()) {
      console.error(
        `munari: FrameSurface source is ${width}x${height}, over this renderer's ${textureLimit}px texture limit; ` +
          'it will not upload or issue receipts until it fits',
      )
    }
    reportedOversize = true
    return true
  }

  // A canvas holding cross-origin pixels cannot be uploaded. WebGPU ignores
  // the failed copy and still reports the texture updated; the WebGL 2
  // fallback throws from render(). Three gets a blank stand-in instead. The
  // check runs once per allocation: at creation, then at the first publish
  // after each, because a caller usually draws after creating the source.
  // Taint lasts until the canvas is resized (decisions.md #70).
  let tainted = !canvasIsOriginClean(source.canvas)
  let publishChecked = false
  let reportedTaint = false
  const reportTaint = () => {
    if (!reportedTaint && isDevelopmentRuntime()) {
      console.error(
        'munari: FrameSurface source canvas holds cross-origin pixels and cannot be uploaded; ' +
          'it issues no receipts until it is resized and redrawn with same-origin or CORS content',
      )
    }
    reportedTaint = true
  }
  if (tainted) reportTaint()

  const texture = new THREE.CanvasTexture(tainted ? blankCanvas() : source.canvas)
  // These values must be final before the texture reaches context, material,
  // or renderer. A later passive write can lose the first upload race.
  texture.colorSpace = THREE.SRGBColorSpace
  texture.premultiplyAlpha = source.format.premultiplyAlpha
  // A frame canvas has fixed pixel supply while its geometry can shrink.
  // This is the DOM Surface's pinned-texture policy: the top level remains
  // exact at 1:1, while trilinear filtering and anisotropy control shimmer
  // during minification.
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.anisotropy = 8
  texture.wrapS = mirrorU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  texture.repeat.x = mirrorU ? -1 : 1

  texture.onUpdate = () => {
    // An oversized upload fails on the GPU after this callback, and a
    // tainted source uploaded the stand-in, so neither names a frame.
    if (!active || tainted || oversized()) return
    // Publication and upload can coalesce. Label only the pixels Three chose
    // to upload, at the callback that confirms that upload happened.
    const frame = source.currentFrame()
    const uploaded = { sourceId: frame.sourceId, generation: frame.generation }
    pendingFrame = uploaded
    lastUploadedFrame = uploaded
  }

  const rejectPresentation = (
    requirement: PresentationRequirement,
    reason: string,
    warn?: (message: string) => void,
  ) => {
    const count = (rejected.get(requirement.transferId) ?? 0) + 1
    rejected.set(requirement.transferId, count)
    if (!warn || warned.has(requirement.transferId)) return
    warned.add(requirement.transferId)
    warn(
      `munari: FrameSurface transfer ${requirement.transferId} rejected a presentation draw (${reason})`,
    )
  }

  const unsubscribe = source.subscribe(() => {
    if (!active) return
    const store = {
      width: source.canvas.width,
      height: source.canvas.height,
    }
    if (uploadNeedsRealloc(allocation, store)) {
      // WebGL texture storage is immutable. Releasing it before Three sees
      // this update makes a resized canvas allocate at its new dimensions.
      texture.dispose()
      allocation = store
      publishChecked = false
    }
    if (!publishChecked) {
      publishChecked = true
      const nowTainted = !canvasIsOriginClean(source.canvas)
      if (nowTainted !== tainted) {
        tainted = nowTainted
        // The image changes size, so its storage is reallocated too.
        texture.dispose()
        texture.image = tainted ? blankCanvas() : source.canvas
      }
      if (tainted) reportTaint()
    }
    if (tainted || oversized()) return
    texture.needsUpdate = true
    // A demand frameloop has no next render until somebody asks for one.
    invalidate()
  })
  // CanvasTexture arms an update in its constructor. Re-arm after all format
  // fields are set so the complete birth state precedes renderer exposure.
  texture.needsUpdate = true

  return {
    source,
    surfaceEpoch,
    texture,
    takeDrawReceipt() {
      if (!active || !pendingFrame) return null
      const frame = pendingFrame
      pendingFrame = null
      return { surfaceEpoch, frame }
    },
    beginPresentationPass(requirement, { outputEligible, colorWrite, drawable }, warn) {
      pendingPresentation = null
      if (!active || !requirement) return
      if (!drawable) {
        rejectPresentation(requirement, 'the geometry has nothing to draw', warn)
        return
      }
      if (!colorWrite) {
        rejectPresentation(requirement, 'material color writes are disabled', warn)
        return
      }
      if (!outputEligible) {
        rejectPresentation(requirement, 'off-screen render target', warn)
        return
      }
      pendingPresentation = requirement
    },
    takePresentationReceipt(warn) {
      if (!active || !pendingPresentation) return null
      const requirement = pendingPresentation
      pendingPresentation = null
      if (!lastUploadedFrame) {
        rejectPresentation(requirement, 'no uploaded frame', warn)
        return null
      }
      const receipt: PresentationReceipt = {
        transferId: requirement.transferId,
        frame: lastUploadedFrame,
        presentationRevision: requirement.presentationRevision,
        surfaceEpoch,
      }
      if (!presentationReceiptSatisfies(requirement, receipt)) {
        rejectPresentation(requirement, 'uploaded frame does not satisfy the requirement', warn)
        return null
      }
      return presented.has(presentationKey(receipt)) ? null : receipt
    },
    deliverPresentation(receipt) {
      // Marked here, not when the receipt is taken: the host discards a
      // deferred receipt whose frame never reached the screen, and the next
      // eligible draw must be able to present the same tuple.
      const key = presentationKey(receipt)
      if (!active || presented.has(key)) return false
      presented.add(key)
      return true
    },
    rejectedPresentationDraws(transferId) {
      return rejected.get(transferId) ?? 0
    },
    dispose() {
      if (!active) return
      active = false
      pendingFrame = null
      lastUploadedFrame = null
      pendingPresentation = null
      presented.clear()
      rejected.clear()
      warned.clear()
      unsubscribe()
      texture.onUpdate = null
      texture.dispose()
    },
  }
}

let originProbe: CanvasRenderingContext2D | null | undefined

/**
 * Whether a canvas's pixels may be uploaded, checked without creating a
 * context on the caller's canvas: drawing it into a private canvas carries its
 * taint there. True where no DOM exists to check with.
 */
function canvasIsOriginClean(canvas: HTMLCanvasElement): boolean {
  if (originProbe === undefined) {
    originProbe = globalThis.document?.createElement('canvas').getContext('2d', { willReadFrequently: true }) ?? null
  }
  if (!originProbe || canvas.width === 0 || canvas.height === 0) return true
  // Setting the size clears the probe's own taint from an earlier check.
  originProbe.canvas.width = 1
  originProbe.canvas.height = 1
  try {
    originProbe.drawImage(canvas, 0, 0, 1, 1)
    originProbe.getImageData(0, 0, 1, 1)
    return true
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') return false
    throw error
  }
}

function blankCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  return canvas
}

function presentationKey(receipt: PresentationReceipt): string {
  return [
    receipt.surfaceEpoch,
    receipt.transferId,
    receipt.presentationRevision,
    receipt.frame.sourceId,
    receipt.frame.generation,
  ].join(':')
}

let nextSurfaceEpoch = 0

export function resolveFrameSurfaceDevelopment(
  metaDevelopment: boolean | undefined,
  nodeEnvironment: string | undefined,
): boolean {
  if (metaDevelopment !== undefined) return metaDevelopment
  return nodeEnvironment === 'development' || nodeEnvironment === 'test'
}

function isDevelopmentRuntime(): boolean {
  // SAFETY: both of these are the HOST's, not the language's. `import.meta
  // .env` exists under Vite and nowhere else; `process` exists under Node
  // and nowhere else. The library has to build and run under every host, so
  // each shape is described here instead of imported from one of them, and
  // every member is optional because absence is the normal answer.
  const metaEnvironment = (
    import.meta as ImportMeta & { readonly env?: { readonly DEV?: boolean } }
  ).env
  // SAFETY: as above, for the Node half.
  const nodeEnvironment = (
    globalThis as typeof globalThis & {
      readonly process?: { readonly env?: { readonly NODE_ENV?: string } }
    }
  ).process?.env?.NODE_ENV
  return resolveFrameSurfaceDevelopment(metaEnvironment?.DEV, nodeEnvironment)
}

const warnRejectedPresentation = (message: string) => {
  if (isDevelopmentRuntime()) console.warn(message)
}

/**
 * A raycast that exists only while `hears()` answers true. Declining at the
 * raycast rather than in handlers means no raycaster — r3f's or a scene's
 * own — ever counts the mesh as a pointer target while the page copy is the
 * presented one.
 */
export function hearingGatedRaycast(
  hears: () => boolean,
): (this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) => void {
  return function raycast(raycaster, intersects) {
    if (!hears()) return
    THREE.Mesh.prototype.raycast.call(this, raycaster, intersects)
  }
}

export function assertFrameMaterialSupported(
  source: FrameSource,
  material: 'unlit' | 'standard' | 'none',
): void {
  if (material === 'none' || !source.format.premultiplyAlpha) return
  throw new Error(
    'munari: premultiplied frames require material="none"; mask the full vec4 and blend ONE / ONE_MINUS_SRC_ALPHA',
  )
}

/**
 * A caller-owned canvas as a Surface material source.
 *
 * Exported from `/advanced`, separately from the retained-HTML Surface API.
 * This implementation owns only the Three texture. It never reparents or disposes the source canvas,
 * and it exposes frame receipts rather than renderer hooks.
 */
export function FrameSurface({
  frame,
  surface,
  raycast,
  children,
  onFrameDrawn,
  presentation,
  onPresented,
  mirrorU = false,
  width = frame.canvas.width,
  height = frame.canvas.height,
  side = THREE.FrontSide,
  roughness = 0.35,
  metalness = 0.05,
  transparent = false,
  material = 'unlit',
  visible = true,
  ...meshProps
}: FrameSurfaceProps) {
  const invalidate = useThree((state) => state.invalidate)
  const renderer = useThree((state) => state.gl)
  const meshRef = useRef<THREE.Mesh>(null)
  const runtimeRef = useRef<FrameSurfaceRuntime | null>(null)
  const [runtime, setRuntime] = useState<FrameSurfaceRuntime | null>(null)
  const frameRef = useLatest(frame)
  const onFrameDrawnRef = useLatest(onFrameDrawn)
  const presentationRef = useLatest(presentation)
  const onPresentedRef = useLatest(onPresented)
  const warnedTransferRef = useRef<number | null>(null)
  const warnedHearingRef = useRef(false)

  // A presentation requirement is the one moment this component KNOWS it is
  // a Surface handoff. With neither `surface` nor an authored `raycast`, the
  // mesh will hear the pointer in every phase — the misroute decisions.md
  // #33 exists to forbid — and nothing else in the system can notice.
  useLayoutEffect(() => {
    if (!presentation || surface || raycast !== undefined || warnedHearingRef.current) return
    warnedHearingRef.current = true
    if (isDevelopmentRuntime()) {
      console.warn(
        'munari: this FrameSurface is crossing (it received a presentation ' +
          'requirement) but its raycast is ungated, so it hears the pointer ' +
          'even while the page copy is the presented one. Pass surface={handle} ' +
          'to follow input-follows-the-eye, or an explicit raycast to own it.',
      )
    }
  }, [presentation, surface, raycast])

  // Build the replacement before releasing the current runtime, then flush
  // the state swap in the layout phase. No renderer frame can land between
  // those steps, and custom geometry/material children keep their identity.
  useLayoutEffect(() => {
    const next = createFrameSurfaceRuntime(
      frame,
      ++nextSurfaceEpoch,
      mirrorU,
      invalidate,
      surfaceTextureLimit(renderer),
    )
    const previous = runtimeRef.current
    runtimeRef.current = next
    setRuntime(next)
    previous?.dispose()
  }, [frame, mirrorU, invalidate, renderer])

  // A separate lifetime cleanup lets dependency changes perform the atomic
  // create → swap → release sequence above. It also survives StrictMode's
  // setup/cleanup rehearsal: the layout effect simply builds a fresh runtime.
  useLayoutEffect(() => {
    return () => {
      const current = runtimeRef.current
      runtimeRef.current = null
      current?.dispose()
      // Runtime release stops future receipts; this draw also removes its
      // last pixels from a demand-driven renderer. Without it, a transparent
      // Canvas can keep the released frame after the mesh has gone.
      invalidate()
    }
  }, [invalidate])

  const paintedSize = useCallback(
    (): readonly [number, number] => [
      width,
      height,
    ],
    [width, height],
  )

  const context = useMemo<SurfaceContextValue>(
    () => ({
      mesh: meshRef,
      source: null,
      width,
      height,
      mirrorU,
      texture: runtime?.texture ?? null,
      chrome: null,
      paintedSize,
    }),
    [width, height, mirrorU, runtime, paintedSize],
  )

  // The Canvas this mesh draws in, when it is a <SurfaceCanvas>. Null in a
  // plain r3f Canvas, which is the case that keeps the old refusal.
  const host = useSurfaceHostContext()
  const deferredRef = useRef(false)
  const drawableRef = useRef(true)

  const reportRejectedPresentation = useCallback(
    (message: string) => {
      const transferId = presentationRef.current?.transferId
      if (transferId === undefined || warnedTransferRef.current === transferId) return
      warnedTransferRef.current = transferId
      warnRejectedPresentation(message)
    },
    [presentationRef],
  )

  const handleBeforeRender = useCallback(
    (
      renderer: { getRenderTarget(): THREE.RenderTarget | null },
      _scene: THREE.Scene,
      _camera: THREE.Camera,
      geometry: THREE.BufferGeometry,
      renderedMaterial: THREE.Material,
    ) => {
      const current = runtimeRef.current
      if (!current || current !== runtime || current.source !== frameRef.current) return
      drawableRef.current = geometryDraws(geometry)
      // A pass into a render target has not reached the screen, so on its
      // own it cannot present. Inside a <SurfaceCanvas> it does not have to
      // decide alone: the host closes its frame tail once the frame it
      // belongs to reached the default framebuffer, and the receipt waits
      // there. Without a host there is no tail and the old refusal stands.
      const target = renderer.getRenderTarget() === null
      deferredRef.current = !target && host !== null && renderedMaterial.colorWrite
      current.beginPresentationPass(
        presentationRef.current,
        {
          outputEligible: target || deferredRef.current,
          colorWrite: renderedMaterial.colorWrite,
          drawable: drawableRef.current,
        },
        reportRejectedPresentation,
      )
    },
    [runtime, frameRef, presentationRef, reportRejectedPresentation, host],
  )

  const handleAfterRender = useCallback(() => {
    const current = runtimeRef.current
    // A source prop can change one commit before its effect disposes the old
    // runtime. Never let that old mesh report into the new source's callback.
    if (!current || current !== runtime || current.source !== frameRef.current) return
    // An empty draw left the canvas as it was; the uploaded frame waits for
    // a draw that shows it.
    if (!drawableRef.current) return
    const receipt = current.takeDrawReceipt()
    if (receipt) onFrameDrawnRef.current?.(receipt)
    const presentationReceipt = current.takePresentationReceipt(reportRejectedPresentation)
    if (!presentationReceipt) return
    const deliver = () => {
      if (current.deliverPresentation(presentationReceipt)) onPresentedRef.current?.(presentationReceipt)
    }
    if (deferredRef.current && host) {
      host.deferPresentation(deliver)
      return
    }
    deliver()
  }, [
    runtime,
    frameRef,
    onFrameDrawnRef,
    onPresentedRef,
    reportRejectedPresentation,
    host,
  ])

  assertFrameMaterialSupported(frame, material)

  const store = surface ? surfaceStoreOf(surface) : null
  const gatedRaycast = useMemo(
    () => (store ? hearingGatedRaycast(() => store.canvasHearsPointer()) : undefined),
    [store],
  )
  // An authored raycast wins — `raycast={() => {}}` is the full opt-out —
  // and only absence falls through to the gate.
  const effectiveRaycast = raycast === undefined ? gatedRaycast : raycast

  return (
    <mesh
      {...meshProps}
      {...(effectiveRaycast !== undefined ? { raycast: effectiveRaycast } : {})}
      ref={meshRef}
      visible={runtime !== null && visible}
      onBeforeRender={handleBeforeRender}
      onAfterRender={handleAfterRender}
    >
      <SurfaceContext value={context}>{children}</SurfaceContext>
      {material === 'unlit' && runtime && (
        <meshBasicMaterial
          map={runtime.texture}
          color="#ffffff"
          side={side}
          transparent={transparent}
          toneMapped={false}
        />
      )}
      {material === 'standard' && runtime && (
        <meshStandardMaterial
          map={runtime.texture}
          color="#ffffff"
          roughness={roughness}
          metalness={metalness}
          side={side}
          transparent={transparent}
        />
      )}
    </mesh>
  )
}
