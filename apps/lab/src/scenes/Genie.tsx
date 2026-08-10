// The genie scene — the 2001 minimize, made graspable.
//
// The original was a movie you triggered: press minimize, watch the
// compositor play a filmstrip of your window, and the frames were
// pictures. Here the window is matter the whole way down, and every
// stage of that movie is a place a hand can enter:
//
//   drag the titlebar   the drain is yours. The window follows the hand
//                       through the funnel; a flick at release commits
//                       it to whichever fate the flick says.
//   press the lamp      the untouched flight, exactly as 2001 shipped
//                       it — except you can reach in and CATCH it by
//                       the titlebar mid-drain, and the movie becomes
//                       a grip.
//   the dock tile       the container the window pours into, not an
//                       icon of it: the tile grows as the drain feeds
//                       it, rings with the landing's own momentum, and
//                       dragging it upward pours the window back out.
//
// None of it stops being DOM. The airborne copy is a second React root
// rendering the SAME component from the SAME state as the page copy;
// the warp bends geometry on the CPU so raycasts hit the funnel the eye
// sees; and both custody swaps happen at exact identities. The law
// (genieLaw.ts) owns shape, the drive (genieDrive.ts) owns time, and a
// landing's leftover momentum is consumed by a settle wobble whose
// perceptual budget — sub-half-pixel within 350ms — is pinned by test.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  SurfaceApp,
  cameraDistance,
  useSurfaceChrome,
  useSurfaceTexture,
} from '@petepetrash/munari'
import {
  GENIE_DEFAULTS,
  SETTLE_DEFAULTS,
  genieGrabSolve,
  genieSettle,
  genieSettleDone,
  genieWarp,
  type GenieParams,
} from './genieLaw'
import {
  DRIVE_DEFAULTS,
  driveCommit,
  driveGrabStep,
  driveSpringStep,
  easeInCubic,
  pourOut,
} from './genieDrive'
import { dockPose, dockRingDone, dockSwell } from './genieDock'
import { GENIE_FRAG, GENIE_VERT } from './genieShaders'
// Archival footage, cut and encoded by tools/make-film.sh. The clip it
// replaced was generated, so its recipe was its source; this one is a
// binary, and a binary cannot explain itself — the take, the crop, and
// the exact encode live in that script, and where the footage came from
// lives in film.provenance.md beside the file. Imported rather than
// served from public/ so the bundler hashes it and a missing file is a
// build error rather than a 404 in front of a visitor.
import filmUrl from './film.mp4'
import './genie.css'

const FOV = 42
// Subdivision is vertical-heavy: the funnel's curvature lives almost
// entirely in y, and a flat sheet renders identically at any tessellation
// so the rest cost is zero.
const GRID_X = 24
const GRID_Y = 64
const MINIMIZE_S = 0.62
const RESTORE_S = 0.52
const SLOW = 6
// The sheet's grabbable band, as a fraction of its height — the titlebar
// plus a little grace. Content below it keeps taking clicks mid-flight.
const TITLEBAR_V = 0.13
// A press becomes a drag at this travel; under it, it is a click.
const CLAIM_PX = 8
// How far off straight-down a titlebar drag may lean and still be read
// as a pour rather than a move: |dx| ≤ dy × this, so a cone of ±26°
// around the dock's own direction. Wide enough that a hand aiming for
// the dock never has to aim carefully, narrow enough that dragging a
// window down and across the desk stays a move.
const POUR_CONE = 0.5
// The graspable remainder. A dragged window may hang off any edge of the
// desk, but never by more than this — one titlebar's worth stays where a
// hand can reach it. Also what holds a window clear of the dock, which
// is the one edge it must not be able to hide behind.
const KEEP = 44
// The restore ease's end slope (≈0.8 of linear), measured off the law —
// an untouched click-restore synthesizes its arrival speed from this.
const POUR_END_SLOPE = (pourOut(1) - pourOut(1 - 1e-3)) / 1e-3
// easeInCubic's derivative is 3p², exactly 3 at p = 1 — closed form,
// unlike POUR_END_SLOPE's finite difference (pourOut has no clean
// derivative to hand). The minimize's own arrival speed, for the
// dock's landing ring.
const MIN_END_SLOPE = 3
// Read once, at module load: a live-updating query would mean the
// ring's presence flips mid-session on a preference change, which is
// not worth a listener. The swell still tracks progress either way —
// it is state synchronized to the user's own gesture, not decoration.
const REDUCE_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

interface GenieFlight {
  /** Window rect as a world pose (z = 0 is the viewport — camera below). */
  w: number
  h: number
  wx: number
  wy: number
  /** The law's params, dock mouth already window-local. */
  params: GenieParams
  duration: number
  /** Where the window ends and its shade begins, as a fraction of the
   *  capture root: (windowW / rootW, windowH / rootH). Measured off the
   *  live boxes at press time like everything else here, so the drop is
   *  never a number this file knows — and (1, 1) for a window with no
   *  shade at all, which switches the shader's fade off by arithmetic
   *  rather than by a branch. */
  shade: [number, number]
}

// ── the drive box: who owns t right now, shared by refs ─────────────────
//
// clock   an untouched flight, eased time
// grab    a hand: t is wherever the hand says (driveGrabStep)
// spring  after release: analytic spring to the committed wall
// settle  after a landing at rest: the wobble consuming arrival momentum

interface DriveBox {
  mode: 'clock' | 'grab' | 'spring' | 'settle'
  t: number
  v: number
  grabT: number
  target: 0 | 1
  clockStart: number | null
  settleTau: number
  settleV: number
}

const restingDrive = (): DriveBox => ({
  mode: 'clock',
  t: 0,
  v: 0,
  grabT: 0,
  target: 1,
  clockStart: null,
  settleTau: 0,
  settleV: 0,
})

// ── the desk's four windows ─────────────────────────────────────────────
//
// Munari kept returning to three figures — the square, the circle, the
// triangle — and gave each its own study. The dock has always drawn them;
// now each mark owns the window it belongs to, and the bay is simply that
// window at 20px. The fourth is the working one, the scheda, which is the
// only window carrying anything that moves or takes input.
//
// All four fly at once, and that is the lab bleeding on it — this scene
// first shipped with a single flight slot, on the reading that four
// windows were four SUBJECTS and multi-flight was generality to be
// refused until something needed it. Something did: a desk on which
// only one window may be in motion is not a desk, it is a slideshow of
// one window at a time, and the demo's claim is that these are ordinary
// windows. So the state below is per-window throughout — a flight, a
// drive, a geometry, a bay wobble, and a paint gate each — and the
// kernel needed nothing, because the law and the drive were always
// written about ONE sheet and never knew how many there were.

type WinId = 'quadrato' | 'cerchio' | 'triangolo' | 'scheda'

interface Scheda {
  id: WinId
  title: string
  /** The bay's drawing: a pane that fills when occupied, then the mark
   *  stroked over it, so the drawing itself never goes anywhere. */
  mark: React.ReactNode
}

// Dock order, left to right. The three figures, then the window that
// works — the same row the scene has always drawn.
const SCHEDE: Scheda[] = [
  {
    id: 'quadrato',
    title: 'quadrato',
    mark: (
      <>
        <rect className="gen-pane" x="2" y="2" width="16" height="16" />
        <rect x="2" y="2" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="0.9" />
      </>
    ),
  },
  {
    id: 'cerchio',
    title: 'cerchio',
    mark: (
      <>
        <circle className="gen-pane" cx="10" cy="10" r="8" />
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="0.9" />
      </>
    ),
  },
  {
    id: 'triangolo',
    title: 'triangolo',
    mark: (
      <>
        <path className="gen-pane" d="M10 2.2 L18.4 17.8 L1.6 17.8 Z" />
        <path
          d="M10 2.2 L18.4 17.8 L1.6 17.8 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.9"
          // The apex of a triangle is a spike, and a mitred spike at
          // this angle runs several units past the point it is drawn
          // at — far enough to clip against the viewBox and come back
          // flattened. Rounding the join keeps the tip inside the box
          // and inside the bay, at a radius too small to read as a
          // soft corner next to the square and the circle.
          strokeLinejoin="round"
        />
      </>
    ),
  },
  {
    id: 'scheda',
    title: 'scheda',
    mark: (
      <>
        <rect className="gen-pane" x="1.6" y="7" width="16.8" height="10" />
        <rect x="1.6" y="3" width="16.8" height="14" fill="none" stroke="currentColor" strokeWidth="0.9" />
        <path d="M1.6 7 L18.4 7" stroke="currentColor" strokeWidth="0.9" />
      </>
    ),
  },
]

/** Dock order, and the order the desk mounts its windows in. Both loops
 *  below walk it, so a window and its bay can never fall out of step. */
const WIN_IDS: WinId[] = SCHEDE.map((s) => s.id)

/** Where the overlay sits in the desk's stack. The windows take 1..n from
 *  their paint order, so this only has to clear n — but a sheet in the air
 *  is the window, and there is no arrangement of the desk it should ever
 *  end up underneath, so it is stated as a ceiling rather than as n + 1. */
const OVERLAY_Z = 100

// Two of the studies. Each figure is drawn at its viewBox size exactly,
// so one strokeWidth means one rendered hairline — the same 1.5px the
// bays are drawn at, which is what makes the big figure and its 20px bay
// read as the same hand rather than two drawings of the same shape.
//
// The triangolo has no study. Its window is the film (below), and the
// trade is the point: the other two windows show a figure drawn, this
// one shows the man who drew them turning one by hand.
const STUDY: Record<'quadrato' | 'cerchio', { figure: React.ReactNode; line: string }> = {
  quadrato: {
    figure: <rect x="2.75" y="2.75" width="98.5" height="98.5" fill="none" stroke="currentColor" strokeWidth="1.5" />,
    line: 'Four equal sides. The module every grid on this page is cut from.',
  },
  cerchio: {
    figure: <circle cx="52" cy="52" r="49.25" fill="none" stroke="currentColor" strokeWidth="1.5" />,
    line: 'One edge, every point of it the same distance from the middle.',
  },
}

// ── the window (rendered twice: on the page, and on the sheet) ──────────

// The shapes' layer, its own component because the phase shift below is
// per-INSTANCE state and every window exists twice.
function PlayLayer() {
  // CSS animations run on the document timeline, which shares its origin
  // with performance.now() — so "minus the time already elapsed" places a
  // freshly mounted copy exactly where a copy mounted at load would be.
  const shift = useRef<React.CSSProperties | null>(null)
  if (shift.current === null)
    shift.current = { animationDelay: `-${(performance.now() / 1000).toFixed(3)}s` }

  // Live content, not decoration. These keep bouncing while the sheet is
  // being warped, which is the claim the whole scene exists to make: what
  // flies is a running page sampled every frame, not a photograph of one
  // taken at press time.
  //
  // The delay is what keeps the two copies honest. Page copy and airborne
  // copy are the same component in different trees, so the airborne one's
  // keyframes would otherwise start from zero the instant it mounts — and
  // the swap frame, which is meant to be invisible, would jump the shapes
  // across the window. A negative delay of the time already elapsed starts
  // each copy at the phase the document clock is already at. Computed once
  // per instance, deliberately: recomputing it on a re-render (every
  // keystroke in the field) would add the mounted time twice and make the
  // shapes stutter as you type.
  return (
    <div className="gen-play" aria-hidden>
      <svg className="gen-shape" data-shape="quadrato" style={shift.current} viewBox="0 0 40 40">
        <rect x="2" y="2" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <svg className="gen-shape" data-shape="cerchio" style={shift.current} viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <svg className="gen-shape" data-shape="triangolo" style={shift.current} viewBox="0 0 40 40">
        <path d="M20 2.5 L38 37.5 L2 37.5 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  )
}

/** The clip's length in seconds — must equal LEN in tools/make-film.sh.
 *  A fallback only: the phase below is derived from the FILE's duration
 *  whenever the decoder has read it, so the two copies agree even if
 *  this number and the asset ever drift apart. */
const FILM_PERIOD = 12

// The window whose content is DECODED VIDEO. Everything else on this
// desk is markup the replay was always going to catch; a video frame is
// the one kind of content you would expect it to miss, because frames
// do not live in the display list the capture replays — they arrive on
// their own compositor layer. They come through anyway (Chrome 150,
// measured 2026-08-09), and that makes this window the scene's hardest
// claim: what flies is the running page, down to the frame the decoder
// handed over this vsync.
/** The one window whose content is decoded video rather than markup. The
 *  page knows this statically, which is what lets the sheet's readiness
 *  gate exist from the moment of takeoff rather than being discovered
 *  from inside the capture root a frame or two late. */
const FILM_WIN: WinId = 'triangolo'

/** How long a sheet will wait for its film before going up without it. A
 *  seek measures 12ms at rest and 20ms at its worst (2026-08-09, twenty
 *  takeoffs), so this is an order of magnitude clear of the thing it is
 *  bounding — it exists so that a decoder which never answers costs a
 *  frame of black rather than a gesture that never starts. */
const FILM_WAIT_MS = 150

function FilmLayer({ onPicture }: { onPicture?: () => void }) {
  // Read through a ref, so the ref callback below can be created once.
  // A `seek` whose identity changed with its props would be detached and
  // reattached on every re-render of the capture root, and each attach
  // issues a fresh seek — the element would never stop seeking, which is
  // the very state this is here to get out of.
  const latest = useRef(onPicture)
  latest.current = onPicture
  // The same problem PlayLayer solves with a negative animation-delay,
  // and the same solution. Every window exists twice — once on the desk,
  // once inside the capture root — and the airborne copy is a fresh
  // mount, so its <video> would start at currentTime 0 and the swap
  // frame, which is meant to be invisible, would cut the film back to
  // the top of the clip. Neither copy can see the other, but both can
  // read the document clock, so both derive the same phase from it.
  const seek = useCallback(
    (el: HTMLVideoElement | null) => {
      if (!el) return
      // Fired once, when this element has the frame it was mounted to
      // show. Only the airborne copy is listening; see `lit` on the page.
      let toldPicture = false
      const picture = () => {
        if (toldPicture) return
        toldPicture = true
        latest.current?.()
      }
      const go = () => {
        // The period is taken from the FILE, not from the constant, so a
        // re-render at another length cannot leave the two copies deriving
        // their phase from different numbers. Both then satisfy
        // currentTime = now mod duration at all times — the page copy
        // because it seeks to its own now at mount and then advances in
        // real time, the airborne copy because it seeks to the same thing
        // at its own, later, mount.
        const period = el.duration || FILM_PERIOD
        el.currentTime = (performance.now() / 1000) % period
        // Muted, so autoplay is permitted; the promise still rejects if
        // the element is torn down mid-flight, which is not an error.
        void el.play().catch(() => {})
        // A seeking <video> has NO frame — not the old one, not the new
        // one — and a box with no frame in it is a hole. Everything else
        // on this desk is markup, which renders the instant it is
        // attached; this is the one content that has a gap between
        // existing and being a picture, and the capture replays the gap
        // faithfully as black. Measured: one composited frame of pure
        // black per takeoff at rest, five under load
        // (instruments/genie-drain/film-stays-lit.mjs).
        if (el.seeking) el.addEventListener('seeked', picture, { once: true })
        else picture()
      }
      // HAVE_FUTURE_DATA, not HAVE_METADATA. A seek issued the instant the
      // duration is known is served by a decoder that still has nothing
      // buffered, and lands late by however long the fetch takes — which
      // is charged to the clip's position and never paid back. The page
      // copy pays that at load (cold) and the airborne copy at takeoff
      // (warm, the file long since cached), so seeking early makes the two
      // copies disagree by the DIFFERENCE of two unrelated latencies:
      // measured at 69ms, which is ~7px of travel on the fastest flock and
      // therefore a visible tick at the swap. Waiting until the decoder
      // can honour a seek promptly makes both seeks warm, and the
      // disagreement collapses to the frame quantum.
      if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) go()
      else el.addEventListener('canplay', go, { once: true })
      // The deadline. Nothing above is guaranteed to fire — a decoder can
      // fail, and a sheet that waits forever is a minimize that never
      // starts. Late is a frame of black; never is a broken desk.
      setTimeout(picture, FILM_WAIT_MS)
    },
    [],
  )

  return (
    <video
      ref={seek}
      className="gen-film"
      src={filmUrl}
      muted
      loop
      playsInline
      autoPlay
      preload="auto"
      aria-hidden
      tabIndex={-1}
    />
  )
}

interface WindowBodyProps {
  scheda: Scheda
  /** Frontmost on the desk. Carried as an attribute on the CAPTURE ROOT
   *  so the airborne copy dims and undims with the page copy — a focus
   *  ring that only one of the two trees knew about would be a visible
   *  change at the swap frame. */
  front: boolean
  note: string
  setNote: (v: string) => void
  checked: boolean
  setChecked: (v: boolean) => void
  onMinimize: (slow: boolean) => void
  /** Only the airborne copy passes this, and only the film window fires
   *  it: the sheet is not fit to be seen until its <video> has a frame.
   *  See `lit` on the page. */
  onPicture?: () => void
}

// The capture root is `.gen-sheet`, not `.gen-window`, and the extra box
// is the shadow's. A box-shadow lies OUTSIDE the border box, which is
// outside the texture — it would sit on the desk at rest and vanish the
// instant the window took flight. Flight builds a WebGL twin for exactly
// this reason; the genie does not need one, because a hard offset shadow
// can simply be painted INSIDE the root, and paint survives the custody
// swap untouched. It pours into the dock along with everything else,
// which on a desk made of paper is the honest thing for it to do.
const noFocus = (e: React.MouseEvent) => e.preventDefault()

function WindowBody({
  scheda,
  front,
  note,
  setNote,
  checked,
  setChecked,
  onMinimize,
  onPicture,
}: WindowBodyProps) {
  const study = scheda.id === 'quadrato' || scheda.id === 'cerchio' ? STUDY[scheda.id] : null
  return (
    <div className="gen-sheet" data-win={scheda.id} data-front={front ? 'true' : undefined}>
      <div className="gen-window">
        <div
          className="gen-titlebar"
          // Mac OS 9 put windowshade on this double-click and macOS keeps
          // the seat warm with "double-click a title bar to minimize" —
          // so on a desk whose whole subject is the minimize, this is
          // where a hand will try it. The lamps answer their own clicks,
          // and takeOff refuses a second flight of a window already in
          // the air, so a double-tap on one is not a third gesture.
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest('.gen-lamp')) return
            onMinimize(e.shiftKey)
          }}
        >
          {/* Chrome focuses a <button> on mousedown; macOS has never
              moved the keyboard for a click on a window widget. Without
              this, clicking the minimize lamp of a window you are NOT
              typing in pulls the caret out of the one you are — the
              press alone does it, before any handler runs. Cancelling
              the mousedown default suppresses only that focus: the
              click still fires, Tab still reaches the lamp, and the
              press still arms a drag, which rides on pointer events. */}
          <button className="gen-lamp" aria-hidden tabIndex={-1} onMouseDown={noFocus} />
          <button
            className="gen-lamp"
            data-role="minimize"
            aria-label={`minimize ${scheda.title}`}
            onMouseDown={noFocus}
            onClick={(e) => onMinimize(e.shiftKey)}
          />
          <button className="gen-lamp" aria-hidden tabIndex={-1} onMouseDown={noFocus} />
          <span className="gen-title">{scheda.title}</span>
        </div>
        {scheda.id === FILM_WIN ? (
          // Borderless: the body's own padding would frame the film, and
          // a film with a mat around it is a picture of a film.
          <div className="gen-body" data-fill="film">
            <FilmLayer onPicture={onPicture} />
          </div>
        ) : study ? (
          <div className="gen-body">
            <div className="gen-figure" aria-hidden>
              <svg viewBox="0 0 104 104" width="104" height="104">
                {study.figure}
              </svg>
            </div>
            <p>{study.line}</p>
          </div>
        ) : (
          <div className="gen-body">
            <PlayLayer />
            <h2>the genie effect</h2>
            <p>
              Recreate the classic effect from Mac OSX but with real DOM. Try dragging the window up and down to manually scrub through the effect. The form is fully interactive at every point in the animation.
            </p>
            <input
              className="gen-field"
              placeholder="type, even mid-flight"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <label className="gen-check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              still a checkbox
            </label>
          </div>
        )}
      </div>
    </div>
  )
}

// ── the camera: z = 0 is the viewport, 1 world unit = 1 CSS px ──────────

function PixelPerfect() {
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

// ── canvas solidity: solid only where there is matter (flight rule #3) ──

function SolidWhereMatterIs({ active }: { active: boolean }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const el = gl.domElement
    if (!active) {
      el.style.pointerEvents = 'none'
      return
    }
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const onMove = (e: PointerEvent) => {
      // The library's retold pointer events bubble back to window; acting
      // on them would toggle the canvas off mid-hover (flight's essay in
      // physics/gestures.ts).
      if (!e.isTrusted) return
      ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const hit = ray
        .intersectObjects(scene.children, true)
        .some((h) => h.object.userData.matter)
      el.style.pointerEvents = hit ? 'auto' : 'none'
    }
    window.addEventListener('pointermove', onMove, true)
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      el.style.pointerEvents = 'none'
    }
  }, [active, gl, camera, scene])
  return null
}

// ── the sheet's material ────────────────────────────────────────────────

/** How hard the funnel has to be squeezing a row before its shadow goes.
 *
 *  Measured, and the measurement overturned the first answer. Reasoning
 *  from the drop's width said a 5px band stops reading as a shadow at
 *  about two rendered pixels, so the band was set to leave between row
 *  scales 0.45 and 0.20 — and shadow-travels then read the identical
 *  profile with the fade on and with it disabled. The reason is that a
 *  minified band does not stay crisp and merely narrow: the GPU averages
 *  it against the transparent margin outside it, so it loses ALPHA at
 *  the same time it loses width. Ink measured down the held funnel, one
 *  frame (2026-08-09, `--drop: 5px`):
 *
 *      row scale   1.00   0.80   0.77   0.69   0.63   0.52   ≤0.35
 *      shade ink    190     89     63     41     27     15       0
 *
 *  Half the shadow is gone by 0.80 and four fifths by 0.69, with none of
 *  that asked for — which is exactly the complaint, a shadow that
 *  dissolves into a grey haze down one flank instead of leaving. A fade
 *  under 0.45 had nothing left to fade. So the band is placed where the
 *  ink still exists: whole above 0.95, gone by 0.55, which LEADS the
 *  dissolution rather than trailing it and takes the smear with it. The
 *  ceiling stays clear of 1.0 for the reason it always did — a sheet at
 *  rest, and the whole first stretch of a flight, must be untouched. */
const SHADE_FADE: [number, number] = [0.55, 0.95]

function GenieMaterial({ shade }: { shade: [number, number] }) {
  const texture = useSurfaceTexture()
  const { chrome, width, height } = useSurfaceChrome()
  const uniforms = useMemo(
    () => ({
      tMap: { value: null as THREE.Texture | null },
      uMunariRadii: { value: new THREE.Vector4(0, 0, 0, 0) },
      uMunariSize: { value: new THREE.Vector2(1, 1) },
      uShadeEdge: { value: new THREE.Vector2(1, 1) },
      uShadeFade: { value: new THREE.Vector2(SHADE_FADE[0], SHADE_FADE[1]) },
    }),
    [],
  )
  uniforms.tMap.value = texture ?? null
  uniforms.uShadeEdge.value.set(shade[0], shade[1])
  // decisions.md #5, and the sheet only started needing it when it grew a
  // translucent shadow. A DOM texture uploads STRAIGHT by default, and
  // GPU filtering averages raw rgb across texels — so every boundary
  // between the shade and the empty corner beside it would mix a colour
  // that is only there at 30% as if it were fully present. Premultiply at
  // upload, blend premultiplied below, and the two halves cancel: the
  // shade composites to the same luma as the page copy's, which is what
  // the swap frame needs. (Measured: straight upload with a premultiplied
  // blend puts the airborne shade 14 luma pale of the DOM's.)
  useEffect(() => {
    if (!texture) return
    texture.premultiplyAlpha = true
    texture.needsUpdate = true
  }, [texture])
  const radii = chrome?.radii ?? [0, 0, 0, 0]
  uniforms.uMunariRadii.value.set(radii[0], radii[1], radii[2], radii[3])
  uniforms.uMunariSize.value.set(width, height)
  return (
    <shaderMaterial
      key={texture?.uuid ?? 'none'}
      uniforms={uniforms}
      vertexShader={GENIE_VERT}
      fragmentShader={GENIE_FRAG}
      transparent
      // decisions.md #5: a 2D canvas's backing store is already
      // premultiplied, so a material consuming one has to blend that way.
      // The sheet was fully opaque until it grew a translucent shadow,
      // which is why this could be missing and look correct — with the
      // default blend the shade gets multiplied by its alpha a second
      // time and lands a few luma dark of the page copy it has to be
      // identical to at the swap.
      premultipliedAlpha
      // Four sheets can be in the air at once and every one of them sits
      // at z = 0, so the depth buffer has no opinion worth having about
      // which is in front — and with writes on, whichever drew first
      // would silently reject the rest. The group's renderOrder decides
      // instead (see Flight), which is the desk's own paint order.
      depthWrite={false}
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  )
}

// ── one window's flight: whoever owns t this frame, law out, positions ──
//
// One instance per AIRBORNE window, mounted by the page below. Everything
// a single flight needs is inside it — the drive box that owns t, the
// geometry the law is written into, the sheet itself, and the transform
// of the bay this sheet is pouring toward. That last one belongs here
// rather than in a central loop for a reason: the mouth the warp funnels
// into and the container the eye sees have to come from ONE read of the
// drive in ONE frame, or the pour's bottom edge and the bay's rim drift
// apart by however far the two loops are from each other.
//
// So every tile has exactly one writer per frame, even with four windows
// in the air: this component holds the bays being poured, and Bays below
// holds every other one.

/** One flight in progress: the pose it took off from, and who owns t. */
interface Airborne {
  f: GenieFlight
  drive: DriveBox
}

/** A bay's landing wobble — seconds since the kick and the kick's own
 *  speed in px/s, per genieDock's dockPose. */
interface Ring {
  t: number
  v: number
}

type Dir = 'minimizing' | 'restoring'

interface FlightProps {
  win: WinId
  dir: Dir
  air: Airborne
  ring: Ring
  ringing: boolean
  /** Fit to be seen. Not the same as "the texture has pixels": a window
   *  of video has pixels while its <video> is still seeking, and those
   *  pixels are a black rectangle. The page assembles this from both
   *  facts — see `painted` and `lit` there. */
  ready: boolean
  /** Paint order among the windows — renderOrder for the sheet, and the
   *  tie-break the hand's raycast uses to pick between two of them. */
  stack: number
  slotOf: (win: WinId) => HTMLButtonElement | null
  kickRing: (win: WinId, vPxPerS: number) => void
  onPainted: (win: WinId) => void
  /** Fired once, on the first frame this sheet is actually drawn. The
   *  page copy's hide waits on this rather than on `painted`, so the two
   *  copies overlap instead of leaving a gap — see `shown` on the page. */
  onShown: (win: WinId) => void
  onLand: (win: WinId, wall: 0 | 1) => void
  content: React.ReactNode
}

function Flight({
  win,
  dir,
  air,
  ring,
  ringing,
  ready,
  stack,
  slotOf,
  kickRing,
  onPainted,
  onShown,
  onLand,
  content,
}: FlightProps) {
  const geoRef = useRef<THREE.PlaneGeometry | null>(null)
  const groupRef = useRef<THREE.Group | null>(null)
  const told = useRef(false)
  // This flight is over. Landing asks the page to delete the flight, and
  // the page does — but that deletion has to cross into the Canvas's own
  // reconciler before this component stops existing, and under load that
  // is several frames later. The loop keeps running through them.
  //
  // Which would be harmless if the drive were finished, and it is not:
  // the minimize nulls clockStart on arrival, so the very next frame
  // reads "no clock yet", starts one, and computes p = 0 — t snaps to 0
  // and the sheet is drawn back at the window's rest position for a
  // frame. That is the flicker as reported, arriving AFTER the window
  // has docked (instruments/genie-drain/rest-blink.mjs, cameBack).
  //
  // So a landed flight computes nothing further. The frames before the
  // unmount draw exactly what the landing frame drew.
  const landed = useRef(false)
  const f = air.f

  useFrame(({ clock }, rawDt) => {
    if (landed.current) return
    const dt = Math.min(rawDt, 1 / 20)
    const d = air.drive
    const restoring = dir === 'restoring'

    // The bay's transform, written every frame from the live drive. Any
    // drive mode will do — clock, grab, spring — because while a window
    // is airborne its t IS the midline, so scrubbing the drag breathes
    // the container live. (An idle bay is the case t cannot answer, and
    // Bays handles it from custody instead.)
    const alive = ringing && !dockRingDone(ring.t, ring.v)
    const slot = slotOf(win)
    if (slot) {
      const pose = dockPose(d.t, alive ? ring.t : 0, alive ? ring.v : 0)
      slot.style.transform = `scale(${pose.sx}, ${pose.sy})`
      // How full the bay's mark reads, 0..1 — the same t, so the level
      // is the drive's and not a second animation with its own opinion.
      // A minimize raises it, a restore drains it, and a hand scrubbing
      // the drag moves it in both directions because t is the midline
      // while a window is airborne. Written as a custom property rather
      // than a class flip for exactly that reason: there is no discrete
      // "filled" moment to hang a rule on when the pour is under a hand.
      slot.style.setProperty('--pour', d.t.toFixed(3))
    }

    const geo = geoRef.current
    if (!geo) return

    // Is this sheet actually being drawn this frame? Asked of the scene
    // graph rather than of the `painted` prop, because those two answers
    // are a frame or more apart under load: `painted` is a state change
    // that has to cross into the Canvas's own reconciler before it
    // becomes `visible` on anything. The group knows now.
    const drawn = groupRef.current?.visible === true
    // The page copy's hide waits on this, so it can never hide into an
    // empty frame. Fired from the loop and only once — the first frame
    // the sheet is on screen is the earliest moment the DOM copy is
    // safely redundant.
    if (drawn && !told.current) {
      told.current = true
      onShown(win)
    }

    // Until the sheet is on screen, the page copy (minimize) or the dock
    // tile (restore) is still the visible truth — hold the wall. A grab
    // is allowed to track anyway: the sheet is invisible, and the first
    // drawn frame then appears already in the hand.
    if (!drawn && d.mode === 'clock') {
      d.clockStart = null
      d.t = restoring ? 1 : 0
    } else if (d.mode === 'clock') {
      if (d.clockStart === null) d.clockStart = clock.elapsedTime
      const p = Math.min(1, (clock.elapsedTime - d.clockStart) / f.duration)
      if (restoring) {
        // The pour-out ease ARRIVES WITH SPEED (pinned ~0.8 of linear),
        // and that speed is what the settle consumes: convert the end
        // slope from t/s to px/s through the midline's full journey.
        d.t = 1 - pourOut(p)
        if (p >= 1) {
          d.t = 0
          d.mode = 'settle'
          d.settleTau = 0
          d.settleV = (POUR_END_SLOPE / f.duration) * Math.abs(f.params.dockY)
        }
      } else {
        // easeInCubic, not easeInOutCubic: the minimize now has to
        // ARRIVE WITH SPEED too (slope 3 at p = 1, MIN_END_SLOPE) to
        // feed the dock's landing ring — and its flat START (slope 0)
        // is what a slow-motion catch relies on, so the titlebar still
        // reads as at-rest a beat into the flight.
        d.t = easeInCubic(p)
        if (p >= 1) {
          d.clockStart = null
          // f.duration, not MINIMIZE_S: a slow-motion flight arrives
          // slowly, and the container's ring answers the ACTUAL landing
          // speed — same divisor the settle handoff uses above.
          kickRing(win, (MIN_END_SLOPE / f.duration) * Math.abs(f.params.dockY))
          landed.current = true
          onLand(win, 1)
          return
        }
      }
    } else if (d.mode === 'grab') {
      const next = driveGrabStep({ t: d.t, v: d.v }, d.grabT, dt)
      d.t = next.t
      d.v = next.v
    } else if (d.mode === 'spring') {
      const next = driveSpringStep({ t: d.t, v: d.v }, d.target, dt, DRIVE_DEFAULTS)
      d.t = next.t
      d.v = next.v
      if (next.done) {
        if (d.target === 1) {
          // A dock landing's momentum is now the tile's ring — the
          // sheet is inside the slot, with no room to wobble on its own.
          kickRing(win, next.arrivalV * Math.abs(f.params.dockY))
          landed.current = true
          onLand(win, 1)
          return
        }
        // A rest landing wobbles: crossing speed becomes the settle's
        // initial slope. t is decreasing into the wall, so the sheet is
        // moving UP at contact — the wobble's first swing is upward.
        d.mode = 'settle'
        d.settleTau = 0
        d.settleV = next.arrivalV * Math.abs(f.params.dockY)
      }
    } else {
      // settle: the sheet is home (t = 0 exactly); the wobble hangs off
      // the top edge, anchored at the bottom — jelly, not a slab.
      d.settleTau += dt
      if (genieSettleDone(d.settleTau, d.settleV, SETTLE_DEFAULTS)) {
        landed.current = true
        onLand(win, 0)
        return
      }
    }

    const wobble =
      d.mode === 'settle' ? genieSettle(d.settleTau, d.settleV, SETTLE_DEFAULTS) : 0
    // The mouth is the ICON's mouth, for the whole pour. measure() took
    // slotHalf from the bay's resting box, but the bay swells while it
    // absorbs — so the mouth has to swell by exactly the same factor, or
    // the sheet funnels down to something narrower than the thing it is
    // landing in. Same dockSwell the transform above is written from, so
    // the two cannot drift.
    const params: GenieParams = {
      ...f.params,
      slotHalf: f.params.slotHalf * dockSwell(d.t),
    }
    const pos = geo.attributes.position as THREE.BufferAttribute
    const uv = geo.attributes.uv as THREE.BufferAttribute
    // Allocated on first use rather than at construction: the geometry
    // is the library's, its vertex count is the LOD tier's to choose,
    // and this is the only code that knows the attribute exists.
    let sq = geo.attributes.squeeze as THREE.BufferAttribute | undefined
    if (!sq || sq.count !== pos.count) {
      sq = new THREE.BufferAttribute(new Float32Array(pos.count), 1)
      geo.setAttribute('squeeze', sq)
    }
    for (let i = 0; i < pos.count; i++) {
      // The law's v runs top → bottom (texture convention); a plane's
      // uv.y runs bottom → top — which also makes uv.y the wobble's
      // top-anchored weight for free.
      const p2 = genieWarp(uv.getX(i), 1 - uv.getY(i), d.t, params)
      pos.setXYZ(i, p2.x, p2.y + wobble * uv.getY(i), 0)
      sq.setX(i, p2.k)
    }
    pos.needsUpdate = true
    sq.needsUpdate = true
  })

  return (
    // Every sheet sits at z = 0 — the plane the viewport is — so depth
    // cannot be what stacks them. renderOrder on the group can: three
    // takes a Group's renderOrder as the groupOrder of everything under
    // it and sorts by that first, which makes the paint order exactly
    // the desk's own. depthWrite is off in the material for the same
    // reason: at equal depth the buffer has no opinion worth having, and
    // a sheet must never reject the one behind it.
    <group ref={groupRef} renderOrder={stack} position={[f.wx, f.wy, 0]} visible={ready}>
      <SurfaceApp
        label="genie-window"
        width={f.w}
        height={f.h}
        material="none"
        // A sheet in flight must NOT re-raster. Two reasons, and the
        // second is the one that bites: (1) dynamic LOD reads the
        // geometry's bounding sphere, which three computes once and
        // never invalidates when positions change — and the loop above
        // rewrites every vertex each frame, so the tier is decided by
        // whatever the warp happened to look like at one arbitrary
        // instant. On a restore that instant is the sheet parked in the
        // dock mouth. (2) Even measured correctly, the sheet IS small
        // mid-pour, so an honest LOD would still drop the tier and hand
        // the landing a texture too coarse for full size — measured at
        // 0.25x, a 460x340 window drawn from a 115x85 raster. The
        // excursion's content is frozen; its resolution has to be too.
        // 2 = one texel per device pixel at this canvas's dpr ceiling.
        resolution={2}
        frustumCulled={false}
        // `win` and `stack` are how the hand tells four airborne sheets
        // apart: the raycast returns them all at the same distance, and
        // only the paint order can break that tie.
        userData={{ matter: true, win, stack }}
        // Not drawn until the texture has pixels — nor, for the film
        // window, until those pixels contain a picture. The wall above already
        // says a grab may TRACK before that, on the promise that the
        // sheet is invisible while it does — and nothing was keeping
        // that promise: mounting the Surface put a freshly allocated
        // (empty) texture on screen the very next frame, an opaque blank
        // rectangle over a window that was still alive underneath. It
        // hid for as long as the first upload took and read as a
        // flicker, because the window's contents were static and a flash
        // between two identical frames has nothing to betray it. Give
        // that window something MOVING and the same defect reads as a
        // teleport: the flash breaks smooth pursuit, the shapes come
        // back displaced, and the type around them looks untouched — so
        // the eye blames the shapes.
        // Uploads run from useFrame, not from drawing this mesh, so the
        // signal that clears the gate does not depend on the gate.
        onFirstUpload={() => onPainted(win)}
        content={content}
      >
        <planeGeometry ref={geoRef} args={[f.w, f.h, GRID_X, GRID_Y]} />
        <GenieMaterial shade={f.shade} />
      </SurfaceApp>
    </group>
  )
}

// ── the bays nobody is pouring into ─────────────────────────────────────
//
// A tile's scale has exactly one writer per frame. While a window is
// airborne that writer is its own Flight, which has the live drive; this
// takes every other tile, and reads its wall from CUSTODY rather than
// from t — an idle drive resets t to 0 on every landing, dock and desk
// alike, so t genuinely cannot say which end an idle bay is resting at.
//
// The rings are advanced here for ALL windows, including one whose bay a
// new flight has already taken back. A ring outlives the landing that
// kicked it by ~0.4s (dockRingDone) — long enough for the window to be
// clicked straight back out — and that gap between "ringing" and
// "something is in the air" is exactly what the frameloop expression
// below exists to keep alive.

interface BaysProps {
  slotOf: (win: WinId) => HTMLButtonElement | null
  ringOf: (win: WinId) => Ring
  ringing: WinId[]
  /** Windows a Flight is writing this frame — skipped here. */
  held: WinId[]
  docked: WinId[]
  stopRing: (win: WinId) => void
}

function Bays({ slotOf, ringOf, ringing, held, docked, stopRing }: BaysProps) {
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    for (const win of ringing) {
      const r = ringOf(win)
      r.t += dt
      if (dockRingDone(r.t, r.v)) stopRing(win)
    }
    for (const win of WIN_IDS) {
      if (held.includes(win)) continue
      const slot = slotOf(win)
      if (!slot) continue
      const r = ringOf(win)
      const alive = ringing.includes(win) && !dockRingDone(r.t, r.v)
      const full = docked.includes(win)
      const pose = dockPose(full ? 1 : 0, alive ? r.t : 0, alive ? r.v : 0)
      slot.style.transform = `scale(${pose.sx}, ${pose.sy})`
      // The idle ends of the same level the Driver writes mid-flight.
      // Custody is the only thing that can answer it here: an unheld bay
      // is either holding a window or it isn't, and the frame that hands
      // it over is the frame the Driver stops writing.
      slot.style.setProperty('--pour', full ? '1' : '0')
    }
  })
  return null
}

// ── the gesture rig: one hand, many windows, window-level listeners ─────
//
// All pointer logic lives here, inside the Canvas where the raycaster
// is. Presses on the DOM (a titlebar, a filled bay) are recognized by
// target; only a press on an airborne sheet needs a raycast, since there
// is no DOM element under the cursor mid-flight. One state machine
// either way: idle → armed → (CLAIM_PX of travel) → move or grab →
// release.
//
// The DOM is asked FIRST, before any question about what is in the air.
// It can be, because mid-flight the canvas is solid only where there is
// matter — so a press that reaches a titlebar really is a press on a
// window standing on the desk, even while three others are pouring.

interface GestureApi {
  anyAir: boolean
  airOf: (win: WinId) => Airborne | undefined
  dirOf: (win: WinId) => Dir | undefined
  beginGrabMinimize: (win: WinId) => boolean
  beginGrabRestore: (win: WinId) => boolean
  clickRestore: (win: WinId, slow: boolean) => void
  raise: (win: WinId) => void
  elOf: (win: WinId) => HTMLDivElement | null
  posOf: (win: WinId) => { x: number; y: number }
  moveTo: (win: WinId, x: number, y: number) => void
  desk: () => DOMRect | null
}

// Every state after `idle` names its window. It has to now: four sheets
// can be in the air at once, so "the flight" is never a thing the rig
// can refer to without saying which.
type GestState =
  | { kind: 'idle' }
  | { kind: 'armed-window'; id: number; win: WinId; x0: number; y0: number }
  | { kind: 'armed-tile'; id: number; win: WinId; y0: number }
  | {
      kind: 'move'
      id: number
      win: WinId
      el: HTMLDivElement
      x0: number
      y0: number
      /** The window's offset when the drag claimed, and where it is now
       *  — mutated in place each move and committed to React on release. */
      ox: number
      oy: number
      lx: number
      ly: number
      bounds: { minX: number; maxX: number; minY: number; maxY: number }
    }
  // `home` is the wall this gesture would return to if it were abandoned,
  // which is not always the wall it started from: a pull from the titlebar
  // came from the desk and a pull from a bay came from the dock, but a
  // sheet CAUGHT mid-flight was already on its way somewhere, and letting
  // go of it should put it back on that journey rather than undo it.
  | { kind: 'grab'; id: number; win: WinId; handY0: number; midY0: number; home: 0 | 1 }

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

function GestureRig({ api }: { api: React.RefObject<GestureApi> }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const gest = useRef<GestState>({ kind: 'idle' })

  useEffect(() => {
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    // The topmost sheet under the cursor, decided by the order the
    // sheets are DRAWN in rather than by depth: they all sit at z = 0,
    // so their ray distances are equal to within float noise and three's
    // own sort cannot break the tie. The paint order can, and it is the
    // one the eye has already agreed to.
    const topHit = (e: PointerEvent) => {
      ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      return ray
        .intersectObjects(scene.children, true)
        .filter((h) => h.object.userData.matter)
        .sort((a, b) => (b.object.userData.stack ?? 0) - (a.object.userData.stack ?? 0))[0]
    }
    const hold = () => {
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    }
    const release = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    const beginGrip = (e: PointerEvent, win: WinId, midY0: number, home: 0 | 1) => {
      gest.current = { kind: 'grab', id: e.pointerId, win, handY0: e.clientY, midY0, home }
      try {
        gl.domElement.setPointerCapture(e.pointerId)
      } catch {
        /* a pointer that already ended cannot be captured — fine */
      }
      hold()
    }
    const endGrip = (id: number) => {
      try {
        gl.domElement.releasePointerCapture(id)
      } catch {
        /* already released */
      }
      release()
    }

    const onDown = (e: PointerEvent) => {
      if (!e.isTrusted || gest.current.kind !== 'idle') return
      const el = e.target as HTMLElement | null

      // The page copy's titlebar: arm, and only a real drag claims — the
      // lamps keep their clicks.
      const bar = el?.closest?.('.gen-titlebar')
      if (bar) {
        const win = (bar.closest('[data-win]') as HTMLElement | null)?.dataset.win
        if (win)
          gest.current = {
            kind: 'armed-window',
            id: e.pointerId,
            win: win as WinId,
            x0: e.clientX,
            y0: e.clientY,
          }
        return
      }
      // A FILLED bay arms; drag up pours, release clicks. An empty bay is
      // just a drawing of a window that is already on the desk.
      const tile = el?.closest?.('.gen-tile[data-role="window"]') as HTMLElement | null
      if (tile?.dataset.filled === 'true' && tile.dataset.win) {
        gest.current = {
          kind: 'armed-tile',
          id: e.pointerId,
          win: tile.dataset.win as WinId,
          y0: e.clientY,
        }
        return
      }

      // Nothing in the DOM claimed it, so this is either bare bench or a
      // sheet in the air. The catch: a press on an airborne titlebar
      // takes t from whoever owned it (clock or spring) — mid-movie is
      // not a protected state, it is just matter in motion.
      if (!api.current.anyAir) return
      const hit = topHit(e)
      if (!hit?.uv || 1 - hit.uv.y >= TITLEBAR_V) return
      const win = hit.object.userData.win as WinId | undefined
      const a = win ? api.current.airOf(win) : undefined
      if (!win || !a) return
      // Catching a sheet is picking it up: it comes to the front, the
      // same as pressing any window would.
      api.current.raise(win)
      a.drive.mode = 'grab'
      a.drive.grabT = a.drive.t
      beginGrip(
        e,
        win,
        genieWarp(0.5, 0.5, a.drive.t, a.f.params).y,
        api.current.dirOf(win) === 'minimizing' ? 1 : 0,
      )
    }

    const onMove = (e: PointerEvent) => {
      if (!e.isTrusted) return
      const g = gest.current

      if (g.kind === 'armed-window' && e.pointerId === g.id) {
        const dx = e.clientX - g.x0
        const dy = e.clientY - g.y0
        if (Math.hypot(dx, dy) < CLAIM_PX) return
        // A titlebar drag has two jobs, and the drag's own direction
        // picks between them. Down is where the dock is, so a pull
        // within POUR_CONE of straight down hands the window to the
        // genie — the scene's signature gesture, and the one the
        // window's own copy tells you to try. Anything else moves the
        // window, which is what a titlebar does everywhere else. The
        // cone is narrow enough that "down and over" still repositions:
        // only a deliberate pull toward the dock pours.
        if (dy > 0 && Math.abs(dx) <= dy * POUR_CONE) {
          if (api.current.beginGrabMinimize(g.win)) {
            const a = api.current.airOf(g.win)
            if (a) beginGrip(e, g.win, genieWarp(0.5, 0.5, 0, a.f.params).y, 0)
          }
          return
        }
        const el = api.current.elOf(g.win)
        const desk = api.current.desk()
        if (!el || !desk) {
          gest.current = { kind: 'idle' }
          return
        }
        const r = el.getBoundingClientRect()
        const p = api.current.posOf(g.win)
        gest.current = {
          kind: 'move',
          id: g.id,
          win: g.win,
          el,
          x0: g.x0,
          y0: g.y0,
          ox: p.x,
          oy: p.y,
          lx: p.x,
          ly: p.y,
          // A window may hang off an edge of the desk; it may not be
          // lost over one, and it may never end up behind the dock
          // where its own bay is. KEEP is the graspable remainder — a
          // titlebar's worth, in every direction.
          bounds: {
            minX: desk.left + KEEP - r.right,
            maxX: desk.right - KEEP - r.left,
            minY: desk.top - r.top,
            maxY: desk.bottom - KEEP - r.top,
          },
        }
        // Captured on the WINDOW, not the canvas: the canvas is
        // pointer-events:none whenever nothing is airborne, which is
        // most of the time a window gets dragged.
        try {
          el.setPointerCapture(g.id)
        } catch {
          /* a pointer that already ended cannot be captured — fine */
        }
        hold()
      } else if (g.kind === 'armed-tile' && e.pointerId === g.id) {
        if (g.y0 - e.clientY >= CLAIM_PX && api.current.beginGrabRestore(g.win)) {
          const a = api.current.airOf(g.win)
          if (a) beginGrip(e, g.win, genieWarp(0.5, 0.5, 1, a.f.params).y, 1)
        }
      } else if (g.kind === 'move' && e.pointerId === g.id) {
        g.lx = g.ox + clamp(e.clientX - g.x0, g.bounds.minX, g.bounds.maxX)
        g.ly = g.oy + clamp(e.clientY - g.y0, g.bounds.minY, g.bounds.maxY)
        // Written straight to the element rather than through state. A
        // re-render per pointermove would rebuild the window's whole
        // subtree — and every OTHER window's, including any airborne
        // copy, which repaints and re-uploads a texture for each pixel
        // the hand travels. React hears about it once, on release.
        g.el.style.setProperty('--dx', `${g.lx}px`)
        g.el.style.setProperty('--dy', `${g.ly}px`)
      } else if (g.kind === 'grab' && e.pointerId === g.id) {
        const a = api.current.airOf(g.win)
        if (!a) return
        // Relative, not absolute: the hand carries the midline by ITS
        // OWN displacement (screen y down = world y down), so the grab
        // never teleports the sheet under the cursor.
        a.drive.grabT = genieGrabSolve(g.midY0 - (e.clientY - g.handY0), a.f.params)
      }
    }

    const commitGrab = (win: WinId, v: number) => {
      const a = api.current.airOf(win)
      if (!a) return
      a.drive.target = driveCommit(a.drive.t, v, DRIVE_DEFAULTS)
      a.drive.mode = 'spring'
    }

    const onUp = (e: PointerEvent) => {
      if (!e.isTrusted) return
      const g = gest.current
      if (g.kind === 'idle' || e.pointerId !== g.id) return
      gest.current = { kind: 'idle' }
      if (g.kind === 'armed-tile') {
        // Never claimed: it was a click. The tile pours the window back.
        api.current.clickRestore(g.win, e.shiftKey)
        return
      }
      if (g.kind === 'move') {
        try {
          g.el.releasePointerCapture(g.id)
        } catch {
          /* already released */
        }
        release()
        api.current.moveTo(g.win, g.lx, g.ly)
        return
      }
      if (g.kind === 'grab') {
        endGrip(g.id)
        commitGrab(g.win, api.current.airOf(g.win)?.drive.v ?? 0)
      }
    }

    const onCancel = (e: PointerEvent) => {
      const g = gest.current
      if (g.kind === 'idle' || e.pointerId !== g.id) return
      gest.current = { kind: 'idle' }
      if (g.kind === 'move') {
        release()
        api.current.moveTo(g.win, g.lx, g.ly)
        return
      }
      if (g.kind === 'grab') {
        endGrip(g.id)
        commitGrab(g.win, 0)
      }
    }

    // Escape abandons the gesture without committing it — the oldest
    // promise a drag makes anywhere, and the reason it is safe to start
    // one to see what happens. A move snaps back to the offset React
    // still believes in, so the abort writes the element and no state at
    // all; a scrub hands the sheet to the spring aimed at `home`.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const g = gest.current
      if (g.kind === 'idle') return
      gest.current = { kind: 'idle' }
      if (g.kind === 'move') {
        try {
          g.el.releasePointerCapture(g.id)
        } catch {
          /* already released */
        }
        release()
        g.el.style.setProperty('--dx', `${g.ox}px`)
        g.el.style.setProperty('--dy', `${g.oy}px`)
        return
      }
      if (g.kind === 'grab') {
        endGrip(g.id)
        const a = api.current.airOf(g.win)
        if (a) {
          a.drive.target = g.home
          a.drive.mode = 'spring'
        }
      }
    }

    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('keydown', onKey, true)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [gl, camera, scene, api])
  return null
}

// ── the page ────────────────────────────────────────────────────────────

export function GenieApp({ chips }: { chips?: React.ReactNode }) {
  // Which windows are in the air and which way each is going. Everything
  // that used to be one slot is now keyed by window, and nothing else
  // changed to make that true — the law and the drive were always
  // written about ONE sheet and never knew how many there were.
  const [air, setAir] = useState<Partial<Record<WinId, Dir>>>({})
  // Which windows are inside their bay, and the paint order of them all
  // (last = frontmost). Desktop convention throughout: pressing a window
  // raises it, restoring one brings it to the front, and MINIMIZING one
  // does not move it at all — you put a window away, you did not promote
  // or demote it, and it has to be where you left it when it comes back.
  const [docked, setDocked] = useState<WinId[]>([])
  // Back to front, and NOT the dock's order. The studies cascade down
  // and right, so the up-left one has to be on top: a down-right shadow
  // is only ever visible falling onto something BEHIND its window, and
  // with the cascade stacked the other way every study covers the shadow
  // of the one above it and the three read as flat cutouts. The working
  // window is frontmost because it is the one with controls in it.
  const [order, setOrder] = useState<WinId[]>(['triangolo', 'cerchio', 'quadrato', 'scheda'])
  // Where the hand has left each window, relative to its place in the
  // layout. Set once per drag, on release: the drag itself writes the
  // element directly (see GestureRig), so a re-render never happens
  // under a moving hand.
  const [pos, setPos] = useState<Partial<Record<WinId, { x: number; y: number }>>>({})
  const [painted, setPainted] = useState<Partial<Record<WinId, boolean>>>({})
  // The sheet has been DRAWN at least once — which is not the same fact
  // as `painted`, and the difference is a hole in the desk.
  //
  // `painted` says the texture has pixels. It reaches two places: the
  // sheet's `visible` in the Canvas tree, and the page copy's `data-away`
  // in the DOM tree. Those are two reconcilers. One state change, two
  // commits, and nothing schedules them together — so the DOM can hide
  // the window a frame or two before the Canvas gets round to drawing
  // the sheet, and for those frames the desk shows neither. The window
  // blinks out and comes back at the position it has not left yet.
  //
  // On an idle machine the two commits land in the same frame every
  // time; the gap is real and zero frames wide, which is the worst width
  // for finding it. Under load it opens (instruments/genie-drain/
  // rest-blink.mjs runs at 1/6 CPU for exactly this reason).
  //
  // So the hide waits on the SHEET, not on the texture. Flight reports
  // this from inside the frame loop, off the group's own `visible` —
  // the scene graph's answer rather than a prop's, so it cannot be early.
  // The two copies now overlap by a frame instead of leaving a gap, and
  // an overlap at the wall is invisible: the sheet is drawn exactly over
  // the window it came from.
  const [shown, setShown] = useState<Partial<Record<WinId, boolean>>>({})
  // The airborne film has a frame in it. A third fact, and again not the
  // one before it: `painted` says the texture has PIXELS, and a window of
  // video has pixels while its <video> is still seeking — black ones.
  //
  // Every other window's airborne copy is markup, which is a picture the
  // instant it is attached. The film's copy is a fresh <video> that has
  // to seek to the page copy's position, and a seeking element presents
  // no frame at all. The capture replays that honestly as an empty box:
  // one composited frame of pure black on an idle machine, five under
  // load (instruments/genie-drain/film-stays-lit.mjs).
  //
  // So the sheet does not go up until the picture is in it, and the wait
  // is the seek — 12ms, 20ms at its worst. The page copy stands there
  // meanwhile, which is exactly what `shown` above already arranges.
  const [lit, setLit] = useState<Partial<Record<WinId, boolean>>>({})
  // Which bays are still ringing. The one React-visible piece of ring
  // state, because it is what the frameloop expression needs — a ring
  // outlives its landing, so "something is moving" is wider than
  // "something is in the air". The numbers themselves live in refs.
  const [ringing, setRinging] = useState<WinId[]>([])
  // The window's content state lives HERE, above both copies, which is
  // what makes them pixel-identical at the swap frames: page copy and
  // airborne copy render the same component from the same values.
  const [note, setNote] = useState('')
  const [checked, setChecked] = useState(true)

  const deskRef = useRef<HTMLDivElement | null>(null)
  const winRefs = useRef<Partial<Record<WinId, HTMLDivElement | null>>>({})
  const slotRefs = useRef<Partial<Record<WinId, HTMLButtonElement | null>>>({})
  // The live flights, by window. A ref and not state: a DriveBox is
  // written 60 times a second by the frame loop and read by the hand,
  // and none of that is anything React should see. `air` above is the
  // React-visible shadow of this map's key set.
  const flights = useRef(new Map<WinId, Airborne>())
  const rings = useRef(new Map<WinId, Ring>())
  // Windows that owe the keyboard a place to land. `visibility: hidden`
  // blurs whatever it was covering, so a minimize drops focus on <body>
  // and the next Tab restarts at the top of the dock, on somebody else's
  // bay — a keyboard user loses the window AND their place in one press.
  // The bay inherits the focus its window had and hands it back on the
  // way out, which is only correct when the focus was in there to begin
  // with: otherwise minimizing one window with the mouse would yank the
  // caret out of whatever you were typing in another.
  const wantsFocus = useRef(new Set<WinId>())
  // Drained on the commit that settles the flight, which is the first
  // moment the window's own controls are focusable again. A restore that
  // gets flicked back into its bay settles docked instead, and forfeits
  // the claim — the tile it came from still has the focus anyway.
  useEffect(() => {
    for (const id of wantsFocus.current) {
      if (air[id]) continue
      wantsFocus.current.delete(id)
      if (docked.includes(id)) continue
      winRefs.current[id]?.querySelector<HTMLElement>('.gen-lamp[data-role="minimize"]')?.focus()
    }
  }, [docked, air])

  const airborne = WIN_IDS.filter((w) => air[w])
  const anyAir = airborne.length > 0
  // The page copy hides only once the sheet has been drawn (minimize),
  // and stays hidden until the sheet has fully landed home (a rest
  // landing unhides it in the same commit that unmounts the sheet).
  const hiddenFor = (win: WinId) => {
    const a = air[win]
    return a ? a === 'restoring' || !!shown[win] : docked.includes(win)
  }
  // The active window: the last one raised that is still on the desk.
  // Everything behind it dims, which is the oldest signal a stack of
  // windows has for saying which one the keyboard is talking to.
  // A window on its way OUT of the dock counts as being on the desk
  // already. `docked` does not drop it until it lands, so without this
  // clause the window you just expanded flies in wearing the background
  // treatment and snaps to active on the last frame — and because
  // `front` is read inside the capture root, that snap is IN THE
  // TEXTURE, not a page-side detail the flight hides.
  const front =
    [...order].reverse().find((w) => !docked.includes(w) || air[w] === 'restoring') ?? null

  const slotOf = (win: WinId) => slotRefs.current[win] ?? null
  const ringOf = (win: WinId): Ring => {
    let r = rings.current.get(win)
    if (!r) {
      r = { t: 0, v: 0 }
      rings.current.set(win, r)
    }
    return r
  }
  // A dock landing kicks its bay's ring with the arrival speed. Reduced
  // motion keeps the swell (state synchronized to the user's own
  // gesture, not decoration) but zeroes the reaction to it.
  const kickRing = (win: WinId, vPxPerS: number) => {
    const r = ringOf(win)
    r.t = 0
    r.v = REDUCE_MOTION ? 0 : vPxPerS
    setRinging((rs) => (rs.includes(win) ? rs : [...rs, win]))
  }
  // Returning the SAME array when nothing changed is what keeps this
  // from re-rendering the page every frame: React bails on an identical
  // reference, and this is called from inside the frame loop.
  const stopRing = (win: WinId) =>
    setRinging((rs) => (rs.includes(win) ? rs.filter((x) => x !== win) : rs))
  const raise = (win: WinId) =>
    setOrder((o) => (o[o.length - 1] === win ? o : [...o.filter((x) => x !== win), win]))

  // Both gestures measure at the moment of the press: visibility:hidden
  // keeps the window's box in flow, so the rects are always live.
  const measure = (id: WinId, slow: boolean, duration: number): GenieFlight | null => {
    const win = winRefs.current[id]?.getBoundingClientRect()
    const slotEl = slotRefs.current[id]
    const slot = slotEl?.getBoundingClientRect()
    if (!win || !slotEl || !slot) return null
    // The window inside the capture root. The difference between the two
    // boxes IS the shade's band, so the drop stays stated once, in CSS.
    const inner = winRefs.current[id]
      ?.querySelector('.gen-window')
      ?.getBoundingClientRect()
    const wx = win.left + win.width / 2 - window.innerWidth / 2
    const wy = window.innerHeight / 2 - (win.top + win.height / 2)
    const mx = slot.left + slot.width / 2 - window.innerWidth / 2
    const my = window.innerHeight / 2 - slot.top
    return {
      w: win.width,
      h: win.height,
      wx,
      wy,
      shade: inner
        ? [inner.width / win.width, inner.height / win.height]
        : [1, 1],
      params: {
        w: win.width,
        h: win.height,
        // Both read off the live rect, and both are invariant under the
        // bay's swell: transform-origin is 50% 0, so a scale moves
        // neither the centre x nor the top edge.
        dockX: mx - wx,
        dockY: my - wy,
        // The full half-width, not inset: the pour's bottom edge is the
        // icon's width exactly, so the sheet lands the same size as the
        // thing that swallows it. The flight scales this by the bay's
        // live swell each frame — which is exactly why the width here
        // must be the bay's RESTING one, and why this is the one number
        // that cannot come off the rect. A restore takes off from a bay
        // that is already holding a window and therefore already swollen
        // 1.34x; measured through the transform, that swell gets applied
        // a second time and the sheet pours out of a mouth a third wider
        // than the container it is pouring out of. offsetWidth is the
        // border box before any transform, which is the mouth the law
        // means. (Measured at 1.326x on a slow restore, 2026-08-09.)
        slotHalf: slotEl.offsetWidth / 2,
        ...GENIE_DEFAULTS,
      },
      duration: duration * (slow ? SLOW : 1),
    }
  }

  // Every takeoff runs through here. The only thing refused is a SECOND
  // flight of the same window — one sheet cannot be minimizing and
  // restoring at once — and a window already on the side of the dock it
  // is being asked to fly to. Other windows are none of its business.
  const takeOff = (id: WinId, to: Dir, d: DriveBox, slow: boolean): boolean => {
    if (flights.current.has(id)) return false
    if (docked.includes(id) !== (to === 'restoring')) return false
    const f = measure(id, slow, to === 'restoring' ? RESTORE_S : MINIMIZE_S)
    if (!f) return false
    flights.current.set(id, { f, drive: d })
    // The two directions are NOT symmetric. A restore is a window coming
    // back to work, so it arrives in front — and this is its only chance
    // to say so, since its press landed on a dock tile and not on the
    // window. A minimize is a window being put away, and putting
    // something away is not a promotion: it keeps the rung it had, so the
    // window you were actually reading does not blink out of focus for
    // half a second every time you dock one of the others.
    if (to === 'restoring') raise(id)
    // Hand the keyboard over before the page copy hides, not after: once
    // it is hidden the focus is already on <body> and there is nothing
    // left to read the intent off.
    //
    // :focus-visible is doing the real work here, and "focus is inside
    // this window" on its own is not enough — Chrome focuses a <button>
    // on mousedown, so the click that starts the minimize satisfies that
    // test by itself, and docking one window with the mouse would pull
    // the caret out of whatever you were typing in another. The pseudo-
    // class is the browser's own answer to "was this a keyboard's doing",
    // which is exactly the question, and it is better calibrated than
    // anything this scene could infer.
    const active = document.activeElement
    if (to === 'minimizing') {
      if (active?.matches(':focus-visible') && winRefs.current[id]?.contains(active))
        slotRefs.current[id]?.focus()
    } else {
      // Expanding a window hands it the keyboard NOW, not on landing.
      // The bay it came from is emptying under the focus otherwise, and
      // a window that is visibly on its way to the front should already
      // be the one keys are talking to — the same promise the raise
      // above makes to the eye. The wrapper takes it because the
      // window's own controls are inside the hidden subtree for the
      // whole flight; the settle below moves it onto a real control.
      winRefs.current[id]?.focus({ preventScroll: true })
      // The keyboard hand-back is claimed only when the keyboard asked.
      // A mouse restore leaves focus on the wrapper, which is where a
      // click on a window puts it anyway — no ring, nothing to read.
      if (active === slotRefs.current[id]) wantsFocus.current.add(id)
    }
    setPainted((p) => ({ ...p, [id]: false }))
    setShown((s) => ({ ...s, [id]: false }))
    setLit((l) => ({ ...l, [id]: false }))
    setAir((a) => ({ ...a, [id]: to }))
    return true
  }

  const beginMinimize = (id: WinId, slow: boolean) => {
    takeOff(id, 'minimizing', restingDrive(), slow)
  }

  const beginGrabMinimize = (id: WinId) =>
    takeOff(id, 'minimizing', { ...restingDrive(), mode: 'grab', t: 0, grabT: 0 }, false)

  const clickRestore = (id: WinId, slow: boolean) => {
    takeOff(id, 'restoring', { ...restingDrive(), t: 1, target: 0 }, slow)
  }

  const beginGrabRestore = (id: WinId) =>
    takeOff(id, 'restoring', { ...restingDrive(), mode: 'grab', t: 1, grabT: 1, target: 0 }, false)

  // Where the sheet lands decides the next custody, not which phase it
  // took off from — a minimize caught and flung home lands resting, a
  // restore flicked back down lands docked.
  const onLand = (id: WinId, wall: 0 | 1) => {
    flights.current.delete(id)
    setDocked((ds) => (wall === 1 ? [...ds.filter((x) => x !== id), id] : ds.filter((x) => x !== id)))
    // No raise here in either direction. A restore claimed the front at
    // takeoff; a minimize you changed your mind about and flung home has
    // to land on the exact rung it left, or an abandoned gesture would
    // reorder the desk as a souvenir.
    setAir((a) => {
      const next = { ...a }
      delete next[id]
      return next
    })
    setPainted((p) => {
      const next = { ...p }
      delete next[id]
      return next
    })
    setShown((s) => {
      const next = { ...s }
      delete next[id]
      return next
    })
    setLit((l) => {
      const next = { ...l }
      delete next[id]
      return next
    })
  }

  // Fired by the airborne film, so it has to survive the re-renders that
  // send new content into the capture root — an unstable callback would
  // re-run the <video>'s ref and start the whole seek again.
  const tellPicture = useCallback((win: WinId) => {
    setLit((l) => (l[win] ? l : { ...l, [win]: true }))
  }, [])

  // `airborne` is the only difference between the two copies of a window,
  // and it is one fact: the desk's copy is already a picture, so nobody
  // is waiting on it to say so.
  const bodyFor = (scheda: Scheda, airborne?: boolean) => (
    <WindowBody
      scheda={scheda}
      front={front === scheda.id}
      note={note}
      setNote={setNote}
      checked={checked}
      setChecked={setChecked}
      onMinimize={(slow) => beginMinimize(scheda.id, slow)}
      onPicture={airborne ? () => tellPicture(scheda.id) : undefined}
    />
  )

  const api: GestureApi = {
    anyAir,
    airOf: (win) => flights.current.get(win),
    dirOf: (win) => air[win],
    beginGrabMinimize,
    beginGrabRestore,
    clickRestore,
    raise,
    elOf: (win) => winRefs.current[win] ?? null,
    posOf: (win) => pos[win] ?? { x: 0, y: 0 },
    moveTo: (win, x, y) => setPos((p) => ({ ...p, [win]: { x, y } })),
    desk: () => deskRef.current?.getBoundingClientRect() ?? null,
  }
  const apiRef = useRef<GestureApi>(api)
  apiRef.current = api

  return (
    <div className="gen-page">
      <header className="gen-head">
        <h1>
          mun<em>ari</em>
        </h1>
        {chips}
      </header>

      {/* Mapped in SCHEDE order and never re-sorted: raising a window has
          to be a z-index, not a move, or React would tear the pressed
          window out of the DOM and rebuild it under the hand — which,
          now that a press can be the start of a drag, would also drop
          the pointer capture the drag is holding. */}
      <div className="gen-desk" ref={deskRef}>
        {SCHEDE.map((s) => (
          <div
            key={s.id}
            ref={(el) => {
              winRefs.current[s.id] = el
            }}
            className="gen-slot"
            data-win={s.id}
            // The hide moved off this element and onto its CONTENTS
            // (genie.css). A `visibility: hidden` box cannot hold focus,
            // and a window being expanded has to hold it from the first
            // frame of the flight — its own DOM is hidden for the whole
            // excursion, so if the wrapper cannot take the keyboard then
            // nothing can, and focus sits on a dock bay that is in the
            // middle of emptying. The wrapper paints nothing itself, so
            // hiding one level down looks identical.
            data-away={hiddenFor(s.id) ? 'true' : undefined}
            // Programmatic focus only — never in the tab ring, because
            // the window's own controls are what a tab should land on.
            tabIndex={-1}
            style={
              {
                zIndex: order.indexOf(s.id) + 1,
                // The drag's committed offset. During a drag these two
                // are written straight to the element and this object
                // holds the value from BEFORE it — which is safe only
                // because React diffs style property by property against
                // its own last render, never against the DOM, so an
                // unchanged `--dx` here is not re-asserted over the
                // hand's.
                '--dx': `${pos[s.id]?.x ?? 0}px`,
                '--dy': `${pos[s.id]?.y ?? 0}px`,
              } as React.CSSProperties
            }
            onPointerDown={(e) => {
              // Everything on a window raises it except its own lamps.
              // Same reason the Dock button doesn't: the lamps act on a
              // background window in place, so you can put the thing
              // behind away without it stepping in front on the way down.
              if ((e.target as HTMLElement).closest('.gen-lamp')) return
              raise(s.id)
            }}
          >
            {bodyFor(s)}
          </div>
        ))}
      </div>

      {/* Four bays holding drafting marks — Munari's quadrato, cerchio,
          triangolo, and one small window wireframe. One shared hairline
          weight, so the marks read as one drawing. */}
      <div className="gen-dock">
        {SCHEDE.map((s) => {
          const full = docked.includes(s.id)
          return (
            <button
              key={s.id}
              ref={(el) => {
                slotRefs.current[s.id] = el
              }}
              className="gen-tile"
              data-role="window"
              data-win={s.id}
              data-filled={full}
              aria-label={full ? `restore ${s.title}` : `${s.title} — on the desk`}
              // GestureRig's onUp also fires clickRestore for an unclaimed
              // armed-tile press — the two paths answer the same click, and
              // clickRestore is guarded, so a double call is harmless.
              onClick={(e) => clickRestore(s.id, e.shiftKey)}
            >
              {/* The pane is drawn first and filled by CSS on the state
                  flip: a container that holds something reads as
                  occupied, not just as bigger. The outline strokes over
                  it, so the mark itself never goes anywhere. */}
              {/* Sized to the bay, not to a fraction of it. The pour
                  ends at the bay's TOP edge — that is where the law
                  aims and where the seam is drawn — so every pixel
                  between that edge and the mark's ink is dead space in
                  the one place the eye is watching two things meet. At
                  26px in a 52px bay the mark's ink began about 19px
                  down: the window vanished into a red line and the
                  symbol it was supposed to have entered sat a third of
                  a tile below, with blank card in between. 46px inside
                  a 50px content box brings the ink up to ~9px, which
                  is an icon's inset rather than a gap.

                  The viewBox stays 20, so the marks keep their drawn
                  proportions and only the scale changes — but stroke
                  is in user units and rides that scale, so the marks
                  carry 0.9 rather than 1.5 to land at the same ~2px on
                  screen they had at 26px. A mark that grew its line
                  along with itself would read as a heavier dock, which
                  is not what was asked for. */}
              <svg viewBox="0 0 20 20" width="46" height="46" aria-hidden>
                {s.mark}
              </svg>
            </button>
          )
        })}
      </div>

      <Canvas
        className="gen-overlay"
        // Inline, not a class: r3f writes position/pointer-events onto its
        // wrapper as inline styles and wins against any stylesheet.
        //
        // The z-index is not decoration and it is not "high enough to be
        // safe" — it is the one number that keeps the sheet in the stack
        // it left. CSS paints positioned boxes with `z-index: auto` in a
        // layer strictly BELOW every positive z-index (2.1 Appendix E,
        // steps 6 and 7), so the moment the desk gave its windows a
        // stacking order this overlay fell underneath all four of them,
        // and every sheet flew home behind the windows it took off from.
        // Nothing in the scene's own state was wrong; the sheet was
        // simply in a lower layer than the desk. The desk's windows are
        // 1..n, so anything above n restores custody — and the number is
        // stated here rather than in a stylesheet because r3f writes this
        // wrapper's inline styles and would win against one.
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: OVERLAY_Z }}
        gl={{ alpha: true, antialias: true }}
        // A ring outlives the landing that kicked it, so "something is
        // moving" is wider than "something is in the air" — and both are
        // now sets rather than single facts.
        frameloop={anyAir || ringing.length > 0 ? 'always' : 'demand'}
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => state.gl.setClearAlpha(0)}
      >
        <PixelPerfect />
        <SolidWhereMatterIs active={anyAir} />
        <GestureRig api={apiRef} />
        <Bays
          slotOf={slotOf}
          ringOf={ringOf}
          ringing={ringing}
          held={airborne}
          docked={docked}
          stopRing={stopRing}
        />
        {airborne.map((win) => {
          const a = flights.current.get(win)
          const s = SCHEDE.find((x) => x.id === win)
          if (!a || !s) return null
          return (
            <Flight
              key={win}
              win={win}
              dir={air[win] as Dir}
              air={a}
              ring={ringOf(win)}
              ringing={ringing.includes(win)}
              // Both facts, and the film window needs both: a texture
              // with pixels in it whose <video> is still seeking is a
              // black rectangle, and a black rectangle is worse than
              // waiting one more frame for the page copy.
              ready={!!painted[win] && (win !== FILM_WIN || !!lit[win])}
              stack={order.indexOf(win)}
              slotOf={slotOf}
              kickRing={kickRing}
              onPainted={(w) => setPainted((p) => (p[w] ? p : { ...p, [w]: true }))}
              onShown={(w) => setShown((s) => (s[w] ? s : { ...s, [w]: true }))}
              onLand={onLand}
              content={bodyFor(s, true)}
            />
          )
        })}
      </Canvas>
    </div>
  )
}
