// Finish card — retained HTML on a Surface that wears a finish, optionally
// tilting toward the pointer, and the pointer tracker the tilt reads.
//
// The law: the HTML owns text, focus, form state and input; the finish owns
// shading only, so the pointer still maps through the mesh UV and hit
// testing is unchanged (docs/materials-research.md §3). The tilt moves the
// plane's vertices through deformSurfaceGeometry, so the raycast hits the
// pose that is drawn, and turns the finish's normal by the same rotation.
// The content root paints `var(--munari-body)`, which Munari sets to the
// finish's color on the page copy and to transparent in the capture, so the
// capture's alpha separates text from body.
//
// The tracker writes the pointer to a plain object and asks for a frame, so a
// pointer move costs no React render. Under prefers-reduced-motion it
// reports no pointer, and every card rests flat.
//
// Ownership: the library builds and lights the material; this module owns
// the card's markup and the tilt.

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Node, UniformNode } from 'three/webgpu'
import { uniform } from 'three/tsl'
import {
  deformSurfaceGeometry,
  Surface,
  useSurfaceBeforeRender,
  useSurfaceRefresh,
  type SurfaceCanvasId,
  type SurfaceFinish,
  type SurfaceRenderFrame,
} from '@petepetrash/munari'
import { useSurfaceFinishMaterial } from '@petepetrash/munari/advanced'
import type { CardTilt } from './materialFinishesTuning'

// The steepest tilt, and the pointer distance in CSS px that reaches it.
// Six degrees moves a 340 px card's edge about 18 px in depth, enough to
// sweep a coat's highlight across it without hiding the far edge's text.
const MAX_TILT = THREE.MathUtils.degToRad(6)
const TILT_REACH_PX = 420
// The tilt follows the pointer with this time constant, ms.
const TILT_EASE_MS = 140
const TILT_SETTLED = 1e-4

export interface PagePointer {
  /** Client CSS px, or null while the pointer is off the page. */
  position: { x: number; y: number } | null
}

export const pagePointer: PagePointer = { position: null }

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Inside a SurfaceCanvas: track the pointer for tilting cards, and draw a frame whenever it moves. */
export function PointerTracker() {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    const reduced = window.matchMedia(REDUCED_MOTION)
    const place = (position: PagePointer['position']) => {
      pagePointer.position = reduced.matches ? null : position
      invalidate()
    }
    const move = (event: globalThis.PointerEvent) => place({ x: event.clientX, y: event.clientY })
    const leave = () => place(null)
    window.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)
    reduced.addEventListener('change', leave)
    return () => {
      window.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
      reduced.removeEventListener('change', leave)
      pagePointer.position = null
    }
  }, [invalidate])
  return null
}

interface TiltState {
  pitch: number
  yaw: number
  last: number
}

const _center = new THREE.Vector3()
const _euler = new THREE.Euler(0, 0, 0, 'YXZ')
const _rotation = new THREE.Matrix4()
const _vertex = new THREE.Vector3()

/** Ease the card toward facing the pointer and bend its plane to match. True while it is still moving. */
function stepTilt(state: TiltState, tilt: UniformNode<'mat3', THREE.Matrix3>, frame: SurfaceRenderFrame): boolean {
  const now = performance.now()
  const elapsed = Math.min(now - state.last, 100)
  state.last = now
  let pitch = 0
  let yaw = 0
  const pointer = pagePointer.position
  const rect = frame.canvas.getBoundingClientRect()
  if (pointer && rect.width > 0) {
    frame.mesh.getWorldPosition(_center).project(frame.camera)
    const cx = rect.left + ((_center.x + 1) / 2) * rect.width
    const cy = rect.top + ((1 - _center.y) / 2) * rect.height
    const reach = (d: number) => Math.max(-1, Math.min(1, d / TILT_REACH_PX))
    yaw = MAX_TILT * reach(pointer.x - cx)
    pitch = -MAX_TILT * reach(cy - pointer.y)
  }
  const follow = 1 - Math.exp(-elapsed / TILT_EASE_MS)
  state.pitch += (pitch - state.pitch) * follow
  state.yaw += (yaw - state.yaw) * follow
  const moving = Math.abs(pitch - state.pitch) > TILT_SETTLED || Math.abs(yaw - state.yaw) > TILT_SETTLED
  if (!moving) {
    state.pitch = pitch
    state.yaw = yaw
  }

  _rotation.makeRotationFromEuler(_euler.set(state.pitch, state.yaw, 0, 'YXZ'))
  tilt.value.setFromMatrix4(_rotation)
  // The plane is 1×1 in local units and the match-dom scale sizes it, so
  // the rotation runs in world units and divides back out of x and y.
  const { x: width, y: height } = frame.mesh.scale
  deformSurfaceGeometry(frame.mesh.geometry, [1, 1], (x, y) => {
    _vertex.set((x - 0.5) * width, (0.5 - y) * height, 0).applyMatrix4(_rotation)
    return { x: _vertex.x / width + 0.5, y: 0.5 - _vertex.y / height, z: _vertex.z }
  })
  return moving
}


/** The Surface's finish with its normal turned by the card's tilt. */
export function TiltedFinish() {
  const [tilt] = useState(() => uniform(new THREE.Matrix3()))
  // SAFETY: a mat3 times a vec3 is a vec3; three's published types leave the
  // product untyped.
  const normal = useCallback((inView: Node<'vec3'>) => tilt.mul(inView) as Node<'vec3'>, [tilt])
  const inputs = useMemo(() => ({ normal }), [normal])
  const material = useSurfaceFinishMaterial(inputs)
  const [tiltState] = useState<TiltState>(() => ({ pitch: 0, yaw: 0, last: performance.now() }))
  const invalidate = useThree((state) => state.invalidate)
  useSurfaceBeforeRender((frame) => {
    if (stepTilt(tiltState, tilt, frame)) invalidate()
  })
  return material ? <primitive object={material} attach="material" /> : null
}

/**
 * Ask for a new capture when the content root's style changes. A style write
 * is not input, so a Surface that is not `live` keeps showing the paint it
 * has (htmlInCanvas.ts onpaint) until one is requested.
 */
export function RecaptureOnStyle({ style }: { readonly style: CSSProperties | undefined }) {
  const refresh = useSurfaceRefresh()
  const styleKey = JSON.stringify(style ?? null)
  useEffect(() => {
    refresh()
  }, [refresh, styleKey])
  return null
}

export interface FinishCardProps {
  readonly canvasId: SurfaceCanvasId
  readonly inScene: boolean
  readonly finish: SurfaceFinish
  readonly tilt: CardTilt
  readonly className?: string
  /** On the content root, which the HTML keeps wherever it is drawn: the place to set page ink such as --mf-ink. */
  readonly style?: CSSProperties
  readonly children: ReactNode
}

export function FinishCard({ canvasId, inScene, finish, tilt, className = '', style, children }: FinishCardProps) {
  const place = inScene ? 'mf-card--scene' : 'mf-card--page'
  return (
    <Surface.Root canvasId={canvasId} inScene={inScene} finish={finish}>
      <Surface.HTML>
        <div className={`mf-card ${place} ${className}`.trim()} style={style}>
          <RecaptureOnStyle style={style} />
          {children}
        </div>
      </Surface.HTML>
      <Surface.Scene>
        <FinishMesh tilt={tilt} />
      </Surface.Scene>
    </Surface.Root>
  )
}

/** A card's mesh: flat in the default material slot, or bending its own plane toward the pointer. */
export function FinishMesh({ tilt }: { readonly tilt: CardTilt }) {
  // A tilting card bends its own plane, so it cannot share the default one.
  const tilting = tilt === 'pointer'
  return (
    <Surface.Mesh
      key={tilt}
      placement="match-dom"
      geometry={tilting ? <planeGeometry args={[1, 1]} /> : undefined}
      material={tilting ? <TiltedFinish /> : undefined}
    />
  )
}
