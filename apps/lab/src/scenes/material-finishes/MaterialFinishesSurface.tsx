// Finish card — retained HTML on a Surface whose material is a physical
// finish, lit by the page's lights at its own studio values, optionally
// tilting toward the pointer.
//
// The law: the HTML owns text, focus, form state and input; the material
// owns shading only, so the pointer still maps through the mesh UV and hit
// testing is unchanged (docs/materials-research.md §3). The tilt moves the
// plane's vertices through deformSurfaceGeometry, so the raycast hits the
// pose that is drawn. The content root is transparent in the scene, so the
// capture's alpha separates text from body; on the page it paints the body
// color itself.
//
// Each card holds its own finish and studio objects, so cards with
// different finishes share one canvas. Each material reflects the
// environment its finish names and is lit only by the lights it is given
// (material.lightsNode), placed and powered by its studio before it draws.
// three's WebGPU renderer reads a light's uniforms once per frame, so cards
// whose studios differ need their own lights: on one shared set, every card
// drew under the studio that placed the lights last (measured 2026-11-26:
// switching one bench card from velvet to lacquer changed 85% of the pixels
// of two other cards). Cards that share a studio may share lights.

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { lights as lightsNodeOf, texture as textureNode, uniform } from 'three/tsl'
import {
  deformSurfaceGeometry,
  Surface,
  useSurfaceBeforeRender,
  useSurfaceNodes,
  useSurfaceRefresh,
  useSurfaceTexture,
  type SurfaceCanvasId,
  type SurfaceRenderFrame,
} from '@petepetrash/munari'
import { createRawCaptureView } from './materialFinishesCaptureView'
import { createKeySheenUniforms } from './materialFinishesKeyLight'
import { createFinishMaterial, createFinishShapeUniforms, writeFinish, type FinishShapeUniforms } from './materialFinishesNodes'
import { lightsOf, placeStudioLights, type StudioEnvironments, type StudioLights } from './materialFinishesStudio'
import {
  subscribeFinishTuning,
  type CardTilt,
  type EnvironmentKind,
  type Finish,
  type LightRig,
  type StudioTuning,
  type TextLighting,
} from './materialFinishesTuning'

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

/**
 * What a card wears and how it is lit. The finish and studio objects are
 * read before every draw, so writing one and calling notifyFinishTuning
 * redraws the card; a write that changes the shader also rebuilds it.
 */
export interface FinishLighting {
  readonly finish: Readonly<Finish>
  readonly studio: Readonly<StudioTuning>
  /** Which of the canvas's environments the card reflects. */
  readonly environment: EnvironmentKind
  readonly environments: StudioEnvironments
  readonly rig: LightRig
  /** The lights this card's studio places; share them only between cards that share a studio. */
  readonly lights: StudioLights
}

interface FinishMaterialProps extends FinishLighting {
  readonly text: TextLighting
  readonly tilt: CardTilt
}

function FinishMaterial({ finish, studio, environment, environments, rig, lights, text, tilt }: FinishMaterialProps) {
  const capture = useSurfaceTexture()
  const surface = useSurfaceNodes()
  const view = useMemo(() => createRawCaptureView(capture), [capture])
  useEffect(() => () => view.dispose(), [view])
  // One node for the material's life: a resize replaces the capture, and a
  // value write keeps the built shader.
  const [captureNode] = useState(() => textureNode(view.texture))
  captureNode.value = view.texture
  const body = useMemo(() => uniform(new THREE.Color()), [])
  const shape = useMemo(createFinishShapeUniforms, [])
  const key = useMemo(createKeySheenUniforms, [])
  // The relief kind, and a crackle, film or scatter crossing zero, change the
  // shader, so each rebuilds the material.
  const detail = useSyncExternalStore(subscribeFinishTuning, () => finish.detail)
  const hasCrackle = useSyncExternalStore(subscribeFinishTuning, () => finish.crackle > 0)
  const hasFilm = useSyncExternalStore(subscribeFinishTuning, () => finish.iridescence > 0)
  const hasScatter = useSyncExternalStore(subscribeFinishTuning, () => finish.subsurface > 0)
  const litBy = useMemo(() => lightsNodeOf([...lightsOf(rig, lights)]), [rig, lights])
  const material = useMemo(() => {
    const built = createFinishMaterial(
      { capture: captureNode, cornerMask: surface.radiusMask(), size: surface.size, radii: surface.radii, body, shape, key },
      { text, detail, crackle: hasCrackle, film: hasFilm, scatter: hasScatter },
    )
    built.lightsNode = litBy
    return built
  }, [captureNode, surface, body, shape, key, text, detail, hasCrackle, hasFilm, hasScatter, litBy])
  useEffect(() => () => material.dispose(), [material])
  const [tiltState] = useState<TiltState>(() => ({ pitch: 0, yaw: 0, last: performance.now() }))

  const invalidate = useThree((state) => state.invalidate)
  useSurfaceBeforeRender((frame) => {
    view.sync()
    writeFinish(material, body, shape, finish)
    const reflected = environments.get(environment) ?? null
    if (material.envMap !== reflected) {
      material.envMap = reflected
      material.needsUpdate = true
      invalidate()
    }
    material.envMapIntensity = studio.environmentIntensity
    placeStudioLights(lights, frame, studio)
    key.position.value.copy(lights.softbox.position).applyMatrix4(frame.camera.matrixWorldInverse)
    key.radiantIntensity.value.copy(lights.softbox.color).multiplyScalar(rig === 'softbox' ? lights.point.intensity : 0)
    key.intensity.value.copy(lights.point.color).multiplyScalar(lights.point.intensity)
    if (tilt === 'pointer' && stepTilt(tiltState, shape, frame)) invalidate()
  })

  return <primitive object={material} attach="material" />
}

/**
 * Ask for a new capture when the content root's style changes. A style write
 * is not input, so a Surface that is not `live` keeps showing the paint it
 * has (htmlInCanvas.ts onpaint) until one is requested.
 */
function RecaptureOnStyle({ style }: { readonly style: CSSProperties | undefined }) {
  const refresh = useSurfaceRefresh()
  const styleKey = JSON.stringify(style ?? null)
  useEffect(() => {
    refresh()
  }, [refresh, styleKey])
  return null
}

export interface FinishCardProps extends FinishLighting {
  readonly canvasId: SurfaceCanvasId
  readonly inScene: boolean
  readonly text: TextLighting
  readonly tilt: CardTilt
  readonly className?: string
  /** On the content root, which the HTML keeps wherever it is drawn: the place to set page ink such as --mf-ink. */
  readonly style?: CSSProperties
  readonly children: ReactNode
}

export function FinishCard({ canvasId, inScene, text, tilt, className = '', style, children, ...lighting }: FinishCardProps) {
  const place = inScene ? 'mf-card--scene' : 'mf-card--page'
  // A tilting card bends its own plane, so it cannot share the default one.
  const geometry = tilt === 'pointer' ? <planeGeometry args={[1, 1]} /> : undefined
  return (
    <Surface.Root canvasId={canvasId} inScene={inScene}>
      <Surface.HTML>
        <div className={`mf-card ${place} ${className}`.trim()} style={style}>
          <RecaptureOnStyle style={style} />
          {children}
        </div>
      </Surface.HTML>
      <Surface.Scene>
        <Surface.Mesh
          key={tilt}
          placement="match-dom"
          geometry={geometry}
          material={<FinishMaterial {...lighting} text={text} tilt={tilt} />}
        />
      </Surface.Scene>
    </Surface.Root>
  )
}
