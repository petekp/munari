// FrameSurface — a caller-owned canvas worn as scene matter.
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
//                 + onAfterRender take   a color-writing draw to the
//                                        default framebuffer
//
// The gate exists because Three fires onAfterRender for off-screen
// render targets and colorWrite:false materials too. Those draws move
// pixels, but they cannot have reached the screen, so a transfer that
// released the page on one would flicker (decisions.md #25: drawing is
// not showing). Rejections are counted per transfer and warned once,
// so a mis-wired transfer is diagnosable without a console flood.
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
  /** HTML input is a separate Surface mode; frame and DOM sources cannot mix. */
  html?: never
  frame: FrameSource
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
   * supply a custom material through `useSurfaceTexture()`.
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
    outputEligible: boolean,
    colorWrite: boolean,
    warn?: (message: string) => void,
  ): void
  takePresentationReceipt(warn?: (message: string) => void): PresentationReceipt | null
  rejectedPresentationDraws(transferId: number): number
  dispose(): void
}

/** Internal runtime split out so the upload/draw ordering can be tested without a renderer mock. */
export function createFrameSurfaceRuntime(
  source: FrameSource,
  surfaceEpoch: number,
  mirrorU: boolean,
  invalidate: () => void,
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

  const texture = new THREE.CanvasTexture(source.canvas)
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
    if (!active) return
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
    }
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
    beginPresentationPass(requirement, outputEligible, colorWrite, warn) {
      pendingPresentation = null
      if (!active || !requirement) return
      if (!outputEligible) {
        rejectPresentation(requirement, 'off-screen render target', warn)
        return
      }
      if (!colorWrite) {
        rejectPresentation(requirement, 'material color writes are disabled', warn)
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
      const key = [
        receipt.surfaceEpoch,
        receipt.transferId,
        receipt.presentationRevision,
        receipt.frame.sourceId,
        receipt.frame.generation,
      ].join(':')
      if (presented.has(key)) return null
      presented.add(key)
      return receipt
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
 * The public `Surface` dispatches frame input here. This implementation owns
 * only the Three texture. It never reparents or disposes the source canvas,
 * and it exposes frame receipts rather than renderer hooks.
 */
export function FrameSurface({
  frame,
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
  const meshRef = useRef<THREE.Mesh>(null)
  const runtimeRef = useRef<FrameSurfaceRuntime | null>(null)
  const [runtime, setRuntime] = useState<FrameSurfaceRuntime | null>(null)
  const frameRef = useLatest(frame)
  const onFrameDrawnRef = useLatest(onFrameDrawn)
  const presentationRef = useLatest(presentation)
  const onPresentedRef = useLatest(onPresented)
  const warnedTransferRef = useRef<number | null>(null)

  // Build the replacement before releasing the current runtime, then flush
  // the state swap in the layout phase. No renderer frame can land between
  // those steps, and custom geometry/material children keep their identity.
  useLayoutEffect(() => {
    const next = createFrameSurfaceRuntime(
      frame,
      ++nextSurfaceEpoch,
      mirrorU,
      invalidate,
    )
    const previous = runtimeRef.current
    runtimeRef.current = next
    setRuntime(next)
    previous?.dispose()
  }, [frame, mirrorU, invalidate])

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
      renderer: THREE.WebGLRenderer,
      _scene: THREE.Scene,
      _camera: THREE.Camera,
      _geometry: THREE.BufferGeometry,
      renderedMaterial: THREE.Material,
    ) => {
      const current = runtimeRef.current
      if (!current || current !== runtime || current.source !== frameRef.current) return
      current.beginPresentationPass(
        presentationRef.current,
        renderer.getRenderTarget() === null,
        renderedMaterial.colorWrite,
        reportRejectedPresentation,
      )
    },
    [runtime, frameRef, presentationRef, reportRejectedPresentation],
  )

  const handleAfterRender = useCallback(() => {
    const current = runtimeRef.current
    // A source prop can change one commit before its effect disposes the old
    // runtime. Never let that old mesh report into the new source's callback.
    if (!current || current !== runtime || current.source !== frameRef.current) return
    const receipt = current.takeDrawReceipt()
    if (receipt) onFrameDrawnRef.current?.(receipt)
    const presentationReceipt = current.takePresentationReceipt(reportRejectedPresentation)
    if (presentationReceipt) onPresentedRef.current?.(presentationReceipt)
  }, [
    runtime,
    frameRef,
    onFrameDrawnRef,
    onPresentedRef,
    reportRejectedPresentation,
  ])

  assertFrameMaterialSupported(frame, material)

  return (
    <mesh
      {...meshProps}
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
