// The logo playground — a side page, not one of the eight scenes.
//
// The wordmark from the sketch: six letters, each in its own face and
// color, set a little haphazard and never sitting still. A conductor
// (logoLaw.ts) re-rolls one letter per beat — new face, new color, new
// tilt — and the CSS spring makes each change land as a hop. All of it
// is ordinary DOM: the page IS the logo, tweakable from the panel.
//
// The munari trick is the "matter" switch, and it flips through the
// library's own threshold guarantee: ONE <Surface> whose six letters
// are <Surface.Part>s, so the word transfers whole or not at all — a
// letter whose raster is late holds the whole handoff rather than
// crossing alone (the fault that made parts exist). Lifting mounts a
// twin of each letter behind its part, warming unseen and pixel-
// aligned with the still-visible page word; the page is released only
// on evidence — every twin's mesh proved a color-writing draw, and any
// in-flight hop settled — while the idle float, carried on one clock
// that the page and the meshes both read, keeps breathing straight
// through the swap.
// Only then does depth ramp in: z bob, perspective wobble, pointer
// dodge, all on underdamped springs riding live DOM textures — and the
// substance each letter was dealt (logoLaw's matter deck, rendered by
// logoShaders) lights up on a window of the same progress, so at both
// handoff edges every letter is exactly its own pixels.
// Landing runs the protocol backwards: progress ramps to zero, the
// twins glide back onto the grid, and the page takes its letters back
// in the same commit that drops the canvas. At no frame is a letter in
// nobody's hands — a sentence that is now a conformance contract
// rather than a comment.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Surface,
  SurfaceCanvas,
  type SurfaceHandle,
  type SurfaceProgress,
  type SurfaceView,
  useSupportsDOMSurfaces,
  useSurface,
  useSurfaceTexture,
} from '@petepetrash/munari'
import { cameraDistance, useCarriedMotion } from '@petepetrash/munari/advanced'
import {
  LOGO_DEFAULTS,
  LOGO_FONTS,
  LOGO_PALETTE,
  RIPPLE,
  WEAVE,
  beatPlan,
  lightDir,
  makeRng,
  nextBeat,
  rollPose,
  seedWord,
  slotLayout,
  springStep,
  strikeSlot,
  stretchAmount,
  waveSteps,
  type BeatStep,
  type LetterPose,
  type LogoKnobs,
} from './logoLaw'
import { LETTER_FRAG, LETTER_VERT, MATTER_GATE, MATTER_PARAMS } from './logoShaders'
import type { MatterSpec } from './logoShaders'
import { FIELD_DS, LetterFields, raster, readAlphaField } from './logoFields'
import { traceContour, type InkIsland } from './logoContour'
import { buildLetterMesh } from './logoSlab'
import { textureSlot } from '../../lib/uniforms'
import './logo.css'

const WORD = 'munari'
const SEED0 = 20260813
const FOV = 40
// The fixed grid: computed once, so a font swap can only ever repaint
// a slot — never move one (logoLaw, "the word's fixed grid").
const GRID = slotLayout(WORD)
// The compositor-clocked eases the crossing's settle dwell must
// outlast — each number must match its logo.css declaration. A swap
// while one still runs trades a mid-flight letter for its settled
// twin. The idle float is NOT on this list: it rides a motion carrier
// (one clock, read by both renderers), so it crosses mid-flight and
// owes the dwell nothing.
const LETTER_EASE_MS = 620 // .logo-letter transform
const COLOR_EASE_MS = 480 // .logo-letter and .logo-twin-glyph color
const SETTLE_MS = Math.max(LETTER_EASE_MS, COLOR_EASE_MS) + 50

// The six guest faces load only when this page mounts, and stay for the
// session — the bench's own <head> payload (index.html) is deliberate
// and this sketch should not tax every other scene's boot.
const FONT_LINK_ID = 'logo-playground-fonts'
const FONT_URL =
  'https://fonts.googleapis.com/css2?family=Caveat:wght@400..700&family=DynaPuff:wght@400..700&family=Fraunces:opsz,wght@9..144,300..900&family=Pixelify+Sans:wght@400..700&family=Shrikhand&family=Silkscreen:wght@400;700&display=swap'

function ensureLogoFonts() {
  if (document.getElementById(FONT_LINK_ID)) return
  const link = document.createElement('link')
  link.id = FONT_LINK_ID
  link.rel = 'stylesheet'
  link.href = FONT_URL
  document.head.appendChild(link)
}

/** The paint a pose puts on a glyph — shared by the page letter and its
 *  parked twin so the two can never drift. Size is em-relative here;
 *  the twin overrides it in px because a parked root inherits nothing. */
function glyphPaint(pose: LetterPose): React.CSSProperties {
  const f = LOGO_FONTS[pose.font]
  return {
    fontFamily: f.family,
    fontWeight: pose.weight,
    color: LOGO_PALETTE[pose.color],
    fontSize: `${f.trim}em`,
  }
}

// ── the matter overlay ──────────────────────────────────────────────────

interface LetterBox {
  /** Viewport-px center of the letter's slot (untransformed), exact —
   *  fractional, never rounded. Snapping happens once, at the mesh. */
  cx: number
  cy: number
  /** Capture box: slot + ink padding (glyphs overflow their slot
   *  freely), quantized to 16px so only a real viewport resize — the
   *  one thing that still moves the grid — reallocates the texture. */
  w: number
  h: number
}

interface WordMetrics {
  fontPx: number
  boxes: LetterBox[]
}

/** 1 world unit = 1 CSS px, same rig as the veil. */
function PixelCam() {
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

interface Spring {
  x: number
  v: number
}

function step(s: Spring, target: number, dt: number) {
  const [x, v] = springStep(s.x, s.v, target, dt)
  s.x = x
  s.v = v
}

// ── the substance driver ────────────────────────────────────────────────
//
// One key light and one studio for the whole word, in WORLD space —
// standing, but no longer fixed: the panel's rig dials aim the key
// (lightDir) and scale the studio's terms, and this default is just
// the dials at rest. The shader lifts each letter's normals into world
// through its quaternion, so a wobbling letter sweeps its reflections
// across the standing light — the cue that reads as substance instead
// of decal.
const WORLD_LIGHT = new THREE.Vector3(
  ...lightDir(LOGO_DEFAULTS.lightYaw, LOGO_DEFAULTS.lightPitch)
)

/** Per-frame uniform feed, written by MatterLetter's frame loop and read
 *  by MatterMaterial's. A mutable ref, not props: these change every
 *  frame and must never re-render React. */
interface LetterFx {
  /** The letter's world rotation, for lifting normals into the studio. */
  quat: THREE.Vector4
  /** Unit direction of screen travel (prism disperses along it). */
  velDir: THREE.Vector2
  /** gloss × cooled amplitude — the shaded-substance mix; 0 for ink. */
  fx: number
  /** The weave's orbit radius in em (the material folds in font px). */
  jelly: number
  /** Prism offset in CSS px (the material converts to texels). */
  prism: number
  /** Relief AMOUNT, not a peak height: the gain on the height field,
   *  referenced to RELIEF_REF = 22 (logoShaders). The px the sheet
   *  actually rises is `relief / 22 × dome × (shoulder × 9.6 + pillow ×
   *  51.2)` at full coverage, so it is per-matter — balloon at the
   *  default 22 already domes 83 px. */
  relief: number
  /** 0..1 — the share of `relief` the mesh carries; the rest is bump. */
  body: number
  /** Extrusion depth in CSS px; 0 collapses every wall to a line. */
  slab: number
  /** Field weights (MATTER_PARAMS): fine-gradient shoulder, coarse-
   *  gradient pillow, and the overall height-to-normal gain. The field
   *  SCALES live in the blur pyramid (logoFields), not here. */
  shoulder: number
  pillow: number
  dome: number
  matter: number
  /** The rest of the deck row — surface response and pop channels —
   *  with the panel's trims already folded in, so the shader stays a
   *  pure consumer of finished numbers. */
  rough: number
  metal: number
  sss: number
  crinkle: number
  sheen: number
  irid: number
  glow: number
  /** The lighting rig — global to the word, but fed per letter like
   *  any other uniform: the key's world direction from the two
   *  position dials, then the studio's five gains. */
  light: THREE.Vector3
  key: number
  keySoft: number
  fill: number
  room: number
  front: number
  /** The motion rig: the weave's dials (the material folds them with
   *  the font size), the strike buffer (plane px, uTime seconds,
   *  power), and the folded gates for rings and travel stretch. */
  waveScale: number
  waveSpeed: number
  waveDir: THREE.Vector2
  /** The letter's center in the shared word frame, px — the weave's
   *  phases are continuous across the word, one sea for six letters. */
  waveOrigin: THREE.Vector2
  ripples: THREE.Vector4[]
  ripAmp: number
  stretch: number
}

/** The latest tap, routed by MatterCanvas to exactly one letter: seq
 *  bumps on every hit, and the letter named by `i` consumes it. */
interface Strike {
  i: number
  x: number
  y: number
  seq: number
}

/** Drop a strike into the deadest ring slot — strikeSlot is the law's
 *  recycling order, so the budget clause speaks for this buffer too. */
/** How far this letter leans away from the pointer, in CSS px. Zero
 *  outside reach, and zero while the page still owns the geometry. */
function dodgeOffset(
  pt: { x: number; y: number } | null,
  b: LetterBox,
  dodge: number,
  amp: number,
  fontPx: number,
): [number, number] {
  if (!pt || dodge <= 0 || amp <= 0) return [0, 0]
  const ox = b.cx - pt.x
  const oy = b.cy - pt.y
  const dist = Math.hypot(ox, oy)
  const reach = fontPx * 2.4
  if (dist <= 1 || dist >= reach) return [0, 0]
  const fall = 1 - dist / reach
  return [
    (ox / dist) * fall * fall * dodge * amp,
    (oy / dist) * fall * fall * dodge * amp,
  ]
}

/** The substance half of the fx buffer: what the letter is MADE of, and
 *  how much of that the matter gate is letting through this frame. Ink
 *  (matter 0) is the page's own look, so every term of it stays zero. */
function writeMatterFx(
  fx: LetterFx,
  p: LetterPose,
  k: LogoKnobs,
  par: MatterSpec,
  gs: number,
  amp: number,
  sp: number,
  dt: number,
  fresh: boolean,
) {
  fx.matter = p.matter
  fx.fx = p.matter === 0 ? 0 : k.gloss * gs
  // The weave, in em (the material lands it as px): one STEADY sea.
  // Excitation never scales it — the beat excites some letter every
  // second or two, and a sea that pumps with it reads as erratic
  // shaking, not a wave (2026-08-14). A strike answers through the
  // rings instead, which a hand can aim.
  //
  // The matter's softness rides a FLOOR, the same shape rings use:
  // most of the deck is stiff (chrome 0.12, enamel 0.1), and a sea
  // that skips two thirds of the word is not a sea. Softness scales
  // the remainder, so gummy still rolls deeper than chrome. Ink is
  // the page's own look and never moves at all.
  //
  // On the MATTER GATE (gs), not raw progress: standing substance
  // motion must freeze back to ink before touchdown, the way light
  // and relief do. The surge moves real ink, and riding raw
  // progress broke the crossing gate's 1.5 px budget (2026-08-14).
  fx.jelly =
    p.matter === 0
      ? 0
      : k.jelly * gs * (WEAVE.floor + (1 - WEAVE.floor) * par.jelly) * WEAVE.amp
  fx.prism = k.prism * amp * par.prism * Math.min(sp / 300, 1) * 2.6
  // Body on the same gate as light. Relief and extrusion are geometry,
  // and geometry near a swap drags the ink mask exactly the way
  // substance light does — a sheet pushed toward the camera grows the
  // letter by perspective alone. So the letter lifts flat, inflates
  // once it is clear of the page, and deflates before it lands.
  // Relief scales by the matter's own dome, so a balloon puffs and a
  // neon tube stays a tube.
  // NOT scaled by par.dome here — the shader's height description owns
  // that (uDome), and folding it in twice is exactly the two-numbers-
  // for-one-surface mistake this refactor removes.
  fx.relief = p.matter === 0 ? 0 : k.relief * gs
  fx.body = k.body
  // The slab chases its target through an asymmetric ease: melting
  // (stale outline, or a matter that carries none) is near-immediate,
  // re-forming takes long enough to read as the letter setting. The
  // snap to exact zero is for the handoff identity — an exponential
  // never arrives on its own, and the swap needs the walls at
  // literally no area.
  const slabWant = p.matter === 0 || !fresh ? 0 : k.extrude * gs
  const eased =
    fx.slab + (slabWant - fx.slab) * (1 - Math.exp(-dt / (slabWant < fx.slab ? 0.05 : 0.14)))
  fx.slab = eased < 0.01 ? 0 : eased
  fx.shoulder = par.shoulder
  fx.pillow = par.pillow
  fx.dome = par.dome
  // The surface, trims folded in HERE so the shader stays a pure
  // consumer. Polish walks roughness matte ↔ mirror around the deck
  // value (1 is identity); the floor matches the shader's numeric
  // one. The channel trims scale what a matter already has — a
  // matter whose row carries zero stays zero at any trim.
  fx.rough = Math.min(Math.max(par.rough * (2 - k.polish), 0.03), 1)
  fx.metal = par.metal
  fx.sss = par.sss
  fx.crinkle = par.crinkle
  fx.sheen = par.sheen * k.sheen
  fx.irid = par.irid * k.irid
  fx.glow = par.glow * k.glow
  // The rig, straight off the dials — direction from the yaw/pitch
  // pair (one source with the conformance sweep), gains verbatim.
  const [lx, ly, lz] = lightDir(k.lightYaw, k.lightPitch)
  fx.light.set(lx, ly, lz)
  fx.key = k.key
  fx.keySoft = k.keySoft
  fx.fill = k.fill
  fx.room = k.room
  fx.front = k.front
}

function strikeRing(fx: LetterFx, x: number, y: number, t: number, power: number) {
  fx.ripples[strikeSlot(fx.ripples.map((r) => r.z))].set(x, y, t, power)
}

/** How many texels the outline is traced at, on the letter's long side.
 *  Around one texel per CSS px: the tracer interpolates each crossing
 *  between samples, so this is already sub-pixel, and going finer only
 *  buys a longer readback stall. */
const OUTLINE_TEXELS = 384

/** px of extrusion past which a letter is fully a body rather than a
 *  picture of one — the depth at which the shader stops trusting the
 *  texture's painted outline and starts trusting the walls'. A wall
 *  only has to clear the sheet's own antialiased fringe to be the thing
 *  the eye sees at the edge, so it is small. */
const SOLID_FULL_PX = 8

/** The outline's schedule: what one letter has traced, and what it owes. */
interface TraceSchedule {
  /** The outline key the committed islands were traced UNDER. */
  key: string
  /** A checksum of the pixels that were read, so an unchanged glyph
   *  costs nothing to re-check. */
  sig: number
  /** When the next readback is due, in the clock the frame loop reads. */
  due: number
  /** How many reads this change still gets before it settles. */
  tries: number
  /** The committed field itself, uploaded for the shader (tTrace) so the
   *  face cuts on the curve the walls stand on. Null until the first
   *  readback lands; owned here, because three will not free a
   *  DataTexture it was only handed. */
  tex: THREE.DataTexture | null
}

function MatterMaterial({
  i,
  fontPx,
  boxRef,
  fx,
  fields,
  solid,
  outlineKey,
  onOutline,
}: {
  i: number
  fontPx: number
  boxRef: React.RefObject<LetterBox>
  fx: LetterFx
  fields: LetterFields
  /** Extrusion is switched on: write depth (a slab has to sort against
   *  its own walls) and keep the traced outline current. */
  solid: boolean
  /** Everything about a pose that can change the glyph's SHAPE. Color
   *  and tilt are deliberately absent — neither moves an outline, and
   *  re-tracing on a color fade would stall a frame for nothing. */
  outlineKey: string
  /** The traced islands, tagged with the key they were traced UNDER —
   *  the tag is what lets the letter refuse walls that belong to a
   *  glyph it no longer is. */
  onOutline: (key: string, islands: InkIsland[]) => void
}) {
  // Inside Surface's material="none" slot: the Surface still owns the
  // texture (source format, premultiply, receipts); this material only
  // consumes it.
  const texture = useSurfaceTexture()
  const mat = useRef<THREE.ShaderMaterial>(null)
  const trace = useRef<TraceSchedule>({
    key: '',
    sig: 0,
    due: 0,
    tries: 0,
    tex: null,
  })
  // Owned here (see TraceSchedule.tex), so freed here.
  useEffect(() => {
    const tr = trace.current
    return () => {
      tr.tex?.dispose()
      tr.tex = null
    }
  }, [])
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      tFine: textureSlot(),
      tCoarse: textureSlot(),
      tTrace: textureSlot(),
      tHalo: textureSlot(),
      uTexel: { value: new THREE.Vector2(1e-3, 1e-3) },
      uTexelF: { value: new THREE.Vector2(1e-2, 1e-2) },
      uTexelC: { value: new THREE.Vector2(1e-2, 1e-2) },
      uPlane: { value: new THREE.Vector2(1, 1) },
      uFont: { value: 100 },
      uShoulder: { value: 0 },
      uPillowW: { value: 0 },
      uDome: { value: 0 },
      uRough: { value: 0.5 },
      uMetal: { value: 0 },
      uSss: { value: 0 },
      uCrinkle: { value: 0 },
      uSheen: { value: 0 },
      uIrid: { value: 0 },
      uGlow: { value: 0 },
      uFx: { value: 0 },
      uJelly: { value: 0 },
      uRelief: { value: 0 },
      uMeshFrac: { value: 1 },
      uFieldPx: { value: new THREE.Vector2(FIELD_DS.fine, FIELD_DS.coarse) },
      uSlab: { value: 0 },
      uSolid: { value: 0 },
      uPrism: { value: 0 },
      uMatter: { value: 0 },
      uVelDir: { value: new THREE.Vector2(1, 0) },
      uQuat: { value: new THREE.Vector4(0, 0, 0, 1) },
      uLight: { value: WORLD_LIGHT.clone() },
      uKey: { value: 1 },
      uKeySoft: { value: 1 },
      uFill: { value: 1 },
      uRoom: { value: 1 },
      uFront: { value: 1 },
      uTime: { value: 0 },
      // The glow pulse's per-letter stagger (fragment only — the weave
      // phases in the shared word frame instead).
      uPhase: { value: i * 2.13 },
      uWaveOrigin: { value: new THREE.Vector2(0, 0) },
      uWaveK: { value: new THREE.Vector2(0.05, 0.05) },
      uWaveW: { value: new THREE.Vector2(WEAVE.w[0], WEAVE.w[1]) },
      uWaveDir: { value: new THREE.Vector2(1, 0) },
      uRipples: {
        value: Array.from({ length: RIPPLE.slots }, () => new THREE.Vector4(0, 0, -1e3, 0)),
      },
      uRipK: { value: new THREE.Vector4(1, 1, 1, 1) },
      uRipAmp: { value: 0 },
      uStretch: { value: 0 },
    }),
    [i],
  )

    /** Re-traces the glyph outline when the letter changes shape, and
     *  commits it as the field both the walls and the face read from. */
    const retraceOutline = (
      gl: THREE.WebGLRenderer,
      m: THREE.ShaderMaterial,
      b: LetterBox,
      now: number,
    ) => {
      // This is the one blocking thing on the page: reading pixels back
      // drains the pipeline. It is scheduled rather than polled — a beat
      // marks the letter, and the reads follow until one of them sees
      // new pixels. Several reads, because a pose lands in the DOM before
      // its capture reaches the GPU: the early reads may still hold the
      // old glyph, and the signature is what says so — a read whose
      // pixels match the last commit is a glyph that has not repainted
      // yet, not a new outline. The letter melts its walls while this
      // key is untraced (MatterLetter), so the schedule is part of the
      // look: the sooner a read lands, the sooner the slab re-forms.
      //
      // The last try commits even on a matching signature. By then the
      // pixels are either truly identical (a re-roll that renders the
      // same — walls traced from these exact pixels are right whatever
      // key they carry) or the paint is pathologically late, and flat is
      // the honest shape for a letter whose face is unknown.
      const tr = trace.current
      if (tr.key !== outlineKey) {
        tr.key = outlineKey
        tr.due = now
        tr.tries = 4
      }
      if (tr.tries < 1 || !texture || now < tr.due) return
      tr.tries--
      tr.due = now + 0.15
      const fit = Math.min(1, OUTLINE_TEXELS / Math.max(b.w, b.h))
      const rw = Math.max(8, Math.round(b.w * fit))
      const rh = Math.max(8, Math.round(b.h * fit))
      const alpha = readAlphaField(gl, texture, rw, rh)
      if (!alpha) return
      let sig = rw * 8191 + rh
      for (let q = 0; q < alpha.length; q += 7) sig = (sig * 31 + alpha[q]) | 0
      if (sig === tr.sig && tr.tries > 0) return
      tr.sig = sig
      // The committed field IS the outline now, on both sides of the
      // seam: the walls are traced from these texels and the face
      // hardens onto the same texels (tTrace). Two consumers, one curve
      // — they cannot disagree. The readback buffer is shared, so the
      // texture takes a copy.
      const field = new THREE.DataTexture(alpha.slice(), rw, rh, THREE.RedFormat)
      field.minFilter = THREE.LinearFilter
      field.magFilter = THREE.LinearFilter
      // Single-channel rows at arbitrary widths: without byte alignment
      // the upload shears.
      field.unpackAlignment = 1
      field.needsUpdate = true
      tr.tex?.dispose()
      tr.tex = field
      m.uniforms.tTrace.value = field
      // Half coverage is the perceptual edge of an antialiased glyph, so
      // the wall meets the letter where the eye says the letter ends.
      onOutline(tr.key, traceContour(alpha, rw, rh, { threshold: 128 }))
    }

  useFrame((state) => {
    const m = mat.current
    if (!m) return
    const u = m.uniforms
    // The texture binds here, not in the memo — it does not exist on the
    // first frames, and LOD tiers swap it under the same uuid-keyed
    // material.
    u.tMap.value = texture ?? null
    const img = raster(texture)
    const b = boxRef.current
    // CSS px → texels: the texture covers the capture box at some LOD
    // scale, and every authored offset must survive a tier change.
    const texPerCss = img && b.w > 0 ? img.width / b.w : 1
    if (img) u.uTexel.value.set(1 / img.width, 1 / img.height)
    // The height fields refresh here, inside the frame write and before
    // the automatic render — and only on frames that USE them, so a
    // parked letter runs no extra passes at all. The vertex stage reads
    // them too now, so relief and extrusion join the light in asking.
    const wantsFields = fx.fx > 0.001 || fx.relief > 0.001 || fx.slab > 0.001
    if (texture && fx.matter > 0.5 && wantsFields) fields.update(state.gl, texture)
    u.tFine.value = fields.fine.texture
    u.tCoarse.value = fields.coarse.texture
    u.tHalo.value = fields.halo.texture
    u.uTexelF.value.set(1 / fields.fine.width, 1 / fields.fine.height)
    u.uTexelC.value.set(1 / fields.coarse.width, 1 / fields.coarse.height)
    u.uPlane.value.set(b.w, b.h)
    u.uFont.value = fontPx
    u.uShoulder.value = fx.shoulder
    u.uPillowW.value = fx.pillow
    u.uDome.value = fx.dome
    u.uRough.value = fx.rough
    u.uMetal.value = fx.metal
    u.uSss.value = fx.sss
    u.uCrinkle.value = fx.crinkle
    u.uSheen.value = fx.sheen
    u.uIrid.value = fx.irid
    u.uGlow.value = fx.glow
    u.uFx.value = fx.fx
    u.uRelief.value = fx.relief
    u.uMeshFrac.value = fx.body
    u.uSlab.value = fx.slab
    // How much of a BODY the letter is, from how far its walls have
    // opened. The shader needs this separately from the depth in px:
    // a slab 200px deep and one 20px deep are equally solid, and both
    // want the geometric silhouette. SOLID_FULL_PX is the depth past
    // which the letter is fully a body — small, because a wall only has
    // to clear the sheet's own fringe to be the thing you see at the
    // edge. Zero depth still means zero, which is what keeps the
    // handoff identity.
    u.uSolid.value = Math.min(1, fx.slab / SOLID_FULL_PX)
    u.uPrism.value = fx.prism * texPerCss
    u.uMatter.value = fx.matter
    u.uVelDir.value.copy(fx.velDir)
    u.uQuat.value.copy(fx.quat)
    u.uLight.value.copy(fx.light)
    u.uKey.value = fx.key
    u.uKeySoft.value = fx.keySoft
    u.uFill.value = fx.fill
    u.uRoom.value = fx.room
    u.uFront.value = fx.front
    u.uTime.value = state.clock.elapsedTime
    // The weave in this letter's own px — wavelengths, speeds, and
    // heights are the law's WEAVE (em and rad/s) under the dials, so
    // every face waves at the same physical scale whatever its slot
    // width. Heights land as px here, the same way uRipAmp does.
    const wl = fontPx * fx.waveScale
    u.uWaveK.value.set((Math.PI * 2) / (wl * WEAVE.lambda[0]), (Math.PI * 2) / (wl * WEAVE.lambda[1]))
    u.uWaveW.value.set(WEAVE.w[0] * fx.waveSpeed, WEAVE.w[1] * fx.waveSpeed)
    u.uJelly.value = fx.jelly * fontPx
    u.uWaveDir.value.copy(fx.waveDir)
    u.uWaveOrigin.value.copy(fx.waveOrigin)
    // The strike rig in this letter's own px — RIPPLE's em constants
    // scaled by the font — and the buffer, copied slot for slot.
    u.uRipK.value.set(
      (Math.PI * 2) / (RIPPLE.lambda * fontPx),
      RIPPLE.speed * fontPx,
      RIPPLE.width * fontPx,
      RIPPLE.tau,
    )
    for (let r = 0; r < RIPPLE.slots; r++) u.uRipples.value[r].copy(fx.ripples[r])
    u.uRipAmp.value = fx.ripAmp * RIPPLE.amp * fontPx
    u.uStretch.value = fx.stretch
    if (solid) retraceOutline(state.gl, m, b, state.clock.elapsedTime)
  })
  return (
    <shaderMaterial
      // Remount when the texture object changes — a ShaderMaterial does
      // not re-bind samplers reliably across texture swaps otherwise.
      key={texture?.uuid ?? 'warming'}
      ref={mat}
      uniforms={uniforms}
      vertexShader={LETTER_VERT}
      fragmentShader={LETTER_FRAG}
      // Premultiplied in, premultiplied blend (decisions.md #5); the
      // letters are paint over the page, so no tone mapping — same
      // stance as the standard-material path it replaces.
      //
      // Depth follows the form. A sheet is paint and wants none of it. A
      // slab has to sort against its OWN walls, and the index order
      // (walls, then sheet — logoSlab) plus a depth buffer is what puts
      // the front face over the edges instead of under them.
      transparent
      premultipliedAlpha
      depthWrite={solid}
      toneMapped={false}
    />
  )
}

/** One letter's scratch state: the fx feed the material reads, plus what
 *  the frame loop has to remember between frames. */
interface LetterDriveState {
  fx: LetterFx
  /** Last frame's UNSNAPPED screen position, and whether a frame has
   *  written one yet — the first frame has nothing to difference. */
  prev: { x: number; y: number }
  tracked: boolean
  /** Strikes consumed, by the router's seq. */
  strikeSeq: number
}

interface MatterLetterProps {
  i: number
  ch: string
  pose: LetterPose
  box: LetterBox
  fontPx: number
  knobs: React.RefObject<LogoKnobs>
  pointer: React.RefObject<{ x: number; y: number } | null>
  /** The latest tap, routed by the canvas to exactly one letter (`i`),
   *  consumed by seq so a strike lands once. */
  strike: React.RefObject<Strike>
  /** The Surface's excursion: `get()` is 0 at the page grid and 1
   *  airborne, `between` is the window a choreography gate reads. */
  progress: SurfaceProgress
  /** The carried idle float, em per letter — the SAME sample the page
   *  is writing to its slots this frame. */
  carried: () => number[]
  /** Extrusion is switched on, so this letter carries walls and sorts
   *  them with depth. */
  solid: boolean
}

/** CSS px per sheet segment. The grid was 28×14 — enough for a gel wave
 *  to travel through, nowhere near enough for a height field to push,
 *  which would have shown up as a faceted letter. */
const SHEET_STEP_PX = 4

function MatterLetter({
  i,
  ch,
  pose,
  box,
  fontPx,
  knobs,
  pointer,
  strike,
  progress,
  carried,
  solid,
}: MatterLetterProps) {
  const meshRef = useRef<THREE.Mesh>(null)

  // The letter's blur pyramid (logoFields): sized off the capture box —
  // which is 16px-quantized, so only a real viewport resize remakes the
  // targets — and refreshed by the material on lit frames.
  const fields = useMemo(() => new LetterFields(box.w, box.h), [box.w, box.h])
  useEffect(() => () => fields.dispose(), [fields])

  // The letter's body (logoSlab): a dense sheet, plus walls once the
  // outline has been traced. Islands arrive from the material's frame
  // write, which is the only place the live texture exists. Until then
  // — and whenever extrusion is off — this is the sheet alone, which is
  // exactly what the letter has always been.
  const [traced, setTraced] = useState<{ key: string; islands: InkIsland[] } | null>(null)
  const geometry = useMemo(() => {
    const sx = Math.max(8, Math.min(160, Math.round(box.w / SHEET_STEP_PX)))
    const sy = Math.max(8, Math.min(160, Math.round(box.h / SHEET_STEP_PX)))
    return buildLetterMesh(box.w, box.h, sx, sy, traced?.islands ?? null)
  }, [box.w, box.h, traced])
  useEffect(() => () => geometry.dispose(), [geometry])
  // Everything that can change the glyph's SHAPE. A re-roll that only
  // repaints (new color) leaves this alone, and costs no readback.
  const outlineKey = `${ch}|${pose.font}|${pose.weight}|${fontPx}|${box.w}x${box.h}`
  // The freshness law: a letter never wears another glyph's walls. A
  // beat re-deals the face NOW; its outline arrives a readback later,
  // and between the two this letter is wearing walls traced from the
  // glyph it used to be — serif feet jutting out of a sans face, a
  // counter's tube standing where the new bowl is not, the back cap
  // showing through every mismatch as black (2026-08-14, both of
  // Pete's artifact screenshots). So while the traced key is not THIS
  // key, the slab melts flat (fast), and it re-forms (slower) when the
  // fresh outline lands. The melt is the correctness guarantee; the
  // asymmetry is what keeps it from reading as flicker.
  const fresh = traced !== null && traced.key === outlineKey

  // Targets live in refs so a pose change never remounts the spring
  // mid-flight — the letter chases the new pose from wherever it is.
  const poseRef = useRef(pose)
  poseRef.current = pose
  const boxRef = useRef(box)
  boxRef.current = box

  // Seeded AT the current pose, not at rest: the twin's first presented
  // frame must sit exactly where the page letter is standing, or the
  // handoff itself would be the visible event it exists to prevent.
  // (The DOM letter's offsets are em OF THE GLYPH — trim included.)
  const springs = useRef<{ dx: Spring; dy: Spring; tilt: Spring; scale: Spring } | null>(null)
  if (!springs.current) {
    const em = fontPx * LOGO_FONTS[pose.font].trim
    springs.current = {
      dx: { x: pose.dx * em, v: 0 },
      dy: { x: pose.dy * em, v: 0 },
      tilt: { x: (-pose.tilt * Math.PI) / 180, v: 0 },
      scale: { x: pose.scale, v: 0 },
    }
  }

  // The substance's scratch state: the fx feed the material reads, plus
  // last position (screen velocity feeds the prism and the travel
  // stretch). Allocated once, mutated every frame.
  const drive = useRef<LetterDriveState | null>(null)
  if (!drive.current) {
    drive.current = {
      fx: {
        quat: new THREE.Vector4(0, 0, 0, 1),
        velDir: new THREE.Vector2(1, 0),
        fx: 0,
        jelly: 0,
        prism: 0,
        relief: 0,
        body: 1,
        slab: 0,
        shoulder: 0,
        pillow: 0,
        dome: 0,
        matter: pose.matter,
        rough: 0.5,
        metal: 0,
        sss: 0,
        crinkle: 0,
        sheen: 0,
        irid: 0,
        glow: 0,
        light: WORLD_LIGHT.clone(),
        key: 1,
        keySoft: 1,
        fill: 1,
        room: 1,
        front: 1,
        waveScale: 1,
        waveSpeed: 1,
        waveDir: new THREE.Vector2(1, 0),
        waveOrigin: new THREE.Vector2(0, 0),
        // Slots idle far in the past, where the ring-down term has
        // long rounded them to zero.
        ripples: Array.from({ length: RIPPLE.slots }, () => new THREE.Vector4(0, 0, -1e3, 0)),
        ripAmp: 0,
        stretch: 0,
      },
      prev: { x: 0, y: 0 },
      tracked: false,
      strikeSeq: strike.current.seq,
    }
  }

  const f = LOGO_FONTS[pose.font]
  return (
    <Surface.Part
      name={`letter-${i}`}
      size={[box.w, box.h]}
      source={
        <div className="logo-twin" style={{ width: box.w, height: box.h }}>
          <span
            className="logo-twin-glyph"
            style={{ ...glyphPaint(pose), fontSize: fontPx * f.trim }}
          >
            {ch}
          </span>
        </div>
      }
    >
      {/* Declared beside the word and drawn inside the Canvas: a page-
          declared presentation registers inward, so the mesh stands in
          the scene while the part feeding it stands next to the letter
          it copies. `manual` because the grid places a letter — the
          page word is the measuring rig, never a layout box to match.
          The material slot goes to the matter shader (logoShaders)
          while the part keeps owning the texture; no lights in this
          canvas, the shader carries its own analytic key light. */}
      <Surface.WebGL
        ref={meshRef}
        placement="manual"
        alpha="source"
        pointerEvents="none"
        frustumCulled={false}
        geometry={<primitive object={geometry} attach="geometry" />}
        material={
          <MatterMaterial
            i={i}
            fontPx={fontPx}
            boxRef={boxRef}
            fx={drive.current.fx}
            fields={fields}
            solid={solid}
            outlineKey={outlineKey}
            onOutline={(key, islands) => setTraced({ key, islands })}
          />
        }
      >
        <LetterDrive
          i={i}
          mesh={meshRef}
          fontPx={fontPx}
          knobs={knobs}
          pointer={pointer}
          strike={strike}
          progress={progress}
          carried={carried}
          poseRef={poseRef}
          boxRef={boxRef}
          springs={springs.current}
          drive={drive.current}
          fresh={fresh}
        />
      </Surface.WebGL>
    </Surface.Part>
  )
}

interface LetterDriveProps {
  i: number
  mesh: React.RefObject<THREE.Mesh | null>
  fontPx: number
  knobs: React.RefObject<LogoKnobs>
  pointer: React.RefObject<{ x: number; y: number } | null>
  strike: React.RefObject<Strike>
  progress: SurfaceProgress
  carried: () => number[]
  poseRef: React.RefObject<LetterPose>
  boxRef: React.RefObject<LetterBox>
  springs: { dx: Spring; dy: Spring; tilt: Spring; scale: Spring }
  drive: LetterDriveState
  /** The committed outline belongs to THIS glyph, so walls may stand. */
  fresh: boolean
}

/**
 * One letter's frame loop, drawn inside the Canvas.
 *
 * Split from <MatterLetter> because the halves live in different trees:
 * the part and its twin are page DOM, and `useFrame` exists only under
 * the renderer. Everything written here is a ref — the mesh transform
 * and the fx feed — so a beat never re-renders the scene.
 */
function LetterDrive({
  i,
  mesh,
  fontPx,
  knobs,
  pointer,
  strike,
  progress,
  carried,
  poseRef,
  boxRef,
  springs,
  drive,
  fresh,
}: LetterDriveProps) {
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)

  useFrame((state, delta) => {
    const el = mesh.current
    if (!el) return
    // A backgrounded tab returns with a giant delta; an unclamped spring
    // step that large explodes instead of settling.
    const dt = Math.min(delta, 1 / 30)
    const k = knobs.current
    const p = poseRef.current
    const b = boxRef.current
    const t = state.clock.elapsedTime
    // Everything matter ADDS to the page pose — bob, wobble, dodge —
    // rides the crossing's smoothstepped progress, so a crossing letter
    // holds the page's flat geometry at 0 and full depth only at 1.
    const amp = progress.get()

    // The pointer dodge, in CSS px: inside reach, a letter leans away.
    const [px, py] = dodgeOffset(pointer.current, b, k.dodge, amp, fontPx)

    const em = fontPx * LOGO_FONTS[p.font].trim
    const s = springs
    step(s.dx, p.dx * em + px, dt)
    step(s.dy, p.dy * em + py, dt)
    step(s.tilt, (-p.tilt * Math.PI) / 180, dt)
    step(s.scale, p.scale, dt)

    // DOM y grows down, world y grows up — dy and cy both flip sign.
    // The summed position snaps to the DEVICE pixel grid (the parts
    // stay exact): at rest the plane is 1:1 with the screen, and a
    // texture sampled half a texel off its grid is the whole difference
    // between the page's crisp glyph and a fuzzy copy. The snap costs
    // at most half a device pixel of placement; z stays free — depth is
    // supposed to leave the plane.
    //
    // The carried float rides at FULL value, never scaled by amp: the
    // page is writing this exact sample to its slot in this exact
    // frame, which is what lets the swap land mid-breath. Only motion
    // the page cannot mirror — bob, wobble, dodge — rides amplitude.
    const snap = (v: number) => Math.round(v * dpr) / dpr
    // The continuous screen position, kept BEFORE the snap: the feed
    // differentiates these for velocity, and a rounded position
    // cannot be differentiated (see the velocity block below).
    const rawX = b.cx - size.width / 2 + s.dx.x
    const rawY = size.height / 2 - b.cy - s.dy.x - carried()[i] * fontPx
    el.position.set(snap(rawX), snap(rawY), Math.sin(t * 1.1 + i * 1.9) * k.depth * amp)
    el.rotation.set(
      Math.sin(t * 0.8 + i * 2.3) * 0.1 * amp - (py / fontPx) * 0.5,
      Math.sin(t * 0.6 + i * 1.4) * 0.14 * amp + (px / fontPx) * 0.5,
      s.tilt.x,
    )
    el.scale.setScalar(s.scale.x)

    // ── feed the substance ──
    const d = drive
    const fx = d.fx
    // Screen velocity (bob + dodge + hop, everything that moves the
    // mesh) — the prism disperses along it and scales with it, so a
    // parked letter shows zero fringe whatever the knob says.
    //
    // Differentiated from the UNSNAPPED position, which is the whole
    // subtlety here. el.position is rounded onto the device pixel
    // grid to keep the glyph crisp, and differencing a rounded signal
    // measures the rounding: at dpr 2 and 120 Hz a nearly-still
    // letter reads a ±60 px/s square wave. That noise sized the
    // squash AND aimed it, so the soft, refractive letters shimmered
    // at frame rate — a bug, not a wobble (2026-08-15, the law test
    // pins why the noise is not negligible).
    //
    // A letter is born at rest: with no previous frame there is no
    // velocity, or the first frame differences against the origin and
    // the letter arrives mid-throw, fully stretched.
    const vx = d.tracked && dt > 0 ? (rawX - d.prev.x) / dt : 0
    const vy = d.tracked && dt > 0 ? (rawY - d.prev.y) / dt : 0
    d.prev.x = rawX
    d.prev.y = rawY
    d.tracked = true
    const sp = Math.hypot(vx, vy)
    if (sp > 1) fx.velDir.set(vx / sp, vy / sp)
    // ── strikes: a tap on the letter, or a beat re-dealing it ──
    // Consumed here, never in an event handler: a strike is a write
    // into the fx buffer, and the fx buffer belongs to the frame loop.
    const st = strike.current
    if (st.seq !== d.strikeSeq) {
      d.strikeSeq = st.seq
      if (st.i === i) {
        // Client → this letter's plane frame: world is y-up with its
        // origin mid-screen, the mesh's center is el.position, the
        // plane 1:1 CSS px at scale 1. Tilt is ignored — a ring
        // center a few px off at ±8° is below what a ring shows.
        const sc = Math.max(s.scale.x, 0.2)
        strikeRing(
          fx,
          (st.x - size.width / 2 - el.position.x) / sc,
          (size.height / 2 - st.y - el.position.y) / sc,
          t,
          1,
        )
      }
    }
    // Beats used to strike the letter they re-dealt. Removed
    // 2026-08-14: a beat lands every second or so, so the word was
    // percussing on its own forever — read as jitter, and it drowned
    // the sea it was supposed to season. A ring is an ANSWER now; the
    // only thing that strikes a letter is a hand on it.
    // Every term is × amp: at the handoff edges the letter is exactly
    // its own pixels (the identity theorem the crossing-flash gate
    // measured, before it was removed). What makes a letter a SUBSTANCE
    // rides a LATER window of the same progress — progress.between over
    // MATTER_GATE — so substances freeze back to ink before touchdown,
    // and the swap-eve frames are ink and nothing else.
    const gate = MATTER_GATE
    const gt = progress.between(gate.from, gate.from + gate.distance)
    const gs = gt * gt * (3 - 2 * gt)
    const par = MATTER_PARAMS[p.matter]
    writeMatterFx(fx, p, k, par, gs, amp, sp, dt, fresh)
    // The motion rig. The weave's dials pass through (the material
    // folds them with the font size). Rings and stretch fold their
    // gates HERE: × amp so both are zero at every handoff, × the
    // matter's softness so gummy rings deep and chrome barely — and
    // ink, matter 0, moves not at all.
    fx.waveScale = Math.max(k.waveScale, 0.05)
    fx.waveSpeed = k.waveSpeed
    const wa = (k.waveAngle * Math.PI) / 180
    fx.waveDir.set(Math.cos(wa), Math.sin(wa))
    // The shared frame: this letter's center in the scene, so all six
    // meshes sample ONE wave field. Pose scale and the float bend the
    // field a hair per letter — organic, and well under a wavelength.
    fx.waveOrigin.set(el.position.x, el.position.y)
    fx.ripAmp =
      p.matter === 0 ? 0 : k.ripple * amp * (RIPPLE.floor + (1 - RIPPLE.floor) * par.jelly)
    fx.stretch = p.matter === 0 ? 0 : k.stretch * amp * par.jelly * stretchAmount(sp)
    const q = el.quaternion
    fx.quat.set(q.x, q.y, q.z, q.w)
  })

  return null
}

interface MatterWordProps {
  poses: LetterPose[]
  metrics: WordMetrics
  knobs: React.RefObject<LogoKnobs>
  /** The word's identity — one handle for all six letters. */
  surface: SurfaceHandle
  /** What the page is asking for; the root wears it to stay exclusive. */
  view: SurfaceView
  /** Which renderer holds the pixels right now. */
  presented: SurfaceView
  /** The canvas wrapper changed synchronously at the handoff edge. */
  canvasRef: React.RefObject<HTMLDivElement | null>
  /** The root's callbacks. The root owns them, so they arrive as props
   *  rather than being written onto the handle from the page above. */
  onPresentedViewChange: (view: SurfaceView) => void
  onMotionComplete: (view: SurfaceView) => void
  onWebGLReleased: () => void
  /** The carried float's per-frame sample, shared with the page. */
  carried: () => number[]
  /** The extrude knob is off zero. A boolean rather than the number,
   *  so sliding thickness stays a uniform write and only switching the
   *  form on or off re-renders. */
  solid: boolean
}

/**
 * The word as matter: six parts of ONE Surface, and the Canvas they draw
 * in.
 *
 * Parts rather than six Surfaces — that is the whole reason this shape
 * exists. Six independent handoffs each crossed the moment their own
 * raster was ready, so the word came apart mid-lift: four letters in
 * WebGL and two still on the page for as long as the slowest one took.
 * One readiness ledger cannot do that.
 */
function MatterWord({
  poses,
  metrics,
  knobs,
  surface,
  view,
  presented,
  canvasRef,
  onPresentedViewChange,
  onMotionComplete,
  onWebGLReleased,
  carried,
  solid,
}: MatterWordProps) {
  const pointer = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const move = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY }
    }
    const gone = () => {
      pointer.current = null
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerout', gone, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerout', gone)
    }
  }, [])

  // A tap strikes the letter under it. Routed HERE, where the boxes
  // live, so overlapping capture pads resolve to the nearest heart —
  // one tap, one letter. The letters consume by seq from their frame
  // loops; nothing re-renders, so the idle-zero stance holds.
  const strike = useRef<Strike>({ i: -1, x: 0, y: 0, seq: 0 })
  useEffect(() => {
    const down = (e: PointerEvent) => {
      let best = -1
      let bestD = Infinity
      metrics.boxes.forEach((b, j) => {
        const dx = e.clientX - b.cx
        const dy = e.clientY - b.cy
        if (Math.abs(dx) > b.w / 2 || Math.abs(dy) > b.h / 2) return
        const dd = dx * dx + dy * dy
        if (dd < bestD) {
          bestD = dd
          best = j
        }
      })
      if (best < 0) return
      const s = strike.current
      s.i = best
      s.x = e.clientX
      s.y = e.clientY
      s.seq++
    }
    window.addEventListener('pointerdown', down, { passive: true })
    return () => window.removeEventListener('pointerdown', down)
  }, [metrics])

  return (
    <>
      {/* `view` is what keeps this an exclusive handoff rather than a
          Twin; the handle it presents was declared by the page, which is
          where the request and the timing live. */}
      <Surface
        surface={surface}
        view={view}
        canvas="logo"
        timing={{ settleMs: SETTLE_MS }}
        onPresentedViewChange={onPresentedViewChange}
        onMotionComplete={onMotionComplete}
        onWebGLReleased={onWebGLReleased}
      >
        {WORD.split('').map((ch, i) => (
          <MatterLetter
            key={i}
            i={i}
            ch={ch}
            pose={poses[i]}
            box={metrics.boxes[i]}
            fontPx={metrics.fontPx}
            knobs={knobs}
            pointer={pointer}
            strike={strike}
            progress={surface.progress}
            carried={carried}
            solid={solid}
          />
        ))}
      </Surface>

      {/* data-holds is the presentation law: until the page lets go it is
          false and logo.css keeps this whole element uncomposited — the
          twins draw warm (a write-free pass still compiles the program
          and samples the texture) but the eye sees only the page until
          the swap. */}
      <div ref={canvasRef} className="logo-canvas" data-holds={presented === 'webgl'}>
        {/* `flat`: the letters are ink, and tone mapping would mute
            exactly the candy this palette is for. */}
        <SurfaceCanvas
          pointerMode="surfaces"
          id="logo"
          flat
          gl={{ alpha: true }}
          dpr={[1, 2]}
          camera={{ fov: FOV, position: [0, 0, 1000] }}
          onCreated={(state) => state.gl.setClearAlpha(0)}
        >
          <PixelCam />
        </SurfaceCanvas>
      </div>
    </>
  )
}

// ── the tweak panel ─────────────────────────────────────────────────────

// The panel shows the subset of LogoKnobs still being tuned by eye. The
// settled ones ship at LOGO_DEFAULTS and move in logoLaw.ts; adding a row
// back here exposes one again. The shader gate drives knobs through
// `window.__logo` rather than this list, so hiding a row cannot silently
// drop a material from its walk.
const SLIDERS: {
  key: keyof LogoKnobs
  label: string
  min: number
  max: number
  step: number
  matterOnly?: boolean
}[] = [
  // 0.9, not 1: gloss becomes uFx, the mix weight in
  // `mix(base.rgb, aces(lit) * base.a, uFx)` (logoShaders.ts). At exactly 1
  // the page's own texel leaves the blend and the letters render from
  // lighting alone, which comes up black (2026-08-15). The cap is on what
  // the panel can ask for; LogoKnobs still carries the full range.
  { key: 'gloss', label: 'gloss', min: 0, max: 0.9, step: 0.05, matterOnly: true },
  { key: 'polish', label: 'polish', min: 0, max: 2, step: 0.05, matterOnly: true },
  { key: 'sheen', label: 'sheen', min: 0, max: 2, step: 0.05, matterOnly: true },
  { key: 'irid', label: 'irid', min: 0, max: 2, step: 0.05, matterOnly: true },
  { key: 'glow', label: 'glow', min: 0, max: 2, step: 0.05, matterOnly: true },
  { key: 'jelly', label: 'jelly', min: 0, max: 1, step: 0.05, matterOnly: true },
  { key: 'prism', label: 'prism', min: 0, max: 1, step: 0.05, matterOnly: true },
  // Not 'relief px': the number is a gain referenced to 22, and the px
  // it buys are per-matter (LogoKnobs.relief).
  { key: 'relief', label: 'relief', min: 0, max: 60, step: 2, matterOnly: true },
  { key: 'extrude', label: 'extrude px', min: 0, max: 80, step: 2, matterOnly: true },
  { key: 'lightYaw', label: 'light yaw°', min: -80, max: 80, step: 1, matterOnly: true },
  { key: 'lightPitch', label: 'light pitch°', min: -45, max: 80, step: 1, matterOnly: true },
  { key: 'key', label: 'key light', min: 0, max: 2, step: 0.05, matterOnly: true },
  { key: 'keySoft', label: 'key soft', min: 0.2, max: 2, step: 0.05, matterOnly: true },
  { key: 'room', label: 'room', min: 0, max: 2, step: 0.05, matterOnly: true },
  { key: 'waveScale', label: 'wave scale', min: 0.3, max: 3, step: 0.05, matterOnly: true },
  { key: 'waveSpeed', label: 'wave speed', min: 0, max: 3, step: 0.05, matterOnly: true },
  { key: 'waveAngle', label: 'wave angle°', min: -90, max: 90, step: 5, matterOnly: true },
]

/** The logo scene's probe handle: the shader gate walks the material states
 *  by setting knobs directly, independent of which rows the panel shows. */
export interface LogoProbeApi {
  setKnob: (key: keyof LogoKnobs, value: number) => void
}

// ── the page ────────────────────────────────────────────────────────────

export function LogoApp() {
  useEffect(ensureLogoFonts, [])

  const [knobs, setKnobs] = useState<LogoKnobs>(LOGO_DEFAULTS)
  // Multiplies the stylesheet's responsive base (--logo-base) rather than
  // naming a px size, so the wordmark still answers the viewport at every
  // setting. Not a LogoKnob: those reach the shaders through a ref, and this
  // one never leaves the DOM. Everything downstream is em — slots, drift,
  // float amplitude — and the WebGL twins size themselves from the fontPx
  // measured below, so this single number carries the whole scene.
  const [textScale, setTextScale] = useState(1)
  const [compact, setCompact] = useState(false)
  const [seed, setSeed] = useState(SEED0)
  // `?probe=still` boots with the conductor paused, so a capture reads
  // the CROSSING alone: beats mid-capture fold the choreography into the
  // measurement. Written for crossing-flash, which is gone; kept because
  // any future crossing instrument needs the same still page.
  const [running, setRunning] = useState(
    () => new URLSearchParams(window.location.search).get('probe') !== 'still',
  )
  const knobsRef = useRef(knobs)
  knobsRef.current = knobs

  // The shader gate reaches materials the panel no longer exposes. Driving
  // knobs from here keeps its walk independent of panel layout: a hidden row
  // costs the gate nothing, where clicking a slider that stopped existing
  // passed while proving less.
  useEffect(() => {
    window.__logo = { setKnob: (key, value) => setKnobs((k) => ({ ...k, [key]: value })) }
    return () => {
      delete window.__logo
    }
  }, [])

  // The handoff is the library's now (this page is where it bled
  // first): six parts must each prove a post-draw color write, and the
  // settle dwell outlasts the compositor-clocked eases — hop and color;
  // the carried float is exempt — the facts that make the swap frame
  // pixel-identical even mid-breath. The handle holds the phases, the
  // evidence gate, and the reversal rule; this page states its timing
  // and reads back what it needs to dress the DOM.
  const supported = useSupportsDOMSurfaces()
  const [view, setView] = useState<SurfaceView>('dom')
  const [presented, setPresented] = useState<SurfaceView>('dom')
  const [settledOn, setSettledOn] = useState<SurfaceView>('dom')
  // The canvas is mounted from the moment a lift is asked for until the
  // protocol says the WebGL side may go — which is after the landing
  // linger, not at the swap, so the teardown never shares the commit
  // that hands the letters back.
  const [glMounted, setGlMounted] = useState(false)
  // Identity only. The view, the timing, and the callbacks are stated once,
  // on the `<Surface>` that declares this handle.
  const surface = useSurface('logo')
  const request = useCallback((webgl: boolean) => {
    if (webgl) setGlMounted(true)
    setView(webgl ? 'webgl' : 'dom')
  }, [])
  const inCrossing = view !== presented || view !== settledOn
  // Who shows the letters. The page keeps them until it actually lets
  // go, which is a draw, not a commit — so the phase the word wears is
  // read from the hold rather than from the request.
  const phase = presented === 'webgl' ? 'gl' : inCrossing ? 'lifting' : 'page'

  const rRef = useRef(makeRng(SEED0))
  const [poses, setPoses] = useState<LetterPose[]>(() =>
    seedWord(WORD.length, makeRng(SEED0), LOGO_DEFAULTS),
  )
  useEffect(() => {
    rRef.current = makeRng(seed)
    setPoses(seedWord(WORD.length, rRef.current, knobsRef.current))
  }, [seed])

  // One letter re-rolls against its own current pose AND both standing
  // neighbors — the constraint that keeps the word six distinct voices.
  const swapLetter = useCallback((i: number) => {
    setPoses((prev) => {
      const near = [prev[i - 1], prev[i + 1]].filter((p) => p !== undefined)
      const next = prev.slice()
      next[i] = rollPose(
        rRef.current,
        {
          fonts: [prev[i].font, ...near.map((p) => p.font)],
          colors: [prev[i].color, ...near.map((p) => p.color)],
          matters: [prev[i].matter, ...near.map((p) => p.matter)],
        },
        knobsRef.current,
      )
      return next
    })
  }, [])

  // Wave steps land on their own delays; the ids are kept so pausing (or
  // leaving the page) silences a sweep already in the air.
  const pending = useRef<number[]>([])
  const schedule = useCallback(
    (steps: BeatStep[]) => {
      for (const s of steps) {
        if (s.delay === 0) swapLetter(s.letter)
        else pending.current.push(window.setTimeout(() => swapLetter(s.letter), s.delay))
      }
    },
    [swapLetter],
  )

  // The conductor: a swung setTimeout chain, reading knobs through the
  // ref so dragging tempo never restarts the loop mid-phrase. It rests
  // during a crossing — a beat landing mid-handoff would put the page
  // letter and its twin mid-transition on different clocks, and the
  // swap frame would stop being pixel-identical.
  useEffect(() => {
    if (!running || inCrossing) return
    let beat = 0
    const tick = () => {
      schedule(beatPlan(rRef.current, WORD.length, knobsRef.current))
      beat = window.setTimeout(tick, nextBeat(rRef.current, knobsRef.current))
    }
    beat = window.setTimeout(tick, nextBeat(rRef.current, knobsRef.current))
    return () => {
      clearTimeout(beat)
      pending.current.forEach(clearTimeout)
      pending.current = []
    }
  }, [running, inCrossing, seed, schedule])

  // Idle float: per-letter period and phase rolled once per take, so six
  // letters breathe out of step instead of pumping in unison.
  const floats = useMemo(() => {
    const r = makeRng(seed ^ 0x9e3779b9)
    return WORD.split('').map(() => ({
      dur: 2600 + r() * 2400,
      delay: -r() * 2600,
    }))
  }, [seed])

  // The float is CARRIED (useCarriedMotion): one clock owns it, the
  // page writes its per-frame sample to the slots and the meshes read
  // the same sample, so a crossing never parks it — the letters keep
  // breathing straight through the swap in both directions
  // (decisions.md #30). The amplitude smooths toward the knob (and
  // toward zero under prefers-reduced-motion) inside the program,
  // replacing the registered-property ease this page used when the
  // float lived on the compositor's clock.
  const slotRefs = useRef<(HTMLElement | null)[]>([])
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)'), [])
  const float = useCarriedMotion(
    useMemo(() => {
      let amp = 0
      let lastT = 0
      return (t: number) => {
        const dt = Math.min(t - lastT, 100)
        lastT = t
        const target = reduced.matches ? 0 : knobsRef.current.float
        amp += (target - amp) * (1 - Math.exp(-dt / 150))
        return floats.map((f) => -Math.cos(((t - f.delay) / f.dur) * Math.PI * 2) * amp)
      }
    }, [floats, reduced]),
    useCallback((v: number[]) => {
      slotRefs.current.forEach((el, i) => {
        if (el) el.style.transform = `translateY(${v[i]}em)`
      })
    }, []),
  )

  // ── measurement for matter mode ──
  // The word is measured for exactly two numbers — its viewport origin
  // and its resolved font-size — and every center is COMPUTED from the
  // same grid the page renders (slotLayout, in em). Reading centers
  // back through offsetLeft/offsetWidth loses the truth: those APIs are
  // integers by spec while the 9vw font-size makes the real geometry
  // fractional, and the stacked rounding stood each twin up to ~1 CSS
  // px (two device px on Retina) off its letter — a visible up-and-
  // sideways step at the swap frame (2026-08-13).
  const wordRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const syncPresented = useCallback((next: SurfaceView) => {
    // The hold changes inside a renderer frame. React state commits later,
    // which left one frame where the canvas had stopped writing but the page
    // letters were still hidden. Put the two CSS ownership flags on their
    // elements synchronously, then let React record the same state.
    if (wordRef.current) wordRef.current.dataset.phase = next === 'webgl' ? 'gl' : 'page'
    if (canvasRef.current) canvasRef.current.dataset.holds = String(next === 'webgl')
    setPresented(next)
  }, [])
  const [metrics, setMetrics] = useState<WordMetrics | null>(null)
  const lastKey = useRef('')
  const measure = useCallback(() => {
    const word = wordRef.current
    if (!word) return
    const wr = word.getBoundingClientRect()
    const fontPx = parseFloat(getComputedStyle(word).fontSize)
    const pad = Math.round(fontPx * 0.45)
    // Slots sit at top: 0 with height 1em, so every vertical center is
    // 0.5em below the word's own top — no per-letter reads at all.
    const boxes: LetterBox[] = GRID.slots.map((slot) => ({
      cx: wr.left + (slot.left + slot.width / 2) * fontPx,
      cy: wr.top + 0.5 * fontPx,
      w: Math.ceil((slot.width * fontPx + pad * 2) / 16) * 16,
      h: Math.ceil((fontPx + pad * 2) / 16) * 16,
    }))
    const key = `${fontPx}|${boxes
      .map((b) => `${b.cx.toFixed(2)},${b.cy.toFixed(2)},${b.w},${b.h}`)
      .join(' ')}`
    if (key === lastKey.current) return
    lastKey.current = key
    setMetrics({ fontPx, boxes })
  }, [])
  // The grid only moves when the viewport does (the word's font-size is
  // a clamp on vw) — but re-measuring after every commit is cheap with
  // the key dedupe, and it makes the lift's first frame correct
  // without ordering assumptions.
  useLayoutEffect(() => {
    if (glMounted) measure()
  })
  useEffect(() => {
    if (!glMounted) return
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [glMounted, measure])

  const setKnob = (key: keyof LogoKnobs, value: number) =>
    setKnobs((k) => ({ ...k, [key]: value }))

  return (
    <div className="logo-page">
      <div className="logo-plate">
        <div
          className="logo-word"
          ref={wordRef}
          // The protocol phase, worn on the DOM: logo.css keys letter
          // visibility off it, and an instrument can read it to know
          // when a crossing is mid-air.
          data-phase={phase}
          // React writes this during the commit, so the layout effect that
          // measures fontPx below reads the new size in the same frame —
          // an effect that set it afterwards would leave the twins one
          // commit behind, at the wrong size for a frame after every step.
          style={{ width: `${GRID.width}em`, fontSize: `calc(var(--logo-base) * ${textScale})` }}
        >
          {WORD.split('').map((ch, i) => (
            <span
              key={i}
              className="logo-slot"
              // The carrier writes this slot's transform every frame —
              // the float never pauses for a crossing, because the
              // meshes are reading the same sample it is writing.
              ref={(el) => {
                slotRefs.current[i] = el
              }}
              style={{
                left: `${GRID.slots[i].left}em`,
                width: `${GRID.slots[i].width}em`,
              }}
            >
              <span
                className="logo-letter"
                style={{
                  ...glyphPaint(poses[i]),
                  transform: `translate(${poses[i].dx}em, ${poses[i].dy}em) rotate(${poses[i].tilt}deg) scale(${poses[i].scale})`,
                }}
              >
                {ch}
              </span>
            </span>
          ))}
        </div>
      </div>

      {glMounted && metrics && (
        <MatterWord
          poses={poses}
          metrics={metrics}
          knobs={knobsRef}
          surface={surface}
          view={view}
          presented={presented}
          canvasRef={canvasRef}
          onPresentedViewChange={syncPresented}
          onMotionComplete={setSettledOn}
          onWebGLReleased={() => setGlMounted(false)}
          carried={float.sample}
          solid={knobs.extrude > 0}
        />
      )}

      <div className="logo-panel" data-compact={compact}>
        <button
          className="logo-panel-title"
          aria-expanded={!compact}
          onClick={() => setCompact((v) => !v)}
        >
          <span>wordmark</span>
          <span className="logo-panel-toggle">{compact ? '+' : '−'}</span>
        </button>
        {/* The scene's subject, so it leads the panel: the same letters
            drawn by the page or by WebGL. Naming both renderers as
            segments states which one owns the pixels right now, where a
            checkbox stated only the destination. A flip mid-crossing
            reverses the crossing, never skips it — that rule lives in the
            library now (crossingRequest), so both segments stay live
            while one is in flight. */}
        {/* `data-renderer` is the probe's handle: shader-compile walks the
            scene through both directions by name, so reordering or
            restyling the segments cannot quietly change what it clicks. */}
        {/* Only where there is a second renderer to name. Without the
            trial the WebGL segment offered a destination nothing could
            reach: the request mounted a Canvas whose frameloop never
            advanced, so react-three-fiber's `onCreated` stayed pending
            until the segment was flipped back — and fired against the
            wrapper div it had just unmounted, throwing (2026-08-23). The
            letters are the page's either way, so the scene loses a label
            here and nothing else. */}
        {supported && (
          <div className="logo-matter">
            <button
              data-renderer="html"
              data-on={view === 'dom'}
              onClick={() => request(false)}
            >
              HTML
            </button>
            <button data-renderer="gl" data-on={view === 'webgl'} onClick={() => request(true)}>
              WebGL
            </button>
          </div>
        )}
        <div className="logo-panel-row">
          <button onClick={() => setRunning((v) => !v)}>{running ? 'pause' : 'play'}</button>
          <button onClick={() => schedule(waveSteps(rRef.current, WORD.length))}>wave</button>
          <button onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>reroll</button>
        </div>
        <label className="logo-panel-slider">
          <span>text size</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={textScale}
            onChange={(e) => setTextScale(Number(e.target.value))}
          />
          <em>{textScale.toFixed(2)}×</em>
        </label>
        {SLIDERS.map((s) => (
          <label
            key={s.key}
            className="logo-panel-slider"
            data-off={s.matterOnly && phase === 'page'}
          >
            <span>{s.label}</span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={knobs[s.key]}
              onChange={(e) => setKnob(s.key, Number(e.target.value))}
            />
            <em>{knobs[s.key]}</em>
          </label>
        ))}
      </div>

    </div>
  )
}
