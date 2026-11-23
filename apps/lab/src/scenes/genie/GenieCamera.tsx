// Genie's camera — z = 0 is the viewport and one world unit is one CSS px,
// so a flat sheet covers exactly the page box it replaces.

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { cameraDistance } from '@petepetrash/munari/advanced'

export const FOV = 42

export function PixelPerfect() {
  // SAFETY: r3f types the store's camera as the base class and hands back a
  // PerspectiveCamera unless the Canvas asks for `orthographic`. This one
  // does not, and could not: fitting the frustum to the viewport is what
  // makes a CSS pixel a world unit, and orthographic has no fov to fit.
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  useEffect(() => {
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(size.height, FOV))
    camera.near = 1
    camera.far = camera.position.z * 3
    camera.updateProjectionMatrix()
  }, [camera, size.height])
  return null
}
