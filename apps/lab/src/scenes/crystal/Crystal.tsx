// The crystal scene — the mouse pointer as a hand-sized lump of cut glass,
// lying on a live page it refracts.
//
// The law: WHAT YOU CLICK IS WHAT YOU SEE. The page is one Surface drawn as
// a full-viewport quad, and the arrow is a cut solid of glass floating 110px
// over it — an actual stone with a crown, a girdle and a pavilion, not a
// picture of one. The shader traces a ray from the camera into a crown
// facet, lets it bounce between the inside faces until its light runs out,
// and follows what escapes downward across the air gap to the page. At the
// tip the page arrives displaced by 48.1 CSS px, and over the body by 130
// (measured 2026-08-26) — the tip looks through the thinnest wedge on the
// stone, so it is the steadiest place on it and the least displaced.
// Nothing on the page moved. A click delivered at the hand's own coordinates
// would land on whatever the glass slid out of the way, so the pointer relay
// is handed the SAME trace the shader drew with. Turn it off with the switch
// and the demo becomes its own counter-example: aim at G, get B.
//
// The fault this scene exists to press on: an overlay cursor drawn in CSS
// can be any shape you like and refracts nothing, because it has no access
// to the pixels under it. A canvas cursor drawn over a screenshot refracts
// a dead picture. This one is a solid lens over a page that is still laying
// out — the clock keeps running, the keys still take clicks, and every key
// you press is a key that was read through the stone.
//
// What it costs, stated plainly: the page is a texture for its whole life,
// so there is no native text selection anywhere on it. Same as the gallery.
// Everything here is a button, which the relay carries perfectly, and the
// scene is about pointing rather than reading.
//
// Ownership: this module owns the page, the hand and the pointer
// correction. The pose is decided in `crystalMaterial.tsx` — one copy, so
// the eye and the hand cannot disagree. Shape and physics are
// `crystalLaw.ts`, pixels `crystalShaders.ts`, numbers `crystalTuning.ts`.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, SurfaceCanvas, useSurface, useSurfaceState } from '@petepetrash/munari'
import { cameraDistance } from '@petepetrash/munari/advanced'
import { showChrome } from '../../bareMode'
import { CrystalTweaks } from './CrystalTweaks'
import { CrystalMaterial, type CrystalDrive } from './crystalMaterial'
import { bendAt, tipScreenPoint, REST_FRAME, type CrystalFrame } from './crystalLaw'
import { crystalTuning as tune } from './crystalTuning'
import './crystal.css'

const FOV = 42

// One epoch for every copy of the page, so a stalled capture is
// distinguishable from ordinary drift — the same clock the refraction scene
// runs, and for the same reason.
const EPOCH = performance.now()

function useTenthSecond(): string {
  const [, bump] = useState(0)
  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [])
  return ((performance.now() - EPOCH) / 1000).toFixed(1)
}

// ── the page under the glass ───────────────────────────────────────────

// A real keyboard's rows, because the point is that you can aim at one
// letter and hit the one beside it. `KEY_PX` is what makes the miss legible:
// the bend at the hotspot is 48.1px and the pitch here is 52 including the
// gap, so an uncorrected click lands a whole key away, and downward — a
// different letter AND a different coloured row, not a near miss you could
// argue about.
const KEY_PX = 48
const ROWS = ['1234567890-=', 'QWERTYUIOP[]', "ASDFGHJKL;'\\", 'ZXCVBNM,./ ⌫'] as const

// `parked` reaches the captured tree as an attribute because CSS cannot get
// there any other way: the source host is a child of the CANVAS element, so
// no selector rooted at `.crystal-page` matches anything in here. The relay
// mirrors whatever cursor this content computes onto the canvas, and while
// the crystal is parked that has to be the real arrow again.
function Pad({ parked }: { parked: boolean }) {
  const tick = useTenthSecond()
  const [typed, setTyped] = useState('')
  const press = (ch: string) => {
    if (ch === '⌫') setTyped((s) => s.slice(0, -1))
    else setTyped((s) => (s + ch).slice(-24))
  }
  return (
    <div className="crystal-page-inner" data-parked={parked || undefined}>
      <div className="crystal-readout">
        <span className="crystal-typed">{typed || ' '}</span>
        <span className="crystal-tick">
          <i>live</i>
          {tick}s
        </span>
      </div>
      <div className="crystal-pad">
        {ROWS.map((row, r) => (
          <div key={row} className="crystal-row" data-row={r}>
            {[...row].map((ch, i) => (
              <button
                key={`${ch}${i}`}
                type="button"
                className="crystal-key"
                data-key={ch === ' ' ? 'SPACE' : ch}
                style={{ width: KEY_PX, height: KEY_PX }}
                onClick={() => press(ch === ' ' ? ' ' : ch)}
              >
                {ch === ' ' ? '␣' : ch}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── the camera: 1 world unit = 1 CSS px ────────────────────────────────

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

// ── the scene ──────────────────────────────────────────────────────────

export function CrystalApp({ chips }: { chips?: React.ReactNode }) {
  const page = useSurface('crystal-page')
  const st = useSurfaceState(page)

  const [box, setBox] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useLayoutEffect(() => {
    const measure = () => setBox({ w: window.innerWidth, h: window.innerHeight })
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const [corrected, setCorrected] = useState(true)

  // Parking, for tuning. The crystal is normally welded to the hand, which
  // makes every knob on the panel unreachable: walking the pointer over to a
  // slider drags the thing you are trying to look at along with it. So `p`
  // freezes it wherever it stands and hands the OS pointer back.
  //
  // The KEY is the control and the checkbox only reports it. Ticking a box
  // is itself a walk across the screen, so a box on its own could never park
  // the crystal anywhere you wanted it.
  const [parked, setParked] = useState(false)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'p' && e.key !== 'P') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      setParked((v) => !v)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  // Four refs, all read from inside the raycast, which runs between React
  // renders and can see no closure of its own.
  const drive = useRef<CrystalDrive>({ x: box.w / 2, y: box.h / 2 })
  // Where the hand actually is, recorded even while parked — otherwise
  // unparking leaves the crystal sitting where it was until the next
  // pointermove, which on a hand already holding still never comes.
  const hand = useRef({ x: box.w / 2, y: box.h / 2 })
  const frame = useRef<CrystalFrame>({ ...REST_FRAME, rot: [...REST_FRAME.rot] })
  const eye = useRef<[number, number, number]>([box.w / 2, box.h / 2, 1000])
  const policy = useRef({ corrected: true, parked: false, w: box.w, h: box.h })
  policy.current.corrected = corrected
  policy.current.parked = parked
  policy.current.w = box.w
  policy.current.h = box.h

  // Capture phase, and on `window` rather than on the canvas: the sheet
  // covers the viewport, so the trusted move is consumed over solid matter
  // before it bubbles anywhere a scene could hear it.
  //
  // `isTrusted` because the relay dispatches synthetic moves INTO the parked
  // page, and hearing those as the hand would make the crystal chase its own
  // reflection (relay.ts — the same seam fisheye guards).
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!e.isTrusted) return
      hand.current.x = e.clientX
      hand.current.y = e.clientY
      // Parked: the hand goes on moving and the drive does not, so the
      // spring settles where it was left. Nothing downstream needs telling —
      // the raycast reads the DRAWN pose, so a click under the parked glass
      // is corrected by the parked glass, and a click away from it is not
      // corrected at all, which is what `bendAt` returns off the solid.
      if (policy.current.parked) return
      drive.current.x = e.clientX
      drive.current.y = e.clientY
    }
    window.addEventListener('pointermove', move, { capture: true })
    return () => window.removeEventListener('pointermove', move, { capture: true })
  }, [])

  // Let go, and the tip is back on the hand this frame rather than at the
  // next twitch of it.
  useEffect(() => {
    if (parked) return
    drive.current.x = hand.current.x
    drive.current.y = hand.current.y
  }, [parked])

  // The correction. Munari's own relay carries the event from here into the
  // page's parked subtree, so mutating the hit's uv is the whole of it —
  // there is no second copy of the enter/leave bookkeeping to keep in step.
  //
  // The pose read here is the one the last DRAWN frame used, up to one frame
  // behind the pointer this ray came from. Tracing the POINTER through a
  // crystal that has not caught up to it is a query the bend field answers
  // badly: on a 900px/s sweep, 6px of stale tip put the hit 141px from the
  // hand and moved it 170px between two consecutive moves — keys lighting up
  // three away from the cursor (measured 2026-08-26). Tracing the TIP holds
  // the query and the solid together, and that drops to 9px.
  const raycast = useMemo<THREE.Object3D['raycast']>(
    () =>
      function (this: THREE.Mesh, raycaster, intersects) {
        const hits: THREE.Intersection[] = []
        THREE.Mesh.prototype.raycast.call(this, raycaster, hits)
        const p = policy.current
        for (const hit of hits) {
          if (hit.uv && p.corrected) {
            // uv's v runs up and the law's y runs down; the same flip the
            // fragment shader makes, and the only conversion on this path.
            //
            // Following, the hotspot IS the tip, so the query goes there.
            // Parked, the glass is a fixed lens the pointer can walk off, so
            // the query stays on the pointer and takes the [0, 0] that comes
            // back once it is off the solid.
            const [qx, qy] = p.parked
              ? [hit.uv.x * p.w, (1 - hit.uv.y) * p.h]
              : tipScreenPoint(frame.current, eye.current)
            const [bx, by] = bendAt(qx, qy, frame.current, tune, eye.current)
            hit.uv.set((qx + bx) / p.w, 1 - (qy + by) / p.h)
          }
          intersects.push(hit)
        }
      },
    [],
  )

  // Keyed on `parked` alone: the pose changes every frame and must never
  // rebuild the source, but a park toggle is rare and only swaps an
  // attribute — same component in the same position, so `typed` survives.
  const source = useMemo(() => <Pad parked={parked} />, [parked])

  return (
    <div className="crystal-page" data-parked={parked || undefined}>
      <Surface
        surface={page}
        view="webgl"
        timing={{ settleMs: 0, durationMs: 1 }}
        size={[box.w, box.h]}
        source={source}
      />

      <SurfaceCanvas
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0 }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => {
          state.gl.setClearAlpha(0)
          window.__r3f = state
        }}
      >
        <PixelPerfect />
        {st.isWebGLMounted && (
          <Surface.WebGL
            surface={page}
            placement="manual"
            alpha="source"
            frustumCulled={false}
            raycast={raycast}
            geometry={<planeGeometry args={[box.w, box.h]} />}
            material={
              <CrystalMaterial
                drive={drive}
                frame={frame}
                eye={eye}
                tune={tune}
                stageW={box.w}
                stageH={box.h}
              />
            }
          />
        )}
      </SurfaceCanvas>

      {/* After the canvas, because the sheet is the whole viewport: with
          `pointerMode="surfaces"` the canvas arms itself wherever a raycast
          finds matter, and here that is everywhere. Chrome painted under it
          would be unreachable. */}
      <div className="crystal-chrome">
        <h2>crystal</h2>
        <p>
          The pointer is a solid lump of cut glass floating over the page, and
          the page under it is still a page — the clock runs, the keys take
          clicks, and the glass casts a shadow and a caustic onto both. What
          you see through the arrow has been displaced by up to 180 pixels, so
          where you click and where you look are two different places.
          Munari&rsquo;s relay is handed the same ray the shader drew with,
          which is what makes the key under the tip the key that answers.
        </p>
        <label className="crystal-switch">
          <input
            type="checkbox"
            data-crystal-correct
            checked={corrected}
            onChange={(e) => setCorrected(e.target.checked)}
          />
          <span>click follows the eye</span>
        </label>
      </div>

      {showChrome && <CrystalTweaks parked={parked} onParked={setParked} />}
      {chips}
    </div>
  )
}
