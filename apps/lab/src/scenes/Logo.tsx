// The logo playground — a side page, not one of the eight scenes.
//
// The wordmark from the sketch: six letters, each in its own face and
// color, set a little haphazard and never sitting still. A conductor
// (logoLaw.ts) re-rolls one letter per beat — new face, new color, new
// tilt — and the CSS spring makes each change land as a hop. All of it
// is ordinary DOM: the page IS the logo, tweakable from the panel.
//
// The munari trick is the "matter" switch, and it flips through the
// library's own threshold guarantee: useLift, the protocol this page
// bled for before it became law (packages/core crossing +
// tests/conformance/transfer/crossing). Lifting mounts a twin of each
// letter behind a per-letter SurfaceApp, warming unseen and
// pixel-aligned with the still-visible page word; the lift releases
// the page only on evidence — every twin PRESENTED (onFirstPresented,
// a post-draw proof, not an upload receipt) and any in-flight hop
// settled — while the idle float, carried on one clock that the page
// and the meshes both read, keeps breathing straight through the swap.
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
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group } from 'three'
import {
  LiftDriver,
  SurfaceApp,
  cameraDistance,
  useCarriedMotion,
  useLift,
  useSurfaceTexture,
  type Lift,
} from '@petepetrash/munari'
import {
  LOGO_DEFAULTS,
  LOGO_FONTS,
  LOGO_PALETTE,
  beatPlan,
  makeRng,
  nextBeat,
  rollPose,
  seedWord,
  slotLayout,
  springStep,
  waveSteps,
  type BeatStep,
  type LetterPose,
  type LogoKnobs,
} from './logoLaw'
import { LETTER_FRAG, LETTER_VERT, MATTER_LIGHT_GATE, MATTER_PARAMS } from './logoShaders'
import { LetterFields } from './logoFields'
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
// One fixed key light and one fixed studio for the whole word, in WORLD
// space. The shader lifts each letter's normals into world through its
// quaternion, so a wobbling letter sweeps its reflections across the
// standing light — the cue that reads as substance instead of decal.
const WORLD_LIGHT = new THREE.Vector3(-0.42, 0.58, 0.7).normalize()

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
  /** Gel amplitude in px, all factors folded in. */
  jelly: number
  /** Prism offset in CSS px (the material converts to texels). */
  prism: number
  /** Field weights (MATTER_PARAMS): fine-gradient shoulder, coarse-
   *  gradient pillow, and the overall height-to-normal gain. The field
   *  SCALES live in the blur pyramid (logoFields), not here. */
  shoulder: number
  pillow: number
  dome: number
  matter: number
}

function MatterMaterial({
  i,
  fontPx,
  boxRef,
  fx,
  fields,
}: {
  i: number
  fontPx: number
  boxRef: React.RefObject<LetterBox>
  fx: LetterFx
  fields: LetterFields
}) {
  // Inside Surface's material="none" slot: the Surface still owns the
  // texture (source format, premultiply, receipts); this material only
  // consumes it.
  const texture = useSurfaceTexture()
  const mat = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(
    () => ({
      tMap: { value: null as THREE.Texture | null },
      tFine: { value: null as THREE.Texture | null },
      tCoarse: { value: null as THREE.Texture | null },
      uTexel: { value: new THREE.Vector2(1e-3, 1e-3) },
      uTexelF: { value: new THREE.Vector2(1e-2, 1e-2) },
      uTexelC: { value: new THREE.Vector2(1e-2, 1e-2) },
      uPlane: { value: new THREE.Vector2(1, 1) },
      uFont: { value: 100 },
      uShoulder: { value: 0 },
      uPillowW: { value: 0 },
      uDome: { value: 0 },
      uFx: { value: 0 },
      uJelly: { value: 0 },
      uPrism: { value: 0 },
      uMatter: { value: 0 },
      uVelDir: { value: new THREE.Vector2(1, 0) },
      uQuat: { value: new THREE.Vector4(0, 0, 0, 1) },
      uLight: { value: WORLD_LIGHT.clone() },
      uTime: { value: 0 },
      uPhase: { value: i * 2.13 },
      uWaveK: { value: new THREE.Vector2(0.05, 0.05) },
    }),
    [i],
  )
  useFrame((state) => {
    const m = mat.current
    if (!m) return
    const u = m.uniforms
    // The texture binds here, not in the memo — it does not exist on the
    // first frames, and LOD tiers swap it under the same uuid-keyed
    // material.
    u.tMap.value = texture ?? null
    const img = texture?.image as { width: number; height: number } | undefined
    const b = boxRef.current
    // CSS px → texels: the texture covers the capture box at some LOD
    // scale, and every authored offset must survive a tier change.
    const texPerCss = img && b.w > 0 ? img.width / b.w : 1
    if (img) u.uTexel.value.set(1 / img.width, 1 / img.height)
    // The height fields refresh here, inside the frame write and before
    // the automatic render — and only on lit frames, so a parked or
    // cooling letter runs no extra passes at all.
    if (texture && fx.matter > 0.5 && fx.fx > 0.001) fields.update(state.gl, texture)
    u.tFine.value = fields.fine.texture
    u.tCoarse.value = fields.coarse.texture
    u.uTexelF.value.set(1 / fields.fine.width, 1 / fields.fine.height)
    u.uTexelC.value.set(1 / fields.coarse.width, 1 / fields.coarse.height)
    u.uPlane.value.set(b.w, b.h)
    u.uFont.value = fontPx
    u.uShoulder.value = fx.shoulder
    u.uPillowW.value = fx.pillow
    u.uDome.value = fx.dome
    u.uFx.value = fx.fx
    u.uJelly.value = fx.jelly
    u.uPrism.value = fx.prism * texPerCss
    u.uMatter.value = fx.matter
    u.uVelDir.value.copy(fx.velDir)
    u.uQuat.value.copy(fx.quat)
    u.uTime.value = state.clock.elapsedTime
    // Wave numbers from the font size, so every face ripples at the same
    // physical scale whatever its slot width.
    u.uWaveK.value.set((Math.PI * 2) / (fontPx * 0.85), (Math.PI * 2) / (fontPx * 0.68))
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
      // letters are paint over the page, so no depth writes and no tone
      // mapping — same stance as the standard-material path it replaces.
      transparent
      premultipliedAlpha
      depthWrite={false}
      toneMapped={false}
    />
  )
}

interface MatterLetterProps {
  i: number
  ch: string
  pose: LetterPose
  box: LetterBox
  fontPx: number
  knobs: React.RefObject<LogoKnobs>
  pointer: React.RefObject<{ x: number; y: number } | null>
  /** The lift's progress, 0..1 smoothstepped: 0 pins the twin flat on
   *  the page grid. */
  progress: () => number
  /** A choreography window over the same progress (drei's range shape);
   *  the cooling gate reads the light's window through it. */
  range: (from: number, distance: number) => number
  /** The carried idle float, em per letter — the SAME sample the page
   *  is writing to its slots this frame. */
  carried: () => number[]
  /** Post-draw proof that this twin's pixels reached the framebuffer. */
  onPresented: () => void
}

function MatterLetter({
  i,
  ch,
  pose,
  box,
  fontPx,
  knobs,
  pointer,
  progress,
  range,
  carried,
  onPresented,
}: MatterLetterProps) {
  const g = useRef<Group>(null)
  const [painted, setPainted] = useState(false)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)

  // The letter's blur pyramid (logoFields): sized off the capture box —
  // which is 16px-quantized, so only a real viewport resize remakes the
  // targets — and refreshed by the material on lit frames.
  const fields = useMemo(() => new LetterFields(box.w, box.h), [box.w, box.h])
  useEffect(() => () => fields.dispose(), [fields])

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
  // excitation (hop energy that makes a freshly-dealt letter jiggle,
  // then gel-decay to calm) and last position (screen velocity feeds
  // the prism). Allocated once, mutated every frame.
  const drive = useRef<{
    fx: LetterFx
    prev: { x: number; y: number }
    excite: number
  } | null>(null)
  if (!drive.current) {
    drive.current = {
      fx: {
        quat: new THREE.Vector4(0, 0, 0, 1),
        velDir: new THREE.Vector2(1, 0),
        fx: 0,
        jelly: 0,
        prism: 0,
        shoulder: 0,
        pillow: 0,
        dome: 0,
        matter: pose.matter,
      },
      prev: { x: 0, y: 0 },
      excite: 0,
    }
  }

  useFrame((state, delta) => {
    const el = g.current
    if (!el) return
    // A backgrounded tab returns with a giant delta; an unclamped spring
    // step that large explodes instead of settling.
    const dt = Math.min(delta, 1 / 30)
    const k = knobs.current
    const p = poseRef.current
    const b = boxRef.current
    const t = state.clock.elapsedTime
    // Everything matter ADDS to the page pose — bob, wobble, dodge —
    // rides the lift's smoothstepped progress, so a crossing letter
    // holds the page's flat geometry at 0 and full depth only at 1.
    const amp = progress()

    // The pointer dodge, in CSS px: inside reach, a letter leans away.
    let px = 0
    let py = 0
    const pt = pointer.current
    if (pt && k.dodge > 0 && amp > 0) {
      const ox = b.cx - pt.x
      const oy = b.cy - pt.y
      const dist = Math.hypot(ox, oy)
      const reach = fontPx * 2.4
      if (dist > 1 && dist < reach) {
        const fall = 1 - dist / reach
        px = (ox / dist) * fall * fall * k.dodge * amp
        py = (oy / dist) * fall * fall * k.dodge * amp
      }
    }

    const em = fontPx * LOGO_FONTS[p.font].trim
    const s = springs.current!
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
    el.position.set(
      snap(b.cx - size.width / 2 + s.dx.x),
      snap(size.height / 2 - b.cy - s.dy.x - carried()[i] * fontPx),
      Math.sin(t * 1.1 + i * 1.9) * k.depth * amp,
    )
    el.rotation.set(
      Math.sin(t * 0.8 + i * 2.3) * 0.1 * amp - (py / fontPx) * 0.5,
      Math.sin(t * 0.6 + i * 1.4) * 0.14 * amp + (px / fontPx) * 0.5,
      s.tilt.x,
    )
    el.scale.setScalar(s.scale.x)

    // ── feed the substance ──
    const d = drive.current!
    const fx = d.fx
    // Excitation: spring speed (px/s-ish; tilt folded in at glyph scale)
    // with a fast attack and a slow gel decay — a beat STRIKES the
    // letter, and the wobble rings down over ~half a second.
    const speed = Math.hypot(s.dx.v, s.dy.v) + Math.abs(s.tilt.v) * em
    d.excite = Math.max(Math.min(speed / 320, 1), d.excite * Math.exp(-dt / 0.45))
    // Screen velocity (bob + dodge + hop, everything that moves the
    // mesh) — the prism disperses along it and scales with it, so a
    // parked letter shows zero fringe whatever the knob says.
    const vx = dt > 0 ? (el.position.x - d.prev.x) / dt : 0
    const vy = dt > 0 ? (el.position.y - d.prev.y) / dt : 0
    d.prev.x = el.position.x
    d.prev.y = el.position.y
    const sp = Math.hypot(vx, vy)
    if (sp > 1) fx.velDir.set(vx / sp, vy / sp)
    // Every term is × amp: at the handoff edges the letter is exactly
    // its own pixels (the identity theorem the crossing-flash gate
    // measures). The LIGHT additionally rides a LATER window of the same
    // progress — lift.range over MATTER_LIGHT_GATE — so substances
    // freeze back to ink before touchdown, and the swap-eve frames are
    // ink and nothing else.
    const gate = MATTER_LIGHT_GATE
    const gt = range(gate.from, gate.distance)
    const par = MATTER_PARAMS[p.matter]
    fx.matter = p.matter
    fx.fx = p.matter === 0 ? 0 : k.gloss * gt * gt * (3 - 2 * gt)
    fx.jelly = k.jelly * amp * par.jelly * (1.1 + 4.5 * d.excite)
    fx.prism = k.prism * amp * par.prism * Math.min(sp / 300, 1) * 2.6
    fx.shoulder = par.shoulder
    fx.pillow = par.pillow
    fx.dome = par.dome
    const q = el.quaternion
    fx.quat.set(q.x, q.y, q.z, q.w)
  })

  const f = LOGO_FONTS[pose.font]
  return (
    <group ref={g} visible={painted}>
      <SurfaceApp
        label={`logo-${WORD[i]}${i}`}
        width={box.w}
        height={box.h}
        transparent
        // material="none" yields the material slot to the matter shader
        // (logoShaders) while the Surface keeps owning the texture —
        // source format, premultiply, and both receipts survive the
        // custom material. No lights in this canvas: the shader carries
        // its own analytic key light per matter.
        material="none"
        frustumCulled={false}
        onFirstUpload={() => setPainted(true)}
        onFirstPresented={onPresented}
        content={
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
        {/* Subdivided so the gel waves have vertices to travel through —
            a 1×1 plane would turn uJelly into a rigid-body shear. */}
        <planeGeometry args={[box.w, box.h, 28, 14]} />
        <MatterMaterial
          i={i}
          fontPx={fontPx}
          boxRef={boxRef}
          fx={drive.current.fx}
          fields={fields}
        />
      </SurfaceApp>
    </group>
  )
}

interface MatterCanvasProps {
  poses: LetterPose[]
  metrics: WordMetrics
  knobs: React.RefObject<LogoKnobs>
  /** The library lift this canvas serves: its driver advances the
   *  protocol, its progress gates depth, its receipts gate the lift-off. */
  lift: Lift
  /** The carried float's per-frame sample, shared with the page. */
  carried: () => number[]
}

function MatterCanvas({ poses, metrics, knobs, lift, carried }: MatterCanvasProps) {
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

  return (
    // data-holds is the presentation law: while lifting it is false and
    // logo.css keeps this whole element uncomposited — the twins draw
    // warm (receipts come from the framebuffer, which opacity does not
    // touch) but the eye sees only the page until the swap.
    <div className="logo-canvas" data-holds={lift.glHolds}>
      {/* `flat`: the letters are ink, and tone mapping would mute
          exactly the candy this palette is for. */}
      <Canvas
        flat
        gl={{ alpha: true }}
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => state.gl.setClearAlpha(0)}
      >
        <PixelCam />
        <LiftDriver lift={lift} />
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
            progress={lift.progress}
            range={lift.range}
            carried={carried}
            onPresented={() => lift.present(i)}
          />
        ))}
      </Canvas>
    </div>
  )
}

// ── the tweak panel ─────────────────────────────────────────────────────

const SLIDERS: {
  key: keyof LogoKnobs
  label: string
  min: number
  max: number
  step: number
  matterOnly?: boolean
}[] = [
  { key: 'tempo', label: 'tempo ms', min: 250, max: 4000, step: 50 },
  { key: 'swing', label: 'swing', min: 0, max: 0.9, step: 0.05 },
  { key: 'wave', label: 'wave odds', min: 0, max: 1, step: 0.05 },
  { key: 'tilt', label: 'tilt deg', min: 0, max: 30, step: 1 },
  { key: 'drift', label: 'drift em', min: 0, max: 0.25, step: 0.01 },
  { key: 'squish', label: 'squish', min: 0, max: 0.5, step: 0.02 },
  { key: 'float', label: 'float em', min: 0, max: 0.15, step: 0.005 },
  { key: 'depth', label: 'depth px', min: 0, max: 160, step: 5, matterOnly: true },
  { key: 'dodge', label: 'dodge px', min: 0, max: 120, step: 5, matterOnly: true },
  { key: 'gloss', label: 'gloss', min: 0, max: 1, step: 0.05, matterOnly: true },
  { key: 'jelly', label: 'jelly', min: 0, max: 1, step: 0.05, matterOnly: true },
  { key: 'prism', label: 'prism', min: 0, max: 1, step: 0.05, matterOnly: true },
]

// ── the page ────────────────────────────────────────────────────────────

export function LogoApp({ chips }: { chips?: React.ReactNode }) {
  useEffect(ensureLogoFonts, [])

  const [knobs, setKnobs] = useState<LogoKnobs>(LOGO_DEFAULTS)
  const [seed, setSeed] = useState(SEED0)
  // `?probe=still` boots with the conductor paused: the crossing-flash
  // instrument measures the CROSSING, and beats mid-capture would fold
  // the choreography into the measurement.
  const [running, setRunning] = useState(
    () => new URLSearchParams(window.location.search).get('probe') !== 'still',
  )
  const knobsRef = useRef(knobs)
  knobsRef.current = knobs

  // The lift is the library's now (this page is where it bled first):
  // six presenters must prove post-draw, and the settle dwell outlasts
  // the compositor-clocked eases — hop and color; the carried float is
  // exempt — the facts that make the swap frame pixel-identical even
  // mid-breath. The hook holds the phases, the evidence gate, and the
  // reversal rule; this page only states its timing.
  const lift = useLift({
    presenters: WORD.length,
    timing: { settleMs: SETTLE_MS },
  })
  const inCrossing = lift.entering || lift.exiting

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
      const near = [prev[i - 1], prev[i + 1]].filter(Boolean) as LetterPose[]
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
    if (lift.glMounted) measure()
  })
  useEffect(() => {
    if (!lift.glMounted) return
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [lift.glMounted, measure])

  const setKnob = (key: keyof LogoKnobs, value: number) =>
    setKnobs((k) => ({ ...k, [key]: value }))

  return (
    <div className="logo-page">
      <div className="logo-plate">
        <div
          className="logo-word"
          ref={wordRef}
          // The protocol phase, worn on the DOM: logo.css keys letter
          // visibility off it, and the crossing-flash instrument reads
          // it to know when a crossing is mid-air.
          data-phase={lift.phase}
          style={{ width: `${GRID.width}em` }}
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

      {lift.glMounted && metrics && (
        <MatterCanvas
          poses={poses}
          metrics={metrics}
          knobs={knobsRef}
          lift={lift}
          carried={float.sample}
        />
      )}

      <div className="logo-panel">
        <div className="logo-panel-title">wordmark</div>
        <div className="logo-panel-row">
          <button onClick={() => setRunning((v) => !v)}>{running ? 'pause' : 'play'}</button>
          <button onClick={() => schedule(waveSteps(rRef.current, WORD.length))}>wave</button>
          <button onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>reroll</button>
        </div>
        <label className="logo-panel-matter">
          {/* A flip mid-crossing reverses the crossing, never skips it
              — that rule lives in the library now (crossingRequest). */}
          <input
            type="checkbox"
            checked={lift.requested}
            onChange={(e) => lift.request(e.target.checked)}
          />
          <span>matter — lift the letters into WebGL</span>
        </label>
        {SLIDERS.map((s) => (
          <label
            key={s.key}
            className="logo-panel-slider"
            data-off={s.matterOnly && lift.phase === 'page'}
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

      {chips}
      <div className="footer">
        six letters, six voices — tune the conductor, then flip on matter and each beat
        transmutes a letter: ink, balloon, foil, gummy, neon
      </div>
    </div>
  )
}
