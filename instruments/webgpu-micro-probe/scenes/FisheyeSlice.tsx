import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { paintStats } from '@munari/core'
import {
  MicroCanvas,
  MicroSurface,
  getMicroHostStats,
  type MicroMaterialFactory,
  type MicroSurfaceFrameCtx,
} from '../engine/reactHost'
import {
  FISHEYE_DEFAULTS,
  fisheyeDisplace,
  fisheyeDisplaceX,
  fisheyeScale,
  fisheyeSource,
} from './fisheyeLaw'
import { FISHEYE_WGSL } from './fisheyeWgsl'
import './fisheye.css'

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
] as const
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
  readonly row: number
  readonly instance: string
  readonly t: number
}

export interface FisheyeActRecord {
  readonly row: number
  readonly instance: string
  readonly t: number
}

export interface ProbePoint {
  readonly x: number
  readonly y: number
  readonly flatX: number
  readonly flatY: number
}

export interface FisheyeMicroProbeApi {
  readonly ready: boolean
  readonly clicks: FisheyeClickRecord[]
  readonly acts: FisheyeActRecord[]
  state(): {
    readonly focus: number
    readonly amp: number
    readonly ampTarget: number
    readonly locked: boolean
    readonly presented: string | null
  }
  lock(focus: number, amp: number): void
  unlock(): void
  rowScreenCenter(i: number): ProbePoint | null
  actPoint(i: number): ProbePoint | null
  filterPoint(): ProbePoint | null
  filter(): { readonly value: string; readonly matches: number }
  sourceRowAtScreenY(y: number): number | null
  hoverRow(): number | null
  stats(): { readonly renderCount: number; readonly workClaims: number; readonly paints: number }
}

declare global {
  interface Window {
    __fisheyeMicro?: FisheyeMicroProbeApi
  }
}

export function FisheyeSlice({ materialFactory }: { readonly materialFactory?: MicroMaterialFactory }) {
  const [query, setQuery] = useState('')
  const [done, setDone] = useState<ReadonlySet<number>>(() => new Set())
  const [selected, setSelected] = useState<number | null>(null)
  const [lensLive, setLensLive] = useState(false)
  const [presented, setPresented] = useState<'page' | 'scene' | 'none'>('page')
  const presentedRef = useRef<'page' | 'scene' | 'none'>('page')
  presentedRef.current = presented

  const holderRef = useRef<HTMLDivElement>(null)
  const drive = useRef<FisheyeDrive>({
    focus: PANEL_H / 2,
    amp: 1,
    ampTarget: 1,
    locked: false,
  })
  const clicks = useRef<FisheyeClickRecord[]>([])
  const acts = useRef<FisheyeActRecord[]>([])
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
      if (inside || d.amp !== 1) setLensLive(true)
    }
    window.addEventListener('pointermove', move, { capture: true })
    return () => window.removeEventListener('pointermove', move, { capture: true })
  }, [])

  const onFrame = useCallback((ctx: MicroSurfaceFrameCtx) => {
    const d = drive.current
    if (!d.locked) {
      d.amp += (d.ampTarget - d.amp) * (1 - Math.exp(-ctx.dtMs / TAU_MS))
      if (Math.abs(d.amp - d.ampTarget) < 1e-3) d.amp = d.ampTarget
    }
    const count = ctx.geometry.vertexCount
    if (!slopeRef.current || slopeRef.current.length !== count) {
      slopeRef.current = new Float32Array(count)
    }
    if (!lensRef.current || lensRef.current.length !== count) {
      lensRef.current = new Float32Array(count)
    }
    const slopeArr = slopeRef.current
    const lensArr = lensRef.current
    const P = FISHEYE_DEFAULTS
    const ampT = (d.amp - 1) / (P.amplitude - 1)
    ctx.deform((x, y, i) => {
      const s = Math.min(P.radius, Math.max(-P.radius, y - d.focus))
      slopeArr[i] = -LENS_HEIGHT * ampT * (Math.PI / (2 * P.radius)) * Math.sin((Math.PI * s) / P.radius)
      lensArr[i] = (fisheyeScale(y, d.focus, d.amp, P) - 1) / (P.amplitude - 1)
      return {
        x: fisheyeDisplaceX(x, y, PANEL_W / 2, d.focus, d.amp, P),
        y: fisheyeDisplace(y, d.focus, d.amp, P),
      }
    })
    ctx.setExtraAttribute(2, slopeArr)
    ctx.setExtraAttribute(3, lensArr)
    if (d.amp === 1 && d.ampTarget === 1 && !d.locked) {
      setLensLive(false)
    }
  }, [])

  useEffect(() => {
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
    const parkedPoint = (selector: string): { readonly cx: number; readonly cy: number } | null => {
      const panel = document.querySelector('canvas[data-munari-parked] .fisheye-panel')
      const el = panel?.querySelector(selector)
      if (!panel || !el) return null
      const pr = panel.getBoundingClientRect()
      const er = el.getBoundingClientRect()
      return { cx: er.left + er.width / 2 - pr.left, cy: er.top + er.height / 2 - pr.top }
    }
    const probe: FisheyeMicroProbeApi = {
      ready: true,
      clicks: clicks.current,
      acts: acts.current,
      state: () => ({
        focus: drive.current.focus,
        amp: drive.current.amp,
        ampTarget: drive.current.ampTarget,
        locked: drive.current.locked,
        presented: presentedRef.current,
      }),
      lock: (focus, amp) => {
        const d = drive.current
        d.locked = true
        d.focus = focus
        d.amp = amp
        d.ampTarget = amp
        setLensLive(true)
      },
      unlock: () => {
        drive.current.locked = false
        setLensLive(true)
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
        const input = document.querySelector('canvas[data-munari-parked] .fisheye-filter')
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
        const hovered = document.querySelector('canvas[data-munari-parked] [data-row][data-hover]')
        const row = hovered?.getAttribute('data-row')
        return row === null || row === undefined ? null : Number(row)
      },
      stats: () => {
        const host = getMicroHostStats()
        const paints = paintStats().reduce((sum, s) => sum + s.paints, 0)
        return { ...host, paints }
      },
    }
    window.__fisheyeMicro = probe
    return () => {
      delete window.__fisheyeMicro
    }
  }, [])

  const materialOptions = useMemo(
    () => ({
      wgsl: FISHEYE_WGSL,
      sampleViewFormat: 'rgba8unorm' as const,
      extraVertexSlots: [
        { shaderLocation: 2, format: 'float32' as const },
        { shaderLocation: 3, format: 'float32' as const },
      ],
    }),
    [],
  )

  return (
    <div className="fisheye-page">
      <MicroCanvas
        frameloop={lensLive ? 'always' : 'demand'}
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0, zIndex: 20 }}
      />
      <div className="fisheye-stage">
        <div className="fisheye-holder" ref={holderRef}>
          <MicroSurface
            inScene
            size={[PANEL_W, PANEL_H]}
            segments={[GRID_X, GRID_Y]}
            material={materialOptions}
            materialFactory={materialFactory}
            onFrame={onFrame}
            onPresentationChange={setPresented}
          >
            <div className="fisheye-panel" style={{ width: PANEL_W, height: PANEL_H }}>
              <div className="fisheye-head" style={{ height: HEADER_H }}>
                <input
                  className="fisheye-filter"
                  type="text"
                  value={query}
                  placeholder="filter the queue"
                  onChange={(e) => setQuery(e.target.value)}
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
                  onClick={(event) => {
                    clicks.current.push({
                      row: i,
                      instance: event.currentTarget.closest('canvas') ? 'source' : 'page',
                      t: performance.now(),
                    })
                    setSelected((prev) => (prev === i ? null : i))
                  }}
                >
                  <span className="fisheye-num">{entry.id}</span>
                  <span className="fisheye-title">{entry.title}</span>
                  <button
                    type="button"
                    className="fisheye-act"
                    data-act={i}
                    onClick={(e) => {
                      e.stopPropagation()
                      acts.current.push({
                        row: i,
                        instance: e.currentTarget.closest('canvas') ? 'source' : 'page',
                        t: performance.now(),
                      })
                      setDone((prev) => {
                        const next = new Set(prev)
                        if (next.has(i)) next.delete(i)
                        else next.add(i)
                        return next
                      })
                    }}
                  >
                    ✓
                  </button>
                </div>
              ))}
            </div>
          </MicroSurface>
        </div>
      </div>
    </div>
  )
}
