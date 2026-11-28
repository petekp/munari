// The slider scene — a trim track scrubbed under traveling glass.
//
// The pragmatic claim: a 500px track over 5,000ms sets its tick labels at 7px —
// unreadable flat. Hovering, the lens follows the cursor; holding the thumb, it
// rides the thumb so the magnified ruler travels with the scrub 1:1.
//
// Ownership: `@petepetrash/munari/gpu` (`SurfaceCanvas` + `Surface`) owns capture,
// displaced vertex raycasting, and demand scheduling; `sliderLens.material.gen.ts`
// shades the lens; this file owns drive state and the trim track DOM.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
} from '../fisheye/fisheyeLaw'
import { sliderLensManifest } from './sliderLens.material.gen'
import './slider.css'

const CANVAS_ID = 'munari-slider'
const FOV = 42
const PANEL_W = 560
const PANEL_H = 84
const MID = PANEL_H / 2
const TRACK_X0 = 30
const TRACK_LEN = 500
const RANGE_MS = 5000
const MS_PER_PX = RANGE_MS / TRACK_LEN
const MINOR_PX = 5
const MAJOR_EVERY = 10
const THUMB_W = 14
const START_MS = 2600
const GRID_X = 280
const GRID_Y = 2
const GRACE = 32
const TAU_MS = 90
const LENS_HEIGHT = 40

const contentXForMs = (ms: number) => TRACK_X0 + ms / MS_PER_PX

interface SliderDrive {
  focus: number
  amp: number
  ampTarget: number
  locked: boolean
  grabbed: boolean
  grabOffset: number | null
}

interface ProbePoint {
  x: number
  y: number
  flatX: number
  flatY: number
}

export interface SliderProbeApi {
  ready: boolean
  state(): {
    value: number
    focus: number
    amp: number
    ampTarget: number
    locked: boolean
    grabbed: boolean
    presented: string | null
  }
  lock(focus: number, amp: number): void
  unlock(): void
  thumbPoint(): ProbePoint | null
}

function Track({ value, onGrab }: { value: number; onGrab: () => void }) {
  const ticks = useMemo(() => {
    const out: { x: number; major: boolean; label?: string }[] = []
    for (let i = 0; i * MINOR_PX <= TRACK_LEN; i++) {
      const major = i % MAJOR_EVERY === 0
      const ms = i * MINOR_PX * MS_PER_PX
      out.push({
        x: TRACK_X0 + i * MINOR_PX,
        major,
        label: major ? `${(ms / 1000).toFixed(1)}s` : undefined,
      })
    }
    return out
  }, [])
  const thumbX = contentXForMs(value)
  return (
    <div className="lslider-panel" style={{ width: PANEL_W, height: PANEL_H }}>
      <div className="lslider-rail" style={{ left: TRACK_X0, width: TRACK_LEN }} />
      <div className="lslider-fill" style={{ left: TRACK_X0, width: Math.max(0, thumbX - TRACK_X0) }} />
      {ticks.map((t) => (
        <span key={t.x} className="lslider-tick" data-major={t.major || undefined} style={{ left: t.x }} />
      ))}
      {ticks
        .filter((t) => t.label)
        .map((t) => (
          <span key={t.x} className="lslider-label" style={{ left: t.x }}>
            {t.label}
          </span>
        ))}
      <button
        type="button"
        className="lslider-thumb"
        aria-label="trim point"
        style={{ left: thumbX, width: THUMB_W }}
        onPointerDown={onGrab}
      />
    </div>
  )
}

export function SliderApp() {
  const [value, setValue] = useState(START_MS)
  const holderRef = useRef<HTMLDivElement>(null)
  const drive = useRef<SliderDrive>({
    focus: PANEL_W / 2,
    amp: 1,
    ampTarget: 1,
    locked: false,
    grabbed: false,
    grabOffset: null,
  })
  const valueRef = useRef(value)
  valueRef.current = value
  const presRef = useRef<SurfacePresentation>('page')
  const slopeRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const lensRef = useRef<Float32Array<ArrayBuffer> | null>(null)

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!e.isTrusted) return
      const d = drive.current
      const r = holderRef.current?.getBoundingClientRect()
      if (!r) return
      if (d.grabbed) {
        const raw = (e.clientX - r.left - TRACK_X0) * MS_PER_PX
        if (d.grabOffset === null) d.grabOffset = valueRef.current - raw
        const v = Math.min(RANGE_MS, Math.max(0, raw + d.grabOffset))
        setValue(v)
        d.focus = contentXForMs(v)
        d.ampTarget = FISHEYE_DEFAULTS.amplitude
        requestGpuFrame(CANVAS_ID)
        return
      }
      if (d.locked) return
      const inside =
        e.clientX >= r.left - GRACE &&
        e.clientX <= r.right + GRACE &&
        e.clientY >= r.top - GRACE &&
        e.clientY <= r.bottom + GRACE
      d.focus = e.clientX - r.left
      d.ampTarget = inside ? FISHEYE_DEFAULTS.amplitude : 1
      if (inside || d.amp !== 1) requestGpuFrame(CANVAS_ID)
    }
    const up = (e: PointerEvent) => {
      if (!e.isTrusted) return
      drive.current.grabbed = false
      requestGpuFrame(CANVAS_ID)
    }
    window.addEventListener('pointermove', move, { capture: true })
    window.addEventListener('pointerup', up, { capture: true })
    return () => {
      window.removeEventListener('pointermove', move, { capture: true })
      window.removeEventListener('pointerup', up, { capture: true })
    }
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const probe: SliderProbeApi = {
      ready: true,
      state: () => ({
        value: valueRef.current,
        focus: drive.current.focus,
        amp: drive.current.amp,
        ampTarget: drive.current.ampTarget,
        locked: drive.current.locked,
        grabbed: drive.current.grabbed,
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
      thumbPoint: () => {
        const r = holderRef.current?.getBoundingClientRect()
        if (!r) return null
        const d = drive.current
        const cx = contentXForMs(valueRef.current)
        return {
          x: r.left + fisheyeDisplace(cx, d.focus, d.amp, FISHEYE_DEFAULTS),
          y: r.top + MID,
          flatX: r.left + cx,
          flatY: r.top + MID,
        }
      },
    }
    window.__slider = probe
    return () => {
      delete window.__slider
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
      const domY = MID - ly
      const s = Math.min(P.radius, Math.max(-P.radius, domX - d.focus))
      slopes[i] = LENS_HEIGHT * ampT * (Math.PI / (2 * P.radius)) * Math.sin((Math.PI * s) / P.radius)
      lenses[i] = (fisheyeScale(domX, d.focus, d.amp, P) - 1) / (P.amplitude - 1)
      const wx = fisheyeDisplace(domX, d.focus, d.amp, P)
      const wy = fisheyeDisplaceX(domY, domX, MID, d.focus, d.amp, P)
      return { x: wx - PANEL_W / 2, y: MID - wy, z: 0 }
    })
    ctx.setExtraAttribute(0, slopes)
    ctx.setExtraAttribute(1, lenses)
    return !d.locked && Math.abs(d.amp - d.ampTarget) >= 1e-3
  }, [])

  return (
    <SurfaceCanvas
      id={CANVAS_ID}
      frameloop="demand"
      pointerMode="surfaces"
      fov={FOV}
      style={{ width: '100%', minHeight: '100vh' }}
    >
      <div className="lslider-page">
        <div className="lslider-stage">
          <div className="lslider-caption">
            <h2>slider</h2>
            <p>
              A 5-second range on a 500px track sets its tick labels at 7px — unreadable flat. Hold
              the thumb and the glass rides it: the magnified ruler travels with the scrub, readable
              the whole way, because the magnification is uniform and the lens is anchored at the
              thumb itself.
            </p>
            <div className="lslider-readout" data-readout>
              {Math.round(value)} ms
            </div>
          </div>
          <div ref={holderRef} className="lslider-holder">
            <Surface
              canvasId={CANVAS_ID}
              inScene
              size={[PANEL_W, PANEL_H]}
              resolution={2 * FISHEYE_DEFAULTS.amplitude}
              segments={[GRID_X, GRID_Y]}
              material={sliderLensManifest}
              onFrame={onFrame}
              onPresentationChange={(p) => {
                presRef.current = p
              }}
            >
              <Track
                value={value}
                onGrab={() => {
                  drive.current.grabbed = true
                  drive.current.grabOffset = null
                  requestGpuFrame(CANVAS_ID)
                }}
              />
            </Surface>
          </div>
        </div>
      </div>
    </SurfaceCanvas>
  )
}
