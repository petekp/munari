// Hand stroke — a screen-space silhouette with a distance-independent width.
//
// The law: only the hand supplies the mask. Expanding its alpha in CSS
// pixels leaves the native page, physical shadow, and pointer hitbox alone.
// The 2026-08-30 chrome preset can blend into pale paper; model-space shells
// would change thickness on press and split at the sealed wrist's normals.
//
// Ownership: the hand lends its geometry and current pose. This component
// owns the mask target, mask material, and transparent outline quad. It does
// not own the source geometry, page capture, or the main render loop.

import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { MARBLE_HAND_STROKE_FRAGMENT, MARBLE_HAND_STROKE_VERTEX } from './marbleHandStrokeShaders'
import {
  MARBLE_HAND_TAP_PROGRAM_KEY,
  addMarbleHandTap,
  type MarbleHandTapUniforms,
} from './marbleHandTapShaders'
import type { MarbleHandTuning } from './marbleHandTuning'

const IGNORE_RAYCAST: THREE.Object3D['raycast'] = () => {}
const MASK_KEY = () => `munari-marble-hand-mask-${MARBLE_HAND_TAP_PROGRAM_KEY}`

export function MarbleHandStroke({ hand, tuning, tap }: {
  hand: THREE.Mesh
  tuning: MarbleHandTuning
  tap: MarbleHandTapUniforms
}) {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const resources = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      // Match the overlay's antialiased edge without forcing another full
      // scene render. Four samples also retain subpixel width at DPR 1.
      samples: 4,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    })
    target.texture.name = 'marble-hand-stroke-mask'
    // The mask draws the same bent stone the visible material draws. An
    // unpatched mask leaves the outline standing where the finger used to be.
    const maskMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
    maskMaterial.onBeforeCompile = (shader) => addMarbleHandTap(shader, tap)
    maskMaterial.customProgramCacheKey = MASK_KEY
    const mask = new THREE.Mesh(hand.geometry, maskMaterial)
    mask.matrixAutoUpdate = false
    mask.frustumCulled = false
    const scene = new THREE.Scene()
    scene.add(mask)
    const uniforms = {
      uMask: { value: target.texture },
      uBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
      uCssPixel: { value: new THREE.Vector2() },
      uWidth: { value: 0 },
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 0 },
    }
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: MARBLE_HAND_STROKE_VERTEX,
      fragmentShader: MARBLE_HAND_STROKE_FRAGMENT,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    quad.name = 'marble-hand-stroke'
    quad.frustumCulled = false
    quad.raycast = IGNORE_RAYCAST
    // The shadow is transparent too. Draw the stroke above that alpha,
    // while the hand mask excludes the sculpture's own visible pixels.
    quad.renderOrder = 10
    return {
      target, maskMaterial, mask, scene, uniforms, material, quad,
      bufferSize: new THREE.Vector2(), clearColor: new THREE.Color(),
      projection: new THREE.Matrix4(), corner: new THREE.Vector4(),
    }
  }, [hand, tap])

  useEffect(() => () => {
    resources.target.dispose()
    resources.maskMaterial.dispose()
    resources.material.dispose()
    resources.quad.geometry.dispose()
  }, [resources])

  useFrame(() => {
    const { quad, target, uniforms, mask, scene, projection, corner } = resources
    quad.visible = hand.visible && tuning.strokeEnabled && tuning.strokeWidthPx > 0 && tuning.strokeOpacity > 0
    if (!quad.visible) return
    uniforms.uWidth.value = tuning.strokeWidthPx
    uniforms.uOpacity.value = tuning.strokeOpacity
    uniforms.uColor.value.set(tuning.strokeColor)
    uniforms.uCssPixel.value.set(1 / size.width, 1 / size.height)
    gl.getDrawingBufferSize(resources.bufferSize)
    if (target.width !== resources.bufferSize.x || target.height !== resources.bufferSize.y) {
      target.setSize(resources.bufferSize.x, resources.bufferSize.y)
    }

    // MarblePointer runs at priority -1. Both this mask and the main hand
    // therefore use the new pose on the same frame, including fast moves.
    hand.updateWorldMatrix(true, false)
    camera.updateWorldMatrix(true, false)
    mask.matrix.copy(hand.matrixWorld)
    mask.matrixWorldNeedsUpdate = true
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(hand.matrixWorld)
    const box = hand.geometry.boundingBox
    let left = 1
    let bottom = 1
    let right = 0
    let top = 0
    if (box) {
      for (let index = 0; index < 8; index++) {
        corner.set(index & 1 ? box.max.x : box.min.x,
          index & 2 ? box.max.y : box.min.y, index & 4 ? box.max.z : box.min.z, 1).applyMatrix4(projection)
        // A box crossing the camera cannot give a finite projected bound.
        // The GPU still clips the mask correctly; cover the viewport then.
        if (corner.w <= 0) { left = 0; bottom = 0; right = 1; top = 1; break }
        const x = corner.x / corner.w * 0.5 + 0.5
        const y = corner.y / corner.w * 0.5 + 0.5
        left = Math.min(left, x)
        bottom = Math.min(bottom, y)
        right = Math.max(right, x)
        top = Math.max(top, y)
      }
    } else {
      left = 0; bottom = 0; right = 1; top = 1
    }
    // Limit expensive mask samples to the hand's projected box. Two extra
    // CSS pixels leave room for the mask's antialiased outer edge.
    const padX = (tuning.strokeWidthPx + 2) / size.width
    const padY = (tuning.strokeWidthPx + 2) / size.height
    uniforms.uBounds.value.set(Math.max(0, left - padX), Math.max(0, bottom - padY),
      Math.min(1, right + padX), Math.min(1, top + padY))

    const previousTarget = gl.getRenderTarget()
    const previousFace = gl.getActiveCubeFace()
    const previousLevel = gl.getActiveMipmapLevel()
    const previousAlpha = gl.getClearAlpha()
    const previousAutoClear = gl.autoClear
    const previousShadows = gl.shadowMap.enabled
    gl.getClearColor(resources.clearColor)
    try {
      gl.autoClear = false
      gl.shadowMap.enabled = false
      gl.setRenderTarget(target)
      gl.setClearColor(0x000000, 0)
      gl.clear(true, true, false)
      gl.render(scene, camera)
    } finally {
      gl.setRenderTarget(previousTarget, previousFace, previousLevel)
      gl.setClearColor(resources.clearColor, previousAlpha)
      gl.autoClear = previousAutoClear
      gl.shadowMap.enabled = previousShadows
    }
  })

  return <primitive object={resources.quad} />
}
