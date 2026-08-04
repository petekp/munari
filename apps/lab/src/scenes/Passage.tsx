// The passage scene — a route transition that is a physical event.
//
// THE CLAIM. A shared-element transition on the web is a photograph. The
// browser's own View Transitions API says so plainly: it captures the old
// state into a static image, cross-fades it against the new one, and for the
// duration of the transition the thing you are looking at is a picture. Every
// CSS "morph" is the same shape of trick — two states and an interpolator
// between them, and the interpolator has never run a layout.
//
// Here the element does not get photographed. It leaves the page as matter,
// flies, and lands as the detail view — and on the way its DOM is laid out
// again, at every intermediate width, by the real layout engine.
//
// THE MECHANISM is one platform fact (platform.md #11): a `@container` query
// is a question about an ELEMENT's size, and a parked canvas is that
// element's containing block, so a container query inside a Surface resolves
// against the Surface's own box. `@media` does not — it stays page-global,
// because a parked canvas is deliberately not a viewport. So a Surface's
// `width` is not merely a texture dimension, it is a LAYOUT INPUT, and
// sweeping it from the tile's box to the article's box makes the component
// re-answer "what shape am I" sixty times a second while it is in the air.
//
// The card in `passage.css` is authored exactly once, the way you would
// author it for an ordinary responsive page. It is never told which state to
// be in and there is no second "expanded" component. Halfway through the
// flight it is 600 px wide — a width nobody designed for — and it looks
// right there because the layout engine is deciding, not a keyframe.
//
// THE INSTRUMENT is the pill on the cover art: a frame counter and a sweep
// driven by requestAnimationFrame INSIDE the card's own React root. If a
// transition works by taking a picture, that readout freezes, and the freeze
// is legible in a single screenshot. The same page can run the same click
// through `document.startViewTransition` — the toggle at the top — so this is
// a measurement rather than an assertion.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { flushSync } from 'react-dom'
import * as THREE from 'three'
import { SurfaceApp, useSurfaceTexture, cameraDistance } from 'anamorph'
import {
  HEIGHT_OMEGA,
  atTarget,
  boxOf,
  densityAt,
  followHeight,
  gridSnap,
  landed,
  poseAt,
  sizeProgress,
  springStep,
  type Box,
} from './passagePath'
import { SHADOW_FRAG, SHADOW_VERT, shadowFrame } from './passageShadow'
import { markupOf, measureEndpoint, type Endpoint } from './passageMeasure'
import { planFlight } from './passageParts'
import { PassageField, cardSizeAt } from './passageField'
import './passage.css'

// ── the library ──────────────────────────────────────────────────────────

interface Item {
  id: string
  eyebrow: string
  title: string
  byline: string
  c1: string
  c2: string
  c3: string
  stats: [label: string, value: string][]
  body: string[]
}

const LIBRARY: Item[] = [
  {
    id: 'clip',
    eyebrow: 'platform · 04',
    title: 'The capture is clipped at the border box',
    byline: 'measured in Chrome 150 · 6 min',
    c1: '#3b6fe0',
    c2: '#8b5cf6',
    c3: '#131a2b',
    stats: [
      ['bare', '0 px'],
      ['wrapped', '12 000 px'],
      ['control', 'unchanged'],
    ],
    body: [
      'A box-shadow lives outside the border box, and the rasterizer cuts there. Drawing the element bare returned zero red pixels — the ink was in the paint record and thrown away at the edge.',
      'The clip follows whichever element was handed over, so the fix is to hand over a bigger one. The same div inside a hundred pixels of padding, with the wrapper drawn, returned all twelve thousand.',
    ],
  },
  {
    id: 'container',
    eyebrow: 'platform · 11',
    title: 'A parked canvas is a container, not a viewport',
    byline: 'measured 2026-08-04 · 4 min',
    c1: '#2dd4bf',
    c2: '#3b82f6',
    c3: '#0d1f22',
    stats: [
      ['@container', 'resolves'],
      ['@media', 'page-global'],
      ['reversible', 'yes'],
    ],
    body: [
      'Viewport questions stay page-global inside a parked canvas: vw, vh, matchMedia and every @media breakpoint answer for the page, because a canvas is deliberately not a viewport.',
      'Element questions do not. A container query resolves against the parked subtree’s own box — 10px to 40px, row to column, and all the way back — which is why the card you are reading can be flown between two shapes without anyone interpolating it.',
    ],
  },
  {
    id: 'depth',
    eyebrow: 'decisions · 58',
    title: 'Blend order cannot express a clip. Depth can.',
    byline: 'field note · 9 min',
    c1: '#f59e0b',
    c2: '#ef4444',
    c3: '#241408',
    stats: [
      ['symptom', '1 px seam'],
      ['cause', 'AA column'],
      ['fix', 'depth test'],
    ],
    body: [
      'A shadow quad drawn in front of a resting card leaked through the card’s own antialiased border column — a one-pixel dark line that read as an extra border on the right edge.',
      'Drawing the card first so it writes depth, then the shadow behind it, lets the depth test carve the silhouette out per fragment. That is CSS’s outside-the-border-box clip, enforced by geometry instead of by blending.',
    ],
  },
  {
    id: 'forge',
    eyebrow: 'decisions · 50',
    title: 'Window is a party line',
    byline: 'field note · 7 min',
    c1: '#a78bfa',
    c2: '#ec4899',
    c3: '#1c1430',
    stats: [
      ['door', 'one'],
      ['brand', 'Symbol.for'],
      ['guard', 'isTrusted'],
    ],
    body: [
      'Every synthetic pointer event a Surface retells bubbles to the document by design, because that is where the grace areas of every floating-UI library live. Stopping them would break the thing they exist to serve.',
      'So provenance becomes the listener’s job, and the vocabulary has exactly one door. A brand that survives module reload is what makes the predicate complete rather than merely usually right.',
    ],
  },
  {
    id: 'aero',
    eyebrow: 'decisions · 62',
    title: 'A live pipeline is not a visible effect',
    byline: 'field note · 5 min',
    c1: '#4ade80',
    c2: '#22d3ee',
    c3: '#0b2018',
    stats: [
      ['wired', 'all of it'],
      ['visible', 'under 2%'],
      ['retuned', 'by hand'],
    ],
    body: [
      'Every wire was live. Forcing the uniform bowed the card instantly, and the driver was delivering real amplitude at real speeds. The bug was the curve: at the shipped cap the swell was single-digit pixels head-on.',
      'Tuned by eye needs the eye on real drags. The visibility floor is a test now, so the next retune cannot quietly fall back under it.',
    ],
  },
  {
    id: 'crumple',
    eyebrow: 'decisions · 60',
    title: 'Paper folds in chunks, not in noise',
    byline: 'field note · 8 min',
    c1: '#fb7185',
    c2: '#f97316',
    c3: '#2a0f16',
    stats: [
      ['per-vertex', 'confetti'],
      ['6×3 cells', 'paper'],
      ['remainder', '35%'],
    ],
    body: [
      'Per-vertex noise targets make a card disintegrate into confetti. Real paper creases along a few coarse folds and everything between them rides along.',
      'Coarse cell targets with a small per-vertex remainder was the whole difference, and the facet shading came free from the screen-space derivatives of world position.',
    ],
  },
]

// ── the liveness instrument ──────────────────────────────────────────────
//
// A frame counter shared by every root that asks for it. The page cards and
// the airborne card subscribe to the SAME source, which matters: while a card
// is in flight there are not two of it being kept in sync by something, there
// is one component rendering in a second React root, driving itself off its
// own rAF subscription. Nothing outside is pushing it.

let frames = 0
let pumping = 0
const tickers = new Set<() => void>()

function pump() {
  frames++
  for (const l of tickers) l()
  pumping = requestAnimationFrame(pump)
}

function subscribeTick(l: () => void) {
  tickers.add(l)
  if (tickers.size === 1) pumping = requestAnimationFrame(pump)
  return () => {
    tickers.delete(l)
    if (tickers.size === 0) cancelAnimationFrame(pumping)
  }
}

/**
 * The frame count, as a primitive.
 *
 * The sweep angle is derived from it rather than from a clock on purpose: a
 * transition that freezes the element freezes BOTH halves of the readout
 * together, so there is no way to have a moving dial over a stopped number.
 */
function useTick(): number {
  return useSyncExternalStore(
    subscribeTick,
    () => frames,
    () => 0,
  )
}

// ── the component, authored once ─────────────────────────────────────────

interface CardViewProps {
  item: Item
  onOpen?: () => void
  vt?: boolean
  /**
   * The height of the box the card is currently occupying, in px. Only set in
   * flight; on the page the card is whatever tall it wants to be.
   *
   * The box FOLLOWS the layout's answer rather than snapping to it
   * (`followHeight`), so the two disagree for most of a flight — measured, 106
   * of 138 frames, by up to 117 px. That is not a breakpoint artifact, it is
   * ordinary tracking lag: a critically damped follower trails a ramp in
   * proportion to how fast the ramp is moving, and this one is climbing 370 px
   * in 700 ms.
   *
   * So the card is TOLD the box, in both directions, and the disagreement
   * stops being visible either way. Taller than the content, the card's own
   * background and border fill the difference — no strip of bare parked canvas
   * under it, which is the pale band that made interpolating the height wrong
   * in the first place. Shorter, its own `overflow: hidden` crops the content
   * and the card keeps its bottom edge and its radius. Both read as a panel
   * opening into its new shape, which is what it is.
   *
   * The first attempt at this was `padding-bottom`, which can only fill a box
   * that is too tall — a card in a box that is too short overflowed and lost
   * its bottom edge for two thirds of every flight.
   */
  boxHeight?: number
}

/**
 * How tall this card WANTS to be, asked while it is being told otherwise.
 *
 * The scene has to keep asking this every frame, of an element it is
 * simultaneously imposing a height on, so the imposition must be exactly
 * invertible. `min-height` is not (`offsetHeight` answers `max(natural,
 * imposed)`, which is un-subtractable); reading the children back is not
 * either (`offsetTop + offsetHeight` misses bottom margins — measured 12–13 px
 * short on 172 of 317 widths). Lifting the imposition for the length of one
 * read is invertible by construction: put back the string that was there.
 *
 * The cost is a second forced layout on a subtree that is already re-laying
 * out every frame, which is the cheapest honest answer available.
 */
function naturalCardHeight(card: HTMLElement): number {
  const imposed = card.style.height
  if (!imposed) return card.offsetHeight
  card.style.height = ''
  const natural = card.offsetHeight
  card.style.height = imposed
  return natural
}

/**
 * The card. There is no second, expanded version of this — the shapes live in
 * `passage.css` as container-query breakpoints, and which one you get depends
 * only on how wide the thing is. On the page that is ordinary responsive
 * authoring. In a Surface it is the transition.
 */
function CardView({ item, onOpen, vt, boxHeight }: CardViewProps) {
  const frame = useTick()
  // Tied to the frame count, not to a clock — see useTick.
  const phase = (frame % 96) / 96
  return (
    <div className="psg-frame" data-vt={vt ? 'true' : undefined}>
      <div
        className="psg-card"
        style={
          {
            '--c1': item.c1,
            '--c2': item.c2,
            '--c3': item.c3,
            cursor: onOpen ? 'pointer' : 'default',
            height: boxHeight ? `${boxHeight}px` : undefined,
          } as React.CSSProperties
        }
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (onOpen && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onOpen()
          }
        }}
      >
        <div className="psg-media">
          <div className="psg-live">
            <i className="psg-sweep" style={{ '--psg-phase': phase } as React.CSSProperties} />
            <span>
              live <b>{frame}</b>
            </span>
          </div>
        </div>
        <div className="psg-head">
          <div className="psg-eyebrow">{item.eyebrow}</div>
          <h2 className="psg-title">{item.title}</h2>
          <p className="psg-byline">{item.byline}</p>
        </div>
        <div className="psg-body">
          {item.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <dl className="psg-stats">
          {item.stats.map(([label, value]) => (
            <div className="psg-stat" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

// ── the flight ───────────────────────────────────────────────────────────

const FOV = 42
/**
 * How far toward the eye the card rises at the midpoint, in CSS px.
 *
 * Bounded by the viewport, not by taste. Lift magnifies by
 * `camZ / (camZ - lift)`, and the card is ALSO growing toward its destination
 * width at the same time — so the two multiply, and at 300 the midpoint was
 * 1.47× on top of a 620 px card and walked straight off the left edge of the
 * screen (measured, held at t = 0.45). A transition that leaves the viewport
 * is not showing you the transition.
 */
const LIFT = 150
/** Peak bank, radians. Enough to read as a solid thing turning. */
const TILT = 0.26
/** Spring stiffness. ~700 ms to settle, and reversible at any point. */
const OMEGA = 9.5

/**
 * The scene's own instrument panel, reachable as `__passage.debug`.
 *
 * `hold` parks a passage at a fixed progress so a capture can be taken at a
 * chosen point on the path instead of at whatever moment a screenshot command
 * happened to land — which is the difference between a regression capture and
 * a souvenir. `omega` slows the spring for watching the reflow with human
 * eyes. Neither is read by anything but the driver, and both are inert at
 * their defaults.
 */
const debug: { hold: number | null; omega: number; shadow: boolean } = {
  hold: null,
  omega: OMEGA,
  shadow: true,
}

interface Pass {
  id: string
  dir: 'open' | 'close'
  /** The source element's box, measured before anything moved. */
  from: Box
  /** The destination's box — null until the destination exists to be measured. */
  to: Box | null
  /**
   * Which end the spring is pulling toward: 1 is `to`, 0 is back to `from`.
   *
   * This is the entire implementation of "press back mid-flight and it turns
   * around", and it is one number because the motion is a spring rather than a
   * scripted ease. Nothing is cancelled, no clock restarts, the card is not
   * re-aimed from wherever it happened to be — the target moves and the
   * existing velocity carries it through the turn. A duration-and-easing
   * transition cannot do this without a second implementation for the
   * interrupted case, which is where the seam always shows.
   */
  target: 0 | 1
}

function PixelPerfect() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  useLayoutEffect(() => {
    // Put the camera exactly far enough back that the frustum is the viewport
    // at z = 0. Everything downstream — rects as poses, CSS px as world units
    // — is a consequence of this one line.
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(size.height, FOV))
    camera.near = 1
    camera.far = camera.position.z * 3
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera, size.width, size.height])
  return null
}

/**
 * The card's material.
 *
 * Unlit and un-tone-mapped: the card must be indistinguishable from the DOM
 * it replaces at both ends of the flight, and any light rig makes it a
 * different colour than the page. `premultipliedAlpha` because a 2D canvas's
 * backing store already is (decisions.md #5), and double-sided because the
 * bank turns it far enough to matter.
 */
function CardMaterial() {
  const texture = useSurfaceTexture()
  return (
    <meshBasicMaterial
      map={texture ?? undefined}
      transparent
      premultipliedAlpha
      toneMapped={false}
      // Depth IS written, unusually for a transparent material, and the
      // shadow behind it depends on that: the depth test is what deletes the
      // shadow from every pixel the card covers (archive decision #58 — blend
      // order cannot express a clip). The radius mask discards at the corners
      // and so writes no depth there, which is precisely where CSS would let
      // the shadow show through anyway.
      depthWrite
      side={THREE.DoubleSide}
    />
  )
}

/**
 * The shadow on the page under a flying card.
 *
 * Un-rotated and un-lifted on purpose: it is cast ONTO the document, so it
 * lives at the document's plane while the card banks and climbs away from it.
 * The separation you see is perspective doing its job, not an authored offset.
 */
function CardShadow({
  x,
  y,
  w,
  h,
  z,
  visible,
}: {
  x: number
  y: number
  w: number
  h: number
  z: number
  visible: boolean
}) {
  const initial = useMemo(
    () => ({
      uCardHalf: { value: new THREE.Vector2(1, 1) },
      uQuadHalf: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: 14 },
      uSigma: { value: 8 },
      uAlpha: { value: 0.5 },
    }),
    [],
  )
  const mat = useRef<THREE.ShaderMaterial>(null)
  const frame = shadowFrame(x, y, z, w, h, LIFT)

  // THE UNIFORMS ARE WRITTEN THROUGH THE MATERIAL, never through the object
  // handed to the `uniforms` prop, and the distinction is not pedantry — it
  // cost an afternoon. r3f deliberately does not adopt that object: to keep a
  // stable target it copies each entry into a holder of its own
  // (`uniforms[name] = {...uniform}`, applyProps). A Vector2 survives that,
  // because the copy shares the same instance and `.set()` mutates it in
  // place. A NUMBER does not — `uniforms.uSigma.value = 37` writes into an
  // object the renderer no longer reads.
  //
  // The failure is silent and half-working, which is the worst shape: the
  // quad resized correctly (Vector2) while the blur and the opacity stayed at
  // their construction values (scalars), so the shadow tracked the card's
  // size perfectly and was hard-edged and black the entire flight.
  useLayoutEffect(() => {
    const u = mat.current?.uniforms
    if (!u) return
    u.uCardHalf.value.set(frame.cardHalf[0], frame.cardHalf[1])
    u.uQuadHalf.value.set(frame.quadHalf[0], frame.quadHalf[1])
    u.uSigma.value = frame.sigma
    u.uAlpha.value = frame.alpha
  })

  return (
    // renderOrder 2 — AFTER the card, which is the whole point: the card has
    // already written depth, so this draw is clipped to its own silhouette by
    // the depth test rather than by blending.
    <mesh
      position={frame.position}
      scale={[frame.quadHalf[0] * 2, frame.quadHalf[1] * 2, 1]}
      renderOrder={2}
      visible={visible}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={mat}
        uniforms={initial}
        vertexShader={SHADOW_VERT}
        fragmentShader={SHADOW_FRAG}
        transparent
        premultipliedAlpha
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

interface FlyingProps {
  pass: Pass
  item: Item
  painted: boolean
  onPainted: () => void
  onLanded: () => void
}

function Flying({ pass, item, painted, onPainted, onLanded }: FlyingProps) {
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const camZ = useThree((s) => s.camera.position.z)

  // The whole pose lives in state rather than in refs, which is the opposite
  // of the usual r3f advice and is correct here for one reason: the SIZE has
  // to go through React anyway (it is a Surface prop, and it is the point),
  // and a pose split across a ref and a state field is a pose that can
  // disagree with its own texture for a frame. One source, one commit.
  const [pose, setPose] = useState(() => ({
    x: 0,
    y: 0,
    z: 0,
    rotX: 0,
    rotY: 0,
    w: pass.from.width,
    h: pass.from.height,
    d: dpr,
  }))
  const spring = useRef({ x: 0, v: 0 })
  /**
   * The card's box, chasing the height its layout keeps asking for.
   *
   * Seeded at the source box, so the departure is exact: the first frame of
   * the flight is the height of the element it is standing in for, whatever
   * the layout does one pixel of width later.
   */
  const hspring = useRef({ h: pass.from.height, v: 0 })
  const done = useRef(false)
  /** Which target the exact-destination frame was rendered for, if any. */
  const snapped = useRef<0 | 1 | null>(null)
  // The parked subtree, so the card's own height can be READ rather than
  // guessed. This is the same kind of observer `FloatingSurface` is allowed:
  // it answers "how big is this", which the compositor never reports, and it
  // triggers no repaint of its own.
  const hostRef = useRef<HTMLElement | null>(null)

  // Note there is no "reset the spring when the pass changes" effect, and
  // that absence is load-bearing. A reversal is the SAME flight with a
  // different target, so it hands down a new `pass` object every time — and
  // an effect keyed on it would zero the velocity at the exact moment the
  // momentum is the point. A genuinely new flight gets a new `key` upstream
  // and a fresh mount, which resets these refs for free.

  useFrame((_, dt) => {
    // Nothing moves until the mesh has real pixels. The source element is
    // still on the page underneath at this moment (it hides on the same
    // signal), so a card that started travelling here would tear away from a
    // still-visible copy of itself.
    const step = Math.min(dt, 1 / 20)
    const moving = debug.hold == null && painted && pass.to
    if (debug.hold != null) {
      spring.current = { x: debug.hold, v: 0 }
    } else if (moving) {
      const [x, v] = springStep(spring.current.x, spring.current.v, pass.target, debug.omega, step)
      spring.current = { x, v }
    }
    const to = pass.to ?? pass.from
    // Ask the card how tall it WANTS to be at the width it currently has. No
    // layout is forced by this — the parked subtree was laid out to produce
    // the paint that is already on screen, so the answer is sitting there.
    const card = hostRef.current?.querySelector<HTMLElement>('.psg-card')
    const natural = card ? naturalCardHeight(card) : 0
    // …and then move the box toward that answer rather than onto it. The
    // layout's honest height is a step function of width — seven
    // discontinuities across this flight, the largest 88 px in a single frame
    // — and rendering it faithfully is a card that snaps vertically while it
    // sails. `followHeight` changes nothing about what the layout decides,
    // only how fast the box is allowed to adopt it.
    if (natural > 0) {
      const [h, hv] = followHeight(
        hspring.current.h,
        hspring.current.v,
        natural,
        HEIGHT_OMEGA,
        step,
      )
      hspring.current = { h, v: hv }
    }
    // ── the landing, which is two frames ──
    //
    // It waits for BOTH springs. Keyed on the position alone the mesh unmounts
    // with the box still 1.9 px short of the DOM taking over — measured, and
    // invisible to every end-exactness test, because those only ever looked at
    // one spring.
    //
    // Then it SNAPS, and renders one frame at the exact destination box before
    // handing over. `atTarget` settles a fraction short of the target by
    // construction, and that fraction is not free: 0.0015 of progress is
    // 0.41 px of width at the end of a `t^1.5` size curve, and 0.41 px of
    // width is 1.09 px of HEIGHT once the height comes from a measurement
    // rather than from an interpolation. Measured, and visible — the card
    // grows a pixel at the instant the DOM takes over.
    //
    // The snap has to be its own frame. `onLanded` clears the pass, which
    // unmounts this component, so a `setPose` in the same commit is discarded
    // and the last thing rendered would be the frame BEFORE the snap.
    if (moving && !done.current) {
      if (snapped.current === pass.target) {
        // Unconditional, and that is the whole subtlety. Re-testing `landed`
        // here does not work: the snap changed the card's width, the DOM has
        // not been laid out at it yet, and so `natural` on this frame is still
        // the PREVIOUS width's answer. Re-testing sees the follower disagree
        // with a stale measurement, un-snaps, and walks the height back down —
        // which is how the seam survived the snap at 0.33 px instead of 1.09.
        done.current = true
        onLanded()
      } else if (
        landed(spring.current.x, spring.current.v, pass.target, hspring.current.h, natural)
      ) {
        // Recorded as WHICH target was snapped to, not merely that a snap
        // happened, so a reversal in the one frame between the snap and the
        // handoff turns the card around instead of landing it at a destination
        // it is no longer heading for.
        snapped.current = pass.target
        spring.current = { x: pass.target, v: 0 }
        hspring.current = { h: pass.target === 1 ? to.height : pass.from.height, v: 0 }
      }
    }
    const p = poseAt(
      pass.from,
      to,
      spring.current.x,
      size.width,
      size.height,
      LIFT,
      TILT,
      natural > 0 ? hspring.current.h : null,
    )
    const d = densityAt(dpr, camZ, p.z, p.width, p.height)
    setPose((prev) =>
      prev.x === p.x &&
      prev.y === p.y &&
      prev.z === p.z &&
      prev.w === p.width &&
      prev.h === p.height &&
      prev.d === d
        ? prev
        : {
            x: p.x,
            y: p.y,
            z: p.z,
            rotX: p.rotX,
            rotY: p.rotY,
            w: p.width,
            h: p.height,
            d,
          }
    )
  })

  return (
    <>
      {/* The shadow may not exist before the card does. On the first frames
          the source has not painted, the card quad draws nothing, and a
          shadow drawn anyway stamps a card-shaped veil over the still-visible
          page element underneath — a black flicker at every departure
          (archive decision #54). Content first, then its chrome: both gate on
          the same upload signal. It sits at page level, outside the rotated
          group, because it is cast onto the document and not carried by the
          card. */}
      <CardShadow
        x={pose.x}
        y={pose.y}
        w={pose.w}
        h={pose.h}
        z={pose.z}
        visible={painted && debug.shadow}
      />
      <PassageCard pose={pose} item={item} onPainted={onPainted} hostRef={hostRef} />
    </>
  )
}

/**
 * The same passage, flown as a SHARED ELEMENT rather than as a live relayout.
 *
 * `Flying` above is the honest version and it is the one that reads badly. It
 * asks the layout engine what the card looks like at 120 intermediate widths
 * and draws every answer, so the text re-wraps 120 times, the type sweeps
 * through sizes nobody chose, and the card spends about 170 ms in a two-column
 * container-query regime that neither endpoint has. Every frame is correct and
 * the sequence is unwatchable.
 *
 * This asks the layout engine TWICE — once at each endpoint, off-screen, at
 * the exact width the page will use — and then flies the answers apart. Every
 * word is measured in both layouts, matched by identity, and travels. Nothing
 * re-wraps because nothing is laid out in between: a word that ends up on a
 * different line simply goes there.
 *
 * That last sentence is what no DOM-based transition can say, and the reason
 * is structural rather than incidental: A LINE BOX IS NOT AN ELEMENT. There is
 * no node for "line 3 of this paragraph", so there is nothing for View
 * Transitions or a layout-animation library to hold, and the best any of them
 * can do is cross-fade the paragraph whole. We are not animating the DOM — we
 * are flying its pixels, with its own layout, at both ends, as ground truth.
 *
 * What the mode still buys from this library is the same thing `Flying` did:
 * the endpoints are MEASURED, not authored, and they are measured from the
 * real component at a real width — including the destination, which the page
 * has never displayed at the moment the flight starts.
 */
/**
 * The one part of the card that is not allowed to be a photograph.
 *
 * Everything else in the flight is two rasterizations of a real layout, and
 * that is fine for everything else, because everything else is not changing.
 * The counter is. Freezing it for the 700 ms of the transition is precisely
 * the charge this scene levels at `startViewTransition` — which snapshots the
 * old and new views and cross-fades the images — so a build that also froze it
 * would be making the foil's argument for it.
 */
const LIVE = { live: '.psg-live' }

/** The pill, on its own, with nothing else from the card in the way. */
function LivePill() {
  const frame = useTick()
  const phase = (frame % 96) / 96
  return (
    <div className="psg-live">
      <i className="psg-sweep" style={{ '--psg-phase': phase } as React.CSSProperties} />
      <span>
        live <b>{frame}</b>
      </span>
    </div>
  )
}

function LiveMaterial() {
  const texture = useSurfaceTexture()
  const mat = useRef<THREE.MeshBasicMaterial>(null)

  /**
   * Recompile when the map arrives.
   *
   * The house rule (CLAUDE.md, and `Surface` does this for the materials it
   * owns) — but `material="none"` means this one is ours, so the obligation is
   * ours too. `USE_MAP` is a preprocessor define baked into the program at
   * compile time, and this material is first compiled a frame or two before
   * the Surface has painted anything, when `map` is still null. Assigning a
   * texture afterwards changes the uniform in a program that has no line of
   * code reading it.
   *
   * Written while chasing a band that drew nothing at all — and it was not the
   * cause. That was immutable GL storage baked at the wrong size, one layer
   * down in `Surface` (see the alloc ledger's seed there). Both faults have
   * the same signature, which is why this took the blame first: a mesh that is
   * present, visible, colour-writing, correctly placed, holding a texture whose
   * canvas demonstrably has ink in it, and drawing nothing, forever, with no
   * error anywhere. Kept because the obligation is real and unpaid otherwise —
   * `material="none"` means this material is ours.
   */
  useEffect(() => {
    if (mat.current) mat.current.needsUpdate = true
  }, [texture])

  return (
    <meshBasicMaterial
      ref={mat}
      map={texture ?? undefined}
      transparent
      premultipliedAlpha
      toneMapped={false}
      // A MeshBasicMaterial WITHOUT A MAP IS WHITE. There is a window of a
      // frame or two between this material existing and its Surface's first
      // upload, and in that window the band drew as an opaque bar across the
      // artwork — captured out of the drawing buffer at frames 1, 3 and 5 of
      // successive attempts at this bug, each time looking like a different
      // problem.
      //
      // `opacity` cannot express it: premultiplied blending is
      // `ONE, ONE_MINUS_SRC_ALPHA`, so a fragment of white at alpha 0 is
      // ADDED to the destination rather than skipped. `colorWrite` is the
      // statement that this material has nothing to say yet.
      colorWrite={!!texture}
      // NOT depthWrite, unlike the card's own material. This sits above the
      // panel that clips the shadow, and a second surface writing depth in
      // front of it would carve a rectangle out of that clip.
      depthWrite={false}
      side={THREE.DoubleSide}
    />
  )
}

/**
 * The live band of the card, as real DOM, for the whole flight.
 *
 * Laid out at the card's CURRENT width every frame — which is the one place in
 * this design where an intermediate layout is not only allowed but wanted. The
 * objection to intermediate layouts is that they RE-WRAP: a paragraph laid out
 * at a width no designer chose puts words on lines no designer chose. A pill
 * with one line of text and no wrap opportunity has nothing to re-wrap, and
 * everything about it is authored in `cqi` — so an intermediate width gives it
 * an intermediate size from the same one rule, continuously, with no
 * breakpoint in between. It is the one part of the card whose responsive
 * design is a function rather than a set of shapes.
 *
 * Which is also why it costs what it costs: a repaint and an upload every
 * frame, for a band about a fifteenth of the card's area. That is the honest
 * price of something that is genuinely moving, and the counter is the whole
 * instrument — a frozen one is the foil's argument, not ours.
 */
function LiveBand({
  a,
  b,
  progress,
}: {
  a: Endpoint
  b: Endpoint
  progress: React.MutableRefObject<number>
}) {
  const dpr = useThree((s) => s.viewport.dpr)
  const [box, setBox] = useState<null | {
    x: number
    y: number
    w: number
    h: number
    cw: number
    ch: number
  }>(null)

  /**
   * Declare the root see-through on the root itself, in the same call that
   * builds it.
   *
   * The band's only job is to put a pill over artwork that is a captured plate
   * on the quad behind, so its content root must rasterize with real alpha —
   * and `.ui-root` carries the app's page background. The obvious way to say
   * that is a `:has()` on a child, and it is a frame late: `useSourceHost`
   * creates the container and hands it to the compositor synchronously, while
   * the React root inside renders concurrently. The first paint is an empty
   * div wearing an opaque background, and it lands before anything else in the
   * flight exists — a white bar alone on screen. `onHost` runs inside that
   * same synchronous mount, so there is no such frame.
   */
  const markBare = useCallback((el: HTMLElement | null) => {
    el?.setAttribute('data-bare', '')
  }, [])

  useFrame(() => {
    const from = a.live?.box
    const to = b.live?.box
    if (!from || !to) return
    const t = Math.min(1, Math.max(0, progress.current))
    const [cw, ch] = cardSizeAt(a, b, t)
    const next = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      w: from.w + (to.w - from.w) * t,
      h: from.h + (to.h - from.h) * t,
      cw,
      ch,
    }
    setBox((prev) =>
      prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h
        ? prev
        : next,
    )
  })

  if (!box) return null
  const { x, y, w, h, cw, ch } = box
  return (
    <group position={[x + w / 2 - cw / 2, ch / 2 - (y + h / 2), 0.5]} scale={[w, h, 1]}>
      <SurfaceApp
        label="passage-live"
        width={w}
        height={h}
        resolution={dpr}
        material="none"
        renderOrder={2}
        frustumCulled={false}
        onHost={markBare}
        content={
          // The band IS the container query's container — see `LiveBand` in
          // passageMeasure.ts. Full card width, so every `cqi` inside resolves
          // against the card the pill is actually on.
          <div className="psg-frame" style={{ width: `${w}px` }}>
            <div className="psg-liveband" style={{ height: `${h}px` }}>
              <LivePill />
            </div>
          </div>
        }
      >
        <planeGeometry args={[1, 1]} />
        <LiveMaterial />
      </SurfaceApp>
    </group>
  )
}

function FieldFlight({ pass, painted, onPainted, onLanded }: FlyingProps) {
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)

  const spring = useRef({ x: 0, v: 0 })
  /**
   * The number every part of the field reads, and the only one.
   *
   * `sizeProgress`, not the spring's raw position — because the card's own box
   * travels on that curve too (`poseAt`'s `tSize`). One computation, two
   * consumers: if the panel and the type ever interpolated on different
   * exponents the words would slide against the surface they are printed on
   * for the entire flight, which is #56's lesson wearing different clothes.
   */
  const progress = useRef(0)
  const done = useRef(false)
  const snapped = useRef<0 | 1 | null>(null)
  const [flightReady, setFlightReady] = useState(false)
  // Stable identity, so the readiness effect downstream fires once rather than
  // on every commit of a flight that re-renders sixty times a second.
  const ready = useCallback(() => setFlightReady(true), [])

  const [pose, setPose] = useState(() => ({
    x: 0,
    y: 0,
    z: 0,
    rotX: 0,
    rotY: 0,
    w: pass.from.width,
    h: pass.from.height,
  }))

  // The markup is taken ONCE, from the card the reader is looking at, before
  // anything has been asked to move or hide. Both endpoints are measured from
  // this same string, which is what makes a word's key mean the same thing on
  // both sides: the nth word of the mth text node is the same word whatever
  // width it was laid out at.
  const markup = useMemo(() => {
    const sel =
      pass.dir === 'open' ? `[data-slot="${pass.id}"] .psg-card` : '.psg-stage .psg-card'
    const el = document.querySelector<HTMLElement>(sel)
    return el ? markupOf(el) : null
  }, [pass.id, pass.dir])

  const a = useMemo(
    () => (markup ? measureEndpoint(markup, pass.from.width, LIVE) : null),
    [markup, pass.from.width],
  )
  // The destination is measured the moment the page can say how wide it is —
  // and NOT before. The arriving route is out of flow and invisible until it
  // takes over, so a width read early is the width of the wrong page.
  const toWidth = pass.to?.width ?? 0
  const b = useMemo(
    () => (markup && toWidth > 0 ? measureEndpoint(markup, toWidth, LIVE) : null),
    [markup, toWidth],
  )
  const plan = useMemo(() => (a ? planFlight(a.layout, (b ?? a).layout) : []), [a, b])

  useFrame((_, dt) => {
    if (!a) return
    const step = Math.min(dt, 1 / 20)
    // Two gates rather than one. `painted` releases the page copy; `flightReady`
    // releases the motion. Between them the field draws the source card at
    // rest, which is what the reader was already looking at.
    const moving = debug.hold == null && flightReady && !!pass.to
    if (debug.hold != null) {
      spring.current = { x: debug.hold, v: 0 }
    } else if (moving) {
      const [x, v] = springStep(spring.current.x, spring.current.v, pass.target, debug.omega, step)
      spring.current = { x, v }
    }

    // The landing is still two frames, and still for the reason it always was:
    // `atTarget` settles a fraction SHORT of the target by construction, and
    // 0.0015 of progress is 1.4 px of width at the end of a `t^1.5` curve —
    // a pixel and a half of growth at the instant the DOM takes back over.
    // What is gone is the second spring: there is no measured height to chase
    // here, because in between there is no layout to measure.
    if (moving && !done.current) {
      if (snapped.current === pass.target) {
        done.current = true
        onLanded()
      } else if (atTarget(spring.current.x, spring.current.v, pass.target)) {
        snapped.current = pass.target
        spring.current = { x: pass.target, v: 0 }
      }
    }

    progress.current = sizeProgress(spring.current.x)
    const end = b ?? a
    const [w, h] = cardSizeAt(a, end, progress.current)
    // The field is authoritative about the card's SIZE — it is drawing the
    // panel — so the pose is told that height rather than deriving its own.
    // The widths already agree by construction: each endpoint was measured at
    // exactly the width the page reported for it.
    const p = poseAt(
      pass.from,
      pass.to ?? pass.from,
      spring.current.x,
      size.width,
      size.height,
      LIFT,
      TILT,
      h,
    )
    // PRESENTATION ONLY, and applied here rather than inside `poseAt` on
    // purpose: the path is the physics and this is a display correction. The
    // card's texture is a capture of its own box, so the texel grid IS the
    // card's pixel grid, and an origin off the display's grid reads every glyph
    // across two texels at once. Measured on the small endpoint: 0.156 px of
    // origin phase cost 16% of the typography's edge energy against the same
    // pixels of real DOM (#20). At rest only — mid-flight the card is magnified
    // and tilted and there is no phase to be right about.
    const [dx, dy] = gridSnap(p.x, p.y, w, h, size.width, size.height, dpr, progress.current)
    const x = p.x + dx
    const y = p.y + dy
    setPose((prev) =>
      prev.x === x && prev.y === y && prev.z === p.z && prev.w === w && prev.h === h
        ? prev
        : { x, y, z: p.z, rotX: p.rotX, rotY: p.rotY, w, h },
    )
  })

  if (!a) return null

  return (
    <>
      <CardShadow
        x={pose.x}
        y={pose.y}
        w={pose.w}
        h={pose.h}
        z={pose.z}
        visible={painted && debug.shadow}
      />
      {/* Position and rotation only — NO scale. The field places its parts in
          the card's own CSS pixels, so a group scale would multiply them a
          second time. That is the whole difference from `PassageCard`, which
          scales a unit plane because its content is a texture cut to the box. */}
      <group position={[pose.x, pose.y, pose.z]} rotation={[pose.rotX, pose.rotY, 0]}>
        <PassageField
          a={a}
          b={b}
          plan={plan}
          progress={progress}
          live={<LiveBand a={a} b={b ?? a} progress={progress} />}
          onSourceReady={onPainted}
          onFlightReady={ready}
        />
      </group>
    </>
  )
}

function PassageCard({
  pose,
  item,
  onPainted,
  hostRef,
}: {
  pose: {
    x: number
    y: number
    z: number
    rotX: number
    rotY: number
    w: number
    h: number
    d: number
  }
  item: Item
  onPainted: () => void
  hostRef: React.RefObject<HTMLElement | null>
}) {
  return (
    // Scale rather than a resized geometry: the box changes every frame, and
    // rebuilding a BufferGeometry sixty times a second to express it would be
    // an allocation per frame for a number a matrix already holds. The unit
    // plane's UVs are scale-invariant, so the radius mask and the hit test
    // are unaffected.
    <group
      position={[pose.x, pose.y, pose.z]}
      rotation={[pose.rotX, pose.rotY, 0]}
      scale={[pose.w, pose.h, 1]}
    >
      <SurfaceApp
        label={`passage-${item.id}`}
        // THE LINE THE LAB IS ABOUT. These are not a scale and not a texture
        // size — they are the width and height the card's DOM is laid out at
        // on this frame, and the container queries in passage.css answer them.
        width={pose.w}
        height={pose.h}
        // Following depth continuously would normally be extravagant (every
        // change re-rasterizes). It is free here: the card is being resized
        // every frame anyway, so it is already re-rasterizing, and the
        // density may as well be the right one for how big it currently is
        // on the display.
        resolution={pose.d}
        material="none"
        // Before the shadow, so the depth it writes is there for the shadow's
        // depth test to be clipped by.
        renderOrder={1}
        frustumCulled={false}
        userData={{ matter: true }}
        // The handoff's readiness signal — from the upload path, never from a
        // frame count. The source element on the page hides on this and the
        // flight starts on this, so a slow first paint delays the departure
        // instead of flashing an empty slot.
        onFirstUpload={onPainted}
        onHost={(el) => {
          hostRef.current = el
        }}
        // The same height, told to the card — so that on the frames where the
        // follower and the layout disagree, the card still fills its own box
        // rather than floating in one or overflowing it.
        content={<CardView item={item} boxHeight={pose.h} />}
      >
        <planeGeometry args={[1, 1]} />
        <CardMaterial />
      </SurfaceApp>
    </group>
  )
}

// ── the page ─────────────────────────────────────────────────────────────

/**
 * Three ways to run the same click, so the comparison is a measurement.
 *
 * `anamorph` is the shared-element flight: two layouts, per-word
 * correspondence, one draw call. `relayout` is the same passage with the card
 * laid out again at every intermediate width — the honest version, kept
 * because it is the thing this library uniquely CAN do and because seeing it
 * next to the other two is the argument for why doing it is a bad idea.
 * `view-transition` is the browser's own, which is a photograph.
 */
type Mode = 'anamorph' | 'relayout' | 'view-transition'

export function PassageApp({ chips }: { chips?: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('anamorph')
  const [route, setRoute] = useState<string | null>(null)
  const [pass, setPass] = useState<Pass | null>(null)
  const [painted, setPainted] = useState(false)
  const [readout, setReadout] = useState<string>('')
  /** Which single card wears `view-transition-name` right now — see below. */
  const [vtId, setVtId] = useState<string | null>(null)

  const scrollerRef = useRef<HTMLDivElement>(null)
  const item = useMemo(() => LIBRARY.find((i) => i.id === route) ?? null, [route])
  const flyingItem = useMemo(
    () => (pass ? (LIBRARY.find((i) => i.id === pass.id) ?? null) : null),
    [pass],
  )

  const frameEl = useCallback((sel: string): HTMLElement | null => {
    return scrollerRef.current?.querySelector<HTMLElement>(sel) ?? null
  }, [])

  // ── the passage ──
  //
  // Five steps, and the ORDER is the whole design:
  //
  //   1. measure the source, before anything has moved
  //   2. mount the mesh there and wait for it to have real pixels
  //   3. only then change the route — so the source is never gone while the
  //      thing replacing it is still blank
  //   4. measure the destination, which now exists
  //   5. fly, with the destination held open and empty underneath
  //
  // Step 3 is the one that is easy to get wrong and it is the same lesson as
  // every other handoff in this project: readiness comes from the upload
  // path, never from a frame count.

  const begin = useCallback(
    (dir: 'open' | 'close', id: string) => {
      if (pass) return
      // Rects are viewport-relative, and a flight that starts mid-scroll
      // would measure its destination against a different scroll position
      // than its origin. Settle the page first, then measure.
      if (scrollerRef.current) scrollerRef.current.scrollTop = 0
      const el = frameEl(dir === 'open' ? `[data-slot="${id}"] .psg-frame` : '.psg-stage .psg-frame')
      if (!el) return
      setPainted(false)
      setPass({ id, dir, from: boxOf(el), to: null, target: 1 })
    },
    [pass, frameEl],
  )

  /**
   * Turn a passage around without interrupting it.
   *
   * Two lines of state and no special case. The spring's target moves; the
   * route flips to whichever page the card is now heading for, so the page
   * underneath is already the shape it is arriving at — the same rule as
   * every other handoff here, just applied to a destination that changed its
   * mind. The card itself is told nothing: it is still the same mesh, on the
   * same flight, with the velocity it had a frame ago.
   */
  const reverse = useCallback(() => {
    if (!pass || !pass.to) return
    const target: 0 | 1 = pass.target === 1 ? 0 : 1
    setPass({ ...pass, target })
    const detailBound = pass.dir === 'open' ? target === 1 : target === 0
    setRoute(detailBound ? pass.id : null)
  }, [pass])

  // Step 3: the route flips on the upload signal, not before.
  useEffect(() => {
    if (!pass || !painted || pass.to) return
    setRoute(pass.dir === 'open' ? pass.id : null)
  }, [pass, painted])

  // Step 4: the destination exists now, so it can be measured. Layout effect
  // because this must happen before the browser paints the frame in which the
  // destination first exists — it is being held hidden, and a measurement one
  // frame late is a flight that starts from a stale box.
  useLayoutEffect(() => {
    if (!pass || !painted || pass.to) return
    const el = frameEl(
      pass.dir === 'open' ? '.psg-stage .psg-frame' : `[data-slot="${pass.id}"] .psg-frame`,
    )
    if (!el) return
    setPass((p) => (p && !p.to ? { ...p, to: boxOf(el) } : p))
  }, [pass, painted, route, frameEl])

  const onLanded = useCallback(() => {
    setPass(null)
    setPainted(false)
  }, [])

  // ── the foil ──
  //
  // The same click, through the browser's own shared-element transition. The
  // counter inside the card is the instrument: it is sampled either side, and
  // what it reads mid-transition is a matter of record rather than of
  // argument. `flushSync` because startViewTransition captures at the moment
  // its callback returns — a React update still sitting in a queue is not in
  // the snapshot.
  const viewTransition = useCallback(
    (next: string | null) => {
      // `startViewTransition` is in the DOM lib but not in every browser, so
      // the feature test is real even though the type is not optional.
      const doc: Document = document
      const before = frames
      if (typeof doc.startViewTransition !== 'function') {
        setRoute(next)
        setReadout('startViewTransition is unavailable in this browser — plain swap.')
        return
      }
      // A view-transition-name must be UNIQUE IN THE DOCUMENT, and a grid of
      // six identical cards is the easy way to break that: naming them all
      // `passage` in the stylesheet made Chrome skip the transition outright
      // — `t.finished` resolved one frame later, zero animations ever ran, and
      // the only trace was a single console error. The comparison silently
      // measured a plain swap and called it a view transition.
      //
      // So the name is painted onto exactly one card, and it has to be there
      // BEFORE the snapshot is taken — hence flushSync ahead of the call
      // rather than inside it.
      flushSync(() => setVtId(next ?? route))
      const t = doc.startViewTransition(() => {
        flushSync(() => setRoute(next))
      })
      void t.finished.then(() => {
        setVtId(null)
        setReadout(
          `view-transition · counter ${before} → ${frames} across the transition. ` +
            `Whatever the number says, the pixels you watched were ::view-transition-old, ` +
            `which is a static image of frame ${before}.`,
        )
      })
    },
    [route],
  )

  // Both entry points ask the same question first: is this click aimed at the
  // end of a flight that is already happening? If so it is a reversal, not a
  // new passage — and a reversal is the one case a photograph cannot serve at
  // all, because the picture it took is of a state the user has changed their
  // mind about.
  const open = useCallback(
    (id: string) => {
      if (mode === 'view-transition') viewTransition(id)
      else if (pass && pass.id === id) reverse()
      else begin('open', id)
    },
    [mode, viewTransition, begin, pass, reverse],
  )

  const back = useCallback(() => {
    if (mode === 'view-transition') viewTransition(null)
    else if (pass) reverse()
    else if (route) begin('close', route)
  }, [mode, viewTransition, begin, route, pass, reverse])

  // Scene hook, matching house style: everything an automation harness needs
  // to drive and interrogate a passage from the console.
  //
  // THE OBJECT IS INSTALLED ONCE AND NEVER REPLACED, and every method reads
  // through a ref. The obvious version — rebuild the hook in an effect over
  // [open, back, route, pass] — is a trap that cost an hour: a harness does
  // `const p = window.__passage` at the top of a probe and then holds a
  // snapshot of the scene as it was BEFORE anything happened. `p.route()`
  // answers null for the whole flight, `p.pass()` answers null while a card
  // is visibly in the air, and `p.back()` closes over `route === null` and
  // silently does nothing — so a reversal test measures a flight that was
  // never interrupted and reports that everything is fine.
  //
  // Nothing about that is visible in a screenshot, and every symptom points
  // at the scene rather than at the probe.
  const live = useRef({ open, back, mode, setMode, route, pass, painted })
  live.current = { open, back, mode, setMode, route, pass, painted }
  useEffect(() => {
    ;(window as unknown as { __passage?: unknown }).__passage = {
      open: (id: string) => live.current.open(id),
      back: () => live.current.back(),
      mode: () => live.current.mode,
      setMode: (m: Mode) => live.current.setMode(m),
      route: () => live.current.route,
      tick: () => frames,
      pass: () => (live.current.pass ? { ...live.current.pass, painted: live.current.painted } : null),
      items: () => LIBRARY.map((i) => i.id),
      // Measure a card at an arbitrary width without flying it — the
      // instrument for everything in passageMeasure.ts.
      // Defaults to exactly what a flight does — no `live` subtree — so the
      // instrument and the thing it is measuring cannot disagree. Options are
      // passed through for probing the alternative.
      measure: (width: number, options?: { live?: string }) => {
        const card = document.querySelector<HTMLElement>('.psg-slot .psg-card')
        if (!card) return null
        return measureEndpoint(markupOf(card), width, options ?? LIVE)
      },
      debug,
    }
  }, [])

  // The source hides only once the mesh has pixels; the destination is held
  // open and empty for the whole passage. Both halves of every handoff in
  // this project reduce to those two sentences.
  const slotAway = (id: string) =>
    !!pass && pass.id === id && (pass.dir === 'close' || painted)
  const stageArriving = !!pass && (pass.dir === 'open' || painted)

  // Which routes exist, and which of them is being left. The route flip
  // happens in the MIDDLE of a passage (step 3), so for the rest of it both
  // routes are on the page: one in flow, one fading out beside it. Nothing
  // here is about the flight — the mesh does not care — it is about the page
  // the flight is crossing not blinking while it does.
  // A pass keeps BOTH routes mounted, whichever way it is currently pointing
  // — which matters more than it sounds, because a reversal flips the route
  // back and an unmount-on-flip would cut the page the reader is turning
  // toward out from under the card mid-turn. The detail joins only once
  // `pass.to` exists, since a destination that has never been measured is a
  // destination that does not yet exist (step 4).
  const grid = route === null || !!pass
  const detail = route !== null || (!!pass && pass.to !== null)
  // Whichever way it is pointing, `route` may already be null while the
  // detail is still on screen fading, so the item it is showing comes from
  // the pass in that window.
  const detailItem = item ?? flyingItem

  return (
    <div className="psg" ref={scrollerRef} data-mode={mode}>
      <div className="psg-inner">
        <div className="psg-top">
          <h1>Signals</h1>
          <span className="psg-sub">field notes from the origin trial</span>
        </div>

        <div className="psg-modes">
          {(['anamorph', 'relayout', 'view-transition'] as Mode[]).map((m) => (
            <button key={m} data-active={mode === m} onClick={() => setMode(m)} disabled={!!pass}>
              {m}
            </button>
          ))}
          <span className="psg-note">
            {mode === 'anamorph'
              ? 'two real layouts, measured off-screen — and every word flies between them'
              : mode === 'relayout'
                ? 'the element re-lays-itself-out at every width on the way — every frame correct'
                : "the browser's own shared-element transition, slowed to 1.1s"}
          </span>
        </div>

        <div className="psg-routes">
          {grid && (
            <div className="psg-grid" data-leaving={route !== null}>
              {LIBRARY.map((it) => (
                <div className="psg-slot" key={it.id} data-slot={it.id} data-away={slotAway(it.id)}>
                  <CardView item={it} onOpen={() => open(it.id)} vt={vtId === it.id} />
                </div>
              ))}
            </div>
          )}
          {detail && detailItem && (
            <div className="psg-detail" data-leaving={route === null}>
              <button className="psg-back" onClick={back}>
                ← library
              </button>
              <div className="psg-stage" data-arriving={stageArriving}>
                <CardView item={detailItem} vt={vtId === detailItem.id} />
              </div>
              {readout && <div className="psg-readout">{readout}</div>}
            </div>
          )}
        </div>
      </div>

      <Canvas
        className="psg-overlay"
        // Inline, because r3f writes `position: relative` and
        // `pointer-events: auto` onto its own wrapper as inline styles and an
        // inline declaration outranks any class. The overlay must never eat a
        // click: the card in flight is not interactive yet, and the back
        // button lives under this canvas.
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
        gl={{ alpha: true, antialias: true }}
        // There is a card in the air or there is nothing to draw.
        frameloop={pass ? 'always' : 'demand'}
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => {
          state.gl.setClearAlpha(0)
          ;(window as unknown as { __r3f: unknown }).__r3f = state
        }}
      >
        <PixelPerfect />
        {pass &&
          flyingItem &&
          (mode === 'relayout' ? (
            <Flying
              key={`${pass.id}-${pass.dir}`}
              pass={pass}
              item={flyingItem}
              painted={painted}
              onPainted={() => setPainted(true)}
              onLanded={onLanded}
            />
          ) : (
            <FieldFlight
              key={`${pass.id}-${pass.dir}`}
              pass={pass}
              item={flyingItem}
              painted={painted}
              onPainted={() => setPainted(true)}
              onLanded={onLanded}
            />
          ))}
      </Canvas>

      <div className="psg-hud">
        {chips}
        <span>
          open a note · the card leaves the page and lays itself out again at
          every width on the way · press back mid-flight and it turns around
        </span>
      </div>
    </div>
  )
}
