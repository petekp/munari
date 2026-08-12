// The knobs scene's tuning surface — the visual numbers a hand wants to
// drag while judging the slab, and the machinery that applies them live.
//
// Three kinds of application, because the scene has three kinds of
// number (the genieKnobs doctrine, plus one):
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
// Writes go straight into live objects; nothing re-renders the scene
// except the rebuild path, which exists because a chamfer has no other
// way to change.

import { KNOB } from './knobsGeometry'

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

  /** Gain on the art's own orbiting glints. */
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
export const knobsTuning: KnobsTuningValues = {
  coronaOut: 2,
  coronaVeil: 120,
  coronaEdgeOut: 12.1,
  coronaEdgeIn: 5,
  coronaCore: 1.35,
  coronaVeilGain: 0.55,
  coronaTone: 1.6,
  coronaSpill: 0.45,
  shadeMax: 0.72,

  rimRough: 0.02,
  rimMetal: 1,
  rimEnv: 3,
  rimBevelSize: 8,
  rimBevelDepth: 1.1,

  knurlCount: KNOB.knurlCount,
  knurlAmp: KNOB.knurlAmp,
  hwRough: 0.6,
  hwEnv: 1.4,
  indexGlow: 0.9,

  lightArt: 0,
  lightAmbient: 0,
  lightKey: 0.08,
  lightFill: 0.6,
  lightDom: 0.3,

  lcdBright: 1,
  lcdEmit: 1.3,
  lcdReflect: 40000,
  lcdGlow: 0.52,
  lcdGhost: 0.12,
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
      { key: 'lightArt', label: 'art lights', min: 0, max: 2.5, step: 0.05 },
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
]
