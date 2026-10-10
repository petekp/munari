// Contact shadows — a soft shadow on the floor under whatever stands above
// it, drawn from the scene's depth as seen from below.
//
// The law: this is drei's ContactShadows with node materials, because drei's
// GLSL materials cannot draw on a WebGPURenderer (contactShadowNodes.ts). The
// passes, the camera, and the blur steps follow drei's, so the floor reads as
// drei's GLSL version does.
//
// Ownership: this component owns its targets, camera, and per-frame passes.
// The scene owns what casts.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { shadowBlurMaterial, shadowDepthMaterial, shadowPlaneMaterial } from './contactShadowNodes'

interface ContactShadowsProps {
  position: [number, number, number]
  opacity: number
  /** Blur radius; one unit is 1/256 of the target per tap. */
  blur: number
  /** The square's side, in world units. */
  scale: number
}

const RESOLUTION = 512
const FAR = 10

export function ContactShadows({ position, opacity, blur, scale }: ContactShadowsProps) {
  const scene = useThree(state => state.scene)
  const gl = useThree(state => state.gl)
  // Fiber types the renderer as WebGLRenderer; SurfaceCanvas supplies a
  // WebGPURenderer, which is what takes a RenderTarget.
  if (!(gl instanceof WebGPURenderer)) throw new Error('ContactShadows needs the WebGPURenderer from SurfaceCanvas')
  const group = useRef<THREE.Group>(null)
  const camera = useRef<THREE.OrthographicCamera>(null)

  const parts = useMemo(() => {
    const target = new THREE.RenderTarget(RESOLUTION, RESOLUTION)
    const blurTarget = new THREE.RenderTarget(RESOLUTION, RESOLUTION)
    target.texture.generateMipmaps = blurTarget.texture.generateMipmaps = false
    const geometry = new THREE.PlaneGeometry(scale, scale).rotateX(Math.PI / 2)
    const blurPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
    return {
      target,
      blurTarget,
      geometry,
      blurPlane,
      depth: shadowDepthMaterial('#000000'),
      horizontal: shadowBlurMaterial(target.texture, 'x'),
      vertical: shadowBlurMaterial(blurTarget.texture, 'y'),
      plane: shadowPlaneMaterial(target.texture, opacity),
    }
  }, [scale, opacity])

  useEffect(() => () => {
    parts.target.dispose()
    parts.blurTarget.dispose()
    parts.geometry.dispose()
    parts.blurPlane.geometry.dispose()
    parts.depth.dispose()
    parts.horizontal.material.dispose()
    parts.vertical.material.dispose()
    parts.plane.dispose()
  }, [parts])

  const clearColor = useMemo(() => new THREE.Color(), [])
  useFrame(() => {
    const shadowCamera = camera.current
    if (!shadowCamera || !group.current) return
    const { target, blurTarget, blurPlane, depth, horizontal, vertical } = parts
    const background = scene.background
    const override = scene.overrideMaterial
    const clearAlpha = gl.getClearAlpha()
    gl.getClearColor(clearColor)
    gl.setClearColor(0x000000, 0)
    group.current.visible = false
    scene.background = null
    scene.overrideMaterial = depth
    gl.setRenderTarget(target)
    gl.render(scene, shadowCamera)
    for (const radius of [blur, blur * 0.4]) {
      horizontal.step.value = vertical.step.value = radius / 256
      blurPlane.material = horizontal.material
      gl.setRenderTarget(blurTarget)
      gl.render(blurPlane, shadowCamera)
      blurPlane.material = vertical.material
      gl.setRenderTarget(target)
      gl.render(blurPlane, shadowCamera)
    }
    gl.setRenderTarget(null)
    group.current.visible = true
    scene.overrideMaterial = override
    scene.background = background
    gl.setClearColor(clearColor, clearAlpha)
  })

  const half = scale / 2
  return (
    <group ref={group} position={position} rotation-x={Math.PI / 2}>
      <mesh geometry={parts.geometry} material={parts.plane} scale={[1, -1, 1]} rotation={[-Math.PI / 2, 0, 0]} />
      <orthographicCamera ref={camera} args={[-half, half, half, -half, 0, FAR]} />
    </group>
  )
}
