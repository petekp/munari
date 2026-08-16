// The flight scene — the page has a third dimension.
//
// A real, ordinary, scrollable, selectable HTML page: a two-column board of
// task cards over a few hundred words of prose. Press a card and it PEELS
// OFF the page — the same component, still live, now a rigid plate with mass
// and inertia hanging off your pointer, casting a real shadow back down onto
// the page it came from. Let go and it flies into whichever slot you were
// over, the document reflows around it for real, and it lies back down as
// ordinary DOM.
//
// The three things that make it work, all of them small:
//
// 1. THE WORLD UNIT IS A CSS PIXEL. `PixelPerfect` sets the camera distance
//    to (viewportHeight/2)/tan(fov/2), so the plane z = 0 is the viewport,
//    exactly. A card's `getBoundingClientRect()` is therefore already a
//    world pose, and there is not one conversion function anywhere in this
//    file. Lifting toward the camera is then honest perspective: the card
//    gets bigger because it is closer, and the LOD ladder re-rasterizes it
//    sharper on the way up because it really is covering more pixels.
//
// 2. NOTHING IS EVER MOVED. The page card does not go anywhere at handoff —
//    it turns `visibility: hidden`, which keeps its box, so the layout does
//    not twitch and the slot is already the right size to be a drop target.
//    The airborne copy is a second React root rendering the SAME component
//    from the SAME state. That is why there is no flash to hide: the page
//    copy stays visible until the Surface has proved a color-writing draw.
//    `useLift` keeps the canvas warm but unseen until that
//    `onFirstPresented` receipt arrives, then changes custody in one commit.
//
// 3. THE CANVAS IS ONLY SOLID WHERE THERE IS MATTER. The overlay is
//    `pointer-events: none` at rest — a canvas with nothing in it must not be
//    able to eat a click, a text selection or a scroll — and is switched to
//    `auto` for exactly as long as the pointer is over an airborne card.
//    Same rule one level up: hit-test first, then decide
//    whether you are there at all.
//
// And the loop closes: the physics writes `--l14-near` onto the slot it is
// aimed at, so a rigid-body simulation running in WebGL is restyling real
// DOM through ordinary CSS, at the same time as that DOM is being rasterized
// into the material of the thing doing the simulating.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  CanvasPointerGate,
  LiftDriver,
  SurfaceApp,
  useLift,
  useSurfaceChrome,
  useSurfaceTexture,
  type Lift,
  type SurfaceChrome,
} from '@petepetrash/munari'
import {
  CARD_FRAG,
  CARD_VERT,
  SHADOW_FRAG,
  SHADOW_MAX_LAYERS,
  SHADOW_VERT,
} from './flightShaders'
import './flight.css'
import {
  cameraDistance,
  carryToPlane,
  densityScheduleStep,
  densitySupply,
  pixelGridSnap,
  planeScale,
  screenToPlane,
} from '@petepetrash/munari'
import { attachFlightGestures } from '@petepetrash/munari'
import {
  aeroFollowStep,
  aeroReach,
  atRest,
  CRUMPLE_RISE_T,
  crumplePhase,
  makePlate,
  makeShadowFrame,
  shadowQuadFrame,
  stepFree,
  stepHeld,
  wadOffscreen,
  wadShrink,
  type Plate,
} from '@petepetrash/munari'
import { corners } from './flightCorners'
import { closestFrom } from '../../lib/dom'
import { plainAttribute } from '../../lib/geometry'
import { textureSlot } from '../../lib/uniforms'

// ── the data ─────────────────────────────────────────────────────────────

interface Card {
  id: string
  /** Stable reference, stamped on the card. Not a position — deleting a
   *  card never renumbers the ones around it. */
  code: string
  tag: string
  title: string
  body: string
  note: string
  done: boolean
}

type ColId = 'queue' | 'today'
const COLS: { id: ColId; name: string }[] = [
  { id: 'queue', name: 'Queue' },
  { id: 'today', name: 'Today' },
]

const SEED: Card[] = [
  {
    id: 'c1',
    code: '01',
    tag: 'shader',
    title: 'Scissor each glass pass',
    body: 'Every SDF pass is full-screen. Clip it to the panel’s screen AABB.',
    note: '',
    done: false,
  },
  {
    id: 'c2',
    code: '02',
    tag: 'a11y',
    title: 'Announcer kit',
    body: 'Live-region plumbing for scene-level focus moves.',
    note: 'after the demo',
    done: false,
  },
  {
    id: 'c3',
    code: '03',
    tag: 'perf',
    title: 'Measure the upload ceiling',
    body: '64–96 concurrent painting sources at 120 Hz — is that still true?',
    note: '',
    done: true,
  },
  {
    id: 'c4',
    code: '04',
    tag: 'docs',
    title: 'Write down the depth-order bug',
    body: 'Distance to the eye is not depth. Any centred scene hides it.',
    note: 'blocked on repro',
    done: false,
  },
  {
    id: 'c5',
    code: '05',
    tag: 'spike',
    title: 'Pick this card up',
    body: 'It is still a DOM element. Type in the field while it is in the air.',
    note: '',
    done: false,
  },
  {
    id: 'c6',
    code: '06',
    tag: 'chrome',
    title: 'Shadow swap at touchdown',
    body: 'Grab and land trade shadow layers. Identity at h=0 or it pops.',
    note: '',
    done: false,
  },
  {
    id: 'c7',
    code: '07',
    tag: 'transfer',
    title: 'Pin density to the plate, not the frame',
    body: 'Sharpness is supply × phase × transfer — three budgets, three bugs.',
    note: '',
    done: true,
  },
  {
    id: 'c8',
    code: '08',
    tag: 'pointer',
    title: 'Foreign captures stay silent',
    body: 'A held-button move that began off-surface is not ours to retell.',
    note: '',
    done: false,
  },
  {
    id: 'c9',
    code: '09',
    tag: 'physics',
    title: 'Throw one of these',
    body: 'Flick it into the other column, or hold ✕ and toss the wad away.',
    note: '',
    done: false,
  },
]

const START = {
  queue: ['c1', 'c2', 'c4', 'c8', 'c9'],
  today: ['c3', 'c5', 'c6', 'c7'],
} satisfies Record<ColId, string[]>

// ── flight ───────────────────────────────────────────────────────────────

/** How far off the page the hand lifts a card, px. */
const LIFT_Z = 96
/** Seconds to reach it. */
const LIFT_T = 0.22
/**
 * Where a deleted card rises to before the crush, px. Deliberately BELOW
 * the density schedule's approach (0.65 · LIFT_Z ≈ 62): the pin must not
 * flip and spend a re-raster on a sheet that is about to stop being a card.
 */
const CRUMPLE_Z = 55

interface Flight {
  id: string
  w: number
  h: number
  /** Where on the card the fingers are, body-local px, +y up. */
  hold: THREE.Vector3
  plate: Plate
  /**
   * `held` — the hand is on it. `float` — it was tapped rather than dragged,
   * and hangs where it was left. `home` — it is flying back into its slot.
   * `crumple` — it is being deleted, and dies as matter.
   *
   * `float` is the state the whole lab is actually about. A card is only
   * interesting as matter for as long as it is off the page, and a card you
   * have to keep the mouse button down on is a card you cannot click into. So
   * a tap parks it in mid-air, still solid, still a DOM subtree: you can put
   * the caret in its note field and type while it is casting a shadow on the
   * paragraph below it. Tap it again and it goes home.
   *
   * `crumple` is the exception to every rule the other modes obey. They all
   * exist to end in a swap back to resting DOM; this one ends in the board
   * forgetting the slot. It is irreversible from the moment it starts (esc
   * is guarded in the gestures, and pointerup only opens the hand — it never
   * puts the card back), and it is the only mode allowed to break the
   * "indistinguishable from DOM" contract — on purpose, because a sheet of
   * paper crushing into a wad is the one thing a document element could
   * never do.
   */
  mode: 'held' | 'float' | 'home' | 'crumple'
  /** The crumple's one clock, seconds. The CRUSH is a function of it. */
  crumpleT: number
  /**
   * The ✕ is a press, not a click: while its button is down the forming
   * ball is IN the hand — tracked by the same spring as a grabbed card, no
   * gravity — and the release is a THROW that inherits the hand's velocity.
   * A plain click is the same release with ~zero speed: the wad drops.
   */
  crumpleHeld: boolean
  /**
   * The hand has thrown it (set by the gesture's release, never cleared).
   * A released ball is BALLISTIC from the instant the hand opens — even
   * mid-rise. Only the never-held keyboard delete spring-rises: routing a
   * released flick through that steer let its damping eat the throw
   * (measured: 9148 px/s in, ~450 px of travel out).
   */
  tossed: boolean
  /** The wad's tumble: axis × rate (rad/s), written when the hand lets go. */
  spin: THREE.Vector3
  /** Where a floating card hangs: the grab point's world position when let go. */
  anchor: THREE.Vector3
  /**
   * …and the page's scroll offset at that instant. The anchor is in world
   * coordinates, which are pinned to the VIEWPORT, but the card is hanging
   * over a particular paragraph — and it is casting a shadow on it. Let the
   * page scroll under a stationary card and the shadow slides off the thing
   * that was supposed to be under it, which reads instantly as fake. So the
   * anchor rides the scroll: it is a page position wearing world clothes.
   */
  anchorScroll: number
  /** Start of the current press — how a tap is told from a drag. */
  downAt: number
  downX: number
  downY: number
  /** Has this card already been parked once? A second tap sends it home. */
  floated: boolean
  /** Live pointer, client px. */
  px: number
  py: number
  /**
   * The hand's own velocity, world px/s on the plane the card is on.
   *
   * `stepHeld`'s damper resists the card's motion RELATIVE to the hand, so
   * it needs this; a damper that does not know the hand is moving models a
   * hand nailed to the floor, and bills the difference to the spring as a
   * permanent speed-proportional lag. It is also the honest throw velocity —
   * the screen-space estimator it replaced had to be converted by hand and
   * had a sign flip in it, and neither of those is a thing you can get wrong
   * twice if the number is already in the right space.
   */
  handVel: THREE.Vector3
  /** Previous frame's target — `handVel` is its derivative. */
  prevTarget: THREE.Vector3
  /** False until `prevTarget` means something. */
  handSeeded: boolean
  /**
   * Event-rate release velocity. `handVel` remains the frame-rate feed for
   * the held spring; this second channel covers a complete press/move/release
   * burst that arrives before Driver gets its first frame.
   */
  releaseVel: THREE.Vector3
  releaseX: number
  releaseY: number
  releaseAt: number
  releaseSeeded: boolean
  /** 0 → 1 as the card leaves the page. */
  lift: number
  /**
   * Is the texture currently pinned at ALTITUDE density? The driver flips
   * this as the plate crosses the lift plane's approach, and `Flying` turns
   * it into a `resolution` change — see the density schedule there.
   */
  hiDensity: boolean
  /** Set by the driver, read by React: the card has landed. */
  done: boolean
}

// ── the card, rendered identically on the page and in the air ─────────────

interface CardBodyProps {
  card: Card
  onChange: (patch: Partial<Card>) => void
  /** Only the page copy starts drags; the airborne one is grabbed in 3D. */
  onGrab?: (e: React.PointerEvent<HTMLDivElement>) => void
  /** The ✕. Both copies get it: a card is deletable wherever it is. */
  onDelete?: (e?: React.PointerEvent<HTMLButtonElement>) => void
  hidden?: boolean
}

function CardBody({ card, onChange, onGrab, onDelete, hidden }: CardBodyProps) {
  return (
    <div
      className="l14-card"
      data-done={card.done}
      data-card={card.id}
      onPointerDown={onGrab}
      style={hidden ? { visibility: 'hidden' } : undefined}
    >
      {/* The identity strip. Everything here is small and silkscreened so
       * the title below it is the only loud thing on the card. */}
      <div className="l14-rail">
        <span className="l14-code">{card.code}</span>
        <span className="l14-tag">{card.tag}</span>
        <hr />
        {onDelete && (
          <button
            className="l14-del"
            data-nodrag
            aria-label="Delete card"
            // A PRESS, so the crumple starts with the button still down and
            // the forming ball is holdable — drag and let go to toss it.
            // The click stays as the KEYBOARD path (Enter/Space on a button
            // fires click with no pointerdown); after a pointer press it
            // finds the crumple already running and does nothing.
            onPointerDown={(e) => onDelete(e)}
            onClick={() => onDelete()}
          >
            ✕
          </button>
        )}
      </div>
      <h3>{card.title}</h3>
      <p>{card.body}</p>
      <div className="l14-foot">
        <label className="l14-check" data-nodrag>
          <input
            type="checkbox"
            checked={card.done}
            onChange={(e) => onChange({ done: e.target.checked })}
          />
          Done
        </label>
        <input
          className="l14-note"
          data-nodrag
          placeholder="Add note"
          value={card.note}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </div>
    </div>
  )
}

// ── the airborne copy's material ─────────────────────────────────────────
//
// The shaders themselves live in flightShaders.ts; what follows is the
// state they read and the component that binds it.

/**
 * The sheet's shared state: the driver writes these objects every frame and
 * the material's uniforms hold the SAME objects, so there is no per-frame
 * plumbing and no React in the loop. pack = (dir.x, dir.y, amplitude px,
 * reach px); grab = the held point, card-local px — the bend's pin AND the
 * point the crush contracts toward; wad = (crush 0→1, hash seed, wad radius
 * px) — crush 0 is the identity, and a card that is not being deleted never
 * leaves it. There is no fade channel: a wad is opaque until it has left
 * the viewport, and then it is simply gone.
 */
export interface AeroState {
  pack: THREE.Vector4
  grab: THREE.Vector2
  wad: THREE.Vector3
}

function CardMaterial({ gloss = 0.5, aero }: { gloss?: number; aero: AeroState }) {
  const texture = useSurfaceTexture()
  const { chrome, width, height } = useSurfaceChrome()
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      uGloss: { value: gloss },
      // Gain on the curvature shade. The bend's normals only swing ~10-15°,
      // so the pow-6 band needs amplification to move a white pixel a
      // readable ~20 counts; the term is identically zero when flat, so
      // this number never touches a resting card.
      uFlex: { value: 2.5 },
      uMunariRadii: { value: new THREE.Vector4(0, 0, 0, 0) },
      uMunariSize: { value: new THREE.Vector2(1, 1) },
      uAero: { value: aero.pack },
      uAeroGrab: { value: aero.grab },
      uWad: { value: aero.wad },
    }),
    [gloss, aero],
  )
  uniforms.tMap.value = texture ?? null
  const radii = chrome?.radii ?? [0, 0, 0, 0]
  uniforms.uMunariRadii.value.set(radii[0], radii[1], radii[2], radii[3])
  uniforms.uMunariSize.value.set(width, height)
  return (
    <shaderMaterial
      key={texture?.uuid ?? 'none'}
      uniforms={uniforms}
      vertexShader={CARD_VERT}
      fragmentShader={CARD_FRAG}
      transparent
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  )
}


const LIGHT = new THREE.Vector3(-0.30, -0.46, -1).normalize()

// ── the driver ───────────────────────────────────────────────────────────

/**
 * The shadow material's uniforms. Written by the driver every frame, held by
 * the material as the very same objects — so this passes by reference, and
 * neither side ever reads the other's copy.
 *
 * Declared as a type alias rather than an interface on purpose: r3f's
 * `uniforms` prop is an index signature, and only a mapped type is assignable
 * to one. Written out rather than inferred so the driver can read
 * `uOff.value[i]` as a Vector2 without asking three, whose `IUniform.value`
 * is `any` and would hand back nothing checkable.
 */
type ShadowUniforms = {
  uQuadHalf: { value: THREE.Vector2 }
  uCardHalf: { value: THREE.Vector2 }
  uRadii: { value: THREE.Vector4 }
  /** How many of the layer slots below are live this frame. */
  uCount: { value: number }
  uOff: { value: THREE.Vector2[] }
  uSigma: { value: number[] }
  uSpread: { value: number[] }
  uColor: { value: THREE.Vector4[] }
}

interface DriverProps {
  flight: React.RefObject<Flight | null>
  /** The public handoff edge: zero keeps the plate at page identity. */
  progress: Lift['progress']
  slotRect: (id: string) => DOMRect | null
  /** The page's scroll offset — a floating card's anchor rides it. */
  scrollTop: () => number
  onLanded: () => void
  /**
   * The card's pose is carried by a GROUP wrapping the Surface, not by the
   * Surface's own mesh. `Surface` spreads the caller's mesh props BEFORE
   * installing its own `ref`, so a `ref` passed down through `SurfaceApp`
   * would overwrite the one Surface uses internally to drive its texture.
   * A wrapper group costs a matrix and cannot collide with anything.
   */
  cardRef: React.RefObject<THREE.Group | null>
  shadowRef: React.RefObject<THREE.Mesh | null>
  /** The shadow's shared uniforms — driver writes, the material holds. */
  shadowUniforms: ShadowUniforms
  /** The texture's CURRENT pin, texels per CSS px — the density schedule's live value. */
  density: number
  /** Flip the schedule: true as the plate climbs through the approach, false for home. */
  onAltitude: (hi: boolean) => void
  /** The card's measured chrome — the shadow's h = 0 truth (see the shader). */
  chromeRef: React.RefObject<SurfaceChrome | null>
  /** The bend field's shared uniforms — driver writes, CardMaterial holds. */
  aero: AeroState
  /** The crumple finished: commit the delete and tear the flight down. */
  onCrumpled: () => void
}

const FLAT = new THREE.Quaternion()
const _target = new THREE.Vector3()
const _corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
]
const _centroid = new THREE.Vector3()
const _proj: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
]
const _frame = makeShadowFrame()
const _spinQ = new THREE.Quaternion()
const _spinAxis = new THREE.Vector3()
const _pressWorld = new THREE.Vector3()
const _wadOff = new THREE.Vector3()

/**
 * One time constant of smoothing on the hand's velocity. Pointer samples do
 * not arrive one per frame — they come in bursts, and some frames get none —
 * so the raw frame-to-frame difference is a staircase whose derivative is
 * spikes. It is not free: the estimate lags the hand by one time constant,
 * the damper is told the hand is slower than it is, and the spring pays the
 * difference — `kd·τ·a / ks` on top of the honest `m·a / ks`. At 41 and 45 ms
 * that surcharge was nearly TWICE the real compliance, so this number is not
 * a smoothing preference, it is most of the tracking error. Short enough that
 * the surcharge is a third of the honest term; long enough that the ripple
 * from a mouse polling slower than the display cannot reach the card.
 */
const HAND_TAU = 0.022
const _handRaw = new THREE.Vector3()
const _releaseFrom = new THREE.Vector3()
const _releaseTo = new THREE.Vector3()
const _releaseRaw = new THREE.Vector3()

function releasePlaneZ(f: Flight) {
  const e = 1 - Math.pow(1 - f.lift, 3)
  return (f.mode === 'crumple' ? CRUMPLE_Z : LIFT_Z) * e
}

function resetReleaseSample(f: Flight, x: number, y: number, at: number) {
  f.releaseVel.set(0, 0, 0)
  f.releaseX = x
  f.releaseY = y
  f.releaseAt = at
  f.releaseSeeded = false
}

function sampleRelease(f: Flight, e: PointerEvent) {
  const viewW = window.innerWidth
  const viewH = window.innerHeight
  const camZ = cameraDistance(viewH, FOV)
  const z = releasePlaneZ(f)
  screenToPlane(f.releaseX, f.releaseY, viewW, viewH, camZ, z, _releaseFrom)
  screenToPlane(e.clientX, e.clientY, viewW, viewH, camZ, z, _releaseTo)

  // PointerEvent.timeStamp shares the page's monotonic clock. Some injected
  // event bursts can carry the same timestamp; one millisecond is the narrow
  // fallback that avoids division by zero without inventing a frame count.
  const dt = Math.max((e.timeStamp - f.releaseAt) / 1000, 0.001)
  _releaseRaw.copy(_releaseTo).sub(_releaseFrom).divideScalar(dt)
  if (f.releaseSeeded) {
    f.releaseVel.lerp(_releaseRaw, 1 - Math.exp(-dt / HAND_TAU))
  } else {
    f.releaseVel.copy(_releaseRaw)
  }
  f.releaseX = e.clientX
  f.releaseY = e.clientY
  f.releaseAt = e.timeStamp
  f.releaseSeeded = true
}

function trackHand(f: Flight, dt: number, target: THREE.Vector3) {
  if (!f.handSeeded) {
    f.handSeeded = true
    f.prevTarget.copy(target)
    f.handVel.set(0, 0, 0)
    return
  }
  _handRaw.copy(target).sub(f.prevTarget).divideScalar(Math.max(dt, 1e-4))
  f.handVel.lerp(_handRaw, 1 - Math.exp(-dt / HAND_TAU))
  f.prevTarget.copy(target)
}

function Driver({
  flight,
  progress,
  slotRect,
  scrollTop,
  onLanded,
  cardRef,
  shadowRef,
  shadowUniforms,
  density,
  onAltitude,
  chromeRef,
  aero,
  onCrumpled,
}: DriverProps) {
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)
  const dpr = useThree((s) => s.viewport.dpr)
  // The bend's smoothed state. A ref, not module scratch: it must start at
  // zero for EVERY flight, and Driver mounts once per flight.
  const aeroSm = useRef({ amt: 0, dirX: 1, dirY: 0 })
  const ownedLastFrame = useRef(false)

  useFrame((_, rawDt) => {
    const f = flight.current
    const group = cardRef.current
    if (!f || !group) return
    const crossing = progress()
    const firstOwnedFrame = crossing > 0 && !ownedLastFrame.current
    ownedLastFrame.current = crossing > 0
    // A tab that was backgrounded hands back a dt measured in seconds; a
    // stiff spring integrated over one of those explodes. Clamp, don't trust.
    const dt = Math.min(rawDt, 1 / 30)

    const vw = size.width
    const vh = size.height
    const camZ = camera.position.z

    // The crumple's live scalar — identity for every other mode, so the
    // shader and the shadow below never need to know which mode this is.
    let crush = 0

    if (crossing <= 0) {
      // The hidden twin must prove the page identity, so plate physics and
      // crumple time do not advance before custody changes. The REAL hand
      // still moves during this wait. Track it on the page plane so a fast
      // release carries honest velocity into the first owned flight frame.
      if (f.mode === 'held' || (f.mode === 'crumple' && f.crumpleHeld)) {
        screenToPlane(f.px, f.py, vw, vh, camZ, 0, _target)
        trackHand(f, dt, _target)
      }
    } else if (f.mode === 'held') {
      f.lift = Math.min(1, f.lift + dt / LIFT_T)
      // easeOutCubic — a hand accelerates the card away from the page and
      // then stops; a linear rise reads as a lift dialog, not a lift.
      const e = 1 - Math.pow(1 - f.lift, 3)
      // The hand is wherever the cursor's RAY meets the plane the card is
      // currently on — NOT the z = 0 mapping. One world unit is one CSS pixel
      // on exactly one plane, and a lifted card is not on it. Reading the
      // cursor as if it were cost an 8% gain: the card outran the hand,
      // drifting out from under the pointer toward the edges of the screen
      // and back toward the middle, which is what "fighting the drag" was.
      // decisions #4 has always said intersect the ray with the DRAG plane;
      // this is that rule, on the plane that is actually being dragged on.
      screenToPlane(f.px, f.py, vw, vh, camZ, LIFT_Z * e, _target)
      // Changing the ray plane is the card rising, not the hand moving.
      // Preserve the velocity measured during warm-up, but reseed its
      // position channel so the plane change cannot create a false flick.
      if (firstOwnedFrame) f.prevTarget.copy(_target)
      trackHand(f, dt, _target)
      stepHeld(f.plate, dt, _target, f.hold, FLAT, f.handVel)
    } else if (f.mode === 'float') {
      // Identical machinery, with the hand replaced by a fixed point in the
      // air. The card settles flat and stays there — and because it is still
      // the held solver, grabbing it again is a change of one target vector.
      // Scrolling the page down moves content up the screen, and world y is
      // up, so the anchor moves the same way by the same amount.
      _target.copy(f.anchor)
      _target.y += scrollTop() - f.anchorScroll
      if (firstOwnedFrame) f.prevTarget.copy(_target)
      trackHand(f, dt, _target)
      stepHeld(f.plate, dt, _target, f.hold, FLAT, f.handVel)
    } else if (f.mode === 'crumple') {
      // The delete's CRUSH has one clock — crumplePhase(t) of it. Its EXIT
      // deliberately has none: the wad is done when it has fully left the
      // viewport (below), because a wad that dimmed on a timer was fading
      // in plain sight whenever the fall was slow.
      f.crumpleT += dt
      const ph = crumplePhase(f.crumpleT, f.crumpleHeld)
      crush = ph.crush
      if (f.crumpleHeld) {
        // The ✕ is still pressed: the forming ball is IN the hand. Same
        // machinery as a held card — ray→plane hand, tracked velocity, the
        // pressed point pinned to the pointer — so the sheet lifts into
        // the grip like any grab, crushes there (the shader contracts the
        // sheet toward this same pin), and the eventual release inherits
        // an honest throw velocity from the damper. The altitude eases in
        // exactly like a lift; no gravity while held (crumplePhase says
        // `falling: false` for a held wad — you are holding it).
        f.lift = Math.min(1, f.lift + dt / LIFT_T)
        const e = 1 - Math.pow(1 - f.lift, 3)
        screenToPlane(f.px, f.py, vw, vh, camZ, CRUMPLE_Z * e, _target)
        if (firstOwnedFrame) f.prevTarget.copy(_target)
        trackHand(f, dt, _target)
        stepHeld(f.plate, dt, _target, f.hold, FLAT, f.handVel)
      } else if (!f.tossed && f.crumpleT <= CRUMPLE_RISE_T) {
        // The KEYBOARD delete's rise — the HANDOFF window wearing a
        // gesture's clothes. The plate springs gently off the page (the
        // same free solver as a throw home, aimed up instead of down)
        // while the page copy stays visible until presentation proof. The
        // crush may not begin until the sheet is fully matter. `crumplePhase`
        // holds it at exactly 0 through this window, so the swap keeps its
        // pixel-copy guarantee. Never for a released press (`tossed`):
        // this solver's damping is sized to STOP a card, and it was
        // measured bleeding a 9148 px/s flick to a ~450 px drift when a
        // mid-rise release fell back in here.
        _target.set(f.plate.p.x, f.plate.p.y, CRUMPLE_Z)
        stepFree(f.plate, dt, _target, FLAT)
      } else {
        // Ballistic — the toss in flight, from the instant the hand opens.
        // The wad keeps whatever momentum the hand imparted, drag bleeds
        // it, gravity takes over only once the sheet IS a wad (a flat card
        // dropping like a stone reads as a glitch, so crumplePhase
        // withholds `falling` until the crush completes — a hard flick
        // therefore flies flat-out first, balls up mid-air, and only then
        // starts to drop), and the tumble is the release's own topspin —
        // no aerodynamics, just enough spin that the wad reads as a thing
        // and not a sprite.
        const drag = Math.exp(-dt / 0.9)
        f.plate.v.multiplyScalar(drag)
        if (ph.falling) f.plate.v.y -= 3400 * dt
        f.plate.p.addScaledVector(f.plate.v, dt)
        const rate = f.spin.length()
        if (rate > 1e-6) {
          _spinAxis.copy(f.spin).multiplyScalar(1 / rate)
          _spinQ.setFromAxisAngle(_spinAxis, rate * dt)
          f.plate.q.premultiply(_spinQ)
        }
      }
      // The exit is a PLACE, not a time: the flight ends when the wad —
      // inflated by the shadow's worst-case reach, projected to screen
      // scale at its own plane — has fully left the viewport. Never during
      // the rise (the handoff window must complete) and never in the hand
      // (a ball dragged off-screen and back must not be torn from the
      // grip). Gravity guarantees this terminates: once falling, terminal
      // velocity is ~3060 px/s straight down.
      if (!f.done && !f.crumpleHeld && f.crumpleT > CRUMPLE_RISE_T) {
        const wm = planeScale(camZ, f.plate.p.z)
        const wr = (Math.hypot(f.w, f.h) / 2 + 240) * wm
        if (wadOffscreen(f.plate.p.x * wm, f.plate.p.y * wm, wr, vw, vh)) {
          f.done = true
          onCrumpled()
        }
      }
    } else {
      const r = slotRect(f.id)
      if (r) _target.set(r.left + r.width / 2 - vw / 2, vh / 2 - (r.top + r.height / 2), 0)
      else _target.set(f.plate.p.x, f.plate.p.y, 0)
      stepFree(f.plate, dt, _target, FLAT)
      if (!f.done && atRest(f.plate, _target)) {
        f.done = true
        onLanded()
      }
    }

    // ── the density schedule ──
    //
    // The law itself is the kernel's (`densityScheduleStep`): page density on
    // the page, altitude density at altitude, toggled on where the plate
    // actually IS rather than on what a mode flag thinks. This scene's only
    // job is translating its four gesture modes into the two mechanism flags
    // the schedule speaks — which is the whole reason the law belongs over
    // there and the translation belongs here (#21).
    //
    // `home` is `returning`: the descent is the motion mask for the re-raster
    // and what matters is arriving at the page 1 : 1. `crumple` is `frozen`:
    // flipping would spend a full re-raster and a texture swap on a sheet
    // that is about to stop being a card, and a delete begun at altitude
    // would otherwise flip low mid-crush.
    const hi = densityScheduleStep(f.hiDensity, {
      z: f.plate.p.z,
      liftZ: LIFT_Z,
      returning: f.mode === 'home',
      frozen: f.mode === 'crumple',
    })
    if (hi !== f.hiDensity) {
      f.hiDensity = hi
      onAltitude(hi)
    }

    // ── the presented pose: physics truth, then the pixel-grid settle ──
    //
    // At rest the card must be indistinguishable from resting DOM, and rest
    // is the only time anyone can stare: even at exactly 1 : 1 density, a
    // texture whose corner sits at a fractional screen position is resampled
    // by bilinear at that fraction — every glyph edge smeared across two
    // device pixels, the fattened-fuzzy look the bisect shots measured.
    //
    // `pixelGridSnap` is the law and it is the kernel's (#21); what stays
    // here is the judgement of WHEN a card counts as at rest, which is the
    // only part of this that was ever about flights. The physics never hears
    // about the answer — same truth/presentation split as the grounded
    // damper (#49) — and the blend runs on plate speed, so a moving card is
    // pure truth and nothing pops in between.
    //
    // Tilt is the one correction the kernel does not own: flat-at-rest is
    // this scene's idea of rest, and it needs a quaternion.
    group.position.copy(f.plate.p)
    group.quaternion.copy(f.plate.q)
    group.scale.set(1, 1, 1)

    const mag = planeScale(camZ, f.plate.p.z)
    const supply = density / dpr
    // Only meaningful where the texture can be 1 : 1 at all — the pin and
    // the plane must agree (they diverge mid-rise and mid-descent, where
    // speed keeps the blend at zero anyway; the gate is for the edges).
    // Never for a crumple: the settle exists to make a RESTING CARD
    // pixel-identical to DOM, and a wad slowing to rest mid-air would be
    // quantized flat — slerped toward FLAT mid-tumble, visibly yanked.
    if (f.mode !== 'crumple' && Math.abs(mag - supply) < supply * 0.02) {
      const edge = Math.hypot(f.w, f.h) / 2
      // A release during hidden warm-up parks its future throw velocity on
      // the plate. That velocity is real, but the plate has not moved yet;
      // presentation must still settle as the motionless page identity.
      const speed = crossing <= 0 ? 0 : f.plate.v.length() + f.plate.w.length() * edge
      const settle = 1 - Math.min(1, Math.max(0, (speed - 2) / 28))
      if (settle > 0) {
        const snap = pixelGridSnap({
          x: f.plate.p.x,
          y: f.plate.p.y,
          width: f.w,
          height: f.h,
          mag,
          viewW: vw,
          viewH: vh,
          dpr,
          density,
        })
        group.position.x += settle * snap.dx
        group.position.y += settle * snap.dy
        group.quaternion.slerp(FLAT, settle)
        group.scale.set(1 + settle * (snap.sx - 1), 1 + settle * (snap.sy - 1), 1)
      }
    }

    // ── the aero bend: the sheet reads the plate's own velocity ──
    //
    // The law lives in aeroFollowStep (physics/plate.ts), under test:
    // direction only follows real motion, amplitude chases the gated curve
    // with a time constant per phase of the paper, and the returned value
    // IS the rendered amplitude — nothing instantaneous touches it on the
    // way to the shader. (The old rendered = smoothed · gate multiply here
    // was both reported symptoms at once: −25.75 px in one frame at a
    // mid-drag pause, and the settle relax compressed into a snap. The
    // follower's gated release + sub-half-pixel snap now owns swap-frame
    // exactness — flat at rest is still EXACTLY 0.)
    {
      // held = any mode but 'home': the swap can only fire at the end of a
      // free flight home, so only there does the relax race a deadline.
      const sm = aeroSm.current
      let amp = 0
      if (crossing <= 0) {
        // The stored release velocity belongs to the future flight. It must
        // not bend the hidden twin that is proving the flat page frame.
        sm.amt = 0
      } else {
        amp = aeroFollowStep(
          sm,
          f.plate.v.x,
          f.plate.v.y,
          dt,
          f.mode !== 'home',
        )
      }
      const reach = aeroReach(sm.dirX, sm.dirY, f.w, f.h, f.hold.x, f.hold.y)
      aero.pack.set(sm.dirX, sm.dirY, amp, reach)
      aero.grab.set(f.hold.x, f.hold.y)
      // The crumple's channel. x is the driver's per-frame verdict; y
      // (seed) and z (wad radius) belong to Flying and are written once.
      aero.wad.x = crush
    }

    // ── the shadow, from the plate's own corners ──
    //
    // A crumpling sheet no longer spans the plate, so the corners are
    // computed from SHRUNKEN dimensions (wadShrink: identity at crush 0,
    // a sixth at full crush) — the shadow contracts with the thing that
    // casts it, and leaves the screen with it (the shadow sits at the wad's
    // own x/y, so the offscreen verdict that ends the flight covers both;
    // its reach is why that verdict inflates the radius).
    const sh = shadowRef.current
    if (!sh) return
    const shrink = wadShrink(crush)
    corners(f.plate, f.w * shrink, f.h * shrink, _corners)
    if (crush > 0) {
      // The wad contracts toward the GRAB point (the shader's 13%-around-
      // uAeroGrab formula), so the shadow must follow its caster: at full
      // crush the ball's centroid sits at grab·0.87 body-local, and the
      // offset rides the same crush that drives the contraction — exactly 0
      // at liftoff (the handoff still draws the DOM's own shadow), under
      // the ball once it is a ball. A keyboard delete's grab is the centre,
      // offset 0 throughout: the old shadow. Without this the blob stayed
      // at the plate's centre while the ball formed at the pressed corner —
      // a shadow half a card away from the thing casting it.
      _wadOff
        .set(f.hold.x * 0.87 * crush, f.hold.y * 0.87 * crush, 0)
        .applyQuaternion(f.plate.q)
      for (const c of _corners) c.add(_wadOff)
    }
    _centroid.set(0, 0, 0)
    for (const c of _corners) _centroid.add(c)
    _centroid.multiplyScalar(0.25)

    const height = Math.max(_centroid.z, 0)

    // The measured layers are the h = 0 truth; height only EVOLVES them.
    // Every factor below is exactly 1 at h = 0, so the liftoff frame draws
    // the DOM's own shadow — same offsets, blurs, colors — and the swap has
    // nothing to pop. Rising: blur grows (the page is farther from the
    // caster), weight fades (more sky reaches around the card), and any
    // authored spread — usually negative, the tight contact hug — relaxes
    // toward zero. A card whose DOM casts nothing casts nothing here either.
    const chrome = chromeRef.current
    const layers = chrome?.shadow ?? []
    const n = Math.min(layers.length, SHADOW_MAX_LAYERS)
    const { value: uOff } = shadowUniforms.uOff
    const { value: uSigma } = shadowUniforms.uSigma
    const { value: uSpread } = shadowUniforms.uSpread
    const { value: uColor } = shadowUniforms.uColor
    const grow = 0.17 * height
    const fade = 1 / (1 + height / 210)
    const relax = 1 / (1 + height / 140)
    let reach = 8
    for (let i = 0; i < n; i++) {
      const l = layers[i]
      const sigma = l.blur / 2 + grow
      const spread = l.spread * relax
      uOff[i].set(l.x, -l.y) // CSS y is down, world y is up
      uSigma[i] = sigma
      uSpread[i] = spread
      uColor[i].set(l.color[0], l.color[1], l.color[2], l.color[3] * fade)
      reach = Math.max(reach, Math.hypot(l.x, l.y) + 3 * sigma + Math.max(spread, 0))
    }
    shadowUniforms.uCount.value = n
    const radii = chrome?.radii
    shadowUniforms.uRadii.value.set(
      radii?.[0] ?? 0,
      radii?.[1] ?? 0,
      radii?.[2] ?? 0,
      radii?.[3] ?? 0,
    )
    const margin = reach

    // Project the plate's corners onto the page along the light, then let
    // `shadowQuadFrame` rebuild the quad with the margin added along the
    // footprint's own axes. The frame's halves go to the shader VERBATIM —
    // the p-space metric and the world metric are the same numbers, which is
    // the whole fix: the old radial corner-push under-delivered the margin
    // vertically (≈0.29× on a wide card) while the uniforms claimed all of
    // it, so every below-card pixel sampled the shadow 2–3σ too far out and
    // the at-rest fringe rendered entirely underneath the card.
    for (let i = 0; i < 4; i++) {
      const c = _corners[i]
      const t = -c.z / LIGHT.z
      _proj[i].set(c.x + LIGHT.x * t, c.y + LIGHT.y * t, 0)
    }
    shadowQuadFrame(_proj, margin, _frame)

    const pos = plainAttribute(sh.geometry, 'position')
    if (!pos) return
    // The frame's verts are already in PlaneGeometry vertex order (TL, TR,
    // BL, BR) — `shadowQuadFrame` did the reorder from `corners` order so
    // the bow-tie mistake has exactly one place to not happen.
    //
    // z = −0.5: strictly BEHIND the card at every altitude, including h = 0.
    // The card renders first and writes depth, so the depth test deletes the
    // shadow wherever the card touched a pixel — which is exactly CSS's rule
    // that box-shadow paints only outside the border box. At +0.5 the plane
    // sat in FRONT of a resting card, the order put the card's blend on top,
    // and the shadow's interior (hairline α .04 + fringe) showed through the
    // border's AA column as a dark seam line.
    for (let i = 0; i < 4; i++) {
      pos.setXYZ(i, _frame.verts[i].x, _frame.verts[i].y, -0.5)
    }
    pos.needsUpdate = true
    sh.geometry.computeBoundingSphere()

    shadowUniforms.uQuadHalf.value.copy(_frame.quadHalf)
    shadowUniforms.uCardHalf.value.copy(_frame.cardHalf)
  })

  return null
}

// ── the airborne card ────────────────────────────────────────────────────

interface FlyingProps {
  card: Card
  flight: React.RefObject<Flight | null>
  lift: Lift
  onChange: (patch: Partial<Card>) => void
  onRegrab: (localX: number, localY: number) => void
  slotRect: (id: string) => DOMRect | null
  scrollTop: () => number
  onLanded: () => void
  /**
   * Board-owned altitude state, reflected back down from the driver. The
   * driver's density schedule writes it (via `onAltitude`) and TWO consumers
   * read it: the texture pin here, and the vacated slot's outline on the
   * page — which must fade while the card is still in the air, because the
   * swap instant is exactly when nothing may change (see the slot CSS).
   */
  atAltitude: boolean
  onAltitude: (hi: boolean) => void
  /** The airborne card's ✕ — a card is deletable mid-flight. */
  onDelete: (e?: React.PointerEvent<HTMLButtonElement>) => void
  /** The wad left the viewport: commit the delete. */
  onCrumpled: () => void
}

function Flying({
  card,
  flight,
  lift,
  onChange,
  onRegrab,
  slotRect,
  scrollTop,
  onLanded,
  atAltitude,
  onAltitude,
  onDelete,
  onCrumpled,
}: FlyingProps) {
  const f = flight.current!
  const cardRef = useRef<THREE.Group>(null)
  const shadowRef = useRef<THREE.Mesh>(null)
  const grabbed = useRef<(() => void) | null>(null)
  const viewH = useThree((s) => s.size.height)
  const dpr = useThree((s) => s.viewport.dpr)

  // The card must be indistinguishable from the resting DOM it replaces —
  // and it lives on TWO planes, so it needs two densities, not one.
  //
  // Both are one kernel identity evaluated at two heights — `densitySupply`,
  // which is `texelDemand` at the plate's altitude and degenerates to exactly
  // dpr on the page. Spelling it out here was how this scene ended up owning
  // a private copy of a law the kernel already had under contract (#21).
  //
  // On the page (z ≈ 0) a CSS pixel is a device pixel × dpr, full stop. At
  // altitude the card sits on the lift plane, magnified by exactly
  // planeScale(camZ, LIFT_Z), so the same content needs that many more
  // texels to stay 1 : 1 with the display. Pinning the ALTITUDE density for
  // the whole flight was measured to be the grab-moment blur itself: the
  // texture is born 11% too dense for the page, and the #46 hard cut swaps
  // crisp DOM for that texture minified into the resting rect — mush, one
  // frame after perfect, precisely when the eye is looking at it.
  //
  // So the pin follows the card: born at page density (the handoff frame is
  // a pixel-for-pixel copy of the DOM it replaces), re-pinned to altitude
  // density as the plate climbs through the approach (the swap re-rasters in
  // place, hidden by the rise), and back to page density on the way home so
  // the landing swap is a pixel copy too. The driver owns the toggle — it is
  // the only thing that watches z every frame.
  const density = densitySupply(atAltitude, dpr, cameraDistance(viewH, FOV), LIFT_Z)

  // Scene hook (scenes hang their live state on a `window.__<scene>` hook
  // for console interrogation): the flight ref and the card's transform
  // group, alive exactly while a card is airborne.
  useEffect(() => {
    const w = window
    w.__flight = { flight, cardRef }
    return () => {
      delete w.__flight
    }
  }, [flight])

  // Re-grabbing an airborne card cannot go through an r3f handler: `Surface`
  // installs its own `onPointerDown` AFTER spreading the caller's mesh props,
  // so ours would simply be discarded. It comes through the DOM instead —
  // which is better anyway, because then the `[data-nodrag]` test that
  // protects the note field is the same one the page copy uses, and the hit
  // has already been resolved against the real subtree rather than against a
  // rectangle. The host is `position: fixed` at page (0, 0), so an
  // offset within its rect IS the body-local point.
  const onHost = useCallback(
    (el: HTMLElement | null) => {
      grabbed.current?.()
      grabbed.current = null
      if (!el) return
      const down = (ev: PointerEvent) => {
        if (closestFrom(ev.target, '[data-nodrag]')) return
        const r = el.getBoundingClientRect()
        onRegrab(
          ev.clientX - r.left - f.w / 2,
          -(ev.clientY - r.top - f.h / 2),
        )
      }
      el.addEventListener('pointerdown', down)
      grabbed.current = () => el.removeEventListener('pointerdown', down)
    },
    [onRegrab, f.w, f.h],
  )
  useEffect(() => () => grabbed.current?.(), [])

  const shadowUniforms = useMemo<ShadowUniforms>(
    () => ({
      uQuadHalf: { value: new THREE.Vector2(1, 1) },
      uCardHalf: { value: new THREE.Vector2(1, 1) },
      uRadii: { value: new THREE.Vector4(0, 0, 0, 0) },
      uCount: { value: 0 },
      uOff: { value: Array.from({ length: SHADOW_MAX_LAYERS }, () => new THREE.Vector2()) },
      uSigma: { value: new Array(SHADOW_MAX_LAYERS).fill(0) },
      uSpread: { value: new Array(SHADOW_MAX_LAYERS).fill(0) },
      uColor: { value: Array.from({ length: SHADOW_MAX_LAYERS }, () => new THREE.Vector4()) },
    }),
    [],
  )

  // The card's measured chrome — radii and box-shadow layers — captured on
  // its first paint and re-measured only when a paint changes it. A ref, not
  // state: the only consumer is the Driver's per-frame uniform write.
  const chromeRef = useRef<SurfaceChrome | null>(null)

  // The sheet field's shared objects: Driver mutates them in place, the
  // material's uniforms hold the very same references. Amplitude starts at
  // 0 — a card is born flat — and the wad channel is born at its identity
  // (crush 0) with a per-flight hash seed, so every delete crushes along
  // different creases, and a wad radius from the card's own smaller
  // dimension.
  const aero = useMemo<AeroState>(
    () => ({
      pack: new THREE.Vector4(1, 0, 0, 1),
      grab: new THREE.Vector2(),
      wad: new THREE.Vector3(0, Math.random() * 10, Math.min(f.w, f.h) * 0.3),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <>
      <Driver
        flight={flight}
        progress={lift.progress}
        slotRect={slotRect}
        scrollTop={scrollTop}
        onLanded={onLanded}
        cardRef={cardRef}
        shadowRef={shadowRef}
        shadowUniforms={shadowUniforms}
        density={density}
        onAltitude={onAltitude}
        chromeRef={chromeRef}
        aero={aero}
        onCrumpled={onCrumpled}
      />

      {/* The shadow must draw during hidden warm-up. `onFirstPresented`
          proves the card mesh after its draw; that frame then draws this
          later renderOrder before the next lift tick may release the page.
          The Canvas wrapper's opacity keeps both unseen during warm-up.
          Hiding this mesh instead would prove a framebuffer without one of
          the incoming presenters and reveal the shadow one frame late.

          renderOrder 2 — AFTER the card, on purpose. The card writes depth
          (matter occludes its own shadow), so drawing the shadow second lets
          the depth test carve the card's silhouette out of it per fragment:
          CSS's outside-the-border-box clip, enforced by geometry. Drawn
          first, the shadow's interior survived under the card and leaked
          through the border's AA column as a 1px dark seam — the "extra
          border" on the right edge. The corners still show fringe: the
          radius mask DISCARDS there, no depth is written, and the shadow
          paints the notch exactly where CSS would. */}
      <mesh ref={shadowRef} renderOrder={2} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          uniforms={shadowUniforms}
          vertexShader={SHADOW_VERT}
          fragmentShader={SHADOW_FRAG}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <group ref={cardRef}>
        <SurfaceApp
          label={`flight-${card.id}`}
          width={f.w}
          height={f.h}
          resolution={density}
          material="none"
          renderOrder={1}
          frustumCulled={false}
          userData={{ matter: true }}
          onHost={onHost}
          // The handoff's readiness signal. An upload only says that texture
          // bytes reached the GPU; it does not prove that the default
          // framebuffer received the card. `useLift` releases the page only
          // after this post-draw receipt, and keys it by card so remounts do
          // not count twice.
          onFirstPresented={() => lift.present(card.id)}
          onChrome={(c) => {
            chromeRef.current = c
          }}
          content={<CardBody card={card} onChange={onChange} onDelete={onDelete} />}
        >
          {/* Segments are the bend's resolution: 32×12 puts a vertex every
              ~16 px on a 514-wide card, enough for the parabolic bow to
              read as a curve rather than a crease. A flat card renders
              identically at any tessellation. */}
          <planeGeometry args={[f.w, f.h, 32, 12]} />
          <CardMaterial aero={aero} />
        </SurfaceApp>
      </group>
    </>
  )
}

// ── camera calibration ───────────────────────────────────────────────────

const FOV = 42

function PixelPerfect() {
  // SAFETY: r3f types the store's camera as the base class and hands back a
  // PerspectiveCamera unless the Canvas asks for `orthographic`. This one
  // does not, and could not: the frustum-fitting below is what makes a CSS
  // pixel a world unit, and an orthographic camera has no fov to fit.
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  useLayoutEffect(() => {
    // The whole lab rests on this one line: put the camera exactly far
    // enough back that the frustum is the viewport at z = 0. Everything
    // downstream — rects as poses, texels as pixels, "1 CSS px" as a world
    // unit — is a consequence of it and nothing else has to know.
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(size.height, FOV))
    camera.near = 1
    camera.far = camera.position.z * 3
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera, size.width, size.height])
  return null
}

// ── FLIP, so the reflow is something you can watch ───────────────────────

function captureRects(root: HTMLElement) {
  const out = new Map<Element, DOMRect>()
  root.querySelectorAll('.l14-slot').forEach((el) => out.set(el, el.getBoundingClientRect()))
  return out
}

/**
 * Play the difference. These are page elements, not Surface content, so
 * transforms are perfectly ordinary here — the compositor rule this project
 * lives under only ever applied to a subtree being rasterized.
 */
function playFlip(root: HTMLElement, before: Map<Element, DOMRect>) {
  root.querySelectorAll('.l14-slot').forEach((el) => {
    const b = before.get(el)
    if (!b) return
    const a = el.getBoundingClientRect()
    const dx = b.left - a.left
    const dy = b.top - a.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 230, easing: 'cubic-bezier(.22,.61,.36,1)' },
    )
  })
}

// ── the lab ──────────────────────────────────────────────────────────────

export function FlightApp({ chips }: { chips?: React.ReactNode }) {
  const [cards, setCards] = useState<Record<string, Card>>(() => {
    const byId: Record<string, Card> = {}
    for (const c of SEED) byId[c.id] = c
    return byId
  })
  const [board, setBoard] = useState<Record<ColId, string[]>>(() => ({ ...START }))
  const [flyingId, setFlyingId] = useState<string | null>(null)
  // Flight's existing f.lift and plate solver own the continuous excursion.
  // The public lift owns only custody: zero is the identity frame at either
  // edge, then one renderer tick admits the scene's motion. The page has no
  // autonomous motion, and drop reflow is barred until GL holds, so no settle
  // dwell is owed. One millisecond is deliberate: LiftDriver still publishes
  // both zero-progress handoff frames without adding a second visible ramp.
  const lift = useLift({
    presenters: 1,
    timing: { settleMs: 0, rampMs: 1 },
  })
  const requestLift = lift.request
  const glHolds = lift.glHolds
  // A finished card stays mounted, unseen, through useLift's reclaim linger.
  // That keeps the Surface React-root teardown out of the commit that gives pixels back to
  // the page and also keeps the old presentation receipt from proving a new
  // card during the linger.
  const ending = useRef(false)
  // The density schedule's altitude verdict, lifted here because the vacated
  // slot's outline keys on it too: the outline may only be lit while the
  // card is safely away, and must fade on the DESCENT — the swap instant is
  // exactly when nothing on the page is allowed to change.
  const [atAltitude, setAtAltitude] = useState(false)

  const flight = useRef<Flight | null>(null)
  const slots = useRef(new Map<string, HTMLLIElement>())
  const boardEl = useRef<HTMLDivElement>(null)

  const scroller = useRef<HTMLDivElement>(null)

  const slotRect = useCallback((id: string) => {
    const el = slots.current.get(id)
    return el ? el.getBoundingClientRect() : null
  }, [])

  const scrollTop = useCallback(() => scroller.current?.scrollTop ?? 0, [])

  const patch = useCallback((id: string, p: Partial<Card>) => {
    setCards((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }))
  }, [])

  // Where would a drop at (x, y) land? The gap the card would leave is
  // already in the list — it is the card's own slot, still holding its full
  // height because the page copy is only hidden, not removed. So this is a
  // plain "which slot is the pointer nearest the top half of".
  const dropTarget = useCallback(
    (x: number, y: number, id: string): { col: ColId; index: number } | null => {
      for (const { id: col } of COLS) {
        const list = board[col]
        const ul = boardEl.current?.querySelector(`[data-col="${col}"] ul`)
        if (!ul) continue
        const r = ul.getBoundingClientRect()
        if (x < r.left - 24 || x > r.right + 24) continue
        let index = list.length
        for (let i = 0; i < list.length; i++) {
          const sr = slotRect(list[i])
          if (sr && y < sr.top + sr.height / 2) {
            index = i
            break
          }
        }
        // Removing the card from its own column shifts everything after it.
        const from = list.indexOf(id)
        if (from >= 0 && index > from) index--
        return { col, index }
      }
      return null
    },
    [board, slotRect],
  )

  // A board reorder starts FLIP transforms on the page. While the page owns
  // the pixels, that would move the source underneath the still-identity
  // hidden twin and make a zero settle dwell false. Pointer coordinates keep
  // updating during warm-up, but a slot may move only after GL owns pixels.
  const ownedDropTarget = useCallback(
    (x: number, y: number, id: string) => {
      if (!glHolds) return null
      return dropTarget(x, y, id)
    },
    [dropTarget, glHolds],
  )

  const moveTo = useCallback(
    (col: ColId, index: number, id: string) => {
      setBoard((prev) => {
        const cur = COLS.map((c) => c.id).find((c) => prev[c].includes(id))
        if (!cur) return prev
        if (cur === col && prev[cur].indexOf(id) === index) return prev
        const next = { queue: [...prev.queue], today: [...prev.today] }
        next[cur].splice(next[cur].indexOf(id), 1)
        next[col].splice(index, 0, id)
        return next
      })
    },
    [],
  )

  // FLIP: snapshot before every commit that can move a slot, play after.
  const pending = useRef<Map<Element, DOMRect> | null>(null)
  const snapshot = useCallback(() => {
    if (boardEl.current) pending.current = captureRects(boardEl.current)
  }, [])
  useLayoutEffect(() => {
    if (pending.current && boardEl.current) playFlip(boardEl.current, pending.current)
    pending.current = null
  }, [board])

  // ── the gesture ──
  const beginDrag = useCallback(
    (id: string, e: React.PointerEvent<HTMLDivElement>) => {
      if (closestFrom(e.target, '[data-nodrag]')) return
      if (flight.current) return
      const el = e.currentTarget.getBoundingClientRect()
      e.preventDefault()

      const plate = makePlate(el.width, el.height)
      plate.p.set(
        el.left + el.width / 2 - window.innerWidth / 2,
        window.innerHeight / 2 - (el.top + el.height / 2),
        0,
      )
      flight.current = {
        id,
        w: el.width,
        h: el.height,
        hold: new THREE.Vector3(
          e.clientX - (el.left + el.width / 2),
          el.top + el.height / 2 - e.clientY,
          0,
        ),
        plate,
        mode: 'held',
        crumpleT: 0,
        crumpleHeld: false,
        tossed: false,
        spin: new THREE.Vector3(),
        anchor: new THREE.Vector3(),
        anchorScroll: 0,
        downAt: performance.now(),
        downX: e.clientX,
        downY: e.clientY,
        floated: false,
        hiDensity: false,
        px: e.clientX,
        py: e.clientY,
        handVel: new THREE.Vector3(),
        prevTarget: new THREE.Vector3(),
        handSeeded: false,
        releaseVel: new THREE.Vector3(),
        releaseX: e.clientX,
        releaseY: e.clientY,
        releaseAt: e.timeStamp,
        releaseSeeded: false,
        lift: 0,
        done: false,
      }
      ending.current = false
      setAtAltitude(false)
      requestLift(true)
      setFlyingId(id)
    },
    [requestLift],
  )

  // ── the delete ──
  //
  // One entry for both worlds, and one entry for both GESTURES. With a
  // pointer event the ✕ was PRESSED: the crumple starts held — the sheet
  // lifts into the grip pinned at the pressed point, balls up in the hand,
  // and the release (attachFlightGestures) is a throw. Without one (keyboard
  // activation of the button, or the click that trails a press and finds
  // the crumple already running) it is the hands-free delete: rise, crush,
  // drop. A card already in flight crumples from its current pose —
  // momentum and all; a card at rest on the page becomes matter first, the
  // same flight machinery as a grab (page copy releases on presentation
  // proof, plate springs off the page), except the mode is `crumple` from birth.
  const deleteCard = useCallback((id: string, e?: React.PointerEvent<HTMLButtonElement>) => {
    if (ending.current) return
    const cardEl = e ? closestFrom(e.target, '.l14-card') : null
    const f = flight.current
    if (f) {
      // One flight at a time — and a crumple, once started, is not restarted.
      if (f.id !== id || f.mode === 'crumple') return
      f.mode = 'crumple'
      f.crumpleT = 0
      f.done = false
      f.lift = 1
      f.tossed = false
      if (e && cardEl) {
        e.preventDefault()
        // The pressed point, body-local. The event's coordinates are
        // PARKED-LOCAL for an airborne copy (the host is fixed at page
        // (0,0)), so "relative to the card element's own rect" is the
        // body-local point in both worlds — the same formula as
        // beginDrag and onHost.
        const r = cardEl.getBoundingClientRect()
        f.hold.set(e.clientX - (r.left + r.width / 2), r.top + r.height / 2 - e.clientY, 0)
        f.crumpleHeld = true
        f.spin.set(0, 0, 0)
        // The held solver's target jumps to the pointer ray; differentiating
        // across that jump would read as a flick nobody performed.
        f.handSeeded = false
        // px/py must be the REAL pointer's page position, and the relayed
        // event's coordinates are parked-local — but the pressed point's
        // world position is exactly under the real pointer at this instant:
        // project it back to the screen.
        _pressWorld.copy(f.hold).applyQuaternion(f.plate.q).add(f.plate.p)
        const m = planeScale(cameraDistance(window.innerHeight, FOV), _pressWorld.z)
        f.px = window.innerWidth / 2 + _pressWorld.x * m
        f.py = window.innerHeight / 2 - _pressWorld.y * m
        f.handVel.set(0, 0, 0)
        resetReleaseSample(f, f.px, f.py, performance.now())
      } else {
        f.crumpleHeld = false
        f.spin.set(
          (Math.random() - 0.5) * 2.0,
          (Math.random() - 0.5) * 2.0,
          (Math.random() - 0.5) * 5.0,
        )
      }
      return
    }
    const el = slots.current.get(id)?.querySelector<HTMLElement>('.l14-card')
    if (!el) return
    const r = el.getBoundingClientRect()
    if (e) e.preventDefault()
    const held = !!e
    const plate = makePlate(r.width, r.height)
    plate.p.set(
      r.left + r.width / 2 - window.innerWidth / 2,
      window.innerHeight / 2 - (r.top + r.height / 2),
      0,
    )
    flight.current = {
      id,
      w: r.width,
      h: r.height,
      // Held: the pinch point, so the sheet lifts pinned at the fingers —
      // exactly like a grab — and the crush contracts the ball into them.
      // Keyboard: the centre, the old formula.
      hold: e
        ? new THREE.Vector3(
            e.clientX - (r.left + r.width / 2),
            r.top + r.height / 2 - e.clientY,
            0,
          )
        : new THREE.Vector3(),
      plate,
      mode: 'crumple',
      crumpleT: 0,
      crumpleHeld: held,
      tossed: false,
      // A held ball spins only when thrown — the release writes it; the
      // hands-free path tumbles lazily from birth, as before.
      spin: held
        ? new THREE.Vector3()
        : new THREE.Vector3(
            (Math.random() - 0.5) * 2.0,
            (Math.random() - 0.5) * 2.0,
            (Math.random() - 0.5) * 5.0,
          ),
      anchor: new THREE.Vector3(),
      anchorScroll: 0,
      downAt: performance.now(),
      downX: e ? e.clientX : 0,
      downY: e ? e.clientY : 0,
      floated: false,
      hiDensity: false,
      px: e ? e.clientX : 0,
      py: e ? e.clientY : 0,
      handVel: new THREE.Vector3(),
      prevTarget: new THREE.Vector3(),
      handSeeded: false,
      releaseVel: new THREE.Vector3(),
      releaseX: e ? e.clientX : 0,
      releaseY: e ? e.clientY : 0,
      releaseAt: e ? e.timeStamp : performance.now(),
      releaseSeeded: false,
      lift: 0,
      done: false,
    }
    ending.current = false
    setAtAltitude(false)
    requestLift(true)
    setFlyingId(id)
  }, [requestLift])

  const regrab = useCallback((localX: number, localY: number) => {
    const f = flight.current
    if (!f) return
    if (f.mode === 'crumple') return
    f.hold.set(localX, localY, 0)
    f.mode = 'held'
    f.lift = Math.max(f.lift, 0.35)
    f.done = false
    // The target jumps from the float anchor to wherever the ray now lands;
    // differentiating across that would read as a flick nobody performed.
    f.handSeeded = false
    f.handVel.set(0, 0, 0)
    // The Surface relay reports parked-local client coordinates. Recover the
    // trusted pointer's real screen position from the pressed world point,
    // then seed the event-rate release channel from that same point.
    _pressWorld.copy(f.hold).applyQuaternion(f.plate.q).add(f.plate.p)
    const m = planeScale(cameraDistance(window.innerHeight, FOV), _pressWorld.z)
    f.px = window.innerWidth / 2 + _pressWorld.x * m
    f.py = window.innerHeight / 2 - _pressWorld.y * m
    resetReleaseSample(f, f.px, f.py, performance.now())
    f.downAt = performance.now()
    f.downX = f.px
    f.downY = f.py
  }, [])

  // Registered once and always, NOT gated on `flyingId`. An effect keyed on
  // that state does not run until React has committed the render the
  // `pointerdown` scheduled — and a quick tap's `pointerup` arrives before
  // that, so the listener that was supposed to hear the release did not exist
  // yet and the card stayed glued to a pointer whose button was already up.
  // Every handler reads `flight.current`, which is set synchronously, so
  // there is nothing to gate: with no flight they all return on the first
  // line. The handlers themselves live in physics/gestures.ts — they filter
  // `isTrusted`, and the test file is the story of why.
  // The gesture's lift-plane carry, with the lab's own camera. The canvas
  // fills the window here, so `innerHeight` is the calibration height.
  const toLiftPlane = useCallback(
    (a: THREE.Vector3) => carryToPlane(a, cameraDistance(window.innerHeight, FOV), LIFT_Z),
    [],
  )

  useEffect(() => {
    // Pointer events can complete an entire flick before Driver receives one
    // animation frame. Sample them in capture phase, then give the release
    // handler the event-rate estimate before it transfers velocity to the
    // plate. The frame-rate hand channel remains the held spring's input.
    const onReleaseSample = (event: PointerEvent) => {
      if (!event.isTrusted) return
      const f = flight.current
      if (!f || (f.mode !== 'held' && !(f.mode === 'crumple' && f.crumpleHeld))) return
      sampleRelease(f, event)
      if (event.type !== 'pointermove') f.handVel.copy(f.releaseVel)
    }
    window.addEventListener('pointermove', onReleaseSample, true)
    window.addEventListener('pointerup', onReleaseSample, true)
    window.addEventListener('pointercancel', onReleaseSample, true)

    const detach = attachFlightGestures({
      flight,
      dropTarget: ownedDropTarget,
      moveTo,
      snapshot,
      scrollTop,
      toLiftPlane,
    })
    return () => {
      window.removeEventListener('pointermove', onReleaseSample, true)
      window.removeEventListener('pointerup', onReleaseSample, true)
      window.removeEventListener('pointercancel', onReleaseSample, true)
      detach()
    }
  }, [ownedDropTarget, moveTo, snapshot, scrollTop, toLiftPlane])

  const onLanded = useCallback(() => {
    if (ending.current) return
    ending.current = true
    requestLift(false)
  }, [requestLift])

  // The wad faded out: NOW the board forgets. The FLIP snapshot goes first,
  // so the neighbours close over the vacated slot as a layout animation
  // rather than a cut — the one reflow in this lab a delete is allowed to
  // cause, and the user watches it happen.
  const onCrumpled = useCallback(() => {
    const f = flight.current
    if (!f || ending.current) return
    ending.current = true
    const id = f.id
    snapshot()
    setCards((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setBoard((prev) => ({
      queue: prev.queue.filter((x) => x !== id),
      today: prev.today.filter((x) => x !== id),
    }))
    requestLift(false)
  }, [requestLift, snapshot])

  // The page already holds when this runs. Waiting for `glMounted` to fall
  // keeps the Surface React-root teardown in useLift's later reclaim commit and
  // clears its keyed receipt before another card can start a flight.
  useEffect(() => {
    if (!ending.current || lift.glMounted) return
    ending.current = false
    flight.current = null
    setFlyingId(null)
    setAtAltitude(false)
    document.querySelectorAll<HTMLElement>('.l14-slot').forEach((el) => {
      el.style.removeProperty('--l14-near')
    })
  }, [lift.glMounted])

  // The loop closing: the physics writes a CSS custom property onto the slot
  // it is aimed at, every frame, and ordinary CSS does the rest.
  useEffect(() => {
    if (!flyingId) return
    let raf = 0
    const tick = () => {
      const f = flight.current
      if (f) {
        const r = slotRect(f.id)
        const el = slots.current.get(f.id)
        if (r && el) {
          if (f.mode === 'crumple') {
            // A crumpling card is never coming home — a held ball carried
            // near its old slot must not make the slot glow with welcome.
            el.style.removeProperty('--l14-near')
          } else {
            const d = Math.hypot(
              f.plate.p.x - (r.left + r.width / 2 - window.innerWidth / 2),
              f.plate.p.y - (window.innerHeight / 2 - (r.top + r.height / 2)),
              f.plate.p.z,
            )
            el.style.setProperty('--l14-near', String(Math.max(0, 1 - d / 260).toFixed(3)))
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [flyingId, slotRect])

  const flyingCard = flyingId ? cards[flyingId] : null

  return (
    <div className="l14" ref={scroller}>
      {/* The black cluster: wordmark and scene selector, nothing else. The
       * board is the whole page — a paragraph explaining what you are
       * about to do to it would only be read once, and by then the card is
       * already in the air. */}
      <div className="l14-bar">
        <div className="l14-bar-inner">
          <h1>
            mun<em>ari</em>
          </h1>
          {chips}
        </div>
      </div>

      <div className="l14-inner">
        <div className="l14-board" ref={boardEl}>
          {COLS.map((col) => (
            <section className="l14-col" data-col={col.id} key={col.id}>
              <h2>
                {col.name}
                <span className="l14-count">
                  {String(board[col.id].length).padStart(2, '0')}
                </span>
              </h2>
              <ul>
                {board[col.id].map((id) => (
                  <li
                    className="l14-slot"
                    key={id}
                    data-empty={flyingId === id && !lift.pageHolds}
                    data-away={flyingId === id && !lift.pageHolds && atAltitude}
                    ref={(el) => {
                      if (el) slots.current.set(id, el)
                      else slots.current.delete(id)
                    }}
                  >
                    <CardBody
                      card={cards[id]}
                      onChange={(p) => patch(id, p)}
                      onGrab={(e) => beginDrag(id, e)}
                      onDelete={(e) => deleteCard(id, e)}
                      hidden={flyingId === id && !lift.pageHolds}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <Canvas
        className="l14-overlay"
        // `position`, `inset` and `pointer-events` all have to be INLINE. r3f
        // writes `position: relative` AND `pointer-events: auto` onto its own
        // wrapper div as inline styles, and an inline declaration outranks any
        // class — so the stylesheet lost silently, twice. First the overlay was
        // laid out as an ordinary block after the article, a full viewport
        // below the fold (the scene was complete and correct the whole time; it
        // was simply somewhere else). Then, once it was in the right place, the
        // wrapper sat over the entire page swallowing every pointerdown, so no
        // card could be grabbed at all — a full-viewport invisible div is a
        // very quiet way to break a page.
        //
        // `SolidWhereMatterIs` toggles the CANVAS, one level down. A child may
        // re-enable `pointer-events` under a `none` parent, which is exactly
        // the arrangement we want: the wrapper is permanently transparent to
        // the pointer, and the canvas inside it is solid only while the ray
        // says it is over matter.
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          opacity: lift.glHolds ? 1 : 0,
        }}
        gl={{ alpha: true, antialias: true }}
        // An overlay stretched across somebody's document does not get to burn
        // a GPU frame every 8 ms for the privilege of being empty. There is a
        // card in flight or there is nothing to draw, and the difference is
        // this prop. (Same instinct as the upload-on-paint contract one layer
        // down: idle costs nothing, and "idle" is the normal case.)
        frameloop={lift.phase === 'page' ? 'demand' : 'always'}
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => {
          state.gl.setClearAlpha(0)
          window.__r3f = state
        }}
      >
        <PixelPerfect />
        <LiftDriver lift={lift} />
        <CanvasPointerGate
          enabled={!!flyingId && lift.glHolds && !ending.current}
          isTarget={(object) => Boolean(object.userData.matter)}
        />
        {flyingCard && flight.current && lift.glMounted && (
          <Flying
            key={flyingCard.id}
            card={flyingCard}
            flight={flight}
            lift={lift}
            onChange={(p) => patch(flyingCard.id, p)}
            onRegrab={regrab}
            slotRect={slotRect}
            scrollTop={scrollTop}
            onLanded={onLanded}
            atAltitude={atAltitude}
            onAltitude={setAtAltitude}
            onDelete={(e) => deleteCard(flyingCard.id, e)}
            onCrumpled={onCrumpled}
          />
        )}
      </Canvas>
    </div>
  )
}
