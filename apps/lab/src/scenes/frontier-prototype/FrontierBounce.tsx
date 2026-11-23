// Variant 05: Lateral light bounce across adjacent reflective Surface containers.
//
// Three independent dark Liquid-Glass `<Surface>` containers (Left Navigation,
// Top Path/Finish Bar, and Right Inspector) surround a native HTML center stage.
// None of the three containers overlap the stage in Z — CSS `backdrop-filter` sees
// nothing behind them — yet each integrates chroma-weighted 2D lateral radiance,
// Vogel-diffused reflections, and bevel catchlights from `useElementCapture()`
// while idling at 0 fps.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { texture } from 'three/tsl'
import {
  Surface,
  SurfaceCanvas,
  useCaptureFrame,
  useElementCapture,
  useSurfaceNodes,
  useSurfaceRefresh,
  useSurfaceStatus,
  useSurfaceSupport,
  type CaptureHandle,
  type ElementCapture,
} from '@petepetrash/munari'
import {
  BounceEmitterSpecimen,
  BounceFilmstrip,
  BounceInspectorPane,
  BounceNavSidebar,
  BounceTopToolbar,
  SYNTH_HUES,
  type SynthHueId,
} from './FrontierBouncePanes'
import { BOUNCE_SPECIMENS, type BounceSpecimenId } from './frontierBounceSpecimens'
import {
  bouncePresetOffset,
  clampBounceOffset,
  computeBounceSeamGaps,
  measureBounceStageDom,
  type BounceOffset,
  type BouncePosePreset,
  type BounceSeamGaps,
} from './frontierBounceLaw'
import {
  applyBounceFinish,
  createBounceMaterial,
  createBounceUniforms,
  type BounceFinishId,
  type BounceUniforms,
} from './frontierBounceNodes'
import {
  FrontierCanvasTelemetry,
  FrontierPixelCamera,
  retainActiveSurface,
  useReducedMotion,
} from './frontierStage'
import './frontierBounce.css'

function createDarkPlaceholderTexture(): THREE.DataTexture {
  const data = new Uint8Array([18, 20, 24, 255])
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.needsUpdate = true
  return tex
}

function useSlotSize(
  ref: { readonly current: HTMLElement | null },
  fallbackW: number,
  fallbackH: number,
): readonly [number, number] {
  const [size, setSize] = useState<readonly [number, number]>([fallbackW, fallbackH])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => {
      const r = el.getBoundingClientRect()
      const nw = Math.max(1, Math.round(r.width))
      const nh = Math.max(1, Math.round(r.height))
      setSize((prev) => (prev[0] === nw && prev[1] === nh ? prev : [nw, nh]))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return size
}

function BounceMaterialSlot({
  emitterCapture,
  uniforms,
}: {
  readonly emitterCapture: CaptureHandle
  readonly uniforms: BounceUniforms
}) {
  const surface = useSurfaceNodes()
  const emitterFrames = useCaptureFrame(emitterCapture)
  const [placeholder] = useState(createDarkPlaceholderTexture)
  const [emitterMap] = useState(() => texture(placeholder))

  const material = useMemo(
    () => createBounceMaterial(surface, emitterMap, uniforms),
    [surface, emitterMap, uniforms],
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
      uniforms.emitterReady.value = 1
    }
  })

  return <primitive object={material} attach="material" />
}

function BounceContainerPresenter({
  stageElRef,
  slotElRef,
  emitterCapture,
  cornerRadius,
  finish,
  boosted,
  syncKey,
}: {
  readonly stageElRef: { readonly current: HTMLDivElement | null }
  readonly slotElRef: { readonly current: HTMLDivElement | null }
  readonly emitterCapture: ElementCapture
  readonly cornerRadius: number
  readonly finish: BounceFinishId
  readonly boosted: boolean
  readonly syncKey: string
}) {
  const status = useSurfaceStatus()
  const refreshSurface = useSurfaceRefresh()
  const invalidate = useThree((s) => s.invalidate)
  const uniforms = useMemo(() => createBounceUniforms(cornerRadius), [cornerRadius])
  const prevSyncRef = useRef(syncKey)

  useEffect(() => {
    if (prevSyncRef.current !== syncKey) {
      prevSyncRef.current = syncKey
      refreshSurface()
    }
  }, [syncKey, refreshSurface])

  useEffect(() => {
    applyBounceFinish(uniforms, finish, boosted ? 1.45 : 1.0)
    invalidate()
  }, [uniforms, finish, boosted, invalidate])

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

    uniforms.panelRectCss.value.set(
      slotRect.left - stageRect.left,
      slotRect.top - stageRect.top,
      Math.max(slotRect.width, 1),
      Math.max(slotRect.height, 1),
    )

    if (emitBounds && emitBounds.width > 0 && emitBounds.height > 0) {
      uniforms.emitterRectCss.value.set(
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
      material={<BounceMaterialSlot emitterCapture={emitterCapture} uniforms={uniforms} />}
    />
  )
}

function BounceCanvasWakeBridge({
  wakeRef,
}: {
  readonly wakeRef: { current: (() => void) | null }
}) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    wakeRef.current = () => invalidate()
    return () => {
      wakeRef.current = null
    }
  }, [invalidate, wakeRef])
  return null
}

export function FrontierBounce() {
  const supported = useSurfaceSupport()
  const reducedMotion = useReducedMotion()
  const canvasId = useId()
  const emitterCapture = useElementCapture({ resolution: 0.25 })

  const [specimenId, setSpecimenId] = useState<BounceSpecimenId>('starry-night')
  const [activeFolder, setActiveFolder] = useState('Pictures')
  const [finish, setFinish] = useState<BounceFinishId>('satin')
  const [boosted, setBoosted] = useState(false)
  const [synthHueId, setSynthHueId] = useState<SynthHueId>('cyan')
  const [synthNote, setSynthNote] = useState('Live DOM illuminates adjacent chrome')
  const [gaps, setGaps] = useState<BounceSeamGaps>({ leftPx: 88, topPx: 68, rightPx: 88 })
  const [emitterDims, setEmitterDims] = useState<readonly [number, number]>([516, 360])

  const stageRef = useRef<HTMLDivElement>(null)
  const navSlotRef = useRef<HTMLDivElement>(null)
  const topSlotRef = useRef<HTMLDivElement>(null)
  const inspSlotRef = useRef<HTMLDivElement>(null)
  const laneRef = useRef<HTMLDivElement>(null)
  const emitterWrapRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef<BounceOffset>({ x: 0, y: 0 })
  const dragStartRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const glideRafRef = useRef<number>(0)
  const wakeCanvasRef = useRef<(() => void) | null>(null)

  const navSize = useSlotSize(navSlotRef, 216, 560)
  const topSize = useSlotSize(topSlotRef, 800, 46)
  const inspSize = useSlotSize(inspSlotRef, 252, 514)

  const cancelGlide = useCallback(() => {
    if (glideRafRef.current) {
      cancelAnimationFrame(glideRafRef.current)
      glideRafRef.current = 0
    }
  }, [])

  useEffect(() => cancelGlide, [cancelGlide])

  const setEmitterRef = useCallback(
    (node: HTMLDivElement | null) => {
      emitterWrapRef.current = node
      emitterCapture.ref(node)
    },
    [emitterCapture],
  )

  const applyOffsetDom = useCallback((next: BounceOffset, commitReadout: boolean) => {
    const metrics = measureBounceStageDom(
      stageRef.current,
      laneRef.current,
      emitterWrapRef.current,
      inspSlotRef.current,
    )
    const clamped = metrics ? clampBounceOffset(next, metrics) : next
    offsetRef.current = clamped
    if (emitterWrapRef.current) {
      emitterWrapRef.current.style.transform = `translate3d(${clamped.x}px, ${clamped.y}px, 0)`
    }
    if (commitReadout && metrics) {
      setGaps(computeBounceSeamGaps(clamped, metrics))
      const nw = Math.round(metrics.emitterWidth)
      const nh = Math.round(metrics.emitterHeight)
      setEmitterDims((prev) => (prev[0] === nw && prev[1] === nh ? prev : [nw, nh]))
    }
    wakeCanvasRef.current?.()
  }, [])

  useLayoutEffect(() => {
    const syncLayout = () => applyOffsetDom(offsetRef.current, true)
    syncLayout()
    const ro = new ResizeObserver(syncLayout)
    if (stageRef.current) ro.observe(stageRef.current)
    if (laneRef.current) ro.observe(laneRef.current)
    if (emitterWrapRef.current) ro.observe(emitterWrapRef.current)
    if (inspSlotRef.current) ro.observe(inspSlotRef.current)
    return () => ro.disconnect()
  }, [applyOffsetDom])

  const mountedEmitRef = useRef(false)
  useLayoutEffect(() => {
    if (!mountedEmitRef.current) {
      mountedEmitRef.current = true
      return
    }
    emitterCapture.refresh()
  }, [specimenId, synthHueId, synthNote, emitterCapture])

  const selectSpecimen = useCallback((next: BounceSpecimenId, folderOverride?: string) => {
    setSpecimenId(next)
    const folder = folderOverride ?? BOUNCE_SPECIMENS.find((s) => s.id === next)?.folder
    if (folder) setActiveFolder(folder)
  }, [])

  const stepSpecimen = useCallback(
    (delta: -1 | 1) => {
      const idx = BOUNCE_SPECIMENS.findIndex((s) => s.id === specimenId)
      const next =
        BOUNCE_SPECIMENS[(idx + delta + BOUNCE_SPECIMENS.length) % BOUNCE_SPECIMENS.length]
      if (next) selectSpecimen(next.id)
    },
    [specimenId, selectSpecimen],
  )

  const snapPose = useCallback(
    (preset: BouncePosePreset) => {
      cancelGlide()
      const metrics = measureBounceStageDom(
        stageRef.current,
        laneRef.current,
        emitterWrapRef.current,
        inspSlotRef.current,
      )
      if (!metrics) return
      const target = bouncePresetOffset(preset, metrics)
      const from = offsetRef.current
      if (reducedMotion || (Math.abs(target.x - from.x) < 1 && Math.abs(target.y - from.y) < 1)) {
        applyOffsetDom(target, true)
        return
      }
      const startAt = performance.now()
      const durationMs = 220
      const step = (now: number) => {
        const t = Math.min(1, (now - startAt) / durationMs)
        const ease = 1 - Math.pow(1 - t, 3)
        const cur = {
          x: from.x + (target.x - from.x) * ease,
          y: from.y + (target.y - from.y) * ease,
        }
        if (t < 1) {
          applyOffsetDom(cur, false)
          glideRafRef.current = requestAnimationFrame(step)
        } else {
          glideRafRef.current = 0
          applyOffsetDom(target, true)
        }
      }
      glideRafRef.current = requestAnimationFrame(step)
    },
    [applyOffsetDom, cancelGlide, reducedMotion],
  )

  const onEmitterPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button, input, label, a')) return
    cancelGlide()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartRef.current = {
      px: event.clientX,
      py: event.clientY,
      ox: offsetRef.current.x,
      oy: offsetRef.current.y,
    }
  }

  const onEmitterPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    applyOffsetDom(
      {
        x: start.ox + (event.clientX - start.px),
        y: start.oy + (event.clientY - start.py),
      },
      false,
    )
  }

  const onEmitterPointerUp = () => {
    if (!dragStartRef.current) return
    dragStartRef.current = null
    applyOffsetDom(offsetRef.current, true)
  }

  const onEmitterKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) {
      return
    }
    const step = event.shiftKey ? 72 : 28
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      cancelGlide()
      applyOffsetDom({ x: offsetRef.current.x - step, y: offsetRef.current.y }, true)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      cancelGlide()
      applyOffsetDom({ x: offsetRef.current.x + step, y: offsetRef.current.y }, true)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      cancelGlide()
      applyOffsetDom({ x: offsetRef.current.x, y: offsetRef.current.y - step }, true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      cancelGlide()
      applyOffsetDom({ x: offsetRef.current.x, y: offsetRef.current.y + step }, true)
    } else if (event.key === 'Home' || event.key === '0') {
      event.preventDefault()
      snapPose('center')
    }
  }

  const specimen = BOUNCE_SPECIMENS.find((s) => s.id === specimenId) ?? BOUNCE_SPECIMENS[0]!
  const painting = specimen.kind === 'painting' ? specimen : null
  const synthHue = SYNTH_HUES.find((h) => h.id === synthHueId) ?? SYNTH_HUES[0]!

  return (
    <div className="frontier-bench">
      <div ref={stageRef} className="frontier-stage-wrap fb-stage">
        <div className="fb-desktop-grid">
          <div ref={navSlotRef} className="fb-slot-nav">
            <Surface.Root canvasId={canvasId} inScene={supported}>
              <Surface.HTML size={navSize} pageClassName="fb-surface-page">
                <BounceNavSidebar
                  supported={supported}
                  size={navSize}
                  activeFolder={activeFolder}
                  onSelectFolder={(folderId, linked) => {
                    if (linked) selectSpecimen(linked, folderId)
                    else setActiveFolder(folderId)
                  }}
                />
              </Surface.HTML>
              <Surface.Scene>
                <BounceContainerPresenter
                  stageElRef={stageRef}
                  slotElRef={navSlotRef}
                  emitterCapture={emitterCapture}
                  cornerRadius={18}
                  finish={finish}
                  boosted={boosted}
                  syncKey={`${activeFolder}:${navSize[0]}x${navSize[1]}`}
                />
              </Surface.Scene>
            </Surface.Root>
          </div>

          <div ref={topSlotRef} className="fb-slot-top">
            <Surface.Root canvasId={canvasId} inScene={supported}>
              <Surface.HTML size={topSize} pageClassName="fb-surface-page">
                <BounceTopToolbar
                  supported={supported}
                  size={topSize}
                  activeFolder={activeFolder}
                  finish={finish}
                  boosted={boosted}
                  onStepSpecimen={stepSpecimen}
                  onSelectFinish={setFinish}
                  onToggleBoost={() => setBoosted((v) => !v)}
                />
              </Surface.HTML>
              <Surface.Scene>
                <BounceContainerPresenter
                  stageElRef={stageRef}
                  slotElRef={topSlotRef}
                  emitterCapture={emitterCapture}
                  cornerRadius={14}
                  finish={finish}
                  boosted={boosted}
                  syncKey={`${activeFolder}:${finish}:${boosted ? 1 : 0}:${topSize[0]}x${topSize[1]}`}
                />
              </Surface.Scene>
            </Surface.Root>
          </div>

          <div className="fb-center-well">
            <div ref={laneRef} className="fb-emitter-lane">
              <div
                ref={setEmitterRef}
                tabIndex={0}
                role="group"
                aria-label="Draggable light emitter specimen. Use arrow keys to move toward glass panes, Home or 0 to center"
                className={`fb-emitter-card${painting ? ' fb-emitter-card--painting' : ''}`}
                style={painting ? { aspectRatio: String(painting.aspect) } : undefined}
                onDoubleClick={() => snapPose('center')}
                onKeyDown={onEmitterKeyDown}
                onPointerDown={onEmitterPointerDown}
                onPointerMove={onEmitterPointerMove}
                onPointerUp={onEmitterPointerUp}
                onLostPointerCapture={onEmitterPointerUp}
              >
                <BounceEmitterSpecimen
                  specimen={specimen}
                  synthHue={synthHue}
                  synthNote={synthNote}
                  onSelectSynthHue={setSynthHueId}
                  onChangeSynthNote={setSynthNote}
                  onImageLoad={emitterCapture.refresh}
                />
              </div>
            </div>

            <BounceFilmstrip activeId={specimenId} onSelect={(id) => selectSpecimen(id)} />
          </div>

          <div ref={inspSlotRef} className="fb-slot-insp">
            <Surface.Root canvasId={canvasId} inScene={supported}>
              <Surface.HTML size={inspSize} pageClassName="fb-surface-page">
                <BounceInspectorPane
                  supported={supported}
                  size={inspSize}
                  specimen={specimen}
                  finish={finish}
                  gaps={gaps}
                  emitterDims={emitterDims}
                  onPosePreset={snapPose}
                />
              </Surface.HTML>
              <Surface.Scene>
                <BounceContainerPresenter
                  stageElRef={stageRef}
                  slotElRef={inspSlotRef}
                  emitterCapture={emitterCapture}
                  cornerRadius={18}
                  finish={finish}
                  boosted={boosted}
                  syncKey={`${specimen.id}:${finish}:${gaps.leftPx}:${gaps.topPx}:${gaps.rightPx}:${emitterDims[0]}x${emitterDims[1]}:${inspSize[0]}x${inspSize[1]}`}
                />
              </Surface.Scene>
            </Surface.Root>
          </div>
        </div>

        {supported && (
          <SurfaceCanvas
            id={canvasId}
            frameloop="demand"
            pointerMode="surfaces"
            gl={{ alpha: true, antialias: false, depth: false }}
            onCreated={({ gl }) => gl.setClearAlpha(0)}
            className="frontier-overlay-canvas"
          >
            <FrontierPixelCamera />
            <FrontierCanvasTelemetry />
            <BounceCanvasWakeBridge wakeRef={wakeCanvasRef} />
          </SurfaceCanvas>
        )}
      </div>
    </div>
  )
}
