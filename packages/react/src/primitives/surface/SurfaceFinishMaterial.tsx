// Surface finish material — the material a Surface.Mesh wears when its Root
// has a `finish` and the mesh names no material of its own.
//
// The law: a finish's values are written before every draw, so changing an
// amount, a color or the light is a uniform write that redraws on the next
// frame. Only a change of layers (finishNodes.ts FinishLayers), of the
// canvas key's kind or of the mesh's `transparent`, builds a new material. The first material waits for
// the rig's environment bake, and for a softbox key the LTC tables, before
// it compiles: compiled without them, it drew one frame unlit by the
// environment and then compiled a second time.
//
// Ownership: this module owns the material's lifetime and its writes. The
// node graph is finishNodes.ts; the lights and environments are the
// canvas's (finishRig.tsx). This module loads with the finish code
// (finishLoader.tsx), which hands it the canvas and the mesh it draws for:
// a lazy module that imported those itself split the page's eager bundle
// into several chunks under Vite 8, which cost more gzip than this code
// weighs (instruments/payload, m2, 2026-11-26).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { texture as textureNode, uv } from 'three/tsl'

import { surfaceRadiusMask } from '../../lib/surfaceRadius'
import { useLatest } from '../useLatest'
import { useFinishLayerCode, type FinishLayerCode } from './finishLayerCode'
import { useFinishRigState, type FinishRig } from './finishRig'
import { createFinishMaterial, type FinishShadingInputs } from './finishNodes'
import { createFinishUniforms, finishLayersOf, sameFinishLayers, writeFinish, type FinishLayers } from './finishUniforms'
import type { FinishPhysicalMaterial } from './finishLightingModel'
import type { SurfaceMaterialValue } from './surfaceContext'
import { resolveFinish, type SurfaceFinish } from './surfaceFinish'
import type { createSurfaceFrameChannel } from './surfaceFrame'
import type { SurfaceLitTexture } from './surfaceLitTexture'

export interface SurfaceFinishMaterialInputs extends FinishShadingInputs {
  /** The finish to wear. Omitted: the Surface's `finish`. */
  readonly finish?: SurfaceFinish
}

/** What a finish reads from the canvas and the mesh it draws for. */
export interface FinishSources {
  readonly slot: SurfaceMaterialValue
  /** The capture's lit view, acquired and synced before each draw. */
  readonly litTexture: SurfaceLitTexture
  readonly frames: ReturnType<typeof createSurfaceFrameChannel> | null
  /** Null outside a SurfaceCanvas, under `lighting="none"`, and without WebGPU. */
  readonly rig: FinishRig | null
  /** The canvas lights its finishes, and its rig has not been built yet. */
  readonly loading: boolean
  readonly invalidate: () => void
}

interface ShownLayers {
  readonly layers: FinishLayers
  readonly code: FinishLayerCode
}

/** The finish material for `sources`' mesh, as useSurfaceFinishMaterial describes. */
export function useFinishMaterial(sources: FinishSources, inputs: SurfaceFinishMaterialInputs): FinishPhysicalMaterial | null {
  const { slot, litTexture, frames, rig, loading, invalidate } = sources
  const finish = inputs.finish ?? slot.finish
  // One node for the material's life: a resize replaces the raw view, and a
  // value write keeps the built shader.
  const [captureNode] = useState(() => textureNode(litTexture.texture))
  captureNode.value = litTexture.texture
  const [uniforms] = useState(createFinishUniforms)

  const values = finish ? resolveFinish(finish) : null
  const valuesRef = useLatest(values)
  const nextLayers = values ? finishLayersOf(values, slot.facesCamera) : null
  const nextCode = useFinishLayerCode(nextLayers)
  // The material changes layers once their code has loaded; until then the
  // one it has keeps drawing, with the new values written into it.
  const shownRef = useRef<ShownLayers | null>(null)
  const previous = shownRef.current
  const layersHeld = previous !== null && nextLayers !== null && sameFinishLayers(previous.layers, nextLayers)
  if (nextLayers === null) shownRef.current = null
  else if (!layersHeld && nextCode !== null) shownRef.current = { layers: nextLayers, code: nextCode }
  const shown = shownRef.current
  const layersPending = nextLayers !== null && shown === null

  const environmentKind = values?.environment ?? 'even'
  const { ready, keyKind } = useFinishRigState(rig, environmentKind)
  const { normal, bodyColor } = inputs
  const material = useMemo(() => {
    if (!shown || loading) return null
    const built = createFinishMaterial(
      { capture: captureNode, size: slot.size, radii: slot.radii, cornerMask: surfaceRadiusMask(uv(), slot.size, slot.radii), uniforms, normal, bodyColor },
      shown.layers,
      shown.code,
    )
    if (rig) built.lightsNode = rig.lightsNode(keyKind)
    // An opaque mesh writes depth and blends nothing, as its default material
    // does. Glass blends on any mesh, because where the canvas behind it is
    // empty the page shows through it (decisions.md #80).
    const blends = slot.transparent || shown.layers.transmission
    built.transparent = blends
    built.depthWrite = !blends
    return built
  }, [captureNode, slot.size, slot.radii, slot.transparent, uniforms, shown, normal, bodyColor, rig, keyKind, loading])
  useLayoutEffect(() => () => material?.dispose(), [material])

  // Held until the rig has what this finish reflects: a material compiled
  // before the environment lands compiles again when it does.
  const holds = (values !== null && loading) || layersPending || (material !== null && !ready)
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
