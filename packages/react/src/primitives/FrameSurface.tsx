import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeElements } from '@react-three/fiber'
import { uploadNeedsRealloc, type FrameId, type FrameSource } from '@munari/core'
import { SurfaceContext, type SurfaceContextValue } from './SurfaceContext'
import { useLatest } from './useLatest'

export interface FrameDrawReceipt {
  readonly surfaceEpoch: number
  readonly frame: FrameId
}

export interface FrameSurfaceProps
  extends Omit<ThreeElements['mesh'], 'children' | 'material' | 'onAfterRender' | 'ref'> {
  /** HTML input is a separate Surface mode; frame and DOM sources cannot mix. */
  html?: never
  frame: FrameSource
  children: React.ReactNode
  onFrameDrawn?: (receipt: FrameDrawReceipt) => void
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
    pendingFrame = { sourceId: frame.sourceId, generation: frame.generation }
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
    dispose() {
      if (!active) return
      active = false
      pendingFrame = null
      unsubscribe()
      texture.onUpdate = null
      texture.dispose()
    },
  }
}

let nextSurfaceEpoch = 0

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
    }
  }, [])

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

  const handleAfterRender = useCallback(() => {
    const current = runtimeRef.current
    // A source prop can change one commit before its effect disposes the old
    // runtime. Never let that old mesh report into the new source's callback.
    if (!current || current !== runtime || current.source !== frameRef.current) return
    const receipt = current.takeDrawReceipt()
    if (receipt) onFrameDrawnRef.current?.(receipt)
  }, [runtime, frameRef, onFrameDrawnRef])

  assertFrameMaterialSupported(frame, material)

  return (
    <mesh
      {...meshProps}
      ref={meshRef}
      visible={runtime !== null && visible}
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
