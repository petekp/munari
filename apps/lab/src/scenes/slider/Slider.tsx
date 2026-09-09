// The slider scene — a trim track scrubbed under traveling glass.
//
// The pragmatic claim: a 500px track over 5,000ms sets its tick labels
// at 7px — unreadable flat. The lens is the fix, and it never leaves
// the work: hovering, it follows the cursor; holding the thumb, it
// rides the THUMB, so the magnified ruler travels with the scrub and
// the labels stay readable the whole way. Legible because the
// magnification is locally uniform (fisheyeLaw.ts — this scene borrows
// the fisheye scene's law, turned on its side).
//
// The anchor is what makes riding the thumb exact rather than
// approximate: the lens's focus is its own fixed point, so with the
// focus pinned to the thumb, the thumb renders precisely under the
// hand and the drag maps 1:1 — the hand, the thumb, and the lens's
// center are one point, at any amplitude, mid-swell included. (A lens
// centered on the thing being steered cannot also gear the hand down;
// this scene chooses the traveling glass and keeps the mapping flat.)
//
// What this scene adds to the fisheye gate's coverage is the DRAG: a
// grab that must land on the thumb's displaced pixels (58px off flat),
// then trusted window moves driving both the value and the lens while
// the relay plays no part. The gate (instruments/slider-drag) presses,
// drags, and holds the released value and the lens's focus against the
// law's own prediction.

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
} from '../fisheye/fisheyeLaw'
import { LENS_FRAG, LENS_LIGHT, LENS_VERT } from './sliderShaders'
import './slider.css'

const FOV = 42
const PANEL_W = 560
const PANEL_H = 84
/** The rail's centerline — the vertical fixed point of the lens. */
const MID = PANEL_H / 2
// 500 track px over 5,000ms: 10ms per pixel flat, 5ms per HAND pixel
// under the held lens. The 30px aprons keep the thumb and the rim's
// bulge inside the capture at both ends.
const TRACK_X0 = 30
const TRACK_LEN = 500
const RANGE_MS = 5000
const MS_PER_PX = RANGE_MS / TRACK_LEN
// Ticks every 5px (50ms), labeled every 50px (500ms). 7px labels are
// deliberately below comfortable reading size — legible under the
// lens, not without it.
const MINOR_PX = 5
const MAJOR_EVERY = 10
const THUMB_W = 14
const START_MS = 2600
// The lens runs along x, so horizontal segments are its resolution: a
// vertex every 2px of track. The y map is linear in y at every x, so
// two vertical segments interpolate it exactly.
const GRID_X = 280
const GRID_Y = 2
const GRACE = 32
const TAU_MS = 90
// The shading's fake bulge height (sliderShaders.ts; the geometry
// never leaves z = 0). Same number as the fisheye scene's glass.
const LENS_HEIGHT = 40

const contentXForMs = (ms: number) => TRACK_X0 + ms / MS_PER_PX

// ── the drive box ────────────────────────────────────────────────────────

interface SliderDrive {
  /** Lens center in content px (0 at the panel's left edge). */
  focus: number
  amp: number
  ampTarget: number
  /** The gate holds the lens still while it aims. */
  locked: boolean
  /** A held thumb takes the anchor: the lens rides the thumb, not the cursor. */
  grabbed: boolean
  /**
   * ms between the value and the hand's flat position, captured on the
   * first trusted move of a drag. Holding it constant is what keeps a
   * grab from teleporting the value when the press lands off the
   * thumb's center — or on its displaced pixels under a held lens.
   */
  grabOffset: number | null
}

// ── the probe (instruments/slider-drag reads this) ──────────────────────

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
  /** Screen point of the thumb's center under the CURRENT lens, plus its flat position. */
  thumbPoint(): ProbePoint | null
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

// ── the glass ────────────────────────────────────────────────────────────

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

// ── the warp ─────────────────────────────────────────────────────────────

function WarpDrive({
  drive,
  geoRef,
  onRest,
}: {
  drive: React.RefObject<SliderDrive>
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
      // The fake bulge z(x) = LENS_HEIGHT·t·cos²(πs/2R); the normal's x
      // component is its derivative negated (mesh x runs with content
      // x, no flip). The clamp lands sin(±π) = 0 outside the rim.
      const ampT = (d.amp - 1) / (P.amplitude - 1)
      deformSurfaceGeometry(geometry, [PANEL_W, PANEL_H], (x, y, i) => {
        const s = Math.min(P.radius, Math.max(-P.radius, x - d.focus))
        slopeAttr.setX(
          i,
          LENS_HEIGHT * ampT * (Math.PI / (2 * P.radius)) * Math.sin((Math.PI * s) / P.radius),
        )
        lensAttr.setX(i, (fisheyeScale(x, d.focus, d.amp, P) - 1) / (P.amplitude - 1))
        return {
          x: fisheyeDisplace(x, d.focus, d.amp, P),
          y: fisheyeDisplaceX(y, x, MID, d.focus, d.amp, P),
        }
      })
      slopeAttr.needsUpdate = true
      lensAttr.needsUpdate = true
    }
    if (d.amp === 1 && d.ampTarget === 1 && !d.locked && !d.grabbed) onRest()
  })
  return null
}

// ── the track (rendered twice: page copy and parked source) ─────────────

function Track({
  value,
  onGrab,
}: {
  value: number
  onGrab: () => void
}) {
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
      <div
        className="lslider-fill"
        style={{ left: TRACK_X0, width: Math.max(0, thumbX - TRACK_X0) }}
      />
      {ticks.map((t) => (
        <span
          key={t.x}
          className="lslider-tick"
          data-major={t.major || undefined}
          style={{ left: t.x }}
        />
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

// ── the page ─────────────────────────────────────────────────────────────

export function SliderApp() {
  const surface = useSurfaceHandle('slider-track')
  const st = useSurfaceStatus(surface)
  const [value, setValue] = useState(START_MS)
  const [lensLive, setLensLive] = useState(false)
  const holderRef = useRef<HTMLDivElement>(null)
  const geoRef = useRef<THREE.PlaneGeometry>(null)
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
  const stRef = useRef(st)
  stRef.current = st

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
      // Trusted events only (relay.ts's documented default guard), capture
      // phase: the library's relays bubble back to window at the PARKED
      // box's coordinates and would poison both the focus and the drag.
      if (!e.isTrusted) return
      const d = drive.current
      const r = holderRef.current?.getBoundingClientRect()
      if (!r) return
      if (d.grabbed) {
        // The drag: the value maps 1:1 from the hand (plus the grab's
        // own offset), and the focus is pinned to the thumb — its own
        // fixed point — so the thumb renders under the cursor while the
        // glass travels with it. The amplitude holds while held: a hand
        // that strays off the track mid-scrub must not collapse the
        // lens it is using.
        const raw = (e.clientX - r.left - TRACK_X0) * MS_PER_PX
        if (d.grabOffset === null) d.grabOffset = valueRef.current - raw
        const v = Math.min(RANGE_MS, Math.max(0, raw + d.grabOffset))
        setValue(v)
        d.focus = contentXForMs(v)
        d.ampTarget = FISHEYE_DEFAULTS.amplitude
        setLensLive(true)
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
      if (inside || d.amp !== 1) setLensLive(true)
    }
    const up = (e: PointerEvent) => {
      if (!e.isTrusted) return
      drive.current.grabbed = false
    }
    window.addEventListener('pointermove', move, { capture: true })
    window.addEventListener('pointerup', up, { capture: true })
    return () => {
      window.removeEventListener('pointermove', move, { capture: true })
      window.removeEventListener('pointerup', up, { capture: true })
    }
  }, [])

  // Diagnostic only; the gate is the consumer (devGlobals.ts).
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

  const content = (
    <Track
      value={value}
      onGrab={() => {
        // Fires through the relay (a synthetic pointerdown on the thumb's
        // displaced pixels). The anchor changes hands HERE: hover's
        // cursor-follow stands down and the lens rides the thumb until
        // the trusted pointerup.
        drive.current.grabbed = true
        drive.current.grabOffset = null
        setLensLive(true)
      }}
    />
  )

  return (
    <div className="lslider-page">
      <div className="lslider-stage">
        <div className="lslider-caption">
          <h2>slider</h2>
          <p>
            A 5-second range on a 500px track sets its tick labels at 7px —
            unreadable flat. Hold the thumb and the glass rides it: the
            magnified ruler travels with the scrub, readable the whole way,
            because the magnification is uniform and the lens is anchored
            at the thumb itself.
          </p>
          <div className="lslider-readout" data-readout>
            {Math.round(value)} ms
          </div>
        </div>
        <div ref={holderRef} className="lslider-holder">
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
