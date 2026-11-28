// The fisheye scene — a triage queue too dense to read, under a glass lens
// that never stops being DOM.
//
// The law: magnification is locally uniform (fisheyeLaw.ts spreads x by the
// vertical scale). Vertices deform in 2D (`z = 0`) so displaced pixels match
// WebGPU raycasting 1:1 with fake normal lighting in `fisheyeLens.material.gen.ts`.
//
// Ownership: `@petepetrash/munari/gpu` (`SurfaceCanvas` + `Surface`) owns capture,
// vertex raycasting, and demand scheduling; this file owns drive state & queue DOM.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Surface,
  SurfaceCanvas,
  requestGpuFrame,
  type SurfaceFrameContext,
  type SurfacePresentation,
} from '@petepetrash/munari/gpu'
import {
  FISHEYE_DEFAULTS,
  fisheyeDisplace,
  fisheyeDisplaceX,
  fisheyeScale,
  fisheyeSource,
} from './fisheyeLaw'
import { fisheyeLensManifest } from '../gpu-studio/materials/fisheyeLens.material.gen'
import './fisheye.css'

const CANVAS_ID = 'munari-fisheye'
const FOV = 42
const ROW_H = 22
const HEADER_H = 36
const PANEL_W = 340
const QUEUE = [
  { id: 'M-101', title: 'Relay drops the hover twin after a scroll', tag: 'bug' },
  { id: 'M-102', title: 'Idle surfaces still schedule a paint tick', tag: 'perf' },
  { id: 'M-103', title: 'Document the premultiplied alpha rule', tag: 'docs' },
  { id: 'M-104', title: 'Crossing stalls when the source remounts', tag: 'bug' },
  { id: 'M-105', title: 'FrameSurface leaks its capture canvas', tag: 'bug' },
  { id: 'M-106', title: 'Pointer relay misses the first pointerdown', tag: 'bug' },
  { id: 'M-107', title: 'Ship a minimal quickstart for the README', tag: 'docs' },
  { id: 'M-108', title: 'Texture uploads block the main thread', tag: 'perf' },
  { id: 'M-109', title: 'Focus ring survives a webgl round-trip', tag: 'bug' },
  { id: 'M-110', title: 'Chrome measurement re-runs on every frame', tag: 'perf' },
  { id: 'M-111', title: 'Expose the paint ledger to instruments', tag: 'api' },
  { id: 'M-112', title: 'Handoff flashes white on slow captures', tag: 'bug' },
  { id: 'M-113', title: 'Relay coordinates drift under page zoom', tag: 'bug' },
  { id: 'M-114', title: 'Add a driveable crossing to the kernel', tag: 'api' },
  { id: 'M-115', title: 'Settle timing ignores reduced motion', tag: 'bug' },
  { id: 'M-116', title: 'Batch anchor rect reads per commit', tag: 'perf' },
  { id: 'M-117', title: 'Spell out the twin-hover authoring rule', tag: 'docs' },
  { id: 'M-118', title: 'Parked copy keeps stale selection paint', tag: 'bug' },
  { id: 'M-119', title: 'Let consumers pin the capture resolution', tag: 'api' },
  { id: 'M-120', title: 'Idle-zero gate flakes on hosted runners', tag: 'bug' },
  { id: 'M-121', title: 'Cache the radius mask between chromes', tag: 'perf' },
  { id: 'M-122', title: 'Relay swallows dblclick on lifted rows', tag: 'bug' },
  { id: 'M-123', title: 'Describe the lift lifecycle end to end', tag: 'docs' },
  { id: 'M-124', title: 'Wobble spring overshoots at low fps', tag: 'bug' },
  { id: 'M-125', title: 'Trim the advanced entry re-exports', tag: 'api' },
  { id: 'M-126', title: 'Landing pose lags the film by a frame', tag: 'bug' },
  { id: 'M-127', title: 'Profile the deform loop at 10k vertices', tag: 'perf' },
  { id: 'M-128', title: 'Relay should surface its drop reasons', tag: 'api' },
]
const PANEL_H = HEADER_H + QUEUE.length * ROW_H
const GRACE = 32
const TAU_MS = 90
const GRID_X = 2
const GRID_Y = 326
const LENS_HEIGHT = 40

function matchesQuery(entry: (typeof QUEUE)[number], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${entry.id} ${entry.title} ${entry.tag}`.toLowerCase().includes(q)
}

interface FisheyeDrive {
  focus: number
  amp: number
  ampTarget: number
  locked: boolean
}

export interface FisheyeClickRecord {
  row: number
  instance: string
  t: number
}

export interface FisheyeActRecord {
  row: number
  instance: string
  t: number
}

interface ProbePoint {
  x: number
  y: number
  flatX: number
  flatY: number
}

export interface FisheyeProbeApi {
  ready: boolean
  clicks: FisheyeClickRecord[]
  acts: FisheyeActRecord[]
  state(): {
    focus: number
    amp: number
    ampTarget: number
    locked: boolean
    presented: string | null
  }
  lock(focus: number, amp: number): void
  unlock(): void
  rowScreenCenter(i: number): ProbePoint | null
  actPoint(i: number): ProbePoint | null
  filterPoint(): ProbePoint | null
  filter(): { value: string; matches: number }
  sourceRowAtScreenY(y: number): number | null
  hoverRow(): number | null
}

function Queue({
  query,
  done,
  selected,
  onQuery,
  onRow,
  onDone,
}: {
  query: string
  done: ReadonlySet<number>
  selected: number | null
  onQuery: (value: string) => void
  onRow: (row: number, instance: string) => void
  onDone: (row: number, instance: string) => void
}) {
  return (
    <div className="fisheye-panel" style={{ width: PANEL_W, height: PANEL_H }}>
      <div className="fisheye-head" style={{ height: HEADER_H }}>
        <input
          className="fisheye-filter"
          type="text"
          value={query}
          placeholder="filter the queue"
          onChange={(e) => onQuery(e.target.value)}
        />
        <span className="fisheye-count">
          {QUEUE.filter((entry) => matchesQuery(entry, query)).length}/{QUEUE.length}
        </span>
      </div>
      {QUEUE.map((entry, i) => (
        <div
          key={entry.id}
          className="fisheye-row"
          data-row={i}
          data-dim={!matchesQuery(entry, query) || undefined}
          data-selected={selected === i || undefined}
          data-done={done.has(i) || undefined}
          style={{ height: ROW_H }}
          onClick={(e) => onRow(i, e.nativeEvent.isTrusted ? 'page' : 'source')}
        >
          <span className="fisheye-num">{entry.id}</span>
          <span className="fisheye-title">{entry.title}</span>
          <span className="fisheye-tag" data-tag={entry.tag}>
            {entry.tag}
          </span>
          <button
            type="button"
            className="fisheye-act"
            data-act={i}
            aria-label={`mark ${entry.id} done`}
            onClick={(e) => {
              e.stopPropagation()
              onDone(i, e.nativeEvent.isTrusted ? 'page' : 'source')
            }}
          >
            ✓
          </button>
        </div>
      ))}
    </div>
  )
}

export function FisheyeApp() {
  const [query, setQuery] = useState('')
  const [done, setDone] = useState<ReadonlySet<number>>(new Set())
  const [selected, setSelected] = useState<number | null>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const drive = useRef<FisheyeDrive>({
    focus: PANEL_H / 2,
    amp: 1,
    ampTarget: 1,
    locked: false,
  })
  const clicks = useRef<FisheyeClickRecord[]>([])
  const acts = useRef<FisheyeActRecord[]>([])
  const presRef = useRef<SurfacePresentation>('page')
  const slopeRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const lensRef = useRef<Float32Array<ArrayBuffer> | null>(null)

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!e.isTrusted) return
      const d = drive.current
      if (d.locked) return
      const r = holderRef.current?.getBoundingClientRect()
      if (!r) return
      const inside =
        e.clientX >= r.left - GRACE &&
        e.clientX <= r.right + GRACE &&
        e.clientY >= r.top - GRACE &&
        e.clientY <= r.bottom + GRACE
      d.focus = e.clientY - r.top
      d.ampTarget = inside ? FISHEYE_DEFAULTS.amplitude : 1
      if (inside || d.amp !== 1) requestGpuFrame(CANVAS_ID)
    }
    window.addEventListener('pointermove', move, { capture: true })
    return () => window.removeEventListener('pointermove', move, { capture: true })
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const panelRect = () => holderRef.current?.getBoundingClientRect() ?? null
    const toScreen = (cx: number, cy: number): ProbePoint | null => {
      const r = panelRect()
      if (!r) return null
      const d = drive.current
      return {
        x: r.left + fisheyeDisplaceX(cx, cy, PANEL_W / 2, d.focus, d.amp, FISHEYE_DEFAULTS),
        y: r.top + fisheyeDisplace(cy, d.focus, d.amp, FISHEYE_DEFAULTS),
        flatX: r.left + cx,
        flatY: r.top + cy,
      }
    }
    const parkedPoint = (selector: string): { cx: number; cy: number } | null => {
      const panel = document.querySelector('.fisheye-panel')
      const el = panel?.querySelector(selector)
      if (!panel || !el) return null
      const pr = panel.getBoundingClientRect()
      const er = el.getBoundingClientRect()
      return { cx: er.left + er.width / 2 - pr.left, cy: er.top + er.height / 2 - pr.top }
    }
    const probe: FisheyeProbeApi = {
      ready: true,
      clicks: clicks.current,
      acts: acts.current,
      state: () => ({
        focus: drive.current.focus,
        amp: drive.current.amp,
        ampTarget: drive.current.ampTarget,
        locked: drive.current.locked,
        presented: presRef.current,
      }),
      lock: (focus, amp) => {
        const d = drive.current
        d.locked = true
        d.focus = focus
        d.amp = amp
        d.ampTarget = amp
        requestGpuFrame(CANVAS_ID)
      },
      unlock: () => {
        drive.current.locked = false
        requestGpuFrame(CANVAS_ID)
      },
      rowScreenCenter: (i) => {
        if (i < 0 || i >= QUEUE.length) return null
        return toScreen(PANEL_W / 2, HEADER_H + (i + 0.5) * ROW_H)
      },
      actPoint: (i) => {
        const p = parkedPoint(`[data-act="${i}"]`)
        return p ? toScreen(p.cx, p.cy) : null
      },
      filterPoint: () => {
        const p = parkedPoint('.fisheye-filter')
        return p ? toScreen(p.cx, p.cy) : null
      },
      filter: () => {
        const input = document.querySelector('.fisheye-panel .fisheye-filter')
        const value = input instanceof HTMLInputElement ? input.value : ''
        return { value, matches: QUEUE.filter((e) => matchesQuery(e, value)).length }
      },
      sourceRowAtScreenY: (y) => {
        const r = panelRect()
        if (!r) return null
        const d = drive.current
        const source = fisheyeSource(y - r.top, d.focus, d.amp, FISHEYE_DEFAULTS)
        const row = Math.floor((source - HEADER_H) / ROW_H)
        return row >= 0 && row < QUEUE.length ? row : null
      },
      hoverRow: () => {
        const hovered = document.querySelector('.fisheye-panel [data-row][data-hover]')
        const row = hovered?.getAttribute('data-row')
        return row === null || row === undefined ? null : Number(row)
      },
    }
    window.__fisheye = probe
    return () => {
      delete window.__fisheye
    }
  }, [])

  const onFrame = useCallback((ctx: SurfaceFrameContext) => {
    const d = drive.current
    const dt = Math.min(ctx.dtMs, 1000 / 30)
    if (!d.locked) {
      d.amp += (d.ampTarget - d.amp) * (1 - Math.exp(-dt / TAU_MS))
      if (Math.abs(d.amp - d.ampTarget) < 1e-3) d.amp = d.ampTarget
    }

    const vCount = ctx.geometry.vertexCount
    let slopes = slopeRef.current
    let lenses = lensRef.current
    if (!slopes || !lenses || slopes.length !== vCount) {
      slopes = new Float32Array(vCount)
      lenses = new Float32Array(vCount)
      slopeRef.current = slopes
      lensRef.current = lenses
    }

    const P = FISHEYE_DEFAULTS
    const ampT = (d.amp - 1) / (P.amplitude - 1)
    ctx.deform((lx, ly, i) => {
      const domX = lx + PANEL_W / 2
      const domY = PANEL_H / 2 - ly
      const s = Math.min(P.radius, Math.max(-P.radius, domY - d.focus))
      slopes[i] = -LENS_HEIGHT * ampT * (Math.PI / (2 * P.radius)) * Math.sin((Math.PI * s) / P.radius)
      lenses[i] = (fisheyeScale(domY, d.focus, d.amp, P) - 1) / (P.amplitude - 1)
      const wx = fisheyeDisplaceX(domX, domY, PANEL_W / 2, d.focus, d.amp, P)
      const wy = fisheyeDisplace(domY, d.focus, d.amp, P)
      return { x: wx - PANEL_W / 2, y: PANEL_H / 2 - wy, z: 0 }
    })
    ctx.setExtraAttribute(0, slopes)
    ctx.setExtraAttribute(1, lenses)
    return !d.locked && Math.abs(d.amp - d.ampTarget) >= 1e-3
  }, [])

  const onRow = (row: number, instance: string) => {
    clicks.current.push({ row, instance, t: performance.now() })
    setSelected((prev) => (prev === row ? null : row))
  }
  const onDone = (row: number, instance: string) => {
    acts.current.push({ row, instance, t: performance.now() })
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(row)) next.delete(row)
      else next.add(row)
      return next
    })
  }

  return (
    <SurfaceCanvas
      id={CANVAS_ID}
      frameloop="demand"
      pointerMode="surfaces"
      fov={FOV}
      style={{ width: '100%', minHeight: '100vh' }}
    >
      <div className="fisheye-page">
        <div className="fisheye-stage">
          <div className="fisheye-caption">
            <h2>fisheye</h2>
            <p>
              A 28-row queue set too small to read, under a glass lens that magnifies uniformly —
              text gets bigger, never taller. Every row stays live DOM: filter it, mark rows done,
              click through the bulge. The lens bends the mesh's vertices, so the hand and the eye
              always agree.
            </p>
          </div>
          <div ref={holderRef} className="fisheye-holder">
            <Surface
              canvasId={CANVAS_ID}
              inScene
              size={[PANEL_W, PANEL_H]}
              resolution={2 * FISHEYE_DEFAULTS.amplitude}
              segments={[GRID_X, GRID_Y]}
              material={fisheyeLensManifest}
              onFrame={onFrame}
              onPresentationChange={(p) => {
                presRef.current = p
              }}
            >
              <Queue
                query={query}
                done={done}
                selected={selected}
                onQuery={setQuery}
                onRow={onRow}
                onDone={onDone}
              />
            </Surface>
          </div>
        </div>
      </div>
    </SurfaceCanvas>
  )
}
