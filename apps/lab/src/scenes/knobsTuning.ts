// The knobs scene's tuning surface — the visual numbers a hand wants to
// drag while judging the slab, and the machinery that applies them live.
//
// Four kinds of application, because the scene has four kinds of
// number (the genieKnobs doctrine, plus two):
//
//   CSS custom properties. The LCD windows are captured DOM, styled by
//   knobs.css through var() with defaults equal to the committed
//   values — an untouched panel changes nothing, and the stylesheet
//   stays the single source of truth for what ships. Custom properties
//   set on :root cascade into the captured subtree, and the live
//   capture repaints on its own.
//
//   Live reads. Shader uniforms, material scalars, and light gains are
//   dripped from this bag every frame by the scene's existing useFrame
//   hooks — no push, no re-render, nothing to desynchronise.
//
//   Rebuilds. Knurl pitch and chamfer cut change the vertex count
//   itself, which no drip can reach: those knobs bump a revision, and
//   the geometry re-machines through React. Dev-only cost, paid only
//   when one of them moves.
//
//   Renderer settings. One knob — render scale — is not a look at all
//   but a property of the drawing buffer, so it can neither be dripped
//   into a uniform nor rebuilt as geometry. It is pushed to r3f's
//   setDpr, which resizes the buffer and the camera together. Watched
//   by RenderScale in Knobs.tsx, which is the only place in the scene
//   allowed to touch it.
//
// Writes go straight into live objects; nothing re-renders the scene
// except the rebuild path, which exists because a chamfer has no other
// way to change.


export interface KnobsTuningValues {
  /** Corona reach outside the silhouette, px. The corona quad's margin
   *  is sized to this slider's CEILING — raise the max and the margin
   *  in Knobs.tsx must grow with it, or the tuned corona crops. */
  coronaOut: number
  /** Veil reach onto the dark face, px. */
  coronaVeil: number
  /** Hot-line width outside, px of exponential tau. */
  coronaEdgeOut: number
  /** Hot-line relax onto the face, px of exponential tau. */
  coronaEdgeIn: number
  /** Gain on the boundary hot line. */
  coronaCore: number
  /** Gain on the face-side bloom veil. */
  coronaVeilGain: number
  /** Tone-map knee: higher saturates toward white sooner. */
  coronaTone: number
  /** Multiplies the three spill sample distances past the edge. */
  coronaSpill: number
  /** Brightest surround CHANNEL below which the corona is fully off —
   *  the backdrop is dark but saturated, so a coloured sample is not
   *  proof of light. At 0 it sits under the brightest backdrop the art
   *  law can paint (0.155), which leaves that backdrop 6.5% of the halo
   *  — litGate is a smoothstep, so a LEVEL of 0.155 is not a share of
   *  0.155; above 0.155 it shuts the background out entirely. See
   *  litGate for why the measure is not luminance. */
  coronaLitFloor: number
  /** Brightest surround channel at which the corona is fully on. Above
   *  the dimmest drawn layer (0.773) the ramp is still climbing there,
   *  so a faint blade glows a little less than a bright one — which is
   *  what an emitter does. What must hold is the GAP, not the ceiling:
   *  see the litGate contract. */
  coronaLitKnee: number
  /** Face shade ceiling: how dark a fully backlit face falls. */
  shadeMax: number

  /** The slab rim's machined chrome. */
  rimRough: number
  rimMetal: number
  /** envMapIntensity: how hard the rim mirrors the artwork. */
  rimEnv: number
  /** Chamfer cut width, px (rebuild). */
  rimBevelSize: number
  /** Chamfer depth, px (rebuild). Ceiling stays under FACE_Z = 1.4:
   *  the captured face must keep standing proud of the facet. */
  rimBevelDepth: number

  /** Knurl ridge count around the skirt (rebuild). */
  knurlCount: number
  /** Knurl ridge depth, px (rebuild). */
  knurlAmp: number
  /** The knob/lever chrome: roughness and art-mirror gain. */
  hwRough: number
  hwEnv: number
  /** Emissive intensity of the knob pointer marks. */
  indexGlow: number

  /** How bright the artwork stands in the room's environment wrap. */
  envArt: number
  /** The picture's bounce: how much of the artwork's own average color
   *  the surrounding room throws back. This is what a CAMERA-FACING
   *  surface mirrors — a knob top cannot see a picture standing behind
   *  it, so the bounce is the only honest path by which the artwork
   *  reaches the front of the panel. Being an average, it is the same
   *  in every direction and cannot change when the slab moves. */
  envRoom: number
  /** The overhead: a soft neutral above everything, so bare metal keeps
   *  one white glint when the picture runs dark. Was a literal in the
   *  bake, and measurement caught it carrying most of the scene. */
  envSky: number

  /** Candela of the art's own orbiting emitters — the picture as three
   *  punctual lights rather than a reflection. Physical falloff over
   *  100–500 px puts the range in the tens of thousands, as `lcdReflect`
   *  found for the window lamps.
   *
   *  Expect little from it, and know why before turning it up. These
   *  lamps stand BEHIND the slab; every surface a viewer sees faces the
   *  camera, so N·L is negative and the diffuse term is gone. The one
   *  surface that does turn away, the knob skirt, is metal at 0.88 —
   *  metal has no diffuse term either, so all a lamp can leave there is
   *  a pinpoint glint. Measured: 400,000 cd moved the skirt 1.8%, and at
   *  the committed value the toggle and the rim both read 0.0%. It is
   *  kept because a travelling glint below a probe's threshold can still
   *  be worth having, but the picture reaches the front of the panel
   *  through `envRoom`, not through here. */
  lightArt: number
  /** Base intensities of the tinted fill, warm key, cool fill. */
  lightAmbient: number
  lightKey: number
  lightFill: number
  /** DOM light: the Surface's emissive term — a LOW floor of authored
   *  paint that survives a dim room, for the lamp halos and engravings.
   *  It lifts ALL the paint, so past a floor it washes the charcoal
   *  body gray; the LCD windows have their own pure emitters and do not
   *  need it (rebuild-flagged: it rides a React prop). */
  lightDom: number

  /** LCD backlight brightness: scales the window's lightness, digits
   *  excepted — a dimmer lamp does not lighten the opaque crystals. */
  lcdBright: number
  /** Gain on the window emitters: 1 shows the authored pixels exactly,
   *  above overdrives them, below dims the lamp toward lit paint. */
  lcdEmit: number
  /** Candela of the per-window point light — how hard the windows land
   *  on the chrome beside them (the scene-side cast of a DOM lamp).
   *  The scene's meter is the pixel and three's falloff is physical
   *  (inverse-square, r165+ has no other mode), so visible numbers
   *  live in the tens of thousands: 145 candela across an 80 px gap
   *  delivers ~0.02 — pitch black. */
  lcdReflect: number
  /** Alpha of the bloom the window leaks onto the face. */
  lcdGlow: number
  /** Alpha of the unenergized segments against the backlight. */
  lcdGhost: number

  /** Render-scale CEILING, not a fixed scale: the renderer draws at
   *  min(devicePixelRatio, this), which is what `dpr={[1, n]}` always
   *  meant. So 2 is "full retina, no supersampling" and on a 1x display
   *  the dial does nothing until it goes below 1.
   *
   *  This is the one dial that trades sharpness for fill rate, and the
   *  only one whose right value is a property of the MACHINE rather than
   *  the look — which is why the committed number is the quality
   *  ceiling, not the fastest setting. Judge it on the knurl teeth and
   *  the LCD text; they blur first. */
  dpr: number
}

// The committed look — Pete's second 2026-08-11 tuning session, baked:
// a dark room (no art lights, no ambient, a whisper of key) where the
// slab holds a tight corona and the windows carry the light. The
// session's lcdBright (0.78) is folded into the stylesheet's color
// literals instead, so the dial reads 1 against the new baseline. The
// session's lcdReflect (145) was a pin against a dead dial — the whole
// 0–150 range sat inside physical falloff's dead zone — so the
// committed value is the probe-tuned candela that dial was reaching
// for.
//
// The light rig's numbers are from the 2026-08-11 relight, measured
// rather than eyeballed: mean RGB of a 30 px disc on the first dial, art
// frozen, slab carried within one run, and every crop ANCHORED to the
// slab's own lit windows — a fixed crop misses the dial by 23 px at the
// far station and reports a swing that is really a miss.
//
// The defect was a magenta that CHANGED with position: excess (r−g) 13
// at the berth against 29 at the left station. Repainting the wrap
// killed that, and the balance below cannot bring it back — four
// balances were read at both stations and the berth-to-left drift is
// 1.2 here, 0.2 at the deepest, against the bug's 16.
//
// So the balance is taste again. `envRoom` is the one dial that decides
// how far the panel stands inside the picture; the sweep that read it
// gave, at both stations, 0.18 → magenta 6/7 and hue response 16.2;
// 0.25 → 12/11 and 20.2; 0.32 → 16/16 and 30.3; 0.45 → 26/28 and 63.3.
// It ships at 0.34, between the third and fourth rows — the sweep is
// the cost curve, not the choice.
//
// The values below are Pete's 2026-08-14 session, and they undo a good
// deal of the 2026-08-11 one on purpose. That session took the corona
// wide and soft and moved the white light from fill to ambient; this
// one takes the corona TIGHT — 13 px of reach against the old 28, and
// spill samples pulled in from 1.4 to 0.3, so the halo wears the colour
// of what it touches instead of an average smeared nearly five times
// wider — and puts the cool fill back at 1.2 while dropping the key to
// 0.1. `coronaEdgeOut` at 10.8 against 13 px of reach is not a
// contradiction: a tau that long decays to 0.30 across the WHOLE reach,
// so the compact-support term does the shaping and the edge light lands
// even. The old pair did the opposite — tau 1.7 over 28 px of reach is
// dead by 7 px, which is a hot line with a long empty tail.
//
// `lightDom` goes to zero. It lifts ALL the authored paint, and with the
// ambient at 1 the charcoal body no longer needs the floor.
//
// One number here is a deliberate softening of the corona's emitter
// gate rather than a look: `coronaLitFloor` at 0 lets the backdrop keep
// 1.2–6.5% of the halo instead of none (measured across the litGate
// sweep; the gate is a smoothstep, so the brightest backdrop's level of
// 0.155 becomes a share of 0.065, not of 0.155). With the corona pulled
// in from 28 px to 13 and its spill from 1.4 to 0.3, that trace is an
// edge rather than the standoff glow the gate was built to kill — so the
// contract moved with it, from "the background gets none" to "the
// background gets under a quarter of what the picture gets" (litGate,
// knobsLaw.test.ts). Push the floor past 0.155 to shut it completely;
// the picture's own gate value does not move either way.
export const knobsTuning: KnobsTuningValues = {
  coronaOut: 13,
  coronaVeil: 76,
  coronaEdgeOut: 10.8,
  coronaEdgeIn: 7.5,
  coronaCore: 0.75,
  coronaVeilGain: 1.4,
  coronaTone: 0.8,
  coronaSpill: 0.3,
  coronaLitFloor: 0,
  coronaLitKnee: 1,
  shadeMax: 0.64,

  rimRough: 0.3,
  rimMetal: 1,
  rimEnv: 5,
  rimBevelSize: 2,
  rimBevelDepth: 1.35,

  knurlCount: 76,
  knurlAmp: 0.35,
  hwRough: 0.05,
  hwEnv: 4,
  indexGlow: 0.8,

  envArt: 2,
  envRoom: 0.34,
  envSky: 0.9,

  lightArt: 26000,
  lightAmbient: 1,
  lightKey: 0.1,
  lightFill: 1.2,
  lightDom: 0,

  lcdBright: 0.8,
  lcdEmit: 1.45,
  lcdReflect: 15000,
  lcdGlow: 0.32,
  lcdGhost: 0.15,

  // Back at the quality ceiling. Pinning this to 1 was a diagnostic —
  // the scene is one forward pass of 54 draws into a 5.2 Mpx buffer, and
  // with the frame limiter OFF, halving the pixels halves the frame
  // (5.16 -> 2.59 ms mean, p95 16.0 -> 7.3). But that is throughput, and
  // throughput was never the complaint: at dpr 1 the drops Pete sees
  // while carrying the panel did not go with it. So fill rate is real
  // and is NOT the cause, and this ships at the value that looks right
  // while the search moves on.
  dpr: 2,
}

/** The LCD backlight's committed colors — the same literals knobs.css
 *  carries as var() defaults. Brightness scales these in HSL space and
 *  writes the result; at exactly 1 the properties are removed instead,
 *  so the untouched stylesheet literals are what render. */
const LCD_STOPS = {
  '--knb-lcd-hot': '#ffb82e',
  '--knb-lcd-mid': '#f4980e',
  '--knb-lcd-edge': '#bd7818',
  '--knb-lcd-base': '#cb881b',
} as const

function scaleHexLightness(hex: string, mul: number): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d > 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  const l2 = Math.min(1, Math.max(0, l * mul))
  const c = (1 - Math.abs(2 * l2 - 1)) * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l2 - c / 2
  const [r2, g2, b2] =
    h < 1 / 6 ? [c, x, 0]
    : h < 2 / 6 ? [x, c, 0]
    : h < 3 / 6 ? [0, c, x]
    : h < 4 / 6 ? [0, x, c]
    : h < 5 / 6 ? [x, 0, c]
    : [c, 0, x]
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r2)}${to(g2)}${to(b2)}`
}

/** Push the CSS-side knobs into the live page. Cheap enough to call per
 *  input. Everything else is read live: per-frame drips into uniforms
 *  and materials, or a rev-triggered re-machine for geometry. */
export function applyKnobsTuning(k: KnobsTuningValues = knobsTuning): void {
  const root = document.documentElement.style
  root.setProperty('--knb-lcd-glow', String(k.lcdGlow))
  root.setProperty('--knb-lcd-ghost', String(k.lcdGhost))
  for (const [prop, hex] of Object.entries(LCD_STOPS)) {
    if (k.lcdBright === 1) root.removeProperty(prop)
    else root.setProperty(prop, scaleHexLightness(hex, k.lcdBright))
  }
}

/** The paste-ready record of a tuning session. */
export function dumpKnobsTuning(): string {
  return JSON.stringify({ knobsTuning }, null, 2)
}

// ── the rebuild channel ─────────────────────────────────────────────────
// Geometry knobs change vertex counts; the scene re-machines by
// subscribing to this revision (useSyncExternalStore) and keying its
// geometry memos on it.

let rev = 0
const listeners = new Set<() => void>()

export function bumpTuningRev(): void {
  rev++
  listeners.forEach((l) => l())
}

export function subscribeTuning(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getTuningRev(): number {
  return rev
}

export interface KnobsTuningDef {
  key: keyof KnobsTuningValues
  label: string
  min: number
  max: number
  step: number
  /** This knob changes vertex counts: moving it bumps the rev. */
  rebuild?: boolean
}

export const KNOBS_TUNING_GROUPS: { title: string; knobs: KnobsTuningDef[] }[] = [
  {
    title: 'backlight',
    knobs: [
      { key: 'coronaOut', label: 'out reach px', min: 0, max: 28, step: 1 },
      { key: 'coronaVeil', label: 'veil reach px', min: 8, max: 220, step: 2 },
      { key: 'coronaEdgeOut', label: 'edge out px', min: 0.8, max: 16, step: 0.1 },
      { key: 'coronaEdgeIn', label: 'edge in px', min: 1, max: 16, step: 0.5 },
      { key: 'coronaCore', label: 'core gain', min: 0, max: 4, step: 0.05 },
      { key: 'coronaVeilGain', label: 'veil gain', min: 0, max: 2, step: 0.05 },
      { key: 'coronaTone', label: 'tone knee', min: 0.4, max: 4, step: 0.05 },
      { key: 'coronaSpill', label: 'spill reach', min: 0.3, max: 4, step: 0.05 },
      { key: 'coronaLitFloor', label: 'lit floor', min: 0, max: 1, step: 0.01 },
      { key: 'coronaLitKnee', label: 'lit knee', min: 0, max: 1, step: 0.01 },
      { key: 'shadeMax', label: 'face shade', min: 0, max: 0.9, step: 0.02 },
    ],
  },
  {
    title: 'chrome rim',
    knobs: [
      { key: 'rimRough', label: 'roughness', min: 0.02, max: 0.6, step: 0.01 },
      { key: 'rimMetal', label: 'metalness', min: 0, max: 1, step: 0.02 },
      { key: 'rimEnv', label: 'reflections', min: 0, max: 5, step: 0.05 },
      { key: 'rimBevelSize', label: 'chamfer size', min: 0.4, max: 12, step: 0.2, rebuild: true },
      { key: 'rimBevelDepth', label: 'chamfer depth', min: 0.2, max: 1.35, step: 0.05, rebuild: true },
    ],
  },
  {
    title: 'hardware',
    knobs: [
      { key: 'knurlCount', label: 'knurl count', min: 24, max: 120, step: 4, rebuild: true },
      { key: 'knurlAmp', label: 'knurl depth', min: 0, max: 1.6, step: 0.05, rebuild: true },
      { key: 'hwRough', label: 'chrome rough', min: 0.05, max: 1, step: 0.01 },
      { key: 'hwEnv', label: 'chrome mirror', min: 0, max: 4, step: 0.05 },
      { key: 'indexGlow', label: 'pointer glow', min: 0, max: 4, step: 0.1 },
    ],
  },
  {
    title: 'light rig',
    knobs: [
      { key: 'envArt', label: 'art in room', min: 0, max: 2, step: 0.05 },
      { key: 'envRoom', label: 'art bounce', min: 0, max: 0.8, step: 0.01 },
      { key: 'envSky', label: 'overhead', min: 0, max: 1, step: 0.02 },
      { key: 'lightArt', label: 'art lights cd', min: 0, max: 60000, step: 1000 },
      { key: 'lightAmbient', label: 'ambient', min: 0, max: 1, step: 0.02 },
      { key: 'lightKey', label: 'key', min: 0, max: 1.5, step: 0.02 },
      { key: 'lightFill', label: 'fill', min: 0, max: 1.2, step: 0.02 },
      { key: 'lightDom', label: 'dom light', min: 0, max: 1.5, step: 0.05, rebuild: true },
    ],
  },
  {
    title: 'lcd',
    knobs: [
      { key: 'lcdBright', label: 'backlight', min: 0.4, max: 1.5, step: 0.02 },
      { key: 'lcdEmit', label: 'emission', min: 0.3, max: 2, step: 0.05 },
      { key: 'lcdReflect', label: 'reflection', min: 0, max: 80000, step: 2500 },
      { key: 'lcdGlow', label: 'window bloom', min: 0, max: 0.8, step: 0.02 },
      { key: 'lcdGhost', label: 'ghost segments', min: 0, max: 0.4, step: 0.01 },
    ],
  },
  {
    title: 'render',
    knobs: [
      // Below 1 is deliberately reachable: it is the fastest way to ask
      // "is this fill rate?" and get an unmistakable answer.
      { key: 'dpr', label: 'render scale', min: 0.5, max: 3, step: 0.25 },
    ],
  },
]
