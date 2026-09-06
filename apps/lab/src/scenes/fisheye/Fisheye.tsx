// The fisheye scene — a triage queue too dense to read, under a glass
// lens that never stops being DOM.
//
// The pragmatic claim: 28 rows at 10px type is more queue than a page
// can legibly show, and the lens is the fix — magnification is locally
// UNIFORM (fisheyeLaw.ts spreads x by the exact vertical scale), so
// rows under the glass get bigger, never taller, and stay readable.
// Everything under the lens is live: rows select, the done button
// marks, and the filter input takes real keystrokes — focus lands
// through a click on the warped mesh and the browser types into the
// parked source with no forwarding at all.
//
// The fault this scene exists to press on (2026-08-19, core-animation
// item 2): three raycasts CPU geometry, so a vertex-shader warp bends
// only the pixels and a click lands where the pixels are NOT — off by
// the full displacement, 60px vertically and >100px horizontally at
// this lens's defaults. The answer is `deformSurfaceGeometry`
// (decisions.md #35): the law hands it displaced content positions, it
// moves the vertices, and the raycast hits the lens the eye sees. The
// gate (instruments/fisheye-pointer) clicks real coordinates against
// both the warped and the flat prediction, on both axes.
//
// The pointer→warp loop never feeds back: the lens is anchored at its
// focus, and the focus is set from the cursor's own clientY — so the
// content under the cursor is the content a flat list would put there,
// no matter what the amplitude is doing. Displacement is what happens
// to the rows the cursor is NOT on.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  deformSurfaceGeometry,
  Surface,
  SurfaceCanvas,
  useSurfaceHandle,
  useSurfaceStatus,
  useSurfaceUniforms,
} from '@petepetrash/munari'
import { cameraDistance } from '@petepetrash/munari/advanced'
import { plainAttribute } from '../../lib/geometry'
import {
  FISHEYE_DEFAULTS,
  fisheyeDisplace,
  fisheyeDisplaceX,
  fisheyeScale,
  fisheyeSource,
} from './fisheyeLaw'
import { LENS_FRAG, LENS_LIGHT, LENS_VERT } from './fisheyeShaders'
import './fisheye.css'

const FOV = 42
// 22px rows and 10px type: deliberately below comfortable reading
// size, so the lens is doing a job, not a trick. At the default 2×
// the hovered region reads like 20px type.
const ROW_H = 22
const HEADER_H = 36
const PANEL_W = 340
// The munari tracker itself, as the queue. Several titles say "relay"
// on purpose: the gate types that word into the filter and counts.
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
// How far past the panel's box the cursor still counts as "on the
// list": the lens eases out rather than snapping off at the border.
const GRACE = 32
// Amplitude ease time constant. Short enough that the lens feels
// attached to the hand, long enough that entering the list is a swell
// rather than a pop.
const TAU_MS = 90
// A vertex every ~2px of content height, comfortably under the
// cosine's curvature. The x map is linear in x at every y, so a plane
// interpolates it exactly and horizontal segments stay minimal.
const GRID_X = 2
const GRID_Y = 326
// The bulge height the SHADING pretends (the geometry never leaves
// z = 0 — fisheyeShaders.ts says why). 40px over a 120px radius peaks
// the fake normal near 28° of tilt: enough to catch the specular
// sweep, shallow enough that the flank shade never buries the text.
const LENS_HEIGHT = 40

function matchesQuery(entry: (typeof QUEUE)[number], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${entry.id} ${entry.title} ${entry.tag}`.toLowerCase().includes(q)
}

// ── the drive box: focus, amplitude, and the probe's freeze ─────────────

interface FisheyeDrive {
  /** Lens center in content px (0 at the panel's top edge). */
  focus: number
  amp: number
  ampTarget: number
  /** The gate holds the lens still while it clicks at computed points. */
  locked: boolean
}

// ── the probe (instruments/fisheye-pointer reads this) ──────────────────

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
  /** The done button's own ledger — a row click never lands here. */
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
  /** Screen point of row i's center under the CURRENT lens, plus where a flat list would put it. */
  rowScreenCenter(i: number): ProbePoint | null
  /** Screen point of row i's done button — off the centerline, so the x law owns it. */
  actPoint(i: number): ProbePoint | null
  /** Screen point of the filter input's center. */
  filterPoint(): ProbePoint | null
  filter(): { value: string; matches: number }
  /** Which row's pixels the current lens shows at screen y — the law's answer, not the relay's. */
  sourceRowAtScreenY(y: number): number | null
  /** The row wearing the relay's data-hover twin in the parked source, if any. */
  hoverRow(): number | null
}

// ── the camera: 1 world unit = 1 CSS px ─────────────────────────────────

function PixelPerfect() {
  // SAFETY: r3f types the store's camera as the base class and hands back a
  // PerspectiveCamera unless the Canvas asks for `orthographic`, which this
  // one does not — fitting the frustum to the viewport is what makes a CSS
  // pixel a world unit, and orthographic has no fov to fit.
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  useEffect(() => {
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(size.height, FOV))
    camera.near = 1
    camera.far = camera.position.z * 3
    camera.updateProjectionMatrix()
  }, [camera, size.height])
  return null
}

// ── the glass: capture lit by the law's fake normals ────────────────────

function LensMaterial() {
  const surface = useSurfaceUniforms()
  const uniforms = useMemo(
    () => ({ ...surface, uLightDir: { value: new THREE.Vector3(...LENS_LIGHT) } }),
    [surface],
  )
  return (
    <shaderMaterial
      uniforms={uniforms}
      vertexShader={LENS_VERT}
      fragmentShader={LENS_FRAG}
      transparent
      premultipliedAlpha
      depthWrite={false}
      toneMapped={false}
    />
  )
}

// ── the warp: the law applied to vertices, every live frame ─────────────

function WarpDrive({
  drive,
  geoRef,
  onRest,
}: {
  drive: React.RefObject<FisheyeDrive>
  geoRef: React.RefObject<THREE.PlaneGeometry | null>
  onRest: () => void
}) {
  useFrame((_, delta) => {
    const d = drive.current
    const dt = Math.min(delta, 1 / 30) * 1000
    if (!d.locked) {
      d.amp += (d.ampTarget - d.amp) * (1 - Math.exp(-dt / TAU_MS))
      if (Math.abs(d.amp - d.ampTarget) < 1e-3) d.amp = d.ampTarget
    }
    const geometry = geoRef.current
    const pos = geometry ? plainAttribute(geometry, 'position') : undefined
    if (geometry && pos) {
      let slope = plainAttribute(geometry, 'aSlope')
      if (!slope || slope.count !== pos.count) {
        slope = new THREE.BufferAttribute(new Float32Array(pos.count), 1)
        geometry.setAttribute('aSlope', slope)
      }
      let lens = plainAttribute(geometry, 'aLens')
      if (!lens || lens.count !== pos.count) {
        lens = new THREE.BufferAttribute(new Float32Array(pos.count), 1)
        geometry.setAttribute('aLens', lens)
      }
      const slopeAttr = slope
      const lensAttr = lens
      const P = FISHEYE_DEFAULTS
      // The shading's fake bulge: z(y) = LENS_HEIGHT·t·cos²(πs/2R), so
      // the normal's y component is its derivative flipped into the
      // mesh's y-up space. The clamp lands sin(±π) = 0 outside the rim.
      const ampT = (d.amp - 1) / (P.amplitude - 1)
      deformSurfaceGeometry(geometry, [PANEL_W, PANEL_H], (x, y, i) => {
        const s = Math.min(P.radius, Math.max(-P.radius, y - d.focus))
        slopeAttr.setX(
          i,
          -LENS_HEIGHT * ampT * (Math.PI / (2 * P.radius)) * Math.sin((Math.PI * s) / P.radius),
        )
        lensAttr.setX(i, (fisheyeScale(y, d.focus, d.amp, P) - 1) / (P.amplitude - 1))
        return {
          x: fisheyeDisplaceX(x, y, PANEL_W / 2, d.focus, d.amp, P),
          y: fisheyeDisplace(y, d.focus, d.amp, P),
        }
      })
      slopeAttr.needsUpdate = true
      lensAttr.needsUpdate = true
    }
    if (d.amp === 1 && d.ampTarget === 1 && !d.locked) onRest()
  })
  return null
}

// ── the queue (rendered twice: page copy and parked source) ─────────────

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
          onClick={event => onRow(i, event.currentTarget.closest('canvas') ? 'source' : 'page')}
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
              onDone(i, e.currentTarget.closest('canvas') ? 'source' : 'page')
            }}
          >
            ✓
          </button>
        </div>
      ))}
    </div>
  )
}

// ── the page ─────────────────────────────────────────────────────────────

export function FisheyeApp() {
  const surface = useSurfaceHandle('fisheye-list')
  const st = useSurfaceStatus(surface)
  const [query, setQuery] = useState('')
  const [done, setDone] = useState<ReadonlySet<number>>(new Set())
  const [selected, setSelected] = useState<number | null>(null)
  // 'always' only while the lens is moving; the swap back to 'demand'
  // is WarpDrive's onRest, so an idle list costs zero frames.
  const [lensLive, setLensLive] = useState(false)
  const holderRef = useRef<HTMLDivElement>(null)
  const geoRef = useRef<THREE.PlaneGeometry>(null)
  const drive = useRef<FisheyeDrive>({
    focus: PANEL_H / 2,
    amp: 1,
    ampTarget: 1,
    locked: false,
  })
  const clicks = useRef<FisheyeClickRecord[]>([])
  const acts = useRef<FisheyeActRecord[]>([])
  // The probe closes over a ref, not over `st`: its effect runs once and
  // the gate polls between React commits.
  const stRef = useRef(st)
  stRef.current = st

  // The mesh stands where the page copy's layout box is. Measured, not
  // authored: the panel is centered by CSS and the center moves with the
  // viewport.
  const [pos, setPos] = useState<{ wx: number; wy: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const r = holderRef.current?.getBoundingClientRect()
      if (!r) return
      setPos({
        wx: r.left + r.width / 2 - window.innerWidth / 2,
        wy: window.innerHeight / 2 - (r.top + r.height / 2),
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      // The library's relays into the parked copy bubble back to window at
      // the PARKED box's coordinates; `isTrusted` is the documented default
      // guard against hearing them as the hand (relay.ts — `isRelayed` is
      // the same seam for pipelines whose real input is synthetic). Capture
      // phase, because the trusted event over the solid canvas is consumed
      // before it bubbles this high.
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

  // Diagnostic only; the gate is the consumer (devGlobals.ts).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const panelRect = () => holderRef.current?.getBoundingClientRect() ?? null
    // Both laws applied to a content point, against the live panel box.
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
    // Content coordinates read off the PARKED copy, which is the unwarped
    // twin of what the mesh presents — so the probe never hardcodes the
    // stylesheet's layout.
    const parkedPoint = (selector: string): { cx: number; cy: number } | null => {
      const host = document.querySelector(
        '[data-munari-source-host][data-munari-surface="fisheye-list"]',
      )
      const panel = host?.querySelector('.fisheye-panel')
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
        presented: stRef.current.presentation,
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
        const host = document.querySelector(
          '[data-munari-source-host][data-munari-surface="fisheye-list"]',
        )
        const input = host?.querySelector('.fisheye-filter')
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
        const hovered = document.querySelector(
          '[data-munari-source-host][data-munari-surface="fisheye-list"] [data-row][data-hover]',
        )
        const row = hovered?.getAttribute('data-row')
        return row === null || row === undefined ? null : Number(row)
      },
    }
    window.__fisheye = probe
    return () => {
      delete window.__fisheye
    }
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

  const content = (
    <Queue
      query={query}
      done={done}
      selected={selected}
      onQuery={setQuery}
      onRow={onRow}
      onDone={onDone}
    />
  )

  return (
    <div className="fisheye-page">
      <div className="fisheye-stage">
        <div className="fisheye-caption">
          <h2>fisheye</h2>
          <p>
            A 28-row queue set too small to read, under a glass lens that
            magnifies uniformly — text gets bigger, never taller. Every row
            stays live DOM: filter it, mark rows done, click through the
            bulge. The lens bends the mesh's vertices, so the hand and the
            eye always agree.
          </p>
        </div>
        <div ref={holderRef} className="fisheye-holder">
          <Surface.Root surface={surface} timing={{ settleMs: 0, durationMs: 1 }} inScene={true}>
<Surface.HTML size={[PANEL_W, PANEL_H]} resolution={2 * FISHEYE_DEFAULTS.amplitude}>{content}</Surface.HTML>

          </Surface.Root>
        </div>
      </div>

      <SurfaceCanvas
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0 }}
        gl={{ alpha: true, antialias: true }}
        frameloop={lensLive ? 'always' : 'demand'}
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => {
          state.gl.setClearAlpha(0)
          window.__r3f = state
        }}
      >
        <PixelPerfect />
        {pos && (
          <Surface.Scene surface={surface}>
          <group position={[pos.wx, pos.wy, 0]}>
            <Surface.Mesh
              surface={surface}
              placement="manual"
              alpha="source"
              frustumCulled={false}
              geometry={
                <planeGeometry ref={geoRef} args={[PANEL_W, PANEL_H, GRID_X, GRID_Y]} />
              }
              material={<LensMaterial />}
            >
              <WarpDrive drive={drive} geoRef={geoRef} onRest={() => setLensLive(false)} />
            </Surface.Mesh>
          </group>
          </Surface.Scene>
        )}
      </SurfaceCanvas>

    </div>
  )
}
