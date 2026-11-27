// Surface finish material — the material a Surface.Mesh wears when its Root
// has a `finish` and the mesh names no material of its own.
//
// The law: a finish's values are written before every draw, so changing an
// amount, a color or the light is a uniform write that redraws on the next
// frame. Only a change of layers (finishNodes.ts FinishLayers), or of the
// canvas key's kind, builds a new material. The first material waits for
// the rig's environment bake, and for a softbox key the LTC tables, before
// it compiles: compiled without them, it drew one frame unlit by the
// environment and then compiled a second time.
//
// Ownership: this module owns the material's lifetime and its writes. The
// node graph is finishNodes.ts; the lights and environments are the
// canvas's (finishRig.tsx).

import { use, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { texture as textureNode, uv } from 'three/tsl'

import { surfaceRadiusMask } from '../../lib/surfaceRadius'
import { useLatest } from '../useLatest'
import { useFinishRig, useFinishRigState } from './finishRig'
import { createFinishMaterial, type FinishShadingInputs } from './finishNodes'
import { createFinishUniforms, finishLayersOf, sameFinishLayers, writeFinish, type FinishLayers } from './finishUniforms'
import type { FinishPhysicalMaterial } from './finishLightingModel'
import { useSurfaceTextureFor } from './surfaceContext'
import { resolveFinish, type SurfaceFinish } from './surfaceFinish'
import { SurfaceFrameContext } from './surfaceFrame'
import { getSurfaceLitTexture } from './surfaceLitTexture'
import { useMaterialSlot } from './surfaceMaterials'

export interface SurfaceFinishMaterialInputs extends FinishShadingInputs {
  /** The finish to wear. Omitted: the Surface's `finish`. */
  readonly finish?: SurfaceFinish
}

/**
 * The finish material for the Surface.Mesh this runs in, for a material
 * that bends or turns the finish's normal or changes its body color. Null
 * when neither `inputs.finish` nor the Surface names a finish.
 *
 * `normal` and `bodyColor` build the shader, so a new function builds a new
 * material: pass functions that keep their identity, defined at module scope
 * or memoized.
 */
export function useSurfaceFinishMaterial(inputs: SurfaceFinishMaterialInputs = {}): FinishPhysicalMaterial | null {
  const capture = useSurfaceTextureFor('useSurfaceFinishMaterial()')
  const slot = useMaterialSlot('useSurfaceFinishMaterial()')
  const finish = inputs.finish ?? slot.finish
  const frames = use(SurfaceFrameContext)
  const invalidate = useThree((state) => state.invalidate)

  const litTexture = useMemo(() => getSurfaceLitTexture(capture), [capture])
  useLayoutEffect(() => litTexture.acquire(), [litTexture])
  // Before each draw, after raster sizing: the raw view follows the capture.
  useLayoutEffect(() => slot.beforeDraw(litTexture.sync), [slot, litTexture])
  // One node for the material's life: a resize replaces the raw view, and a
  // value write keeps the built shader.
  const [captureNode] = useState(() => textureNode(litTexture.texture))
  captureNode.value = litTexture.texture
  const [uniforms] = useState(createFinishUniforms)

  const values = finish ? resolveFinish(finish) : null
  const valuesRef = useLatest(values)
  const nextLayers = values ? finishLayersOf(values, slot.facesCamera) : null
  const layersRef = useRef<FinishLayers | null>(nextLayers)
  const previous = layersRef.current
  const layersHeld = previous !== null && nextLayers !== null && sameFinishLayers(previous, nextLayers)
  if (!layersHeld) layersRef.current = nextLayers
  const layers = layersRef.current

  const rig = useFinishRig()
  const environmentKind = values?.environment ?? 'even'
  const { ready, keyKind } = useFinishRigState(rig, environmentKind)
  const { normal, bodyColor } = inputs
  const material = useMemo(() => {
    if (!layers) return null
    const built = createFinishMaterial(
      { capture: captureNode, size: slot.size, radii: slot.radii, cornerMask: surfaceRadiusMask(uv(), slot.size, slot.radii), uniforms, normal, bodyColor },
      layers,
    )
    built.areaKey = keyKind === 'area' ? uniforms.key : null
    if (rig) built.lightsNode = rig.lightsNode(keyKind)
    return built
  }, [captureNode, slot.size, slot.radii, uniforms, layers, normal, bodyColor, rig, keyKind])
  useLayoutEffect(() => () => material?.dispose(), [material])

  // Held until the rig has what this finish reflects: a material compiled
  // before the environment lands compiles again when it does.
  const holds = material !== null && !ready
  const { hold } = slot
  useLayoutEffect(() => (holds ? hold() : undefined), [holds, hold])

  // Written at commit too, so the compile sees the finish's side, its
  // environment and its values, not only the first draw.
  useLayoutEffect(() => {
    if (!material || !values) return
    writeFinish(material, uniforms, values)
    const reflected = rig?.environment(values.environment) ?? null
    if (material.envMap !== reflected) {
      material.envMap = reflected
      material.needsUpdate = true
    }
    material.envMapIntensity = rig?.environmentIntensity() ?? 1
    invalidate()
  })

  useEffect(() => {
    if (!material || !frames) return
    return frames.subscribe((frame) => {
      const current = valuesRef.current
      if (!current) return
      writeFinish(material, uniforms, current)
      if (rig) {
        const reflected = rig.environment(current.environment)
        if (material.envMap !== reflected) {
          material.envMap = reflected
          material.needsUpdate = true
        }
        material.envMapIntensity = rig.environmentIntensity()
        rig.place(frame, uniforms.key)
      }
    })
  }, [material, frames, uniforms, rig, valuesRef])

  return material
}

/** The Surface's finish, worn by a Surface.Mesh with no material of its own. */
export function SurfaceFinishMaterial() {
  const material = useSurfaceFinishMaterial()
  return material ? <primitive object={material} attach="material" /> : null
}
