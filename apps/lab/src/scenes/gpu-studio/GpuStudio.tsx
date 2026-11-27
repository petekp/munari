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
  simulateGpuDeviceLoss,
  type GpuHostStats,
  type GpuViewport,
  type SurfaceFinish,
  type SurfaceFrameContext,
  type SurfacePose,
  type SurfacePresentation,
} from '@petepetrash/munari/gpu'
import { fisheyeLensManifest } from './materials/fisheyeLens.material.gen'
import { flightCardManifest } from './materials/flightCard.material.gen'
import { foilManifest } from './materials/foil.material.gen'
import { glassRefractManifest } from './materials/glassRefract.material.gen'
import {
  FISHEYE_PARAMS,
  domMatchPose,
  fisheyeDisplace,
  fisheyeDisplaceX,
  fisheyeScale,
  projectSurfaceLocalPoint,
} from './gpuStudioLaw'
import './gpuStudio.css'

const CANVAS_ID = 'gpu-studio'
type StudioTab = 'flight' | 'fisheye' | 'materials'

const FLIGHT_SIZE: readonly [number, number] = [340, 200]
const FISHEYE_SIZE: readonly [number, number] = [360, 652]
const FISHEYE_HEADER_H = 36
const FISHEYE_ROW_H = 22
const FISHEYE_ROWS = Array.from({ length: 28 }, (_, i) => ({
  id: `M-${101 + i}`,
  title: `Surface queue item ${i + 1}`,
}))

const LACQUER_FINISH: SurfaceFinish = {
  color: '#7d1924',
  roughness: 0.14,
  metalness: 0,
  coat: { amount: 1, roughness: 0.04 },
  specularIntensity: 0,
  text: 'lit',
  lightGain: 1,
}

const VELVET_FINISH: SurfaceFinish = {
  color: '#1b2247',
  roughness: 0.85,
  metalness: 0,
  sheen: { amount: 0.9, roughness: 0.35, color: '#6b77d4' },
  lightGain: 2.5,
}

const GLASS_FINISH: SurfaceFinish = {
  color: '#dce8f8',
  roughness: 0.18,
  metalness: 0,
  transmission: { amount: 0.65, thickness: 18, dispersion: 0.25 },
  coat: { amount: 0.8, roughness: 0.08 },
  text: 'lit',
}

export interface GpuStudioHandle {
  readonly stats: () => GpuHostStats & { readonly paints: number }
  readonly capability: () => ReturnType<typeof detectHtmlInCanvas>
  readonly simulateLoss: () => boolean
  readonly presentation: () => SurfacePresentation
  readonly setFisheyeFocus: (rowIndex: number | null) => void
  readonly flightCornerPoint: () => { readonly x: number; readonly y: number } | null
  readonly flightActionPoint: () => { readonly x: number; readonly y: number } | null
  readonly fisheyePoint: (rowIndex: number, target?: 'row' | 'done') => { readonly x: number; readonly y: number } | null
}

declare global {
  interface Window {
    __gpuStudio?: GpuStudioHandle
  }
}

function readInitialTab(): StudioTab {
  const q = new URLSearchParams(window.location.search).get('tab')
  if (q === 'fisheye' || q === 'materials') return q
  return 'flight'
}

interface FlightPanelProps {
  readonly onPresChange: (p: SurfacePresentation) => void
  readonly flightRef: React.MutableRefObject<{ pose: SurfacePose; viewport: GpuViewport } | null>
}

function FlightPanel({ onPresChange, flightRef }: FlightPanelProps) {
  const [lifted, setLifted] = useState(true)
  const [note, setNote] = useState('Check Gate B14')
  const [count, setCount] = useState(0)
  const [pres, setPres] = useState<SurfacePresentation>('page')

  const flightUniforms = useMemo(
    () => ({
      aeroDir: [0.6, -0.8],
      aeroAmt: lifted ? 18 : 0,
      aeroReach: 170,
      gloss: lifted ? 0.5 : 0,
    }),
    [lifted],
  )

  const handleFrame = useCallback(
    (ctx: SurfaceFrameContext) => {
      if (!ctx.pageRect) return
      const base = domMatchPose(ctx.pageRect, ctx.viewport)
      const pose: SurfacePose = lifted
        ? { ...base, x: base.x + 14, y: base.y + 10, z: 32, rx: -0.04, ry: 0.06 }
        : base
      ctx.setPose(pose)
      flightRef.current = { pose, viewport: ctx.viewport }
    },
    [lifted, flightRef],
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
        inScene={lifted}
        size={FLIGHT_SIZE}
        segments={[12, 12]}
        material={flightCardManifest}
        uniforms={flightUniforms}
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

  const handleFrame = useCallback(
    (ctx: SurfaceFrameContext) => {
      const base = ctx.pageRect ? domMatchPose(ctx.pageRect, ctx.viewport) : { x: 0, y: 0, z: 0 }
      ctx.setPose(base)
      const activeRow = focusRowRef.current
      const focusDomY = activeRow !== null ? FISHEYE_HEADER_H + (activeRow + 0.5) * FISHEYE_ROW_H : FISHEYE_SIZE[1] / 2
      const amp = activeRow !== null ? FISHEYE_PARAMS.amplitude : 1
      fisheyeRef.current = { pose: base, viewport: ctx.viewport, focusDomY, amp }

      const vCount = ctx.geometry.vertexCount
      if (!slopeRef.current || slopeRef.current.length !== vCount) {
        slopeRef.current = new Float32Array(vCount)
        lensRef.current = new Float32Array(vCount)
      }
      const slopes = slopeRef.current
      const lenses = lensRef.current!
      const h = FISHEYE_SIZE[1]
      ctx.deform((lx, ly, i) => {
        const domY = h / 2 - ly
        const scale = fisheyeScale(domY, focusDomY, amp, FISHEYE_PARAMS)
        const warpedDomY = fisheyeDisplace(domY, focusDomY, amp, FISHEYE_PARAMS)
        const warpedX = fisheyeDisplaceX(lx, domY, focusDomY, amp, FISHEYE_PARAMS)
        slopes[i] = (scale - 1) * Math.sign(focusDomY - domY || 1) * 0.45
        lenses[i] = Math.max(0, (scale - 1) / Math.max(0.01, FISHEYE_PARAMS.amplitude - 1)) * 0.5
        return { x: warpedX, y: h / 2 - warpedDomY, z: lenses[i]! * 18 }
      })
      ctx.setExtraAttribute(0, slopes)
      ctx.setExtraAttribute(1, lenses)
    },
    [focusRowRef, fisheyeRef],
  )

  return (
    <div className="gpu-studio-stage">
      <div className="gpu-studio-controls">
        <span data-testid="fisheye-clicked">row: {clickedRow ?? 'none'}</span>
        <span data-testid="fisheye-done-count">done: {doneClicks}</span>
        <span data-testid="fisheye-visible-count">rows: {filtered.length}</span>
      </div>

      <Surface
        canvasId={CANVAS_ID}
        inScene
        size={FISHEYE_SIZE}
        segments={[2, 48]}
        material={fisheyeLensManifest}
        onFrame={handleFrame}
        onPresentationChange={onPresChange}
      >
        <div className="gpu-fisheye-panel">
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
  )
}

function MaterialsPanel({ onPresChange }: { readonly onPresChange: (p: SurfacePresentation) => void }) {
  const foilUniforms = useMemo(() => ({ tilt: [0.38, -0.24], intensity: 0.55, phase: 0.35 }), [])
  const glassUniforms = useMemo(
    () => ({ tint: [0.72, 0.9, 1.0], amount: 0.78, shift: [0.012, 0.004], highlight: 0.16 }),
    [],
  )

  const handleBackdropFrame = useCallback((ctx: SurfaceFrameContext) => {
    if (!ctx.pageRect) return
    ctx.setPose({ ...domMatchPose(ctx.pageRect, ctx.viewport), z: -12 })
  }, [])

  const handleGlassFrame = useCallback((ctx: SurfaceFrameContext) => {
    if (!ctx.pageRect) return
    ctx.setPose({ ...domMatchPose(ctx.pageRect, ctx.viewport), z: 24 })
  }, [])

  return (
    <div className="gpu-studio-stage">
      <div className="gpu-materials-grid">
        <Surface canvasId={CANVAS_ID} inScene size={[210, 150]} finish={LACQUER_FINISH} pixelSnap onPresentationChange={onPresChange}>
          <div className="gpu-finish-card" data-testid="finish-lacquer" style={{ color: '#fde8e8' }}>
            <strong>Lacquer Crimson</strong>
            <span>pixelSnap + lit text</span>
          </div>
        </Surface>

        <Surface canvasId={CANVAS_ID} inScene size={[210, 150]} finish={VELVET_FINISH}>
          <div className="gpu-finish-card" data-testid="finish-velvet" style={{ color: '#e0e7ff' }}>
            <strong>Velvet Midnight</strong>
            <span>Sheen + 2.5x key gain</span>
          </div>
        </Surface>

        <Surface canvasId={CANVAS_ID} inScene size={[210, 150]} finish={GLASS_FINISH}>
          <div className="gpu-finish-card" data-testid="finish-glass" style={{ color: '#0f172a' }}>
            <strong>Glass Frosted</strong>
            <span>LTC softbox coat</span>
          </div>
        </Surface>

        <Surface canvasId={CANVAS_ID} inScene size={[210, 150]} material={foilManifest} uniforms={foilUniforms}>
          <div className="gpu-foil-card">
            <strong>Foil Manifest</strong>
            <span>0 TypeGPU runtime</span>
          </div>
        </Surface>
      </div>

      <div className="gpu-backdrop-stage">
        <div className="gpu-backdrop-back">
          <Surface canvasId={CANVAS_ID} inScene size={[210, 120]} onFrame={handleBackdropFrame}>
            <div className="gpu-backdrop-card" data-testid="backdrop-source">
              <strong>Backdrop Signal</strong>
              <span>Pass 1 opaque</span>
            </div>
          </Surface>
        </div>
        <div className="gpu-backdrop-front">
          <Surface
            canvasId={CANVAS_ID}
            inScene
            size={[170, 120]}
            material={glassRefractManifest}
            uniforms={glassUniforms}
            onFrame={handleGlassFrame}
          >
            <div className="gpu-glass-card" data-testid="backdrop-glass">
              <strong>Glass Refract</strong>
              <span>@group(2)</span>
            </div>
          </Surface>
        </div>
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
              {(['flight', 'fisheye', 'materials'] as const).map((t) => (
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
          {tab === 'materials' && <MaterialsPanel onPresChange={setPres} />}
        </div>
      </SurfaceCanvas>
    </div>
  )
}
