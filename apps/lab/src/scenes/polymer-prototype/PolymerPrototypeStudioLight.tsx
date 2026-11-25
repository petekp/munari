// Studio light in the scene — the prototype's CSS studio light, given to three
// so the physical body is lit from the same place as the hand-built one.
//
// The law: the light has one position, `polymerTuning`'s lightU/lightV/
// lightHeight in stage CSS px, which the drag handle, the shadow skirt and
// the hand-built body all read directly. The physical body reads only scene
// lights, so this module converts that position into a world-space
// `PointLight`. The conversion comes from a placed Surface mesh itself (its
// world center, axes and scale against its CSS box), never from the camera
// distance Munari places Surfaces at, which the package does not export.
//
// The light has no falloff (decay 0), like the hand-built body, so a card's
// brightness depends on the angle to the light and not on its distance.
//
// Ownership: `PolymerStudioLight` mounts the light and a room environment
// while the physical body is on, and writes their intensities.
// `PolymerPrototypeSurface` places the light from its mesh each frame.

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { polymerTuning, subscribePolymerTuning } from './polymerPrototypeTuning'

let studioLight: THREE.PointLight | null = null

const _center = new THREE.Vector3()
const _rotation = new THREE.Quaternion()
const _scale = new THREE.Vector3()
const _axis = new THREE.Vector3()

/**
 * Put the studio light at a stage CSS point, `heightPx` in front of the
 * Surface plane. `mesh` is a placed match-DOM Surface whose box is centered
 * at (`centerX`, `centerY`) stage CSS px and is `widthPx` wide.
 */
export function placeStudioLight(
  mesh: THREE.Object3D,
  box: { readonly cx: number; readonly cy: number; readonly w: number },
  light: { readonly x: number; readonly y: number; readonly heightPx: number },
): void {
  if (!studioLight || box.w <= 0) return
  mesh.updateWorldMatrix(true, false)
  mesh.matrixWorld.decompose(_center, _rotation, _scale)
  const worldPerPx = _scale.x / box.w
  const position = studioLight.position.copy(_center)
  position.addScaledVector(_axis.set(1, 0, 0).applyQuaternion(_rotation), (light.x - box.cx) * worldPerPx)
  position.addScaledVector(_axis.set(0, -1, 0).applyQuaternion(_rotation), (light.y - box.cy) * worldPerPx)
  position.addScaledVector(_axis.set(0, 0, 1).applyQuaternion(_rotation), light.heightPx * worldPerPx)
}

function getBody() {
  return polymerTuning.body
}

export function usePolymerBody() {
  return useSyncExternalStore(subscribePolymerTuning, getBody)
}

function PhysicalStudio() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const light = useMemo(() => new THREE.PointLight(0xffffff, polymerTuning.lightIntensity, 0, 0), [])

  useEffect(() => {
    if (!(gl instanceof WebGPURenderer)) throw new Error('The polymer studio environment needs the WebGPURenderer from SurfaceCanvas')
    scene.add(light)
    studioLight = light
    const room = new RoomEnvironment()
    const generator = new PMREMGenerator(gl)
    const baked = generator.fromScene(room, 0.04)
    generator.dispose()
    room.dispose()
    scene.environment = baked.texture
    scene.environmentIntensity = polymerTuning.environmentIntensity
    invalidate()
    return () => {
      scene.remove(light)
      if (studioLight === light) studioLight = null
      light.dispose()
      scene.environment = null
      baked.dispose()
      invalidate()
    }
  }, [gl, scene, light, invalidate])

  useFrame(() => {
    light.intensity = polymerTuning.lightIntensity
    scene.environmentIntensity = polymerTuning.environmentIntensity
  })

  return null
}

export function PolymerStudioLight() {
  const body = usePolymerBody()
  return body === 'physical' ? <PhysicalStudio /> : null
}
