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
// sees; and both handoffs happen at exact identities. The law
// (genieLaw.ts) owns shape, the drive (genieDrive.ts) owns time, and a
// landing's leftover momentum is consumed by a settle wobble whose
// perceptual budget — sub-half-pixel within 350ms — is pinned by test.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { flushSync } from 'react-dom'
import * as THREE from 'three'
import {
  createSurface,
  deformSurfaceGeometry,
  Surface,
  type SurfaceHandle,
  SurfaceCanvas,
  type PresentationReceipt,
  type SourceUvRect,
  type SurfacePresentation,
  useSurfaceAnchorRects,
  useSurfaceChrome,
  useSurfaceDriver,
  useSurfacePaintedSize,
  useSurfaceSourceRoot,
  useSurfaceTexture,
  useSurfaceUniforms,
  useSurfaceSupport,
} from '@petepetrash/munari'
import {
  cameraDistance,
  FrameSurface,
  paintStats,
  presentationReceiptSatisfies,
  surfaceManualPresenter,
  type FrameDrawReceipt,
  type FrameId,
  type FrameSource,
  type PresentationRequirement,
  type SurfaceManualPresenter,
  useFrameTexture,
} from '@petepetrash/munari/advanced'
import {
  GENIE_DEFAULTS,
  SETTLE_DEFAULTS,
  genieGrabSolve,
  genieRestBottomVelocity,
  genieSettle,
  genieSettleDone,
  genieWarp,
  type GenieParams,
} from './genieLaw'
import {
  DRIVE_DEFAULTS,
  driveCommit,
  driveGrabStep,
  drivePresentationStep,
  driveSpringStep,
  easeInCubic,
  pourOut,
} from './genieDrive'
import { dockFill, dockPose, dockRingDone, dockSwell } from './genieDock'
import { BOUNCE_MARKS, registerBounceCourt } from './genieBounce'
import { genieTuning } from './genieTuning'
import { GenieTweakPanel } from './GenieTweaks'
import { showChrome } from '../../bareMode'
import {
  GENIE_FILM_FRAG,
  GENIE_FRAG,
  GENIE_VERT,
} from './genieShaders'
import {
  GENIE_FILM_HEIGHT,
  GENIE_FILM_WIDTH,
  createGenieFilmController,
  type GenieFilmController,
} from './genieFilm'
// Archival footage, cut and encoded by tools/make-film.sh. The clip it
// replaced was generated, so its recipe was its source; this one is a
// binary, and a binary cannot explain itself — the take, the crop, and
// the exact encode live in that script, and where the footage came from
// lives in film.provenance.md beside the file. Imported rather than
// served from public/ so the bundler hashes it and a missing file is a
// build error rather than a 404 in front of a visitor.
import filmUrl from './film.mp4'
import { closestFrom } from '../../lib/dom'
import { plainAttribute } from '../../lib/geometry'
import './genie.css'

const FOV = 42
// Subdivision is vertical-heavy: the funnel's curvature lives almost
// entirely in y, and a flat sheet renders identically at any tessellation
// so the rest cost is zero.
const GRID_X = 24
const GRID_Y = 96
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
  /** Untransformed half-height of the visible SVG mark, in CSS pixels. */
  markHalf: number
  duration: number
  /** Where the window ends and its shade begins, as a fraction of the
   *  capture root: (windowW / rootW, windowH / rootH). Measured off the
   *  live boxes at press time like everything else here, so the drop is
   *  never a number this file knows — and (1, 1) for a window with no
   *  shade at all, which switches the shader's fade off by arithmetic
   *  rather than by a branch. */
  shade: [number, number]
  /** Present only for the one window whose pixels come from the shared film source. */
  film?: {
    source: FrameSource
    required: FrameId
    token: number
    presentation: PresentationRequirement
    /** Bottom corner radius in source CSS pixels. */
    radius: number
  }
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
  /** Progress actually drawn. It only differs from t while catching up
   *  after a hand moved during the hidden texture handoff. */
  visibleT: number
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
  visibleT: 0,
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
        <rect className="gen-icon-base" x="1.4" y="1.4" width="17.2" height="17.2" rx="0.8" />
        <rect className="gen-pane" x="1.4" y="1.4" width="17.2" height="17.2" rx="0.8" />
        <rect className="gen-icon-line" x="1.4" y="1.4" width="17.2" height="17.2" rx="0.8" />
      </>
    ),
  },
  {
    id: 'cerchio',
    title: 'cerchio',
    mark: (
      <>
        <circle className="gen-icon-base" cx="10" cy="10" r="8.8" />
        <circle className="gen-pane" cx="10" cy="10" r="8.8" />
        <circle className="gen-icon-line" cx="10" cy="10" r="8.8" />
      </>
    ),
  },
  {
    id: 'triangolo',
    title: 'triangolo',
    mark: (
      <>
        <path className="gen-icon-base" d="M10 0.9 L19.2 18.6 L0.8 18.6 Z" />
        <path className="gen-pane" d="M10 0.9 L19.2 18.6 L0.8 18.6 Z" />
        <path
          className="gen-icon-line"
          d="M10 0.9 L19.2 18.6 L0.8 18.6 Z"
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
        <rect className="gen-icon-base" x="0.9" y="2.2" width="18.2" height="15.6" rx="0.9" />
        <rect className="gen-pane" x="0.9" y="2.2" width="18.2" height="15.6" rx="0.9" />
        <rect className="gen-icon-line" x="0.9" y="2.2" width="18.2" height="15.6" rx="0.9" />
        <path className="gen-icon-detail" d="M0.9 6.6 L19.1 6.6" />
      </>
    ),
  },
]

/** Dock order, and the order the desk mounts its windows in. Both loops
 *  below walk it, so a window and its bay can never fall out of step. */
const WIN_IDS: WinId[] = SCHEDE.map((s) => s.id)

/** Kept as a set of plain strings so the question below can be ASKED of
 *  one — a dataset attribute and a mesh's userData both hand back strings
 *  the desk may no longer recognise. */
const WIN_ID_SET: ReadonlySet<string> = new Set(WIN_IDS)

/** Does this name still belong to a window on the desk? */
function isWinId(value: string | undefined | null): value is WinId {
  return value !== undefined && value !== null && WIN_ID_SET.has(value)
}

/** A window's Surface identity, held by the desk rather than by a tree.
 *  A flight mounts and unmounts around it; the name does not move. */
const surfaceNameOf = (win: WinId) => `genie-${win}`

/** One window's Surface, and the film presenter that draws over it. The
 *  film composites the frozen generation itself, so it owes the crossing
 *  its own two-stage report — there is no component to make it. */
interface GenieSurface {
  handle: SurfaceHandle
  film: SurfaceManualPresenter
}

/**
 * A window's inline style. React's own CSSProperties has no room for a
 * custom property, so the two the stylesheet reads are named here.
 */
interface WindowVars extends React.CSSProperties {
  '--dx': string
  '--dy': string
}

/**
 * Stack order plus the drag's COMMITTED offset.
 *
 * During a drag the two offsets are written straight to the element and this
 * object holds the value from before it — which is safe only because React
 * diffs style property by property against its own last render, never
 * against the DOM, so an unchanged `--dx` here is not re-asserted over the
 * hand's.
 */
function windowStyle(zIndex: number, at: { x: number; y: number } | undefined): WindowVars {
  return {
    zIndex,
    '--dx': `${at?.x ?? 0}px`,
    '--dy': `${at?.y ?? 0}px`,
  }
}



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
type StudyId = 'quadrato' | 'cerchio'

// ── the window (rendered twice: on the page, and on the sheet) ──────────

type GenieMotionStyle = React.CSSProperties & {
  '--gen-phase'?: string
  '--line-delay'?: string
  '--line-opacity'?: number
}

// Each live copy joins the document clock at the same phase. A newly mounted
// airborne tree therefore matches the DOM tree on its first visible frame.
function useDocumentPhase(): GenieMotionStyle {
  // CSS animations run on the document timeline, which shares its origin
  // with performance.now() — so "minus the time already elapsed" places a
  // freshly mounted copy exactly where a copy mounted at load would be.
  const [shift] = useState<GenieMotionStyle>(() => ({
    '--gen-phase': `-${(performance.now() / 1000).toFixed(3)}s`,
  }))
  return shift
}

function StudyPattern({ kind }: { kind: StudyId }) {
  const phase = useDocumentPhase()
  const lines = Array.from({ length: kind === 'quadrato' ? 7 : 9 })
  return (
    <svg
      className="gen-math-pattern"
      data-pattern={kind}
      style={phase}
      viewBox="0 0 120 120"
      aria-hidden
    >
      {lines.map((_, i) => {
        const style: GenieMotionStyle = {
          '--line-delay': `${i * 0.12}s`,
          '--line-opacity': 0.28 + i * 0.075,
        }
        if (kind === 'quadrato') {
          const inset = 12 + i * 4.8
          return (
            <rect
              key={i}
              className="gen-math-line"
              x={inset}
              y={inset}
              width={120 - inset * 2}
              height={120 - inset * 2}
              rx={1.5 + i * 0.2}
              pathLength="100"
              transform={`rotate(${i * 11.25} 60 60)`}
              style={style}
            />
          )
        }
        return (
          <ellipse
            key={i}
            className="gen-math-line"
            cx="60"
            cy="60"
            rx="46"
            ry="19"
            pathLength="100"
            transform={`rotate(${i * 20} 60 60)`}
            style={style}
          />
        )
      })}
    </svg>
  )
}

// One bouncing mark. The box is the mark's rest diameter; the shared
// simulation (genieBounce.ts) positions it by inline transform, so its
// layout stays put and the capture sees the same numbers the page
// draws. Strokes are non-scaling: the size knob resizes the figure,
// not the pen.
function BounceMark({ index }: { index: number }) {
  const mark = BOUNCE_MARKS[index]
  const d = mark.r * 2
  return (
    <div className="gen-bounce" data-mark={mark.id} style={{ width: d, height: d }}>
      <svg
        className="gen-bounce-figure"
        viewBox="0 0 100 100"
        style={{ color: mark.color }}
        aria-hidden
      >
        {mark.id === 'quadrato' && (
          <rect className="gen-mark-stroke" x="4" y="4" width="92" height="92" rx="6" />
        )}
        {mark.id === 'cerchio' && <circle className="gen-mark-stroke" cx="50" cy="50" r="46" />}
        {mark.id === 'triangolo' && (
          <polygon className="gen-mark-stroke" points="50,5 96,95 4,95" />
        )}
      </svg>
    </div>
  )
}

// The marks' layer, its own component because registering with the
// simulation is per-INSTANCE work and every window exists twice.
function PlayLayer() {
  // Live content, not decoration. These keep bouncing while the sheet is
  // being warped, which is the claim the whole scene exists to make: what
  // flies is a running page sampled every frame, not a photograph of one
  // taken at press time.
  //
  // Joining the ONE simulation is what keeps the two copies honest:
  // the page copy and the airborne copy draw the same bodies at the
  // same instant, so the handoff has nothing to jump. The old
  // phase-pinning dance (startTime = 0 on every animation) is gone
  // with the compositor animations that needed it. Layout effect, so
  // the copy is in position before its first paint.
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => registerBounceCourt(root.current!), [])
  return (
    <div className="gen-play" aria-hidden ref={root}>
      {BOUNCE_MARKS.map((mark, i) => (
        <BounceMark key={mark.id} index={i} />
      ))}
    </div>
  )
}

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

function FilmLayer({ attach }: { attach?: React.RefCallback<HTMLCanvasElement> }) {
  return (
    <canvas
      ref={attach}
      className="gen-film"
      data-munari-anchor="film"
      width={GENIE_FILM_WIDTH}
      height={GENIE_FILM_HEIGHT}
      aria-hidden
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
  /** Only the page copy gets the persistent film canvas. */
  attachFilmCanvas?: React.RefCallback<HTMLCanvasElement>
}

// The capture root is `.gen-sheet`, not `.gen-window`, and the extra box
// is the shadow's. A box-shadow lies OUTSIDE the border box, which is
// outside the texture — it would sit on the desk at rest and vanish the
// instant the window took flight. Flight builds a WebGL twin for exactly
// this reason; the genie does not need one, because a hard offset shadow
// can simply be painted INSIDE the root, and paint survives the handoff
// untouched. It pours into the dock along with everything else,
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
  attachFilmCanvas,
}: WindowBodyProps) {
  const study: StudyId | null =
    scheda.id === 'quadrato' || scheda.id === 'cerchio' ? scheda.id : null
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
            if (closestFrom(e.target, '.gen-lamp')) return
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
          <button type="button" className="gen-lamp" aria-hidden tabIndex={-1} onMouseDown={noFocus} />
          <button
            type="button"
            className="gen-lamp"
            data-role="minimize"
            aria-label={`minimize ${scheda.title}`}
            onMouseDown={noFocus}
            onClick={(e) => onMinimize(e.shiftKey)}
          />
          <button type="button" className="gen-lamp" aria-hidden tabIndex={-1} onMouseDown={noFocus} />
          <span className="gen-title">{scheda.title}</span>
        </div>
        {scheda.id === FILM_WIN ? (
          // Borderless: the body's own padding would frame the film, and
          // a film with a mat around it is a picture of a film.
          <div className="gen-body" data-fill="film">
            <FilmLayer attach={attachFilmCanvas} />
          </div>
        ) : study ? (
          <div className="gen-body" data-study={study}>
            <div className="gen-figure" aria-hidden>
              <StudyPattern kind={study} />
            </div>
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
  // SAFETY: r3f types the store's camera as the base class and hands back a
  // PerspectiveCamera unless the Canvas asks for `orthographic`. This one
  // does not, and could not: fitting the frustum to the viewport is what
  // makes a CSS pixel a world unit, and orthographic has no fov to fit.
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
  const surface = useSurfaceUniforms()
  const uniforms = useMemo(
    () => ({
      ...surface,
      uShadeEdge: { value: new THREE.Vector2(1, 1) },
      uShadeFade: { value: new THREE.Vector2(SHADE_FADE[0], SHADE_FADE[1]) },
    }),
    [surface],
  )
  uniforms.uShadeEdge.value.set(shade[0], shade[1])
  // Surface creates every DOM texture premultiplied (decisions.md #5).
  // This material only owns the matching blend rule below.
  return (
    <shaderMaterial
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

/** The film's own box inside the window capture, named on the canvas that
 *  holds it. One key, but the transaction rule is the point: the composite
 *  is withheld until a whole set describes the generation on this
 *  geometry, so the shader can never cut a hole where the film used to be. */
const FILM_ANCHORS = ['film'] as const

interface FilmCompositeMaterialProps {
  chromeTexture: THREE.Texture
  film: NonNullable<GenieFlight['film']>
  /** The film's box in the outer capture, once the anchor set is whole. */
  uv: SourceUvRect | null
  shade: [number, number]
  width: number
  height: number
  ref: React.RefObject<THREE.ShaderMaterial | null>
}

function FilmCompositeMaterial({
  chromeTexture,
  film,
  uv,
  shade,
  width,
  height,
  ref,
}: FilmCompositeMaterialProps) {
  const filmTexture = useFrameTexture()
  const uniforms = useMemo(
    () => ({
      tMap: { value: chromeTexture },
      tFilm: { value: filmTexture },
      uMunariRadii: { value: new THREE.Vector4(0, 0, 0, 0) },
      uMunariSize: { value: new THREE.Vector2(1, 1) },
      uShadeEdge: { value: new THREE.Vector2(1, 1) },
      uShadeFade: { value: new THREE.Vector2(SHADE_FADE[0], SHADE_FADE[1]) },
      uFilmRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFilmRadius: { value: 0 },
    }),
    [chromeTexture, filmTexture],
  )
  uniforms.tMap.value = chromeTexture
  uniforms.tFilm.value = filmTexture
  uniforms.uMunariSize.value.set(width, height)
  uniforms.uShadeEdge.value.set(shade[0], shade[1])
  if (uv) {
    uniforms.uFilmRect.value.set(uv.uMin, 1 - uv.vMax, uv.uMax - uv.uMin, uv.vMax - uv.vMin)
  }
  uniforms.uFilmRadius.value = film.radius

  return (
    <shaderMaterial
      ref={ref}
      // The first child render has no FrameSurface texture. Rebuild the
      // material when either sampler appears; reusing the first uniforms
      // object leaves Three bound to that initial null value.
      key={`${chromeTexture.uuid}:${filmTexture?.uuid ?? 'none'}`}
      uniforms={uniforms}
      vertexShader={GENIE_VERT}
      fragmentShader={GENIE_FILM_FRAG}
      transparent
      premultipliedAlpha
      depthWrite={false}
      toneMapped={false}
      side={THREE.DoubleSide}
      // Off at birth and written from the frame loop (Flight below). Two
      // facts have to be true before this composite may be SEEN and both
      // turn inside a frame rather than in a commit: the crossing has given
      // the canvas presentation authority, and the frozen film generation
      // is the one on this geometry. Declared here as well so a re-render
      // between those frames cannot show the film early.
      colorWrite={false}
    />
  )
}

interface FilmCompositeProps {
  f: GenieFlight
  /** The name the outer Surface paints under — the paint ledger's key. */
  paintName: string
  token: number
  geometry: React.RefObject<THREE.PlaneGeometry | null>
  material: React.RefObject<THREE.ShaderMaterial | null>
  onFrameDrawn: (receipt: FrameDrawReceipt) => void
  onPresented: (receipt: PresentationReceipt) => void
  onAnchor: (uv: SourceUvRect | null) => void
}

/**
 * The outer presenter supplies static window chrome; this supplies the one
 * persistent film canvas, and it is the mesh that actually writes the
 * window's pixels. Both the upload-to-draw receipt and the qualified
 * default-framebuffer presentation receipt are earned here, because the
 * frame that shows the frozen generation is the frame the page may let go.
 */
function FilmComposite({
  f,
  paintName,
  token,
  geometry,
  material,
  onFrameDrawn,
  onPresented,
  onAnchor,
}: FilmCompositeProps) {
  const film = f.film
  const chromeTexture = useSurfaceTexture()
  const { width, height } = useSurfaceChrome()
  const captureRoot = useSurfaceSourceRoot()
  const paintedSize = useSurfacePaintedSize()
  const rects = useSurfaceAnchorRects(FILM_ANCHORS)
  const uv = rects?.film ?? null

  // React Doctor's no-pass-data-to-parent warning is intentional. The
  // anchor transaction commits in the Surface presenter tree, while the
  // film compositor that owns the mesh is its parent. The reorder browser
  // gate proves this effect publishes one complete painted generation and
  // withholds the stale set while the DOM moves.
  useEffect(() => {
    if (!uv) {
      onAnchor(null)
      return
    }
    // The reorder probe is the only reader of the two stages. It moves the
    // film inside a sheet that keeps its box, so nothing but a freshly
    // collected set can say where the film went.
    const sheet = captureRoot?.querySelector<HTMLElement>('.gen-sheet') ?? null
    const reordering =
      new URLSearchParams(window.location.search).get('probe') === 'genie-film-reorder' &&
      sheet !== null &&
      sheet.dataset.anchorReorder !== 'true'
    // Withheld while the reorder is pending: this set is true of pixels the
    // probe is about to move, and drawing on it would put the film where
    // the content no longer is.
    onAnchor(reordering ? null : uv)
    probeFilm({
      type: 'outer-anchor',
      token,
      stage: reordering ? 'before-reorder' : 'accepted',
      generation: paintStats().find((stat) => stat.label === paintName)?.paints ?? 0,
      paintedSize: paintedSize(),
      anchor: uv,
    })
    if (reordering && sheet) sheet.dataset.anchorReorder = 'true'
  }, [uv, onAnchor, captureRoot, paintName, token, paintedSize])

  if (!film) return null
  return (
    <FrameSurface
      frame={film.source}
      material="none"
      width={f.w}
      height={f.h}
      // Under the outer presenter, which draws nothing and reports last:
      // its presentation is what releases the page, and the page may not
      // let go until this composite has already written the frame.
      renderOrder={1}
      frustumCulled={false}
      raycast={() => {}}
      onFrameDrawn={onFrameDrawn}
      presentation={film.presentation}
      onPresented={onPresented}
    >
      <planeGeometry ref={geometry} args={[f.w, f.h, GRID_X, GRID_Y]} />
      <FilmCompositeMaterial
        ref={material}
        chromeTexture={chromeTexture}
        film={film}
        uv={uv}
        shade={f.shade}
        width={width}
        height={height}
      />
    </FrameSurface>
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
  /** Unique lifetime. A window can take off again before r3f has unmounted
   *  its prior Flight, so the window name alone is not a safe React key. */
  flightId: number
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
interface AirState {
  direction: Dir
  renderIn: SurfacePresentation
}

function frameCovers(receipt: FrameDrawReceipt, required: FrameId): boolean {
  return (
    receipt.frame.sourceId === required.sourceId &&
    receipt.frame.generation >= required.generation
  )
}

export type GenieFilmProbeEvent =
  | {
      type: 'require'
      token: number
      direction: Dir
      frame: FrameId
      presentationRevision: number
      source: FrameSource
      canvas: HTMLCanvasElement | null
      video: HTMLVideoElement | null
    }
  | { type: 'receipt'; token: number; receipt: FrameDrawReceipt }
  | {
      type: 'outer-anchor'
      token: number
      stage: 'before-reorder' | 'accepted'
      /** The outer source's paint count when this set was committed. */
      generation: number
      paintedSize: readonly [number, number]
      anchor: SourceUvRect
    }
  | { type: 'accept'; token: number; receipt: FrameDrawReceipt }
  | { type: 'present'; token: number; receipt: PresentationReceipt }
  | { type: 'show'; token: number; frame: FrameId }
  | { type: 'land'; token: number; wall: 0 | 1; frame?: FrameId }
  | { type: 'reveal'; token: number; frame: FrameId }
  | { type: 'release'; token: number; wall: 0 | 1 }
  | { type: 'revoke'; token: number; reason: 'context-lost' }

/** Hand one step of the film's handoff to whoever is watching. Nothing in
 *  the scene reads this; the hook is installed by a probe or by hand. */
function probeFilm(event: GenieFilmProbeEvent): void {
  window.__genieFilmProbe?.(event)
}

function WebGLContextGuard({ onLost }: { onLost: () => void }) {
  const renderer = useThree((state) => state.gl)
  const onLostRef = useRef(onLost)

  useLayoutEffect(() => {
    onLostRef.current = onLost
  }, [onLost])

  // The browser canvas is an external event source. Keep its subscription
  // paired with this renderer lifetime so a replaced Canvas cannot revoke a
  // newer scene.
  useEffect(() => {
    const canvas = renderer.domElement
    const handleLost = (event: Event) => {
      event.preventDefault()
      // A lost context can leave its last backing store composited above the
      // native fallback. Remove that invalid presenter in the same event.
      canvas.style.visibility = 'hidden'
      onLostRef.current()
    }
    const handleRestored = () => {
      canvas.style.visibility = ''
    }
    canvas.addEventListener('webglcontextlost', handleLost)
    canvas.addEventListener('webglcontextrestored', handleRestored)
    return () => {
      canvas.removeEventListener('webglcontextlost', handleLost)
      canvas.removeEventListener('webglcontextrestored', handleRestored)
      canvas.style.visibility = ''
    }
  }, [renderer])

  return null
}

interface FlightProps {
  win: WinId
  dir: Dir
  air: Airborne
  /** This window's handle, owned by the page's map rather than by any
   *  tree — a flight mounts and unmounts, the identity does not. */
  store: GenieSurface
  ring: Ring
  ringing: boolean
  /** Paint order among the windows — renderOrder for the sheet, and the
   *  tie-break the hand's raycast uses to pick between two of them. */
  stack: number
  slotOf: (win: WinId) => HTMLButtonElement | null
  kickRing: (win: WinId, vPxPerS: number) => void
  freezeFilm: () => FrameId | null
  onFramed: (win: WinId, token: number, receipt: FrameDrawReceipt) => void
  onFilmPresented: (
    win: WinId,
    token: number,
    receipt: PresentationReceipt,
  ) => void
  onLand: (win: WinId, wall: 0 | 1, resumeFrame?: FrameId) => void
}

/** The second presenter the film window registers.
 *
 *  The outer presenter draws nothing and can prove itself from a bare
 *  warm-up, so on its own it would let the page go with an empty sheet
 *  underneath. This key stands for the film: it proves when the FROZEN
 *  generation is on the geometry and presents when that generation has
 *  written the default framebuffer, which is the only moment the page
 *  copy and the sheet are the same picture. */
const FILM_PRESENTER = 'genie-film'

/** Half-height of the visible SVG mark in CSS px, or null before the icon
 *  has a laid-out box — a flight measured then would pour into nothing. */
function measureMarkHalf(slotEl: HTMLElement): number | null {
  const mark = slotEl.querySelector<SVGGraphicsElement>('.gen-icon-base')
  const svg = mark?.ownerSVGElement
  const viewBoxHeight = svg?.viewBox.baseVal.height ?? 0
  const markHalf =
    mark && svg && viewBoxHeight > 0
      ? (mark.getBBox().height / viewBoxHeight) * svg.clientHeight * 0.5
      : 0
  return Number.isFinite(markHalf) && markHalf > 0 ? markHalf : null
}

/** Advances the drive one frame and returns the wall it landed at, if any.
 *  The four modes are exclusive; only `clock` and `spring` can land. */
function stepDrive(
  d: DriveBox,
  f: GenieFlight,
  live: boolean,
  restoring: boolean,
  elapsed: number,
  dt: number,
  kick: (v: number) => void,
): 0 | 1 | null {
  let landAt: 0 | 1 | null = null
  if (!live && d.mode === 'clock') {
    d.clockStart = null
    d.t = restoring ? 1 : 0
  } else if (d.mode === 'clock') {
    if (d.clockStart === null) d.clockStart = elapsed
    const p = Math.min(1, (elapsed - d.clockStart) / f.duration)
    if (restoring) {
      // The pour-out ease ARRIVES WITH SPEED (pinned ~0.8 of linear),
      // and that speed is what the settle consumes: convert the end
      // slope from t/s to px/s through the midline's full journey.
      d.t = 1 - pourOut(p)
      if (p >= 1) {
        d.t = 0
        d.mode = 'settle'
        d.settleTau = 0
        d.settleV = genieRestBottomVelocity(-POUR_END_SLOPE / f.duration, f.params)
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
        kick((MIN_END_SLOPE / f.duration) * Math.abs(f.params.dockY))
        landAt = 1
      }
    }
  } else if (d.mode === 'grab') {
    const next = driveGrabStep({ t: d.t, v: d.v }, d.grabT, dt)
    d.t = next.t
    d.v = next.v
  } else if (d.mode === 'spring') {
    // A release can beat the texture handoff. Preserve its committed
    // spring state, but do not spend that momentum while the page copy
    // still owns the pixels.
    if (live) {
      const next = driveSpringStep({ t: d.t, v: d.v }, d.target, dt, DRIVE_DEFAULTS)
      d.t = next.t
      d.v = next.v
      if (next.done) {
        if (d.target === 1) {
          // A dock landing's momentum is now the tile's ring — the
          // sheet is inside the slot, with no room to wobble on its own.
          kick(next.arrivalV * Math.abs(f.params.dockY))
          landAt = 1
        } else {
          // A rest landing keeps the bottom edge's exact crossing speed.
          // t is decreasing into the wall, so the edge moves UP at contact
          // and the spring's first swing continues in that same direction.
          d.mode = 'settle'
          d.settleTau = 0
          d.settleV = genieRestBottomVelocity(-next.arrivalV, f.params)
        }
      }
    }
  } else {
    // settle: the sheet is home (t = 0 exactly). Its top edge has already
    // arrived; the bottom edge was the last part moving, so that edge keeps
    // its momentum while the top stays planted. The bounce is the end of
    // the restore motion, not a new motion after it.
    d.settleTau += dt
    if (genieSettleDone(d.settleTau, d.settleV, SETTLE_DEFAULTS)) {
      landAt = 0
    }
  }
  return landAt
}

/** Writes the dock tile's pose and the two probe-readable custom properties. */
function writeSlot(
  slot: HTMLButtonElement,
  f: GenieFlight,
  params: GenieParams,
  visibleT: number,
  alive: boolean,
  ring: Ring,
) {
  const pose = dockPose(visibleT, alive ? ring.t : 0, alive ? ring.v : 0)
  const top = genieWarp(0.5, 0, visibleT, params)
  const bottom = genieWarp(0.5, 1, visibleT, params)
  const markHalf = f.markHalf * pose.sy
  const fill = dockFill(top.y, bottom.y, f.params.dockY + markHalf)
  slot.style.transform = `scale(${pose.sx}, ${pose.sy})`
  // Non-visual flight progress for the frame-by-frame hold probe.
  // `--pour` now means spatial icon fill and is deliberately nonlinear,
  // so it cannot also stand in for the drive without inventing jumps.
  slot.style.setProperty('--gen-progress', visibleT.toFixed(4))
  slot.style.setProperty('--pour', fill.toFixed(3))
}

/** Rewrites every vertex of the sheet and its film twin from the same warp
 *  sample. A missing squeeze attribute is allocated on first use. */
function deformSheets(
  geometries: readonly (THREE.PlaneGeometry | null)[],
  f: GenieFlight,
  params: GenieParams,
  visibleT: number,
  wobble: number,
) {
  for (const geometry of geometries) {
    if (!geometry) continue
    const pos = plainAttribute(geometry, 'position')
    if (!pos) continue
    // Allocated on first use rather than at construction: the geometry
    // is the library's, its vertex count is the LOD tier's to choose,
    // and this is the only code that knows the attribute exists.
    let sq = plainAttribute(geometry, 'squeeze')
    if (!sq || sq.count !== pos.count) {
      sq = new THREE.BufferAttribute(new Float32Array(pos.count), 1)
      geometry.setAttribute('squeeze', sq)
    }
    const squeeze = sq
    // genieWarp speaks the mesh's own centered y-up space; the deform
    // seam speaks content px, top-down — the arithmetic on both sides
    // of the call is that adapter. The wobble weights by v so the
    // landing spring moves the bottom edge while the already-arrived
    // top edge stays put.
    deformSurfaceGeometry(geometry, [f.w, f.h], (x, y, i) => {
      const v = y / f.h
      const p2 = genieWarp(x / f.w, v, visibleT, params)
      squeeze.setX(i, p2.k)
      return { x: p2.x + f.w / 2, y: f.h / 2 - (p2.y + wobble * v) }
    })
    squeeze.needsUpdate = true
  }
}


function Flight({
  win,
  dir,
  air,
  store,
  ring,
  ringing,
  stack,
  slotOf,
  kickRing,
  freezeFilm,
  onFramed,
  onFilmPresented,
  onLand,
}: FlightProps) {
  const geoRef = useRef<THREE.PlaneGeometry | null>(null)
  const filmGeoRef = useRef<THREE.PlaneGeometry | null>(null)
  const filmMatRef = useRef<THREE.ShaderMaterial | null>(null)
  const groupRef = useRef<THREE.Group | null>(null)
  const filmFramed = useRef(false)
  const filmPresented = useRef(false)
  const filmAnchored = useRef(false)
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
  // has docked (rest-blink.mjs, cameBack — probe removed 2026-08-15).
  //
  // So a landed flight computes no more drive state.
  const landed = useRef(false)
  const f = air.f

  // The pour driver. The ramp is how far the sheet stands from the pose
  // the page copy is in, which is the desk in BOTH directions — a
  // minimize leaves it and a restore arrives at it — so one expression
  // serves both. Zero the moment the board asks for the page back: a
  // dock landing ends at visibleT 1 and would otherwise never hand over,
  // and there is nothing left to interpolate once the sheet has arrived.
  useSurfaceDriver(({ target }) =>
    target === 'page' ? 0 : Math.min(1, Math.max(0, air.drive.visibleT)),
  store.handle)

  // The film's own presenter, registered for as long as this flight is in
  // the air. Registration is the whole mechanism: the crossing releases
  // the page only when EVERY registered presenter has presented.
  useEffect(() => {
    if (!f.film) return
    return store.film.register()
  }, [store, f.film])

  const onFilmFrameDrawn = (receipt: FrameDrawReceipt) => {
    const film = f.film
    if (!film) return
    probeFilm({ type: 'receipt', token: film.token, receipt })
    if (filmFramed.current || !frameCovers(receipt, film.required)) return
    filmFramed.current = true
    store.film.prove()
    onFramed(win, film.token, receipt)
  }

  const onFilmPresentation = (receipt: PresentationReceipt) => {
    const film = f.film
    if (
      !film ||
      filmPresented.current ||
      !presentationReceiptSatisfies(film.presentation, receipt)
    ) {
      return
    }
    filmPresented.current = true
    // Reported before the store hears it. The release is synchronous —
    // the outer presenter's own draw follows in this same frame — so a
    // probe written after it would record the two the wrong way round.
    onFilmPresented(win, film.token, receipt)
    store.film.present()
  }

  const onAnchor = useCallback((uv: SourceUvRect | null) => {
    filmAnchored.current = uv !== null
  }, [])

  useFrame(({ clock }, rawDt) => {
    // The composite may be SEEN only where all three are true at once,
    // and each turns inside a frame: the crossing has handed the canvas
    // presentation authority, the frozen generation is on the geometry,
    // and the anchor set that says where the film sits is whole.
    const mat = filmMatRef.current
    if (mat) {
      mat.colorWrite =
        filmFramed.current && filmAnchored.current && store.film.canvasPresents()
    }
    if (landed.current) return
    const dt = Math.min(rawDt, 1 / 20)
    const d = air.drive
    const restoring = dir === 'restoring'

    const geo = geoRef.current
    if (!geo) return

    // Has the sheet taken the pixels? One question now, asked of the
    // crossing: the page holds until every presenter of this window has
    // written color, and until then the page copy or the dock tile is the
    // visible truth, so automatic motion holds the wall. A grab is allowed
    // to track anyway — the sheet is invisible while it does, and the first
    // drawn frame then appears already in hand.
    const live = !store.film.holdsPage()

    const landAt = stepDrive(d, f, live, restoring, clock.elapsedTime, dt, (v) =>
      kickRing(win, v),
    )

    // A grab can track before acquisition so it never loses the hand. Until
    // the DOM copy has actually hidden, though, render the sheet at its wall
    // identity. This also keeps the film presentation revision stable while
    // a pre-acquisition grab changes its hidden target. The first displaced
    // frame then has one owner, not two.
    const wallT = restoring ? 1 : 0
    d.visibleT = live
      ? drivePresentationStep(d.visibleT, d.t, dt, DRIVE_DEFAULTS.vMax)
      : wallT
    const visibleT = d.visibleT
    const wobble =
      d.mode === 'settle' ? genieSettle(d.settleTau, d.settleV, SETTLE_DEFAULTS) : 0
    // The narrow neck grows with the icon while it absorbs. It remains well
    // inside the solid mark at every scale, and both values come from the
    // same dockSwell sample so the visible join cannot drift.
    const params: GenieParams = {
      ...f.params,
      slotHalf: f.params.slotHalf * dockSwell(visibleT),
    }
    // The bay and the sheet use the same updated drive sample. The icon
    // stays white until the sheet's warped bottom edge crosses the visible
    // top of the mark, then fills by the fraction of the WHOLE sheet below
    // that boundary. It reaches full only after the trailing top edge passes.
    // This is spatial absorption, not another animation or a guessed time.
    const alive = ringing && !dockRingDone(ring.t, ring.v)
    const slot = slotOf(win)
    if (slot) writeSlot(slot, f, params, visibleT, alive, ring)
    deformSheets([geo, filmGeoRef.current], f, params, visibleT, wobble)

    if (landAt === null) return
    landed.current = true
    if (landAt === 0) {
      // A rest landing hands back at the desk, which is where the page copy
      // has been standing all along — so the ramp reaching exactly zero IS
      // the identity, and the crossing performs the swap inside one frame.
      onLand(win, 0, f.film ? (freezeFilm() ?? f.film.required) : undefined)
      return
    }
    // A dock landing has nothing to reveal: the window is inside its bay
    // and the filled icon already owns the final neck. Suppress the
    // finished mesh before this render.
    if (groupRef.current) groupRef.current.visible = false
    onLand(win, 1)
  })

  return (
    // Every sheet sits at z = 0 — the plane the viewport is — so depth
    // cannot be what stacks them. renderOrder on the group can: three
    // takes a Group's renderOrder as the groupOrder of everything under
    // it and sorts by that first, which makes the paint order exactly
    // the desk's own. depthWrite is off in the material for the same
    // reason: at equal depth the buffer has no opinion worth having, and
    // a sheet must never reject the one behind it.
    <group ref={groupRef} renderOrder={stack} position={[f.wx, f.wy, 0]}>
      <Surface.Mesh
        surface={store.handle}
        // The page declares this window's source in its own slot; the
        // sheet is placed by the warp, not by the box the page copy is in.
        placement="manual"
        alpha="source"
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
        // Last of this window's meshes, and that order is the protocol.
        // This presenter's color-writing draw is what releases the page,
        // so anything of this window that has to be ON SCREEN in the
        // released frame — the film composite — draws before it.
        renderOrder={2}
        // `win` and `stack` are how the hand tells four airborne sheets
        // apart: the raycast returns them all at the same distance, and
        // only the paint order can break that tie.
        userData={{ matter: true, win, stack }}
        geometry={<planeGeometry ref={geoRef} args={[f.w, f.h, GRID_X, GRID_Y]} />}
        material={
          f.film ? (
            // Draws no pixels of its own. The window's picture is the
            // composite below, which needs this presenter's texture and
            // its anchor scope; what stays here is the evidence, and
            // evidence has to come from a pass that actually ran.
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          ) : (
            <GenieMaterial shade={f.shade} />
          )
        }
      >
        {f.film && (
          <FilmComposite
            f={f}
            paintName={surfaceNameOf(win)}
            token={f.film.token}
            geometry={filmGeoRef}
            material={filmMatRef}
            onFrameDrawn={onFilmFrameDrawn}
            onPresented={onFilmPresentation}
            onAnchor={onAnchor}
          />
        )}
      </Surface.Mesh>
    </group>
  )
}

// ── the bays nobody is pouring into ─────────────────────────────────────
//
// A tile's scale has exactly one writer per frame. While a window is
// airborne that writer is its own Flight, which has the live drive; this
// takes every other tile, and reads its wall from HOLD rather than
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
      slot.style.setProperty('--gen-progress', full ? '1' : '0')
      // The idle ends of the same level the Driver writes mid-flight.
      // Hold is the only thing that can answer it here: an unheld bay
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

interface ArmedWindow {
  kind: 'armed-window'
  id: number
  win: WinId
  x0: number
  y0: number
}

// Every state after `idle` names its window. It has to now: four sheets
// can be in the air at once, so "the flight" is never a thing the rig
// can refer to without saying which.
type GestState =
  | { kind: 'idle' }
  | ArmedWindow
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

      // The page copy's titlebar: arm, and only a real drag claims — the
      // lamps keep their clicks.
      const bar = closestFrom(e.target, '.gen-titlebar')
      if (bar) {
        const win = closestFrom(bar, '[data-win]')?.dataset.win
        if (isWinId(win)) {
          // While the window is crossing, the presented copy is the PAGE
          // one (decisions.md #33), so a titlebar press mid-lift arrives
          // here instead of at the sheet. It means what pressing the sheet
          // means: catch. Arming a window-move instead would drag the page
          // copy while the flight's pose stays frozen — two copies of one
          // window disagreeing at the swap.
          const a = api.current.airOf(win)
          if (a) {
            api.current.raise(win)
            a.drive.mode = 'grab'
            a.drive.grabT = a.drive.t
            beginGrip(
              e,
              win,
              genieWarp(0.5, 0.5, a.drive.t, a.f.params).y,
              api.current.dirOf(win) === 'minimizing' ? 1 : 0,
            )
            return
          }
          gest.current = {
            kind: 'armed-window',
            id: e.pointerId,
            win,
            x0: e.clientX,
            y0: e.clientY,
          }
        }
        return
      }
      // A FILLED bay arms; drag up pours, release clicks. An empty bay is
      // just a drawing of a window that is already on the desk.
      const tile = closestFrom(e.target, '.gen-tile[data-role="window"]')
      const tileWin = tile?.dataset.win
      if (tile?.dataset.filled === 'true' && isWinId(tileWin)) {
        gest.current = {
          kind: 'armed-tile',
          id: e.pointerId,
          win: tileWin,
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
      const win = hit.object.userData.win
      if (!isWinId(win)) return
      const a = api.current.airOf(win)
      if (!a) return
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

    // A titlebar drag does nothing until it has travelled CLAIM_PX.
    const dragArmedWindow = (e: PointerEvent, g: ArmedWindow) => {
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
    }

    const onMove = (e: PointerEvent) => {
      if (!e.isTrusted) return
      const g = gest.current

      if (g.kind === 'armed-window' && e.pointerId === g.id) {
        dragArmedWindow(e, g)
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

export function GenieApp() {
  // No trial, no flight — see `fold`.
  const supported = useSurfaceSupport()
  const [filmController] = useState<GenieFilmController>(() =>
    createGenieFilmController({
      onError: (error) => console.warn('[munari] Genie film frame failed:', error),
    }),
  )
  const nextFilmToken = useRef(0)
  const nextFilmPresentationRevision = useRef(0)
  const attachFilmCanvas = useCallback<React.RefCallback<HTMLCanvasElement>>(
    (canvas) => (canvas ? filmController.attachCanvas(canvas) : undefined),
    [filmController],
  )
  const attachFilmDecoder = useCallback<React.RefCallback<HTMLVideoElement>>(
    (video) => (video ? filmController.attachVideo(video) : undefined),
    [filmController],
  )

  // Which windows are in the air and which way each is going. Everything
  // that used to be one slot is now keyed by window, and nothing else
  // changed to make that true — the law and the drive were always
  // written about ONE sheet and never knew how many there were.
  const [air, setAir] = useState<Partial<Record<WinId, AirState>>>({})
  // React Doctor's related-state warning is intentional here. These are
  // not one reducer transition: frame-exact flight state, z-order, input
  // state, and film presentation each commit on different evidence. The
  // 24-round film gate is the proof that combining their schedules would
  // be a protocol change, not a mechanical cleanup.
  // Which windows are inside their bay, and the paint order of them all
  // (last = frontmost). Desktop convention throughout: pressing a window
  // raises it, restoring one brings it to the front, and MINIMIZING one
  // does not move it at all — you put a window away, you did not promote
  // or demote it, and it has to be where you left it when it comes back.
  const [docked, setDocked] = useState<WinId[]>([])
  // The same list, frame-exact. A landing writes it in the frame loop and
  // the commit that publishes it is one or more frames behind — and a hand
  // that grabs a window the instant it lands asks in that gap. Reading the
  // committed array there refuses the gesture, which reads as a dead click.
  const dockedRef = useRef<WinId[]>([])
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
  // The page copy is hidden and WebGL is showing — reported by the handle,
  // never inferred from a texture having pixels.
  //
  // The distinction is a hole in the desk. A texture upload reaches two
  // reconcilers: the sheet's visibility in the Canvas tree and the page
  // copy's `data-away` in the DOM tree. One state change, two commits,
  // nothing scheduling them together — so the DOM can hide the window a
  // frame or two before the Canvas draws the sheet, and for those frames
  // the desk shows neither. The window blinks out and comes back at the
  // position it has not left yet.
  //
  // On an idle machine both commits land in the same frame every time; the
  // gap is real and zero frames wide, which is the worst width for finding
  // it. Under load it opens — which is why rest-blink.mjs ran at 1/6 CPU.
  // That probe was removed on 2026-08-15; anything hunting this gap again
  // has to squeeze the main thread the same way.
  const [shown, setShown] = useState<Partial<Record<WinId, boolean>>>({})
  // The exact frozen film generation has crossed both the WebGL upload
  // and mesh traversal. This opens the pixel gate, but does not release
  // the page canvas; `shown` waits for the separate presentation receipt.
  const [framed, setFramed] = useState<Partial<Record<WinId, boolean>>>({})
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
  // One Surface identity per window, owned here. A handle allocates
  // nothing until a tree mounts it, which is what lets the desk hold four
  // of them while at most one window is usually in the air — and what
  // lets a flight's mesh and its page copy find the same content without
  // either tree owning the other.
  const surfaces = useRef(new Map<WinId, GenieSurface>())
  const storeOf = (win: WinId): GenieSurface => {
    let store = surfaces.current.get(win)
    if (!store) {
      const handle = createSurface(surfaceNameOf(win))
      store = { handle, film: surfaceManualPresenter(handle, FILM_PRESENTER) }
      surfaces.current.set(win, store)
    }
    return store
  }
  // Landings in flight: the frame loop decides one, the crossing performs
  // it, and the page finishes it when the pixels are back in its hands.
  const landings = useRef(new Map<WinId, { wall: 0 | 1; frame?: FrameId }>())
  // The receipt that will be quoted when the page copy lets go, so the
  // release names the exact film generation that replaced it.
  const filmShowReceipt = useRef<PresentationReceipt | null>(null)
  const nextFlightId = useRef(0)
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
  const dockedSet = useMemo(() => new Set(docked), [docked])
  // The desk's OWN hide, which is not the same fact as the handoff's.
  //
  // A minimize starts on the desk, so the page copy has to stay visible
  // until the sheet takes the pixels — and that release belongs to
  // <Surface.DOM>, which hides its holder inside the drawing frame that
  // replaces it. This attribute answers the other question: is the window
  // put away? True while it is docked and for the whole of a restore,
  // which starts docked. The two hides compose, and neither has to know
  // when the other turns.
  const hiddenFor = (win: WinId) => {
    const a = air[win]
    if (a) return a.direction === 'restoring'
    return dockedSet.has(win)
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
    [...order].reverse().find((w) => !dockedSet.has(w) || air[w]?.direction === 'restoring') ?? null

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

  // Only the film window carries pixels it does not own. Freezing is the
  // last step so a refusal costs nothing: a null return leaves the page
  // holding its copy and the gesture never starts.
  const attachFilm = (
    measured: GenieFlight,
    id: WinId,
    innerEl: HTMLElement | null | undefined,
  ): GenieFlight | null => {
    const source = filmController.source
    if (!source || !innerEl) return null

    // Freeze only after all geometry is valid. A null result means that
    // the decoder has not presented its first real frame yet, so the page
    // keeps the hold and the gesture is safely refused.
    const required = filmController.freeze()
    if (!required) return null
    const style = getComputedStyle(innerEl)
    const radius = Math.max(
      0,
      (Number.parseFloat(style.borderBottomLeftRadius) || 0) -
        (Number.parseFloat(style.borderLeftWidth) || 0),
    )
    const token = ++nextFilmToken.current
    measured.film = {
      source,
      required,
      token,
      presentation: {
        transferId: token,
        frame: required,
        presentationRevision: ++nextFilmPresentationRevision.current,
      },
      radius,
    }
    probeFilm({
      type: 'require',
      token: measured.film.token,
      direction: dockedRef.current.includes(id) ? 'restoring' : 'minimizing',
      frame: required,
      presentationRevision: measured.film.presentation.presentationRevision,
      source,
      canvas: filmController.canvas,
      video: filmController.video,
    })
    return measured
  }

  // Both gestures measure at the moment of the press: visibility:hidden
  // keeps the window's box in flow, so the rects are always live.
  const measure = (id: WinId, slow: boolean, duration: number): GenieFlight | null => {
    const win = winRefs.current[id]?.getBoundingClientRect()
    const slotEl = slotRefs.current[id]
    const slot = slotEl?.getBoundingClientRect()
    if (!win || !slotEl || !slot) return null
    const mouth = Number.parseFloat(
      getComputedStyle(slotEl).getPropertyValue('--gen-mouth'),
    )
    if (!Number.isFinite(mouth) || mouth <= 0) return null
    const markHalf = measureMarkHalf(slotEl)
    if (markHalf === null) return null
    // The window inside the capture root. The difference between the two
    // boxes IS the shade's band, so the drop stays stated once, in CSS.
    const innerEl = winRefs.current[id]?.querySelector<HTMLElement>('.gen-window')
    const inner = innerEl?.getBoundingClientRect()
    const wx = win.left + win.width / 2 - window.innerWidth / 2
    const wy = window.innerHeight / 2 - (win.top + win.height / 2)
    const mx = slot.left + slot.width / 2 - window.innerWidth / 2
    const my = window.innerHeight / 2 - (slot.top + slot.height / 2)
    const measured: GenieFlight = {
      w: win.width,
      h: win.height,
      wx,
      wy,
      markHalf,
      shade: inner
        ? [inner.width / win.width, inner.height / win.height]
        : [1, 1],
      params: {
        w: win.width,
        h: win.height,
        // Both read off the live centre, which stays fixed while the icon
        // grows from 50% 50%. The narrow neck ends inside the solid mark,
        // not at the old button-box edge.
        dockX: mx - wx,
        dockY: my - wy,
        ...GENIE_DEFAULTS,
        slotHalf: mouth / 2,
        // The working window gets the deliberate easter egg. Signed radius
        // chooses which side of the drain the circle sits on. Read from
        // the tweak panel's live bag at measure time, so a dragged value
        // applies to the next flight.
        loopRadius: id === 'scheda' ? genieTuning.loopRadius : 0,
      },
      // The looped route is almost twice as long as the normal drain. Give
      // it time for the same calm travel speed instead of rushing the circle.
      duration: duration * (id === 'scheda' ? 1.8 : 1) * (slow ? SLOW : 1),
    }
    if (id !== FILM_WIN) return measured
    return attachFilm(measured, id, innerEl)
  }

  // Every takeoff runs through here. The only thing refused is a SECOND
  // flight of the same window — one sheet cannot be minimizing and
  // restoring at once — and a window already on the side of the dock it
  // is being asked to fly to. Other windows are none of its business.
  // Hand the keyboard over before the page copy hides, not after: once it
  // is hidden the focus is already on <body> and there is nothing left to
  // read the intent off.
  //
  // :focus-visible is doing the real work here, and "focus is inside this
  // window" on its own is not enough — Chrome focuses a <button> on
  // mousedown, so the click that starts the minimize satisfies that test
  // by itself, and docking one window with the mouse would pull the caret
  // out of whatever you were typing in another. The pseudo-class is the
  // browser's own answer to "was this a keyboard's doing", which is
  // exactly the question, and it is better calibrated than anything this
  // scene could infer.
  const handKeyboardOver = (id: WinId, to: Dir) => {
    const active = document.activeElement
    if (to === 'minimizing') {
      if (active?.matches(':focus-visible') && winRefs.current[id]?.contains(active))
        slotRefs.current[id]?.focus()
      return
    }
    // Expanding a window hands it the keyboard NOW, not on landing. The
    // bay it came from is emptying under the focus otherwise, and a window
    // that is visibly on its way to the front should already be the one
    // keys are talking to — the same promise the raise makes to the eye.
    // The wrapper takes it because the window's own controls are inside
    // the hidden subtree for the whole flight; the settle moves it onto a
    // real control.
    winRefs.current[id]?.focus({ preventScroll: true })
    // The keyboard hand-back is claimed only when the keyboard asked. A
    // mouse restore leaves focus on the wrapper, which is where a click on
    // a window puts it anyway — no ring, nothing to read.
    if (active === slotRefs.current[id]) wantsFocus.current.add(id)
  }

  /**
   * The minimize with no renderer under it.
   *
   * Without the trial there is no sheet to pour, so the window folds to
   * its bay on a CSS transition instead (`[data-degraded]` in genie.css)
   * and the desk's state changes exactly as it would after a landing.
   * Everything else about the desk already worked degraded — the windows
   * are page DOM, titlebar drags write the element directly — but the
   * minimize went through `air`, and an `air` entry whose Surface can
   * never present webgl never lands: the window stayed on the desk, the
   * bay stayed empty, and a second click was refused by the in-flight
   * guard. It read as a dead lamp (2026-08-23).
   *
   * The travel is measured here rather than declared in CSS because the
   * bays sit in a flex row and the windows in a cascade, so the distance
   * between a window and its own bay is not a number either one knows.
   */
  const fold = (id: WinId, to: Dir): boolean => {
    const win = winRefs.current[id]
    const bay = slotRefs.current[id]?.getBoundingClientRect()
    const from = win?.getBoundingClientRect()
    if (win && bay && from) {
      win.style.setProperty('--gen-fold-x', `${Math.round(bay.x + bay.width / 2 - (from.x + from.width / 2))}px`)
      win.style.setProperty('--gen-fold-y', `${Math.round(bay.y + bay.height / 2 - (from.y + from.height / 2))}px`)
    }
    if (to === 'restoring') raise(id)
    handKeyboardOver(id, to)
    settleDock(id, to === 'restoring' ? 0 : 1)
    return true
  }

  const takeOff = (id: WinId, to: Dir, d: DriveBox, slow: boolean): boolean => {
    if (flights.current.has(id)) return false
    if (dockedRef.current.includes(id) !== (to === 'restoring')) return false
    if (!supported) return fold(id, to)
    const f = measure(id, slow, to === 'restoring' ? RESTORE_S : MINIMIZE_S)
    if (!f) return false
    d.visibleT = to === 'restoring' ? 1 : 0
    flights.current.set(id, { flightId: ++nextFlightId.current, f, drive: d })
    // The two directions are NOT symmetric. A restore is a window coming
    // back to work, so it arrives in front — and this is its only chance
    // to say so, since its press landed on a dock tile and not on the
    // window. A minimize is a window being put away, and putting
    // something away is not a promotion: it keeps the rung it had, so the
    // window you were actually reading does not blink out of focus for
    // half a second every time you dock one of the others.
    if (to === 'restoring') raise(id)
    handKeyboardOver(id, to)
    setShown((s) => ({ ...s, [id]: false }))
    setFramed((f) => ({ ...f, [id]: false }))
    setAir((a) => ({ ...a, [id]: { direction: to, renderIn: 'scene' } }))
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

  // Where the sheet lands decides the next hold, not which phase it
  // took off from — a minimize caught and flung home lands resting, a
  // restore flicked back down lands docked.
  // Which windows are in their bay, frame-exact and committed together.
  // Both the flight's landing and the degraded fold end here, so there is
  // one answer to "is this window put away" and not two that can drift.
  const settleDock = (id: WinId, wall: 0 | 1) => {
    dockedRef.current =
      wall === 1
        ? [...dockedRef.current.filter((x) => x !== id), id]
        : dockedRef.current.filter((x) => x !== id)
    setDocked(dockedRef.current)
  }

  const finishLand = (
    id: WinId,
    wall: 0 | 1,
    flight: Airborne,
    resumeFrame?: FrameId,
  ) => {
    // A context-loss fallback can revoke this flight before its next-frame
    // reverse release. Late work from that old transfer is harmless.
    if (flights.current.get(id) !== flight) return
    const film = flight.f.film
    if (film) probeFilm({ type: 'release', token: film.token, wall })
    flights.current.delete(id)
    settleDock(id, wall)
    setAir((a) => {
      const next = { ...a }
      delete next[id]
      return next
    })
    setShown((s) => {
      const next = { ...s }
      delete next[id]
      return next
    })
    setFramed((f) => {
      const next = { ...f }
      delete next[id]
      return next
    })
    if (id === FILM_WIN && resumeFrame) {
      // Keep the transfer pixels fixed through the reveal commit. The
      // token guard makes this callback harmless if another transfer has
      // already frozen a newer generation.
      requestAnimationFrame(() => filmController.resume(resumeFrame))
    }
  }

  // Arrival, which is not yet the end of the flight. The sheet has reached
  // its wall; the page copy is still hidden and the handle still holds. All
  // this does is record what the landing was and ask for the page back —
  // the teardown waits for the handle to say the page is actually showing.
  //
  // No raise here in either direction. A restore claimed the front at
  // takeoff; a minimize you changed your mind about and flung home has to
  // land on the exact rung it left, or an abandoned gesture would reorder
  // the desk as a souvenir.
  const onLand = (id: WinId, wall: 0 | 1, resumeFrame?: FrameId) => {
    const flight = flights.current.get(id)
    if (!flight) return
    const film = flight.f.film
    if (film) probeFilm({ type: 'land', token: film.token, wall, frame: resumeFrame })
    // A dock landing ends with the window put away, and `hiddenFor` will say
    // so on the next commit. Set it now, while WebGL still holds the pixels,
    // so the swap cannot expose the page copy for the commit in between.
    if (wall === 1) winRefs.current[id]?.setAttribute('data-away', 'true')
    landings.current.set(id, { wall, frame: resumeFrame })
    // The landing is decided inside the renderer frame. Commit the
    // controlled prop now so Surface's layout-phase request reaches the
    // store before this frame can finish; there is still one owner of the
    // view, and no imperative second control path beside it.
    flushSync(() => {
      setAir((current) => {
        const flightState = current[id]
        return flightState
          ? { ...current, [id]: { ...flightState, renderIn: 'page' } }
          : current
      })
    })
  }

  // The handle's own answer about who is showing, which is the only edge
  // either side of this scene may act on: hiding the page copy early
  // doubles translucent pixels, and revealing it early shows two of them.
  const onPresentedView = (id: WinId, view: SurfacePresentation) => {
    if (view === 'scene') {
      winRefs.current[id]?.setAttribute('data-away', 'true')
      setShown((s) => (s[id] ? s : { ...s, [id]: true }))
      const film = flights.current.get(id)?.f.film
      const receipt = filmShowReceipt.current
      if (film && receipt) {
        filmShowReceipt.current = null
        probeFilm({ type: 'show', token: film.token, frame: receipt.frame })
        requestAnimationFrame(() => filmController.resume(film.required))
      }
      return
    }
    if (view !== 'page') return
    const landing = landings.current.get(id)
    if (!landing) return
    landings.current.delete(id)
    const flight = flights.current.get(id)
    if (!flight) return
    if (landing.wall === 0) {
      // Revealed here, in the frame the hold came back, and not at the
      // commit below. The sheet is still drawn over the page copy for the
      // linger that follows, so the two overlap rather than leaving a frame
      // with neither — which is what a translucent shadow shows as a
      // lightened band across the boundary (shadow-travels.mjs).
      winRefs.current[id]?.removeAttribute('data-away')
      const film = flight.f.film
      if (film && landing.frame)
        probeFilm({ type: 'reveal', token: film.token, frame: landing.frame })
    }
    finishLand(id, landing.wall, flight, landing.frame)
  }

  const tellFilmReady = useCallback(
    (win: WinId, token: number, receipt: FrameDrawReceipt) => {
      const film = flights.current.get(win)?.f.film
      if (!film || film.token !== token || !frameCovers(receipt, film.required)) return
      probeFilm({ type: 'accept', token, receipt })
      setFramed((f) => (f[win] ? f : { ...f, [win]: true }))
    },
    [],
  )

  const tellFilmPresented = useCallback(
    (win: WinId, token: number, receipt: PresentationReceipt) => {
      const film = flights.current.get(win)?.f.film
      if (
        !film ||
        film.token !== token ||
        !presentationReceiptSatisfies(film.presentation, receipt)
      ) {
        return
      }
      probeFilm({ type: 'present', token, receipt })
      // Held, not acted on. This receipt says the film's own presenter is
      // satisfied; the page copy does not go until every presenter is, and
      // that verdict belongs to the handle. `show` is emitted there.
      filmShowReceipt.current = receipt
    },
    [],
  )

  const revokeRendererHold = useCallback(() => {
    const revoked = [...flights.current.entries()]
    if (!revoked.length) return

    // A lost renderer cannot remain presentation authority. Reveal every
    // native window before any React update, then remove the dead flights.
    // This reverse transfer never waits for renderer evidence.
    for (const [id, flight] of revoked) {
      winRefs.current[id]?.removeAttribute('data-away')
      const slot = slotRefs.current[id]
      if (slot) {
        slot.style.transform = ''
        slot.style.removeProperty('--gen-progress')
        slot.style.setProperty('--pour', '0')
      }
      const film = flight.f.film
      if (film) probeFilm({ type: 'revoke', token: film.token, reason: 'context-lost' })
    }

    const ids = new Set(revoked.map(([id]) => id))
    flights.current.clear()
    // The handles go with them. A store left mid-crossing would answer the
    // next flight's first frame from a transfer whose renderer is gone.
    landings.current.clear()
    filmShowReceipt.current = null
    for (const id of ids) surfaces.current.delete(id)
    setAir({})
    setShown({})
    setFramed({})
    const nextDocked = dockedRef.current.filter((id) => !ids.has(id))
    dockedRef.current = nextDocked
    setDocked(nextDocked)
    setRinging((current) => current.filter((id) => !ids.has(id)))
    if (filmController.frozen) filmController.resume()
  }, [filmController])

  // `airborne` is the only difference between the two copies of a window,
  // and it is one fact: the desk's copy is already a picture, so nobody
  // is waiting on it to say so.
  const bodyFor = (scheda: Scheda) => (
    <WindowBody
      scheda={scheda}
      front={front === scheda.id}
      note={note}
      setNote={setNote}
      checked={checked}
      setChecked={setChecked}
      onMinimize={(slow) => beginMinimize(scheda.id, slow)}
      attachFilmCanvas={
        scheda.id === FILM_WIN ? attachFilmCanvas : undefined
      }
    />
  )

  const api: GestureApi = {
    anyAir,
    airOf: (win) => flights.current.get(win),
    dirOf: (win) => air[win]?.direction,
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
    <div
      className="gen-page"
      data-degraded={supported ? undefined : 'true'}
      data-genie-film-direction={air[FILM_WIN]?.direction}
      data-genie-film-framed={framed[FILM_WIN] ? 'true' : 'false'}
      data-genie-film-shown={shown[FILM_WIN] ? 'true' : 'false'}
    >
      {/* This is the only media clock. It stays connected and playing while
          either the page canvas or WebGL owns the visible pixels. */}
      <video
        ref={attachFilmDecoder}
        className="gen-film-decoder"
        src={filmUrl}
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        aria-hidden
        tabIndex={-1}
      />
      {showChrome && <GenieTweakPanel />}

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
            style={windowStyle(order.indexOf(s.id) + 1, pos[s.id])}
            onPointerDown={(e) => {
              // Everything on a window raises it except its own lamps.
              // Same reason the Dock button doesn't: the lamps act on a
              // background window in place, so you can put the thing
              // behind away without it stepping in front on the way down.
              if (closestFrom(e.target, '.gen-lamp')) return
              raise(s.id)
            }}
          >
            <Surface.Root canvas="genie"
              surface={storeOf(s.id).handle}
              inScene={Boolean(air[s.id]) && air[s.id]?.renderIn !== 'page'}
              timing={{ settleMs: 0, durationMs: 1 }}
              onPresentationChange={view => onPresentedView(s.id, view)}
            >
              <Surface.HTML pageClassName="gen-page-presentation" resolution={2}>
                {bodyFor(s)}
              </Surface.HTML>
            </Surface.Root>
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
              type="button"
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
              {/* The button is only the hit target. The 54px solid mark
                  is the visible dock and sits above the WebGL sheet, so
                  its centre masks the law's narrow final neck. */}
              <svg viewBox="0 0 20 20" width="54" height="54" aria-hidden>
                {s.mark}
              </svg>
            </button>
          )
        })}
      </div>

      <SurfaceCanvas
        pointerMode="surfaces"
        id="genie"
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
        // 1..n, so anything above n restores the hold — and the number is
        // stated here rather than in a stylesheet because r3f writes this
        // wrapper's inline styles and would win against one.
        // Pointer events are the host's: an airborne sheet is hit-testable
        // matter, and the reserved `pointerEvents: 'none'` above would have
        // made the whole overlay untouchable.
        style={{ position: 'fixed', inset: 0, zIndex: OVERLAY_Z }}
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
        <WebGLContextGuard onLost={revokeRendererHold} />
        <GestureRig api={apiRef} />
        <Bays
          slotOf={slotOf}
          ringOf={ringOf}
          ringing={ringing}
          held={airborne}
          docked={docked}
          stopRing={stopRing}
        />
        {SCHEDE.map((scheda) => {
          const win = scheda.id
          const store = storeOf(win)
          const a = flights.current.get(win)
          // `airborne` is read off `air` itself, so the direction is there
          // by construction — asked for anyway, with the two beside it.
          const dir = air[win]?.direction
          return (
            <Surface.Scene key={win} surface={store.handle}>
              {a && dir && (
                <Flight
                  key={`${win}:${a.flightId}`}
                  win={win}
                  dir={dir}
                  air={a}
                  store={store}
                  ring={ringOf(win)}
                  ringing={ringing.includes(win)}
                  stack={order.indexOf(win)}
                  slotOf={slotOf}
                  kickRing={kickRing}
                  freezeFilm={() => filmController.freeze()}
                  onFramed={tellFilmReady}
                  onFilmPresented={tellFilmPresented}
                  onLand={(w, wall, resumeFrame) => {
                    if (flights.current.get(w) !== a) return
                    onLand(w, wall, resumeFrame)
                  }}
                />
              )}
            </Surface.Scene>
          )
        })}
      </SurfaceCanvas>
    </div>
  )
}
