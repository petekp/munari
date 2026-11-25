// Finish card — retained HTML on a Surface whose material is a physical
// finish, under the page's one studio light.
//
// The law: the HTML owns text, focus, form state and input; the material
// owns shading only, so the pointer still maps through the mesh UV and hit
// testing is unchanged (docs/materials-research.md §3). The content root is
// transparent in the scene, so the capture's alpha separates text from body;
// on the page it paints the body color itself.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { texture as textureNode, uniform } from 'three/tsl'
import {
  Surface,
  useSurfaceBeforeRender,
  useSurfaceNodes,
  useSurfaceTexture,
  type SurfaceCanvasId,
  type SurfaceRenderFrame,
} from '@petepetrash/munari'
import { createRawCaptureView } from './materialFinishesCaptureView'
import { createFinishMaterial, writeFinish } from './materialFinishesNodes'
import { liveFinish, studio, type TextLighting } from './materialFinishesTuning'

const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _forward = new THREE.Vector3()
const _toMesh = new THREE.Vector3()
const _cameraPosition = new THREE.Vector3()

/**
 * Stand the light over a viewport point, `studio.lightHeight` CSS px in
 * front of the plane the matched cards stand on. Power scales with the
 * squared height so the irradiance under the light is `lightPower` at any
 * world scale.
 */
function placeStudioLight(light: THREE.PointLight, frame: SurfaceRenderFrame): void {
  // SAFETY: SurfaceCanvas creates a PerspectiveCamera unless `orthographic` is requested, and this scene does not request it.
  const camera = frame.camera as THREE.PerspectiveCamera
  const rect = frame.canvas.getBoundingClientRect()
  if (rect.height <= 0) return
  camera.matrixWorld.extractBasis(_right, _up, _forward)
  _forward.negate()
  camera.getWorldPosition(_cameraPosition)
  frame.mesh.getWorldPosition(_toMesh).sub(_cameraPosition)
  const depth = _toMesh.dot(_forward)
  const worldPerCss = (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / rect.height
  const x = (studio.lightX * window.innerWidth - rect.left - rect.width / 2) * worldPerCss
  const y = (rect.height / 2 - (studio.lightY * window.innerHeight - rect.top)) * worldPerCss
  const height = studio.lightHeight * worldPerCss
  light.position
    .copy(_cameraPosition)
    .addScaledVector(_forward, depth - height)
    .addScaledVector(_right, x)
    .addScaledVector(_up, y)
  light.intensity = studio.lightPower * height * height
}

function FinishMaterial({ text, light }: { readonly text: TextLighting; readonly light: THREE.PointLight }) {
  const capture = useSurfaceTexture()
  const surface = useSurfaceNodes()
  const view = useMemo(() => createRawCaptureView(capture), [capture])
  useEffect(() => () => view.dispose(), [view])
  // One node for the material's life: a resize replaces the capture, and a
  // value write keeps the built shader.
  const [captureNode] = useState(() => textureNode(view.texture))
  captureNode.value = view.texture
  const body = useMemo(() => uniform(new THREE.Color(liveFinish.color)), [])
  const material = useMemo(
    () => createFinishMaterial({ capture: captureNode, cornerMask: surface.radiusMask(), body }, text),
    [captureNode, surface, body, text],
  )
  useEffect(() => () => material.dispose(), [material])

  const scene = useThree((state) => state.scene)
  useSurfaceBeforeRender((frame) => {
    view.sync()
    writeFinish(material, body, liveFinish)
    placeStudioLight(light, frame)
    scene.environmentIntensity = studio.environmentIntensity
  })

  return <primitive object={material} attach="material" />
}

export interface FinishCardProps {
  readonly canvasId: SurfaceCanvasId
  readonly inScene: boolean
  readonly text: TextLighting
  readonly light: THREE.PointLight
  readonly className?: string
  readonly children: ReactNode
}

export function FinishCard({ canvasId, inScene, text, light, className = '', children }: FinishCardProps) {
  const place = inScene ? 'mf-card--scene' : 'mf-card--page'
  return (
    <Surface.Root canvasId={canvasId} inScene={inScene}>
      <Surface.HTML>
        <div className={`mf-card ${place} ${className}`.trim()}>{children}</div>
      </Surface.HTML>
      <Surface.Scene>
        <Surface.Mesh placement="match-dom" material={<FinishMaterial text={text} light={light} />} />
      </Surface.Scene>
    </Surface.Root>
  )
}
