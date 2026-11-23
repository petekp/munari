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
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useThree } from '@react-three/fiber'
import { Surface, SurfaceCanvas, useElementCapture, useCaptureSupport } from '@petepetrash/munari'
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
import { createBounceLookUniforms } from './frontierBounceNodes'
import { BounceContainerPresenter } from './FrontierBouncePresenter'
import { FrontierBounceTweaks } from './FrontierBounceTweaks'
import { applyBounceTuning, bounceTuningFor, type BounceFinishId } from './frontierBounceTuning'
import { FrontierCanvasTelemetry, FrontierPixelCamera, useReducedMotion } from './frontierStage'
import './frontierBounce.css'

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
  const supported = useCaptureSupport()
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
  const [look] = useState(() => createBounceLookUniforms(bounceTuningFor('satin', false)))
  const wakeCanvas = useCallback(() => wakeCanvasRef.current?.(), [])

  useEffect(() => {
    applyBounceTuning(look.tuning, bounceTuningFor(finish, boosted))
    wakeCanvas()
  }, [look, finish, boosted, wakeCanvas])

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
                  look={look}
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
                  look={look}
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
                  look={look}
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
      {supported && (
        <FrontierBounceTweaks
          key={`${finish}:${boosted ? 1 : 0}`}
          uniforms={look.tuning}
          onChange={wakeCanvas}
        />
      )}
    </div>
  )
}
