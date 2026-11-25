// Finish card — retained HTML on a Surface whose material is a physical
// finish, under the page's studio lights, optionally tilting toward the
// pointer.
//
// The law: the HTML owns text, focus, form state and input; the material
// owns shading only, so the pointer still maps through the mesh UV and hit
// testing is unchanged (docs/materials-research.md §3). The tilt moves the
// plane's vertices through deformSurfaceGeometry, so the raycast hits the
// pose that is drawn. The content root is transparent in the scene, so the
// capture's alpha separates text from body; on the page it paints the body
// color itself.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { texture as textureNode, uniform } from 'three/tsl'
import {
  deformSurfaceGeometry,
  Surface,
  useSurfaceBeforeRender,
  useSurfaceNodes,
  useSurfaceTexture,
  type SurfaceCanvasId,
  type SurfaceRenderFrame,
} from '@petepetrash/munari'
import { createRawCaptureView } from './materialFinishesCaptureView'
import { createFinishMaterial, createFinishShapeUniforms, writeFinish, type FinishShapeUniforms } from './materialFinishesNodes'
import { placeStudioLights, type StudioLights } from './materialFinishesStudio'
import { FINISHES, liveFinish, studio, type CardTilt, type FinishId, type TextLighting } from './materialFinishesTuning'

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
function stepTilt(state: TiltState, shape: FinishShapeUniforms, frame: SurfaceRenderFrame): boolean {
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
  shape.tilt.value.setFromMatrix4(_rotation)
  // The plane is 1×1 in local units and the match-dom scale sizes it, so
  // the rotation runs in world units and divides back out of x and y.
  const { x: width, y: height } = frame.mesh.scale
  deformSurfaceGeometry(frame.mesh.geometry, [1, 1], (x, y) => {
    _vertex.set((x - 0.5) * width, (0.5 - y) * height, 0).applyMatrix4(_rotation)
    return { x: _vertex.x / width + 0.5, y: 0.5 - _vertex.y / height, z: _vertex.z }
  })
  return moving
}

interface FinishMaterialProps {
  readonly finish: FinishId
  readonly text: TextLighting
  readonly tilt: CardTilt
  readonly lights: StudioLights
}

function FinishMaterial({ finish, text, tilt, lights }: FinishMaterialProps) {
  const capture = useSurfaceTexture()
  const surface = useSurfaceNodes()
  const view = useMemo(() => createRawCaptureView(capture), [capture])
  useEffect(() => () => view.dispose(), [view])
  // One node for the material's life: a resize replaces the capture, and a
  // value write keeps the built shader.
  const [captureNode] = useState(() => textureNode(view.texture))
  captureNode.value = view.texture
  const body = useMemo(() => uniform(new THREE.Color(liveFinish.color)), [])
  const shape = useMemo(createFinishShapeUniforms, [])
  const detail = FINISHES[finish].detail
  const material = useMemo(
    () =>
      createFinishMaterial(
        { capture: captureNode, cornerMask: surface.radiusMask(), size: surface.size, radii: surface.radii, body, shape },
        text,
        detail,
      ),
    [captureNode, surface, body, shape, text, detail],
  )
  useEffect(() => () => material.dispose(), [material])
  const [tiltState] = useState<TiltState>(() => ({ pitch: 0, yaw: 0, last: performance.now() }))

  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  useSurfaceBeforeRender((frame) => {
    view.sync()
    writeFinish(material, body, shape, liveFinish)
    placeStudioLights(lights, frame)
    scene.environmentIntensity = studio.environmentIntensity
    if (tilt === 'pointer' && stepTilt(tiltState, shape, frame)) invalidate()
  })

  return <primitive object={material} attach="material" />
}

export interface FinishCardProps {
  readonly canvasId: SurfaceCanvasId
  readonly inScene: boolean
  readonly finish: FinishId
  readonly text: TextLighting
  readonly tilt: CardTilt
  readonly lights: StudioLights
  readonly className?: string
  readonly children: ReactNode
}

export function FinishCard({ canvasId, inScene, finish, text, tilt, lights, className = '', children }: FinishCardProps) {
  const place = inScene ? 'mf-card--scene' : 'mf-card--page'
  // A tilting card bends its own plane, so it cannot share the default one.
  const geometry = tilt === 'pointer' ? <planeGeometry args={[1, 1]} /> : undefined
  return (
    <Surface.Root canvasId={canvasId} inScene={inScene}>
      <Surface.HTML>
        <div className={`mf-card ${place} ${className}`.trim()}>{children}</div>
      </Surface.HTML>
      <Surface.Scene>
        <Surface.Mesh
          key={tilt}
          placement="match-dom"
          geometry={geometry}
          material={<FinishMaterial finish={finish} text={text} tilt={tilt} lights={lights} />}
        />
      </Surface.Scene>
    </Surface.Root>
  )
}
