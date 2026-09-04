import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, useSurfaceHandle, useSurfaceTexture } from '@petepetrash/munari'
import { surfaceManualPresenter, type SurfaceManualPresenter } from '@petepetrash/munari/advanced'
import { BLIT_FRAGMENT, GLASS_FRAGMENT, QUAD_VERTEX } from './glassSdfShader'

// The SDF glass path — the shared kit every glass panel builds on (beads,
// a morphing chat shell).
//
// `SdfGlassPanel` is a Surface that renders NOTHING of its own: the mesh
// carries a custom invisible material, so it exists only to
// be raycast (the pointer forwarding still needs a real quad with real
// UVs). Its pixels are produced later, by `GlassSdfCompositor`, from
// the panel's world matrix and its DOM texture.
//
// Rendering `material.visible = false` costs one skipped draw call
// (WebGLRenderer checks it in renderObjects) and keeps the object visible to
// the raycaster, which is exactly the split we want: invisible matter that
// can still be touched.

export interface GlassParams {
  /** Corner radius, world units. The shape's only geometric input. */
  radius: number
  /** Width of the lensing rim. Everything inside this is flat glass. */
  bezel: number
  /** How far the rim bulges — the "how thick does it look" knob. */
  thickness: number
  /** How far a refracted ray travels before we re-project it: bend strength. */
  spread: number
  ior: number
  chroma: number
  roughness: number
  tint: string
  tintAmount: number
  /** Gain on the light piped out at the rim — a multiplier, not an addition. */
  edgeLight: number
  /**
   * How much environment the grazing bezel mirrors, at full Fresnel. This is
   * what keeps the edge the colour of the room rather than the colour of a
   * constant: raise it and the outline picks up more of whatever the panel is
   * standing in front of.
   */
  edgeReflect: number
  /**
   * Peak displacement of the living boundary, world units. Keep it small — a
   * distance field with an angle-varying term added no longer has a unit
   * gradient, and a large warp makes the bezel width drift around the outline.
   * 0 restores a perfectly still edge (and the cheap analytic gradient).
   */
  edgeWarp: number
  /** How fast the boundary breathes. */
  edgeWarpSpeed: number
  specular: number
  inkOpacity: number
  /** Smooth-min blend radius for coplanar satellites, world units. */
  smooth: number
  /** Peak wave HEIGHT a unit impulse adds, world units. 0 disables ripples. */
  rippleAmp: number
  /** Capillary phase constant K = 4/(27 sigma/rho): sets the wave scale. */
  rippleK: number
  /** Viscosity — how fast the short leading waves are eaten. */
  rippleNu: number
  /** Source radius: a contact is not a delta impulse. World units. */
  rippleSource: number
  /** Bulk loss, seconds. */
  rippleDecay: number
  /**
   * Seconds before a ripple is retired from the array. A slot budget, not a
   * physical constant — `rippleRetirement` fades the ripple out over the last
   * stretch of it so the eviction is never visible.
   */
  rippleLife: number
  /**
   * Reference wave speed, world units per second — the c in v/c. Only ripples
   * carrying a velocity use it. LOWER makes a moving source lean its wake
   * harder, because the same speed is a larger fraction of the wave's.
   */
  rippleWaveSpeed: number
  /** How far the ripple drags the DOM's UV with it. 0 keeps text crisp. */
  rippleInk: number
  /** Peak brightness a unit strike adds. 0 disables glows entirely. */
  glowAmp: number
  /** The colour the bloom fades out through; its heart is always white. */
  glowColor: string
  /** How far the bloom opens over its life, world units. */
  glowReach: number
  /** Seconds from strike to dark — also when the emitter retires it. */
  glowLife: number
}

/**
 * A circle sharing the panel's plane, unioned into its field.
 *
 * Deliberately a plain mutable object, not React state: the scene animates
 * these every frame and the compositor reads them every frame, so the array
 * identity is the contract and nothing in between needs to re-render.
 */
export interface GlassBlob {
  /** Centre in panel-local world units — (0,0) is the panel's centre. */
  x: number
  y: number
  r: number
}

/**
 * A rounded rect sharing the panel's plane, unioned into its field.
 *
 * This is what makes a panel a LAYOUT rather than a card: two of these that
 * start coincident and then move apart *melt* into two panes, because the
 * union of two distances necks and snaps where the union of two meshes would
 * only have stopped overlapping. Same mutable-in-place contract as GlassBlob.
 */
export interface GlassRect {
  /** Centre in panel-local world units — (0,0) is the panel's centre. */
  x: number
  y: number
  /** Half extents. */
  hw: number
  hh: number
  /** Corner radius. */
  r: number
}

/**
 * A wave packet expanding across the panel's surface from where a satellite
 * made or broke contact. `t0` is a clock timestamp; the compositor turns it
 * into an age, so the shader needs no time uniform of its own.
 */
export interface GlassRipple {
  x: number
  y: number
  t0: number
  /** Signed: negative recoils the surface, which is what a release does. */
  amp: number
  /**
   * Velocity of whatever made the ripple, panel-local world units per second.
   * Optional, and omitting it is not a degraded path: a ripple with no
   * velocity gets the stationary circular law exactly. Supplying it makes the
   * wave lean the way its source was going — see the Doppler note in the
   * shader's wave loop, and `rippleWaveSpeed` below for the reference c.
   */
  vx?: number
  vy?: number
  /**
   * Radius of the thing that MADE this ripple, world units. Defaults to the
   * panel's `rippleSource`.
   *
   * It is the spectrum knob, not a size knob: a source cannot radiate
   * wavelengths shorter than itself, so a broad source gives a low-frequency
   * ring and a small one gives a fine, tight, fast-fading disturbance. That
   * is the whole difference between a body striking the sheet (source = the
   * contact patch) and a body leaving it (source = the neck of the liquid
   * bridge at pinch-off, much smaller than the body).
   */
  src?: number
}

/**
 * Light struck into the panel where a pointer landed. Same mutable-array
 * contract as GlassRipple, and the same `t0 < 0 means stamp me` convention:
 * the array's owner knows the clock, a click handler should not have to.
 *
 * A ripple and a glow are deliberately separate primitives even though a real
 * tap would make both. A ripple is geometry — it tilts the surface and every
 * refracted ray moves with it. A glow is radiometry — the surface is
 * untouched and only the light changes. Fusing them would mean a scene could
 * never have one without the other.
 */
export interface GlassGlow {
  /** Centre in panel-local world units — (0,0) is the panel's centre. */
  x: number
  y: number
  t0: number
  amp: number
}

/** How many circular satellites one panel may carry — matches the define. */
export const MAX_BLOBS = 6
/** How many rounded-rect satellites — matches the define. */
export const MAX_RECTS = 12
/**
 * Concurrent ripples per panel — must match the shader define. Ten, because a
 * satellite crossing the panel emits a TRAIN as it goes rather than one ping
 * on arrival, and a single crossing therefore has four or five fronts alive
 * at once. Six was sized for a staggered emergence where each source fired
 * once; at that budget a second satellite entering would evict the first
 * one's wake out from under it mid-flight.
 */
export const MAX_RIPPLES = 10

/**
 * Fraction of a ripple's budgeted life spent easing out — the TS twin's
 * RETIRE_FRACTION, kept as a literal here because this file is vendored
 * standalone. tests/registry/glassPack.test.ts pins the two together.
 */
const RETIRE_FRACTION = 0.45

/**
 * The retirement window. This is NOT part of the wave law and is applied
 * here, per ripple per frame, rather than in the shader per pixel.
 *
 * `rippleLife` is not a property of water: it exists because the uniform
 * array is finite and something must eventually be evicted. That makes the
 * horizon a budget, and a budget that shows is a bug — with life 1.8s against
 * decay 1.2s a ripple still carried about a fifth of its envelope at the
 * moment it was dropped, so it vanished between two frames instead of
 * dissipating. Bending `rippleDecay` down until the tail happened to be
 * invisible by the horizon would have made every ripple die faster to fix a
 * problem about arrays; instead the law keeps its own decay and this window
 * closes the ripple out over the last stretch, reaching exactly zero AT the
 * horizon for any pairing of the two.
 */
function rippleRetirement(age: number, life: number): number {
  if (!(life > 0) || age >= life) return 0
  if (age <= 0) return 1
  const k = Math.min(1, (1 - age / life) / RETIRE_FRACTION)
  return k * k * (3 - 2 * k)
}
/**
 * Concurrent strikes per panel — must match the shader define. Four, because
 * a person mashing a button is a real input and the fourth press must not
 * silently delete the first one's light while it is still bright.
 */
export const MAX_GLOWS = 4

/**
 * The panel's rounded-rect distance, in JS. The same function the shader
 * evaluates per pixel — here it runs three times a frame, to answer "has
 * this bead touched yet". Contact detection belongs on the CPU: it is a
 * sign change over time, and a fragment shader has no memory of last frame.
 */
export function sdRoundRect(px: number, py: number, bx: number, by: number, r: number) {
  const dx = Math.abs(px) - bx + r
  const dy = Math.abs(py) - by + r
  return (
    Math.min(Math.max(dx, dy), 0) +
    Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) -
    r
  )
}

/** Its gradient — the outward direction, for placing the contact point. */
export function sdRoundRectGrad(px: number, py: number, bx: number, by: number, r: number) {
  const sx = Math.sign(px) || 1
  const sy = Math.sign(py) || 1
  const dx = Math.abs(px) - bx + r
  const dy = Math.abs(py) - by + r
  if (dx > 0 && dy > 0) {
    const l = Math.hypot(dx, dy) || 1
    return [(sx * dx) / l, (sy * dy) / l] as const
  }
  return dx > dy ? ([sx, 0] as const) : ([0, sy] as const)
}

// Tuned in the browser against the lab's own wall (loud, high-frequency,
// live DOM) — see the README entry. The two that matter most: `roughness`
// above ~0.15 stops being frost and starts being fog, because the frost is a
// blur of the ALREADY-COMPOSITED image rather than a rough-surface BSDF; and
// `bezel` is the whole look — it is how much of the panel is lens.
export const GLASS_DEFAULTS: GlassParams = {
  radius: 0.16,
  // A thin rim over a long throw. Almost all of the panel is flat middle, so
  // the ink stays legible, and what bending there is happens in a narrow band
  // at the edge — which is where the eye looks for the evidence anyway.
  bezel: 0.03,
  thickness: 0.16,
  spread: 1.09,
  ior: 2.2,
  chroma: 0.05,
  roughness: 0.13,
  tint: '#dfe8ff',
  // Off on the card. The colour stays because the CTA still uses it; a sheet
  // this large tinted at all reads as a coloured filter laid over the wall
  // rather than as glass in front of it.
  tintAmount: 0,
  // Piped light, full reflectivity and hot speculars, against a dead-flat
  // outline: the edge does all the work of saying "solid object", and none of
  // it comes from movement.
  edgeLight: 1.52,
  edgeReflect: 1,
  edgeWarp: 0,
  edgeWarpSpeed: 0,
  specular: 2,
  inkOpacity: 1,
  // The card's merge radius, and wider than a satellite (r ≈ 0.09–0.18): a
  // blob starts necking into the sheet well before it touches, so arrivals
  // read as surface tension taking hold rather than as contact. RIPPLE_BAND
  // in Glass.tsx is derived from this — half of it — so widening the merge
  // also widens the hysteresis that stops a grazing bead from firing a ripple
  // every frame. The CTA keeps the old 0.14, because the only thing merging
  // into a button is the press bulge and that wants a tighter neck.
  smooth: 0.245,
  // Ripples. `rippleK` is the only scale knob: the train is self-similar
  // along r ~ t^(2/3), so raising K makes the whole pattern finer AND slower
  // together, the way a real change in surface tension would. `rippleNu`
  // decides how far the fine leading waves get before viscosity eats them —
  // it is the difference between water and syrup.
  rippleAmp: 0.5,
  rippleK: 3.0,
  rippleNu: 0.0018,
  rippleSource: 0.04,
  // A long time constant against a short window. The sheet loses its motion
  // slowly — exp(-t/3.4) is still at 66% when the 1.4s budget runs out — so
  // almost the whole fade is the retire taper in rippleLaw.ts rather than the
  // bulk loss. That is the taper working as designed (it reaches exactly zero
  // at the horizon for ANY pairing), and it is what buys a calm sheet that
  // keeps moving instead of a lively one that stops.
  rippleDecay: 3.4,
  rippleLife: 1.4,
  // Measured against the train it has to be commensurate with, not guessed:
  // at K = 3 the crest holding phase 2π sits at r = (2π t²/K)^(1/3), so its
  // speed dr/dt = (2/3)(r/t) is about 1.3 units/s through the middle of a
  // ripple's life.
  //
  // c sits well ABOVE that now. The lab's satellites cross at 0.95–1.75
  // units/s (orbSpan 6.2, orbCycle 13, six lanes), which at c = 2.9 is a Mach
  // number of 0.33–0.60 — subsonic all the way across, where an earlier
  // c = 1.55 put the fastest lanes over 1.0 and the wake became a shock. The
  // wake is meant to be evidence that something passed, not the loudest event
  // on the sheet, so nothing here is allowed to go supersonic.
  rippleWaveSpeed: 2.9,
  // Just enough that the ink shifts with the surface it is printed on. Past
  // a few hundredths the type starts swimming and the panel stops reading as
  // a page behind glass.
  rippleInk: 0.02,
  // The strike. `glowReach` was measured down from 0.5 in the browser: at
  // half a world unit the front had crossed the CTA's whole half-width inside
  // the first frames, so the panel came up uniformly lit and the one thing
  // the interaction is FOR — showing where the finger landed — was the first
  // thing lost. Under a third of a unit the bloom stays a place on the button
  // instead of a state of it. `glowLife` is short for the neighbouring
  // reason: long enough to watch the front open, short enough that a second
  // press reads as answered rather than queued.
  glowAmp: 1.9,
  glowColor: '#ffb38a',
  glowReach: 0.32,
  glowLife: 0.8,
}

interface SdfPanel {
  label: string
  /** The compositor's receipt for this panel's final screen draw. */
  presenter: SurfaceManualPresenter
  group: React.RefObject<THREE.Group | null>
  half: THREE.Vector2
  /** Where the DOM lands, in panel-local units: [cx, cy, hw, hh]. */
  inkRect: THREE.Vector4
  hasBase: boolean
  params: GlassParams
  blobs: GlassBlob[]
  rects: GlassRect[]
  ripples: GlassRipple[]
  glows: GlassGlow[]
  /** View-space z, refreshed each frame; the compositing order key. */
  depth: number
}

/** A shader uniform holding a texture that is not bound yet. Named so the
 *  uniform bag can be inferred whole: a bare `{ value: null }` would infer
 *  the slot as permanently null. */
interface TextureSlot {
  value: THREE.Texture | null
}

const sdfPanels = new Map<string, SdfPanel>()
// Separate from the panel entry on purpose: React runs child effects before
// parent ones, so the registrar inside `Surface.Mesh` cannot write into a
// record its own parent has not created yet. Keyed by label, joined at
// composite time.
const sdfInk = new Map<string, THREE.Texture>()
// Dev handle: `__glassInk.get('glass-wall').image` is the parking canvas the
// compositor is sampling, which is the only way to tell a UV bug apart from a
// rasterization bug from the outside. Declared rather than asserted onto
// window, so the console and this file agree on what the handle holds.
declare global {
  interface Window {
    __glassInk?: Map<string, THREE.Texture>
  }
}
window.__glassInk = sdfInk

export function sdfPanelParams(label: string) {
  return sdfPanels.get(label)?.params ?? null
}

export function sdfPanelLabels() {
  return [...sdfPanels.keys()]
}

// ---- the panel ----------------------------------------------------------

// The DOM texture reaches the compositor the same way the mesh path's ink quad got
// it — through the material-slot seam — but it never touches a material here.
// Premultiplied for the same reason as the mesh path: bilinear filtering of straight
// alpha bleeds the white of `bg-white/10` into every opaque boundary,
// and the compositor's `glass*(1-a) + rgb` is the shader spelling of
// One/OneMinusSrcAlpha.
function InkRegistrar({ label }: { label: string }) {
  const texture = useSurfaceTexture()
  useEffect(() => {
    if (!texture) return
    texture.premultiplyAlpha = true
    texture.needsUpdate = true
    sdfInk.set(label, texture)
    return () => {
      sdfInk.delete(label)
    }
  }, [label, texture])
  return null
}

export interface SdfGlassPanelProps {
  label: string
  /**
   * CSS px; divided by `px` for world units. This is the DOM's size and the
   * raycast quad's size — and, unless `hasBase` is false, the field's base
   * rounded rect too.
   */
  width: number
  height: number
  px: number
  params?: Partial<GlassParams>
  /**
   * false = the base rect is NOT in the distance field; the panel's shape is
   * whatever its satellites are. The rect still frames the DOM and still
   * catches rays, so a panel can be a column of separate glass bubbles that
   * share one texture and one pointer target.
   */
  hasBase?: boolean
  /**
   * Coplanar circles merged into this panel's glass. Pass a STABLE array and
   * mutate its members per frame — see `BlobDrift` in the glass scene.
   */
  blobs?: GlassBlob[]
  /** Coplanar rounded rects, same stable-array-mutated-in-place contract. */
  rects?: GlassRect[]
  /** Contact ripples, same contract. */
  ripples?: GlassRipple[]
  /** Pointer strikes, same contract. */
  glows?: GlassGlow[]
  /** Passed through to the Surface — 'content' gates rays on painted pixels. */
  hitTest?: 'plane' | 'content'
  content: React.ReactNode
  position: [number, number, number]
  rotation?: [number, number, number]
}

export function SdfGlassPanel({
  label,
  width,
  height,
  px,
  params,
  hasBase = true,
  blobs,
  rects,
  ripples,
  glows,
  hitTest,
  content,
  position,
  rotation,
}: SdfGlassPanelProps) {
  const group = useRef<THREE.Group | null>(null)
  const surface = useSurfaceHandle(label)
  const presenter = useMemo(
    () => surfaceManualPresenter(surface, `sdf-compositor-${label}`),
    [label, surface],
  )
  useEffect(() => presenter.register(), [presenter])
  // One mutable params object per panel, created once and then poked in place
  // by the console knobs — no re-render, no uniform plumbing, and nothing to
  // clobber a live tuning session. `params` is an INITIAL value.
  const live = useMemo(
    () => ({ ...GLASS_DEFAULTS, ...params }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    sdfPanels.set(label, {
      label,
      presenter,
      group,
      half: new THREE.Vector2(width / px / 2, height / px / 2),
      inkRect: new THREE.Vector4(0, 0, width / px / 2, height / px / 2),
      hasBase,
      params: live,
      blobs: blobs ?? [],
      rects: rects ?? [],
      ripples: ripples ?? [],
      glows: glows ?? [],
      depth: 0,
    })
    return () => {
      sdfPanels.delete(label)
    }
  }, [label, presenter, width, height, px, hasBase, live, blobs, rects, ripples, glows])

  return (
    <group ref={group} position={position} rotation={rotation}>
      <Surface surface={surface} renderIn="canvas" size={[width, height]} source={content}>
        <Surface.Mesh
          name={label}
          presentation="manual"
          placement="manual"
          geometry={<planeGeometry args={[width / px, height / px]} />}
          material={<meshBasicMaterial transparent opacity={0} depthWrite={false} />}
          pointerEvents={hitTest === 'content' ? 'content' : 'geometry'}
        >
          <InkRegistrar label={label} />
        </Surface.Mesh>
      </Surface>
    </group>
  )
}

// ---- the compositor -----------------------------------------------------
//
// Takes the render loop over (`useFrame` at priority 1 tells r3f to stop
// auto-rendering) and runs:
//
//   scene → sceneFbo (once, panels hidden, depth texture attached)
//   for each panel, far → near:  src → glass pass → dst,  swap
//   src → blit → screen (tone mapping + sRGB, the only such step)
//
// Cost is one scene render plus N full-screen passes, against the mesh path's N
// scene renders. The passes are pure fill: at 1× viewport, ~8 taps each.

// drei's useFBO can't express "give me a depth texture" in its types (its
// `depth?: boolean` intersects with three's `RenderTargetOptions.depth?:
// number` and collapses to never), and the pipeline wants exact control over
// the attachments anyway: HalfFloat colour so the composite stays in linear
// light, a depth texture on the scene pass only, MSAA on the scene pass only.
function useTarget(w: number, h: number, opts: { depth?: boolean; samples?: number } = {}) {
  const { depth = false, samples = 0 } = opts
  const target = useMemo(() => {
    const t = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: depth,
    })
    if (depth) t.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType)
    t.samples = samples
    return t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    target.setSize(w, h)
  }, [target, w, h])
  useEffect(() => () => target.dispose(), [target])
  return target
}

const tmpInvProjView = new THREE.Matrix4()
const tmpProjView = new THREE.Matrix4()
const tmpPanelInv = new THREE.Matrix4()
const tmpRot = new THREE.Matrix3()
const tmpPos = new THREE.Vector3()

/** Fills the ripple uniform slots newest-first and returns how many it used.
 *
 *  NEWEST first because the array is chronological: walking it forwards
 *  spends the budget on the oldest — the faintest, nearly-retired ripples —
 *  and silently drops the fresh ones a viewer is actually watching. That was
 *  harmless while every emitter capped its own array at MAX_RIPPLES; a
 *  satellite laying down a wake as it crosses does not, so the policy has to
 *  live here, where the budget is. */
function uploadRipples(
  slots: THREE.Vector4[],
  vels: THREE.Vector2[],
  srcs: number[],
  ripples: readonly GlassRipple[],
  q: GlassParams,
  now: number,
): number {
  if (q.rippleAmp <= 0) return 0
  let nr = 0
  for (let k = ripples.length - 1; k >= 0 && nr < MAX_RIPPLES; k--) {
    const rp = ripples[k]
    const age = now - rp.t0
    if (age < 0 || age > q.rippleLife) continue
    // The retirement window folds into the amplitude here — one multiply per
    // ripple per frame instead of per pixel, and it keeps the shader's loop
    // describing physics only.
    const fade = rippleRetirement(age, q.rippleLife)
    if (fade <= 0) continue
    vels[nr].set(rp.vx ?? 0, rp.vy ?? 0)
    srcs[nr] = Math.max(rp.src ?? q.rippleSource, 1e-4)
    slots[nr++].set(rp.x, rp.y, age, rp.amp * q.rippleAmp * fade)
  }
  return nr
}

/** Stamps any glow still waiting for a clock, then fills the glow uniform
 *  slots and returns how many it used.
 *
 *  `t0 < 0` means "stamp me", and it is honoured HERE — for every panel's
 *  array, unconditionally — because this is the code that owns `now`.
 *
 *  It used to live in the scene, next to the array the CTA pushes into. That
 *  worked for exactly one array: when the strike began spilling onto the card
 *  as well, the card's glows kept t0 = -1 forever, `now - (-1)` was always
 *  past glowLife, and the upload skipped every one of them in silence. The
 *  spill never drew a frame, and the two knobs aimed at it read as dead
 *  controls. Stamping where the upload happens is what makes that class of
 *  bug unable to recur — an array that reaches the compositor is an array
 *  that gets a clock. */
function uploadGlows(
  slots: THREE.Vector4[],
  glows: GlassGlow[],
  q: GlassParams,
  now: number,
): number {
  for (const gw of glows) if (gw.t0 < 0) gw.t0 = now
  if (q.glowAmp <= 0) return 0
  let ng = 0
  for (const gw of glows) {
    if (ng >= MAX_GLOWS) break
    const age = now - gw.t0
    if (age < 0 || age > q.glowLife) continue
    slots[ng++].set(gw.x, gw.y, age, gw.amp * q.glowAmp)
  }
  return ng
}

export function GlassSdfCompositor({ lightDir = [4, 7, 5] }: { lightDir?: [number, number, number] }) {
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const w = Math.max(1, Math.round(size.width * dpr))
  const h = Math.max(1, Math.round(size.height * dpr))

  // MSAA on the scene pass only: the panels get exact analytic coverage from
  // the SDF, but the props and the wall behind them are still triangles.
  // three resolves the depth attachment alongside the colour one
  // (RenderTarget.resolveDepthBuffer defaults true), so occlusion survives.
  const sceneFbo = useTarget(w, h, { samples: 4, depth: true })
  const pingA = useTarget(w, h)
  const pingB = useTarget(w, h)

  // A uniform slot that starts empty. Inference alone would freeze the
  // initial `null` into the type and then refuse the texture that
  // arrives on the first pass.
  const emptyTexture = (): TextureSlot => ({ value: null })
  // The uniform bag lives here, not inside the material, so its literal
  // type survives: three declares `material.uniforms` as a string-keyed
  // bag whose every value is `any`, and reading the writers below off
  // that would need one assertion per uniform. Same object either way —
  // the material is constructed with exactly this one.
  const uniforms = useMemo(
    () => ({
      tSrc: emptyTexture(),
      tDepth: emptyTexture(),
      tInk: emptyTexture(),
      uHasInk: { value: false },
      uInkOpacity: { value: 1 },
      uInkRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uCamPos: { value: new THREE.Vector3() },
      uInvProjView: { value: new THREE.Matrix4() },
      uProjView: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uPanelInv: { value: new THREE.Matrix4() },
      uPanelRot: { value: new THREE.Matrix3() },
      uHalf: { value: new THREE.Vector2() },
      uRadius: { value: 0.09 },
      uHasBase: { value: true },
      // Allocated full-length once: three uploads a vec3[] as one
      // uniform3fv, so the array must keep its size even when the panel
      // carries fewer blobs — uBlobCount is what bounds the loop.
      uBlobs: { value: Array.from({ length: MAX_BLOBS }, () => new THREE.Vector3()) },
      uBlobCount: { value: 0 },
      uRects: { value: Array.from({ length: MAX_RECTS }, () => new THREE.Vector4()) },
      uRectR: { value: new Array<number>(MAX_RECTS).fill(0) },
      uRectCount: { value: 0 },
      uSmooth: { value: 0.14 },
      uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4()) },
      uRippleVel: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector2()) },
      uRippleSrcR: { value: new Array<number>(MAX_RIPPLES).fill(0.04) },
      uEdgeReflect: { value: 0.55 },
      uEdgeWarp: { value: 0.018 },
      uEdgeWarpSpeed: { value: 1 },
      uTime: { value: 0 },
      uRippleWaveSpeed: { value: 1.55 },
      uRippleCount: { value: 0 },
      uRippleK: { value: 3.0 },
      uRippleNu: { value: 0.0018 },
      uRippleSrc: { value: 0.04 },
      uRippleDecay: { value: 0.9 },
      uRippleInk: { value: 0 },
      uGlows: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Vector4()) },
      uGlowCount: { value: 0 },
      uGlowColor: { value: new THREE.Color('#ffb38a') },
      uGlowReach: { value: 0.5 },
      uGlowLife: { value: 0.85 },
      uBezel: { value: 0.13 },
      uThickness: { value: 0.1 },
      uSpread: { value: 0.34 },
      uIor: { value: 1.42 },
      uChroma: { value: 0.035 },
      uRough: { value: 0.28 },
      uTint: { value: new THREE.Color('#dfe8ff') },
      uTintAmount: { value: 0.06 },
      uEdgeLight: { value: 0.28 },
      uSpecular: { value: 0.55 },
      uLightDir: { value: new THREE.Vector3(...lightDir) },
    }),

    // lightDir is read into the uniform below every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const glass = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: QUAD_VERTEX,
        fragmentShader: GLASS_FRAGMENT,
        defines: { SAMPLES: 8, MAX_BLOBS, MAX_RECTS, MAX_RIPPLES, MAX_GLOWS },
        depthTest: false,
        depthWrite: false,
        uniforms,
      }),
    [uniforms],
  )
  const blit = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: QUAD_VERTEX,
        fragmentShader: BLIT_FRAGMENT,
        depthTest: false,
        depthWrite: false,
        uniforms: { tSrc: { value: null } },
      }),
    [],
  )

  // Two one-mesh scenes. `frustumCulled = false` because the vertex shader
  // writes clip space directly — three's bounding-sphere test would cull a
  // quad it thinks is a 2×2 plane at the origin.
  const [glassScene, blitScene, quadCam] = useMemo(() => {
    const geo = new THREE.PlaneGeometry(2, 2)
    const mk = (m: THREE.Material) => {
      const s = new THREE.Scene()
      const mesh = new THREE.Mesh(geo, m)
      mesh.frustumCulled = false
      s.add(mesh)
      return s
    }
    return [mk(glass), mk(blit), new THREE.Camera()]
  }, [glass, blit])

  useEffect(
    () => () => {
      glass.dispose()
      blit.dispose()
    },
    [glass, blit],
  )

  useFrame(({ gl, scene, camera, clock }) => {
    const panels = [...sdfPanels.values()].filter((p) => p.group.current)
    const now = clock.elapsedTime

    // 1 — the world, once. The panels are hidden even though their material
    // is invisible: the contract is "the compositor owns these pixels", and a
    // panel that later grows a visible child must not leak into its own
    // refraction source.
    for (const p of panels) p.group.current!.visible = false
    gl.setRenderTarget(sceneFbo)
    gl.render(scene, camera)
    for (const p of panels) p.group.current!.visible = true

    if (panels.length === 0) {
      blit.uniforms.tSrc.value = sceneFbo.texture
      gl.setRenderTarget(null)
      gl.render(blitScene, quadCam)
      return
    }

    // 2 — far → near. Each pass reads what the previous one wrote, so a
    // panel's refraction contains the glass, the ink and the world behind it
    // by construction.
    //
    // The key is VIEW-SPACE Z, not distance to the camera. Distance was wrong
    // and went unnoticed while two panels sat on the view axis
    // where the two orders agree. Put a panel out to the side — a
    // rail, one sixth of the way across a wide app — and it is FARTHER by
    // Pythagoras while being no deeper at all, so it composited first and the
    // panel actually behind it then refracted its ink: every glyph in the
    // rail came out smeared through eight dispersion taps, with no error and
    // clean paint counters. Depth order is depth, and depth is -z in view
    // space (negative ahead of the camera, so "more negative" is farther).
    for (const p of panels) {
      p.group.current!.getWorldPosition(tmpPos).applyMatrix4(camera.matrixWorldInverse)
      p.depth = tmpPos.z
    }
    panels.sort((a, b) => a.depth - b.depth)

    const u = uniforms
    tmpProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    tmpInvProjView.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse)
    u.uProjView.value.copy(tmpProjView)
    u.uInvProjView.value.copy(tmpInvProjView)
    u.uView.value.copy(camera.matrixWorldInverse)
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld)
    // SAFETY: the depth reconstruction below is perspective math — it is
    // only reached from this composite pass, which the scene mounts under a
    // perspective camera. r3f types the store's camera as the base class,
    // which carries neither plane.
    const perspective = camera as THREE.PerspectiveCamera
    u.uNear.value = perspective.near
    u.uFar.value = perspective.far
    u.tDepth.value = sceneFbo.depthTexture
    u.uLightDir.value.set(lightDir[0], lightDir[1], lightDir[2])

    let src: THREE.WebGLRenderTarget = sceneFbo
    let dst = pingA
    const presentedPanels: SdfPanel[] = []
    for (const p of panels) {
      const g = p.group.current!
      tmpPanelInv.copy(g.matrixWorld).invert()
      tmpRot.setFromMatrix4(g.matrixWorld)
      u.uPanelInv.value.copy(tmpPanelInv)
      u.uPanelRot.value.copy(tmpRot)
      u.uHalf.value.copy(p.half)
      u.uHasBase.value = p.hasBase
      u.uInkRect.value.copy(p.inkRect)
      const ink = sdfInk.get(p.label) ?? null
      u.tSrc.value = src.texture
      u.tInk.value = ink
      u.uHasInk.value = !!ink
      const q = p.params
      u.uRadius.value = q.radius
      u.uBezel.value = q.bezel
      u.uThickness.value = q.thickness
      u.uSpread.value = q.spread
      u.uIor.value = q.ior
      u.uChroma.value = q.chroma
      u.uRough.value = q.roughness
      u.uTint.value.set(q.tint)
      u.uTintAmount.value = q.tintAmount
      u.uEdgeLight.value = q.edgeLight
      u.uEdgeReflect.value = q.edgeReflect
      u.uEdgeWarp.value = Math.max(q.edgeWarp, 0)
      u.uEdgeWarpSpeed.value = q.edgeWarpSpeed
      u.uTime.value = now
      u.uSpecular.value = q.specular
      u.uInkOpacity.value = q.inkOpacity
      u.uSmooth.value = Math.max(q.smooth, 1e-4)   // smin divides by k
      const blobs = p.blobs
      const nb = Math.min(blobs.length, MAX_BLOBS)
      for (let i = 0; i < nb; i++) {
        u.uBlobs.value[i].set(blobs[i].x, blobs[i].y, blobs[i].r)
      }
      u.uBlobCount.value = nb
      const rects = p.rects
      const nq = Math.min(rects.length, MAX_RECTS)
      const rectSlots = u.uRects.value
      const radii = u.uRectR.value
      for (let i = 0; i < nq; i++) {
        const r = rects[i]
        rectSlots[i].set(r.x, r.y, r.hw, r.hh)
        // A corner radius may never exceed the smaller half extent, or
        // sdRoundRect stops being a distance and the bezel inverts. Clamping
        // here rather than in every caller means a rect can be animated from
        // a wide pane down to a bead without the scene minding the geometry.
        radii[i] = Math.min(r.r, Math.min(r.hw, r.hh))
      }
      u.uRectCount.value = nq

      // Ages, not timestamps: the shader gets `now - t0` so it needs no clock
      // of its own, and a ripple that has outlived `rippleLife` simply never
      // reaches the uniform (the emitter prunes it too — this is the guard).
      u.uRippleK.value = Math.max(q.rippleK, 1e-3)
      u.uRippleNu.value = Math.max(q.rippleNu, 0)
      u.uRippleSrc.value = Math.max(q.rippleSource, 0)
      u.uRippleDecay.value = Math.max(q.rippleDecay, 1e-3)
      u.uRippleInk.value = q.rippleInk
      u.uRippleWaveSpeed.value = Math.max(q.rippleWaveSpeed, 1e-3)
      u.uRippleCount.value = uploadRipples(
        u.uRipples.value,
        u.uRippleVel.value,
        u.uRippleSrcR.value,
        p.ripples,
        q,
        now,
      )

      // Same age-not-timestamp discipline as the ripples above. A strike is
      // retired by its own life, so a panel nobody has pressed uploads a
      // count of zero and the shader's loop never runs.
      u.uGlowColor.value.set(q.glowColor)
      u.uGlowReach.value = Math.max(q.glowReach, 1e-3)
      u.uGlowLife.value = Math.max(q.glowLife, 1e-3)
      u.uGlowCount.value = uploadGlows(u.uGlows.value, p.glows, q, now)

      gl.setRenderTarget(dst)
      gl.render(glassScene, quadCam)
      // A panel cannot claim canvas input until this pass actually sampled
      // its current DOM texture. An unpainted source may still contribute
      // the field's backdrop, but it has no live content for a pointer to
      // reach.
      if (ink) presentedPanels.push(p)
      src = dst
      dst = dst === pingA ? pingB : pingA
    }

    // 3 — out of linear light, once.
    blit.uniforms.tSrc.value = src.texture
    gl.setRenderTarget(null)
    gl.render(blitScene, quadCam)
    // This is the sole color-writing presentation of each sampled SDF panel.
    // Proxy meshes are input geometry only, so a panel earns canvas input
    // only after this actual screen draw includes its composited pixels.
    for (const p of presentedPanels) {
      p.presenter.prove()
      p.presenter.present()
    }
  }, 1)

  return null
}
