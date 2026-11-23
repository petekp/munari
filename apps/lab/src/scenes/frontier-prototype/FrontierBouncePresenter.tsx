// Light bounce pane presenter — one glass Surface.Mesh per pane, with the
// material that lights it from the emitter capture. Each pane owns its rectangle
// and corner radius; the tuning, emitter rectangle and glass color are shared
// by all three panes (frontierBounceTuning.ts).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { texture } from 'three/tsl'
import {
  Surface,
  useCaptureFrame,
  useSurfaceNodes,
  useSurfaceRefresh,
  useSurfaceStatus,
  type CaptureHandle,
  type ElementCapture,
} from '@petepetrash/munari'
import {
  createBounceMaterial,
  createBouncePaneUniforms,
  type BounceLookUniforms,
  type BouncePaneUniforms,
} from './frontierBounceNodes'
import { retainActiveSurface } from './frontierStage'

function createDarkPlaceholderTexture(): THREE.DataTexture {
  const data = new Uint8Array([18, 20, 24, 255])
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.needsUpdate = true
  return tex
}

function BounceMaterialSlot({
  emitterCapture,
  look,
  pane,
}: {
  readonly emitterCapture: CaptureHandle
  readonly look: BounceLookUniforms
  readonly pane: BouncePaneUniforms
}) {
  const surface = useSurfaceNodes()
  const emitterFrames = useCaptureFrame(emitterCapture)
  const [placeholder] = useState(createDarkPlaceholderTexture)
  const [emitterMap] = useState(() => texture(placeholder))

  const material = useMemo(
    () => createBounceMaterial(surface, emitterMap, look, pane),
    [surface, emitterMap, look, pane],
  )

  useEffect(
    () => () => {
      material.dispose()
      placeholder.dispose()
    },
    [material, placeholder],
  )

  useFrame(() => {
    const latest = emitterFrames.get()
    if (latest) {
      emitterMap.value = latest.texture
      look.emitterReady.value = 1
    }
  })

  return <primitive object={material} attach="material" />
}

export function BounceContainerPresenter({
  stageElRef,
  slotElRef,
  emitterCapture,
  cornerRadius,
  look,
  syncKey,
}: {
  readonly stageElRef: { readonly current: HTMLDivElement | null }
  readonly slotElRef: { readonly current: HTMLDivElement | null }
  readonly emitterCapture: ElementCapture
  readonly cornerRadius: number
  readonly look: BounceLookUniforms
  readonly syncKey: string
}) {
  const status = useSurfaceStatus()
  const refreshSurface = useSurfaceRefresh()
  const pane = useMemo(() => createBouncePaneUniforms(cornerRadius), [cornerRadius])
  const prevSyncRef = useRef(syncKey)

  useEffect(() => {
    if (prevSyncRef.current !== syncKey) {
      prevSyncRef.current = syncKey
      refreshSurface()
    }
  }, [syncKey, refreshSurface])

  useEffect(() => {
    if (status.presentation === 'scene') return retainActiveSurface()
    return undefined
  }, [status.presentation])

  useFrame(() => {
    const stage = stageElRef.current
    const slot = slotElRef.current
    const emitBounds = emitterCapture.getBounds()
    if (!stage || !slot) return
    const stageRect = stage.getBoundingClientRect()
    const slotRect = slot.getBoundingClientRect()
    if (stageRect.width <= 0 || slotRect.width <= 0) return

    pane.panelRectCss.value.set(
      slotRect.left - stageRect.left,
      slotRect.top - stageRect.top,
      Math.max(slotRect.width, 1),
      Math.max(slotRect.height, 1),
    )

    if (emitBounds && emitBounds.width > 0 && emitBounds.height > 0) {
      look.emitterRectCss.value.set(
        emitBounds.left - stageRect.left,
        emitBounds.top - stageRect.top,
        Math.max(emitBounds.width, 8),
        Math.max(emitBounds.height, 8),
      )
    }
  })

  return (
    <Surface.Mesh
      placement="match-dom"
      renderOrder={2}
      material={<BounceMaterialSlot emitterCapture={emitterCapture} look={look} pane={pane} />}
    />
  )
}
