// WebGPU Studio demo — showcases `@petepetrash/munari/gpu` + compiled
// Material Manifests installed by `munari add`, with zero Three/R3F/TypeGPU runtime.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Surface,
  SurfaceCanvas,
  createSurfaceLight,
  detectHtmlInCanvas,
  getGpuHostStats,
  paintStats,
  requestGpuFrame,
  simulateGpuDeviceLoss,
  type GpuHostStats,
  type GpuViewport,
  type SurfaceFrameContext,
  type SurfacePose,
  type SurfacePresentation,
} from '@petepetrash/munari/gpu'
import { SPRING_FISHEYE, SPRING_FLIGHT, createSpring } from '../../behaviors/spring'
import { createLiftBehavior } from '../../behaviors/compose'
import { fisheyeLensManifest } from './materials/fisheyeLens.material.gen'
import { flightCardManifest } from './materials/flightCard.material.gen'
import { MaterialsPanel } from './gpuStudioMaterials'
import { GeniePanel, type GenieDebugSnapshot } from './gpuStudioGenie'
import {
  FISHEYE_PARAMS,
  fisheyeDisplace,
  fisheyeDisplaceX,
  fisheyeScale,
  projectSurfaceLocalPoint,
} from './gpuStudioLaw'
import './gpuStudio.css'

const CANVAS_ID = 'gpu-studio'
type StudioTab = 'flight' | 'fisheye' | 'materials' | 'genie'

const FLIGHT_SIZE: readonly [number, number] = [340, 200]
const FLIGHT_SHADOW = { opacity: 0.34, blur: 16, elevationScale: 0.45 } as const
const FISHEYE_SIZE: readonly [number, number] = [360, 652]
const FISHEYE_HEADER_H = 36
const FISHEYE_ROW_H = 22
const FISHEYE_ROWS = Array.from({ length: 28 }, (_, i) => ({
  id: `M-${101 + i}`,
  title: `Surface queue item ${i + 1}`,
}))

export interface GpuStudioHandle {
  readonly stats: () => GpuHostStats & { readonly paints: number }
  readonly capability: () => ReturnType<typeof detectHtmlInCanvas>
  readonly simulateLoss: () => boolean
  readonly presentation: () => SurfacePresentation
  readonly setFisheyeFocus: (rowIndex: number | null) => void
  readonly flightCornerPoint: () => { readonly x: number; readonly y: number } | null
  readonly flightActionPoint: () => { readonly x: number; readonly y: number } | null
  readonly flightShadowSamplePoint: () => { readonly x: number; readonly y: number } | null
  readonly fisheyePoint: (rowIndex: number, target?: 'row' | 'done') => { readonly x: number; readonly y: number } | null
  readonly fisheyeState: () => { readonly focusDomY: number; readonly amp: number } | null
  readonly genieState: () => GenieDebugSnapshot | null
  readonly toggleGenie: () => void
}

declare global {
  interface Window {
    __gpuStudio?: GpuStudioHandle
  }
}

function readInitialTab(): StudioTab {
  const q = new URLSearchParams(window.location.search).get('tab')
  if (q === 'fisheye' || q === 'materials' || q === 'genie') return q
  return 'flight'
}

interface FlightPanelProps {
  readonly onPresChange: (p: SurfacePresentation) => void
  readonly flightRef: React.MutableRefObject<{ pose: SurfacePose; viewport: GpuViewport } | null>
}

function FlightPanel({ onPresChange, flightRef }: FlightPanelProps) {
  const [lifted, setLifted] = useState(true)
  const [inScene, setInScene] = useState(true)
  const [note, setNote] = useState('Check Gate B14')
  const [count, setCount] = useState(0)
  const [pres, setPres] = useState<SurfacePresentation>('page')

  const liftedRef = useRef(lifted)
  liftedRef.current = lifted
  const inSceneRef = useRef(inScene)
  inSceneRef.current = inScene

  const liftBehavior = useMemo(() => createLiftBehavior({ initialLifted: true, config: SPRING_FLIGHT }), [])
  const aeroSpring = useMemo(() => createSpring(18, SPRING_FLIGHT), [])
  const glossSpring = useMemo(() => createSpring(0.5, SPRING_FLIGHT), [])
  const initialFlightUniforms = useMemo(
    () => ({ aeroDir: [0.6, -0.8] as const, aeroAmt: 18, aeroReach: 170, gloss: 0.5 }),
    [],
  )

  useEffect(() => {
    if (lifted) {
      if (!inSceneRef.current) {
        liftBehavior.snapLifted(false)
        aeroSpring.snap(0)
        glossSpring.snap(0)
        setInScene(true)
      }
      liftBehavior.setLifted(true)
      aeroSpring.setTarget(18)
      glossSpring.setTarget(0.5)
    } else {
      liftBehavior.setLifted(false)
      aeroSpring.setTarget(0)
      glossSpring.setTarget(0)
    }
    requestGpuFrame(CANVAS_ID)
  }, [lifted, liftBehavior, aeroSpring, glossSpring])

  const handleFrame = useMemo(
    () => (ctx: SurfaceFrameContext<typeof initialFlightUniforms>) => {
      if (!ctx.pageRect) return false
      const liftActive = liftBehavior.behavior(ctx)
      const aeroActive = aeroSpring.step(ctx.dtMs)
      const glossActive = glossSpring.step(ctx.dtMs)
      ctx.setUniforms({
        aeroDir: [0.6, -0.8],
        aeroAmt: aeroSpring.get().value,
        aeroReach: 170,
        gloss: glossSpring.get().value,
      })
      const v = liftBehavior.values()
      flightRef.current = {
        pose: {
          ...ctx.basePose,
          x: ctx.basePose.x + v.x,
          y: ctx.basePose.y + v.y,
          z: ctx.basePose.z + v.z,
          rx: (ctx.basePose.rx ?? 0) + v.rx,
          ry: (ctx.basePose.ry ?? 0) + v.ry,
        },
        viewport: ctx.viewport,
      }
      const anyActive = liftActive || aeroActive || glossActive
      if (!liftedRef.current && inSceneRef.current && !anyActive) {
        queueMicrotask(() => setInScene(false))
      }
      return anyActive
    },
    [liftBehavior, aeroSpring, glossSpring, flightRef],
  )

  const handlePres = useCallback(
    (p: SurfacePresentation) => {
      setPres(p)
      onPresChange(p)
    },
    [onPresChange],
  )

  return (
    <div className="gpu-studio-stage">
      <div className="gpu-studio-controls">
        <button
          type="button"
          data-testid="flight-toggle"
          className="gpu-studio-btn"
          onClick={() => setLifted((v) => !v)}
        >
          {lifted ? 'Land card' : 'Lift card'}
        </button>
        <span data-testid="flight-pres">presentation: {pres}</span>
        <span data-testid="flight-count">clicks: {count}</span>
      </div>

      <Surface
        canvasId={CANVAS_ID}
        inScene={inScene}
        size={FLIGHT_SIZE}
        segments={[12, 12]}
        shadow={FLIGHT_SHADOW}
        material={flightCardManifest}
        uniforms={initialFlightUniforms}
        onFrame={handleFrame}
        onPresentationChange={handlePres}
      >
        <div className="gpu-flight-card" data-testid="flight-card-root">
          <div className="gpu-flight-header">
            <span>Flight MN-204</span>
            <span>On time</span>
          </div>
          <input
            data-testid="flight-note"
            className="gpu-flight-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Flight note"
          />
          <div className="gpu-flight-footer">
            <span>Seat 14A</span>
            <button
              type="button"
              data-testid="flight-action"
              className="gpu-studio-btn"
              onClick={() => setCount((c) => c + 1)}
            >
              Check in ({count})
            </button>
          </div>
        </div>
      </Surface>
    </div>
  )
}

interface FisheyePanelProps {
  readonly onPresChange: (p: SurfacePresentation) => void
  readonly focusRowRef: React.MutableRefObject<number | null>
  readonly fisheyeRef: React.MutableRefObject<{
    pose: SurfacePose
    viewport: GpuViewport
    focusDomY: number
    amp: number
  } | null>
}

function FisheyePanel({ onPresChange, focusRowRef, fisheyeRef }: FisheyePanelProps) {
  const [filter, setFilter] = useState('')
  const [clickedRow, setClickedRow] = useState<number | null>(null)
  const [doneClicks, setDoneClicks] = useState(0)
  const slopeRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const lensRef = useRef<Float32Array<ArrayBuffer> | null>(null)

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return FISHEYE_ROWS
    return FISHEYE_ROWS.filter((r) => `${r.id} ${r.title}`.toLowerCase().includes(q))
  }, [filter])

  const focusSpring = useMemo(() => createSpring(FISHEYE_SIZE[1] / 2, SPRING_FISHEYE), [])
  const ampSpring = useMemo(() => createSpring(1, SPRING_FISHEYE), [])

  const handleFrame = useCallback(
    (ctx: SurfaceFrameContext) => {
      ctx.setPose(ctx.basePose)
      const activeRow = focusRowRef.current
      const targetY = activeRow !== null ? FISHEYE_HEADER_H + (activeRow + 0.5) * FISHEYE_ROW_H : FISHEYE_SIZE[1] / 2
      const targetAmp = activeRow !== null ? FISHEYE_PARAMS.amplitude : 1
      focusSpring.setTarget(targetY)
      ampSpring.setTarget(targetAmp)
      const fActive = focusSpring.step(ctx.dtMs)
      const aActive = ampSpring.step(ctx.dtMs)
      const focusDomY = focusSpring.get().value
      const amp = ampSpring.get().value
      fisheyeRef.current = { pose: ctx.basePose, viewport: ctx.viewport, focusDomY, amp }

      const vCount = ctx.geometry.vertexCount
      let slopes = slopeRef.current
      let lenses = lensRef.current
      if (!slopes || !lenses || slopes.length !== vCount) {
        slopes = new Float32Array(vCount)
        lenses = new Float32Array(vCount)
        slopeRef.current = slopes
        lensRef.current = lenses
      }
      const h = FISHEYE_SIZE[1]
      ctx.deform((lx, ly, i) => {
        const domY = h / 2 - ly
        const scale = fisheyeScale(domY, focusDomY, amp, FISHEYE_PARAMS)
        const warpedDomY = fisheyeDisplace(domY, focusDomY, amp, FISHEYE_PARAMS)
        const warpedX = fisheyeDisplaceX(lx, domY, focusDomY, amp, FISHEYE_PARAMS)
        slopes[i] = (scale - 1) * Math.sign(focusDomY - domY || 1) * 0.45
        lenses[i] = Math.max(0, (scale - 1) / Math.max(0.01, FISHEYE_PARAMS.amplitude - 1)) * 0.5
        return { x: warpedX, y: h / 2 - warpedDomY, z: lenses[i] * 18 }
      })
      ctx.setExtraAttribute(0, slopes)
      ctx.setExtraAttribute(1, lenses)
      return fActive || aActive
    },
    [focusRowRef, fisheyeRef, focusSpring, ampSpring],
  )

  return (
    <div className="gpu-studio-stage">
      <div className="gpu-studio-controls">
        <span data-testid="fisheye-clicked">row: {clickedRow ?? 'none'}</span>
        <span data-testid="fisheye-done-count">done: {doneClicks}</span>
        <span data-testid="fisheye-visible-count">rows: {filtered.length}</span>
      </div>

      <div className="gpu-fisheye-wrap">
        <Surface
          canvasId={CANVAS_ID}
          inScene
          size={FISHEYE_SIZE}
          segments={[2, 48]}
          material={fisheyeLensManifest}
          onFrame={handleFrame}
          onPresentationChange={onPresChange}
        >
        <div
          className="gpu-fisheye-panel"
          onMouseLeave={() => {
            focusRowRef.current = null
            requestGpuFrame(CANVAS_ID)
          }}
        >
          <div className="gpu-fisheye-header">
            <input
              data-testid="fisheye-filter"
              className="gpu-fisheye-filter"
              placeholder="Filter items..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          {filtered.map((row, i) => (
            <div
              key={row.id}
              data-testid={`fisheye-row-${i}`}
              className="gpu-fisheye-row"
              onMouseEnter={() => {
                focusRowRef.current = i
                requestGpuFrame(CANVAS_ID)
              }}
              onClick={() => setClickedRow(i)}
            >
              <span className="gpu-fisheye-row-title">
                {row.id} {row.title}
              </span>
              <button
                type="button"
                data-testid={`fisheye-done-${i}`}
                className="gpu-fisheye-done"
                onClick={(e) => {
                  e.stopPropagation()
                  setDoneClicks((n) => n + 1)
                }}
              >
                Done
              </button>
            </div>
          ))}
        </div>
        </Surface>
      </div>
    </div>
  )
}

function localOffsetInCard(panelSelector: string, childSelector: string, size: readonly [number, number]) {
  const panel = document.querySelector(panelSelector)
  const child = document.querySelector(childSelector)
  if (!panel || !child) return null
  const pr = panel.getBoundingClientRect()
  const cr = child.getBoundingClientRect()
  const cx = cr.left + cr.width / 2 - pr.left - size[0] / 2
  const cy = size[1] / 2 - (cr.top + cr.height / 2 - pr.top)
  return { cx, cy, domY: cr.top + cr.height / 2 - pr.top }
}

export function GpuStudioApp() {
  const [tab, setTab] = useState<StudioTab>(readInitialTab)
  const [pres, setPres] = useState<SurfacePresentation>('page')
  const [stats, setStats] = useState<GpuHostStats>(() => getGpuHostStats(CANVAS_ID))
  const light = useMemo(() => ({ key: createSurfaceLight({ follow: 'pointer' }) }), [])

  const flightRef = useRef<{ pose: SurfacePose; viewport: GpuViewport } | null>(null)
  const fisheyeFocusRef = useRef<number | null>(null)
  const fisheyeRef = useRef<{
    pose: SurfacePose
    viewport: GpuViewport
    focusDomY: number
    amp: number
  } | null>(null)
  const genieDebugRef = useRef<(() => GenieDebugSnapshot) | null>(null)
  const genieToggleRef = useRef<(() => void) | null>(null)
  const presRef = useRef<SurfacePresentation>(pres)
  presRef.current = pres

  useEffect(() => {
    window.__gpuStudio = {
      stats: () => ({
        ...getGpuHostStats(CANVAS_ID),
        paints: paintStats().reduce((total, entry) => total + entry.paints, 0),
      }),
      capability: () => detectHtmlInCanvas(),
      simulateLoss: () => simulateGpuDeviceLoss(CANVAS_ID),
      presentation: () => presRef.current,
      setFisheyeFocus: (row) => {
        fisheyeFocusRef.current = row
        requestGpuFrame(CANVAS_ID)
      },
      flightCornerPoint: () => {
        const snap = flightRef.current
        if (!snap) return null
        return projectSurfaceLocalPoint(snap.pose, -FLIGHT_SIZE[0] / 2 + 2, FLIGHT_SIZE[1] / 2 - 2, 0, snap.viewport)
      },
      flightActionPoint: () => {
        const snap = flightRef.current
        if (!snap) return null
        const off = localOffsetInCard('[data-testid="flight-card-root"]', '[data-testid="flight-action"]', FLIGHT_SIZE)
        if (!off) return null
        return projectSurfaceLocalPoint(snap.pose, off.cx, off.cy, 0, snap.viewport)
      },
      flightShadowSamplePoint: () => {
        const snap = flightRef.current
        if (!snap) return null
        return projectSurfaceLocalPoint(
          { ...snap.pose, z: 0, rx: 0, ry: 0, rz: 0 },
          FLIGHT_SIZE[0] / 2 + 16,
          -FLIGHT_SIZE[1] / 2 + 24,
          -0.5,
          snap.viewport,
        )
      },
      fisheyePoint: (rowIndex, target = 'row') => {
        const snap = fisheyeRef.current
        if (!snap) return null
        const sel = target === 'done' ? `[data-testid="fisheye-done-${rowIndex}"]` : `[data-testid="fisheye-row-${rowIndex}"]`
        const off = localOffsetInCard('.gpu-fisheye-panel', sel, FISHEYE_SIZE)
        const baseX = target === 'done' && off ? off.cx : -40
        const domY = off ? off.domY : FISHEYE_HEADER_H + (rowIndex + 0.5) * FISHEYE_ROW_H
        const warpedDomY = fisheyeDisplace(domY, snap.focusDomY, snap.amp, FISHEYE_PARAMS)
        const warpedX = fisheyeDisplaceX(baseX, domY, snap.focusDomY, snap.amp, FISHEYE_PARAMS)
        return projectSurfaceLocalPoint(snap.pose, warpedX, FISHEYE_SIZE[1] / 2 - warpedDomY, 0, snap.viewport)
      },
      fisheyeState: () => {
        const snap = fisheyeRef.current
        return snap ? { focusDomY: snap.focusDomY, amp: snap.amp } : null
      },
      genieState: () => genieDebugRef.current?.() ?? null,
      toggleGenie: () => genieToggleRef.current?.(),
    }
    return () => {
      delete window.__gpuStudio
    }
  }, [])

  const refreshStats = () => setStats(getGpuHostStats(CANVAS_ID))

  return (
    <div className="gpu-studio-root">
      <SurfaceCanvas
        id={CANVAS_ID}
        frameloop="demand"
        pointerMode="surfaces"
        lighting={light}
        style={{ width: '100%', minHeight: '100vh' }}
      >
        <div className="gpu-studio-canvas-wrap">
          <header className="gpu-studio-topbar">
            <div className="gpu-studio-brand">
              <h1>Munari GPU Studio</h1>
              <span className="gpu-studio-badge">@petepetrash/munari/gpu</span>
            </div>

            <div className="gpu-studio-tabs">
              {(['flight', 'fisheye', 'materials', 'genie'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  data-testid={`tab-${t}`}
                  className="gpu-studio-tab"
                  aria-pressed={tab === t}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="gpu-studio-actions">
              <span data-testid="studio-renders">renders: {stats.renderCount}</span>
              <button type="button" className="gpu-studio-btn" onClick={refreshStats}>
                Refresh stats
              </button>
              <button
                type="button"
                data-testid="simulate-loss"
                className="gpu-studio-btn"
                onClick={() => simulateGpuDeviceLoss(CANVAS_ID)}
              >
                Simulate device loss
              </button>
            </div>
          </header>

          {tab === 'flight' && <FlightPanel onPresChange={setPres} flightRef={flightRef} />}
          {tab === 'fisheye' && (
            <FisheyePanel
              onPresChange={setPres}
              focusRowRef={fisheyeFocusRef}
              fisheyeRef={fisheyeRef}
            />
          )}
          {tab === 'materials' && <MaterialsPanel canvasId={CANVAS_ID} onPresChange={setPres} />}
          {tab === 'genie' && (
            <GeniePanel
              canvasId={CANVAS_ID}
              onPresChange={setPres}
              debugRef={genieDebugRef}
              toggleRef={genieToggleRef}
            />
          )}
        </div>
      </SurfaceCanvas>
    </div>
  )
}
