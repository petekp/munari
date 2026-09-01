// Marble-hand tuning — the hand's scale, weight and studio light.
//
// The law: the fingertip stays on the browser pointer while every other
// degree of freedom may lag. These numbers only tune the sculpture around
// that fixed point; none can move the hotspot away from the click.
//
// The fault this prevents, 2026-08-30: damping the whole object makes a
// beautiful follower and a false pointer. A fast hand can then be 20–40px
// ahead of the fingertip that appears to own the click.
//
// Ownership: this file owns perceptual scene values. Pointer truth stays in
// MarbleHand.tsx and the source model stays under public/models.

import type { MarbleHandThemeId } from './marbleHandThemes'

export type MarbleHandFinish = 'marble' | 'chrome'

export interface MarbleHandTuning {
  materialMode: MarbleHandFinish
  scale: number
  mobileScale: number
  heightPx: number
  pressHeightPx: number
  pressPitch: number
  velocityTilt: number
  maxTilt: number
  maxSpin: number
  poseDamping: number
  baseRotation: number
  sculptureRoll: number
  sculpturePitch: number
  motionEnabled: boolean
  keepAbovePage: boolean
  tapEnabled: boolean
  tapIdleDelayMs: number
  tapPeriodMs: number
  tapLiftRad: number
  pinchEnabled: boolean
  pinchIndexRad: number
  pinchThumbRad: number
  stoneColor: string
  veinColor: string
  veinStrength: number
  veinScale: number
  roughness: number
  clearcoat: number
  clearcoatRoughness: number
  envMapIntensity: number
  ior: number
  specularIntensity: number
  chromeRoughness: number
  chromeReflectionIntensity: number
  chromeTint: string
  strokeEnabled: boolean
  strokeWidthPx: number
  strokeColor: string
  strokeOpacity: number
  reflectionFps: number
  ambientIntensity: number
  keyIntensity: number
  lightX: number
  lightY: number
  lightZ: number
  lightColor: string
  exposure: number
  roomBounce: number
  pageLightIntensity: number
  shadowsEnabled: boolean
  shadowIntensity: number
  shadowRadius: number
  shadowMapSize: number
  wavesZoom: number
  wavesWarp: number
  wavesRipple: number
  wavesContrast: number
  wavesShift: number
  wavesSheen: number
  wavesGloss: number
  wavesVignette: number
  tideHorizon: number
  tideLift: number
  tideEclipseSize: number
  tideSwell: number
  tideGlow: number
  tideHueShift: number
  tideSurgeRate: number
  tideGlitter: number
  tideGlade: number
  tideFlare: number
  tideStarDensity: number
  prismSegments: number
  prismZoom: number
  prismDispersion: number
  prismCells: number
  prismEdge: number
  prismGlint: number
  prismCore: number
  prismSpin: number
  prismMorph: number
  prismPlates: number
  prismPlateTint: number
  prismDepth: number
  prismSpark: number
}

// A fresh scene copies these defaults. The panel never mutates them, so
// Reset all restores the tested pose instead of a previously edited bag.
export const marbleHandTuning: Readonly<MarbleHandTuning> = Object.freeze({
  materialMode: 'chrome',
  // The 2026-08-30 user export makes the 215-unit fragment about 148px
  // at the page plane. Keep the selected values exact for Reset all.
  scale: 0.69,
  mobileScale: 0.76,
  // The user's 40px press travel tightens the tip shadow. The floor guard
  // still protects poses outside this saved orientation and motion range.
  heightPx: 92,
  pressHeightPx: 52,
  pressPitch: -0.2565634000431664,
  // The latest export reaches the 0.12rad rock limit after about 11px of
  // pointer travel; the wider spin limit gives lateral motion more room.
  velocityTilt: 0.0111,
  maxTilt: 0.12,
  maxSpin: 0.3490658503988659,
  // 7.5/s settles 98% in about 520ms: weight after the hand stops, without
  // making the cursor look detached from its own input.
  poseDamping: 7.5,
  // Local +X points from wrist to tip. The user's 151.9-degree direction
  // retains the index upper-left and wrist down-right cursor relation.
  baseRotation: 2.651155133779387,
  // The user-selected roll and tilt remain in radians here; the panel
  // displays degrees without rounding these stored values on focus.
  sculptureRoll: 1.9355701404617116,
  sculpturePitch: 0.582939970166106,
  motionEnabled: true,
  keepAbovePage: true,
  // Idle drumming. 1200ms is past the longest pause inside a normal reach
  // across the page, so the fingers do not start twitching mid-gesture.
  // 720ms per finger with the three staggered reads as one impatient roll
  // rather than three separate taps. The two-joint chain turns the tip
  // 1.8x this knuckle angle (marbleHandTapLaw chain constants), so 0.22rad
  // keeps roughly the tip travel the flat 0.35rad hinge had — well past
  // the few pixels a reader notices in peripheral vision — while the curl
  // now bends through the finger. Every tap angle tightens the existing
  // curl, lifting the stone further off the page rather than into it.
  tapEnabled: true,
  tapIdleDelayMs: 1200,
  tapPeriodMs: 720,
  tapLiftRad: 0.22,
  // The pinch closes thumb and index while text is being selected. The
  // angles are capped by the same page-clearance law the tap obeys; the
  // pair stops short of touching so the stone never intersects itself.
  pinchEnabled: true,
  pinchIndexRad: 0.46,
  pinchThumbRad: 0.36,
  // The exported finish uses a broad coat highlight and a stronger room
  // reflection, balanced by the lower key light and exposure below.
  roughness: 0.25,
  clearcoat: 0.81,
  clearcoatRoughness: 0.86,
  envMapIntensity: 3.95,
  stoneColor: '#eee9dc',
  veinColor: '#482f1e',
  veinStrength: 1,
  veinScale: 1.05,
  ior: 2.05,
  specularIntensity: 0.73,
  // The 2026-08-30 user export softens the chrome reflection without adding
  // the stone's broad clearcoat. Keep this finish separate so switching
  // materials never overwrites the saved marble settings.
  chromeRoughness: 0.364,
  chromeReflectionIntensity: 2.95,
  chromeTint: '#eef2f7',
  // The edge uses CSS pixels so camera distance and hand size cannot thin
  // it. A narrow, partly transparent edge keeps the reflected finish clear.
  strokeEnabled: true,
  strokeWidthPx: 2,
  strokeColor: '#171914',
  strokeOpacity: 0.85,
  // The user's latest export allows high-refresh reflections. This is a
  // ceiling, not a guaranteed rate, and does not cap the hand's motion.
  reflectionFps: 120,
  ambientIntensity: 0.25,
  keyIntensity: 1.2,
  lightX: -170,
  lightY: 270,
  lightZ: 950,
  lightColor: '#fff3db',
  exposure: 0.45,
  // Like Knobs, native colour fields illuminate the object through a dim
  // room bounce and page-plane lights. Pixel-scale inverse-square falloff
  // needs candela in the thousands; neither term changes the native page.
  roomBounce: 0.29,
  pageLightIntensity: 16000,
  shadowsEnabled: true,
  shadowIntensity: 0.8,
  shadowRadius: 10.5,
  // The final DPR 2 browser frame keeps the long index shadow smooth at
  // 2048. A larger map would quadruple this candidate's shadow storage.
  shadowMapSize: 2048,
  // All three backgrounds carry the 2026-08-31 user export — warped,
  // rippled waves; a low-horizon sea with a calm swell and heavy glitter,
  // glade, and flare; and a dense fast-morphing sixteen-mirror prism. The
  // gate's theme fps and diff clauses measure this look, and Reset all
  // restores it.
  wavesZoom: 2.4,
  wavesWarp: 1.65,
  wavesRipple: 0.15,
  wavesContrast: 1.55,
  wavesShift: -0.18,
  wavesSheen: 0.13,
  wavesGloss: 0.14,
  wavesVignette: 0.26,
  tideHorizon: 0.21,
  tideLift: 0.34,
  tideEclipseSize: 0.11,
  tideSwell: 0.8,
  tideGlow: 0.65,
  tideHueShift: -0.17,
  tideSurgeRate: 0.3,
  tideGlitter: 1.95,
  tideGlade: 1.06,
  tideFlare: 1.45,
  tideStarDensity: 0.56,
  prismSegments: 16,
  prismZoom: 3.5,
  prismDispersion: 0.05,
  prismCells: 8,
  prismEdge: 0.25,
  prismGlint: 0.65,
  prismCore: 0.3,
  prismSpin: 0.04,
  prismMorph: 3.75,
  prismPlates: 1.5,
  prismPlateTint: 2,
  prismDepth: 1.2,
  prismSpark: 0.59,
})

export type MarbleHandNumberKey = {
  [Key in keyof MarbleHandTuning]: MarbleHandTuning[Key] extends number ? Key : never
}[keyof MarbleHandTuning]

export interface MarbleHandControl {
  key: MarbleHandNumberKey
  label: string
  min: number
  max: number
  step: number
  unit?: string
  degrees?: boolean
}

export interface MarbleHandControlGroup {
  title: string
  description: string
  initiallyOpen?: boolean
  material?: MarbleHandFinish
  theme?: MarbleHandThemeId
  controls: readonly MarbleHandControl[]
}

// Snap before publishing, not only when displaying. A typed 3.25 on a
// 0.1-step field otherwise draws 3.3 while the light still uses 3.25.
export function normalizeMarbleHandInput(control: MarbleHandControl, value: number): number | null {
  if (!Number.isFinite(value)) return null
  const bounded = Math.min(control.max, Math.max(control.min, value))
  const steps = Math.round((bounded - control.min) / control.step)
  const decimals = control.step.toString().split('.')[1]?.length ?? 0
  const snapped = Number((control.min + steps * control.step).toFixed(decimals))
  return control.degrees ? snapped * Math.PI / 180 : snapped
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const MARBLE_HAND_FINISHES = new Set<MarbleHandFinish>(['marble', 'chrome'])
const MARBLE_HAND_COLOR_KEYS = ['stoneColor', 'veinColor', 'chromeTint', 'strokeColor', 'lightColor'] as const
const MARBLE_HAND_BOOLEAN_KEYS = [
  'motionEnabled', 'keepAbovePage', 'tapEnabled', 'pinchEnabled', 'strokeEnabled', 'shadowsEnabled',
] as const

// Turns a stored bag — shaped like MarbleHandTuning but not necessarily
// valid at runtime (an older build, a hand-edited localStorage entry) —
// into a complete, in-range tuning object. Restore clamps to a control's
// bounds but never snaps to its step: authored defaults sit off the step
// grid (maxTilt 0.12rad is 6.8755° on a 0.1° step), and the marble-hand
// gate requires an untouched field to survive a reload with its exact
// value (2026-09-01, restore-snapping drifted it to 6.9°). Step snapping
// belongs to typed input only (normalizeMarbleHandInput). Bounds are in
// display units, so a degrees field clamps in degrees, not radians.
export function normalizeMarbleHandTuning(raw: MarbleHandTuning): MarbleHandTuning {
  const next = { ...marbleHandTuning }
  for (const group of MARBLE_HAND_GROUPS) {
    for (const control of group.controls) {
      const stored = raw[control.key]
      if (!Number.isFinite(stored)) continue
      const display = control.degrees ? (stored * 180) / Math.PI : stored
      const bounded = Math.min(control.max, Math.max(control.min, display))
      // An in-range value keeps its stored bits: the deg→rad round trip
      // alone shifts a radian value by 1 ULP, which the gate's exact-
      // radians clause counts as a change.
      next[control.key] = bounded === display ? stored : control.degrees ? (bounded * Math.PI) / 180 : bounded
    }
  }
  for (const key of MARBLE_HAND_COLOR_KEYS) {
    if (HEX_COLOR.test(raw[key])) next[key] = raw[key].toLowerCase()
  }
  for (const key of MARBLE_HAND_BOOLEAN_KEYS) {
    if (raw[key] === true || raw[key] === false) next[key] = raw[key]
  }
  if (MARBLE_HAND_FINISHES.has(raw.materialMode)) next.materialMode = raw.materialMode
  return next
}

// Angle ranges are displayed in degrees; stored values stay in radians so
// the browser gate and frame loop keep one pose contract. These broad ranges
// are for exploration, with keepAbovePage providing the physical floor.
export const MARBLE_HAND_GROUPS: readonly MarbleHandControlGroup[] = [
  {
    title: 'Orientation',
    description: 'All three axes rotate around the fingertip.',
    initiallyOpen: true,
    controls: [
      { key: 'baseRotation', label: 'Direction · Z', min: 0, max: 360, step: 0.1, degrees: true },
      { key: 'sculptureRoll', label: 'Roll · X', min: -180, max: 180, step: 0.1, degrees: true },
      { key: 'sculpturePitch', label: 'Tilt · Y', min: -180, max: 180, step: 0.1, degrees: true },
    ],
  },
  {
    title: 'Size & height',
    description: 'Height is measured at the fingertip. Page clearance can raise it further.',
    controls: [
      { key: 'scale', label: 'Hand size', min: 0.25, max: 1.6, step: 0.01, unit: '×' },
      { key: 'mobileScale', label: 'Mobile size', min: 0.25, max: 1, step: 0.01, unit: '×' },
      { key: 'heightPx', label: 'Hover height', min: 4, max: 240, step: 1, unit: 'px' },
      { key: 'pressHeightPx', label: 'Press height', min: 4, max: 240, step: 1, unit: 'px' },
    ],
  },
  {
    title: 'Movement',
    description: 'Higher settle speed makes the hand stop rocking sooner.',
    controls: [
      { key: 'poseDamping', label: 'Settle speed', min: 2, max: 120, step: 0.5, unit: '/s' },
      { key: 'velocityTilt', label: 'Tilt sensitivity', min: 0, max: 0.08, step: 0.0001 },
      { key: 'maxTilt', label: 'Rock limit', min: 0, max: 180, step: 0.1, degrees: true },
      { key: 'maxSpin', label: 'Spin limit', min: 0, max: 180, step: 0.1, degrees: true },
      { key: 'pressPitch', label: 'Press tilt', min: -180, max: 180, step: 0.1, degrees: true },
    ],
  },
  {
    title: 'Idle tap',
    description: 'The three curled fingers drum while the pointer rests. The index fingertip never moves.',
    controls: [
      { key: 'tapIdleDelayMs', label: 'Wait before tapping', min: 200, max: 5000, step: 50, unit: 'ms' },
      { key: 'tapPeriodMs', label: 'Tap period', min: 200, max: 2000, step: 10, unit: 'ms' },
      { key: 'tapLiftRad', label: 'Tap depth', min: 0, max: 60, step: 0.5, degrees: true },
    ],
  },
  {
    title: 'Pinch',
    description: 'Thumb and index close together while text is selected.',
    controls: [
      { key: 'pinchIndexRad', label: 'Index reach', min: 0, max: 45, step: 0.5, degrees: true },
      { key: 'pinchThumbRad', label: 'Thumb reach', min: 0, max: 45, step: 0.5, degrees: true },
    ],
  },
  {
    title: 'Marble',
    material: 'marble',
    description: 'Shape the stone, its veins, and reflected light.',
    controls: [
      { key: 'roughness', label: 'Roughness', min: 0.02, max: 1, step: 0.01 },
      { key: 'clearcoat', label: 'Polish', min: 0, max: 1, step: 0.01 },
      { key: 'clearcoatRoughness', label: 'Polish softness', min: 0.02, max: 1, step: 0.01 },
      { key: 'envMapIntensity', label: 'Environment reflection', min: 0, max: 4, step: 0.05 },
      { key: 'specularIntensity', label: 'Highlight strength', min: 0, max: 1, step: 0.01 },
      { key: 'ior', label: 'Refractive index', min: 1, max: 2.5, step: 0.01 },
      { key: 'veinStrength', label: 'Vein strength', min: 0, max: 3, step: 0.05 },
      { key: 'veinScale', label: 'Vein frequency', min: 0.25, max: 4, step: 0.05, unit: '×' },
    ],
  },
  {
    title: 'Chrome',
    material: 'chrome',
    description: 'Pure mirrored metal, with no stone veins. Your marble settings are kept separately.',
    controls: [
      { key: 'chromeRoughness', label: 'Mirror roughness', min: 0, max: 1, step: 0.001 },
      { key: 'chromeReflectionIntensity', label: 'Mirror reflection', min: 0, max: 4, step: 0.05 },
    ],
  },
  {
    title: 'Stroke',
    description: 'Width is in screen pixels. It stays the same at any distance from the camera.',
    controls: [
      { key: 'strokeWidthPx', label: 'Stroke width', min: 0, max: 12, step: 0.25, unit: 'px' },
      { key: 'strokeOpacity', label: 'Stroke opacity', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Reflections',
    description: 'This is an upper limit. Unchanged reflections do not update. Hand movement stays smooth and uses its own frame rate.',
    controls: [
      { key: 'reflectionFps', label: 'Reflection frame rate', min: 1, max: 120, step: 1, unit: 'fps' },
    ],
  },
  {
    title: 'Lighting',
    description: 'Page colors light the hand. The key light shapes its shadow; the HTML stays unchanged.',
    controls: [
      { key: 'keyIntensity', label: 'Key light', min: 0, max: 8, step: 0.1 },
      { key: 'ambientIntensity', label: 'Fill light', min: 0, max: 3, step: 0.05 },
      { key: 'pageLightIntensity', label: 'Page light', min: 0, max: 60000, step: 1000 },
      { key: 'roomBounce', label: 'Room bounce', min: 0, max: 1, step: 0.01 },
      { key: 'lightX', label: 'Light horizontal', min: -1000, max: 1000, step: 10, unit: 'px' },
      { key: 'lightY', label: 'Light vertical', min: -1000, max: 1000, step: 10, unit: 'px' },
      { key: 'lightZ', label: 'Light height', min: 100, max: 1500, step: 10, unit: 'px' },
      { key: 'exposure', label: 'Exposure', min: 0.25, max: 2.5, step: 0.01 },
    ],
  },
  {
    title: 'Waves background',
    theme: 'waves',
    description: 'The silk field behind the poster. Zoom and warp reshape the folds; contrast and shift move the palette.',
    controls: [
      { key: 'wavesZoom', label: 'Pattern zoom', min: 0.8, max: 6, step: 0.1, unit: '×' },
      { key: 'wavesWarp', label: 'Warp depth', min: 0, max: 2, step: 0.05, unit: '×' },
      { key: 'wavesRipple', label: 'Fine ripple', min: 0, max: 0.15, step: 0.005 },
      { key: 'wavesContrast', label: 'Palette contrast', min: 0.5, max: 2.5, step: 0.05 },
      { key: 'wavesShift', label: 'Palette shift', min: -0.5, max: 0.5, step: 0.01 },
      { key: 'wavesSheen', label: 'Fold sheen', min: 0, max: 1, step: 0.01 },
      { key: 'wavesGloss', label: 'Traveling gloss', min: 0, max: 0.4, step: 0.01 },
      { key: 'wavesVignette', label: 'Vignette', min: 0, max: 0.5, step: 0.01 },
    ],
  },
  {
    title: 'Tide background',
    theme: 'tide',
    description: 'The luminous sea and its eclipse. A speed change jumps the phase once, then runs smoothly.',
    controls: [
      { key: 'tideHorizon', label: 'Horizon height', min: 0.05, max: 0.6, step: 0.01 },
      { key: 'tideLift', label: 'Eclipse height', min: 0.05, max: 0.6, step: 0.01 },
      { key: 'tideEclipseSize', label: 'Eclipse size', min: 0.06, max: 0.2, step: 0.002 },
      { key: 'tideSwell', label: 'Swell', min: 0, max: 2.5, step: 0.05, unit: '×' },
      { key: 'tideGlow', label: 'Filament glow', min: 0, max: 2, step: 0.05, unit: '×' },
      { key: 'tideHueShift', label: 'Glow hue', min: -0.5, max: 0.5, step: 0.01 },
      { key: 'tideSurgeRate', label: 'Surge speed', min: 0, max: 0.3, step: 0.005, unit: '/s' },
      { key: 'tideGlitter', label: 'Glitter', min: 0, max: 3, step: 0.05, unit: '×' },
      { key: 'tideGlade', label: 'Light path', min: 0, max: 1.5, step: 0.02 },
      { key: 'tideFlare', label: 'Lens flare', min: 0, max: 2, step: 0.05, unit: '×' },
      { key: 'tideStarDensity', label: 'Star density', min: 0, max: 1, step: 0.02 },
    ],
  },
  {
    title: 'Prism background',
    theme: 'prism',
    description: 'The kaleidoscope. Changing segments pops a mirror line into place; every other control moves smoothly.',
    controls: [
      { key: 'prismSegments', label: 'Mirror segments', min: 3, max: 16, step: 1 },
      { key: 'prismZoom', label: 'Glass zoom', min: 1, max: 5, step: 0.1, unit: '×' },
      { key: 'prismDispersion', label: 'Dispersion', min: 0, max: 0.05, step: 0.001 },
      { key: 'prismCells', label: 'Cell scale', min: 1, max: 8, step: 0.1, unit: '×' },
      { key: 'prismEdge', label: 'Edge glow', min: 0, max: 1.5, step: 0.05 },
      { key: 'prismGlint', label: 'Caustic glint', min: 0, max: 1, step: 0.05 },
      { key: 'prismCore', label: 'Core glow', min: 0, max: 1, step: 0.05 },
      { key: 'prismSpin', label: 'Spin speed', min: 0, max: 0.2, step: 0.005, unit: '/s' },
      { key: 'prismMorph', label: 'Morph speed', min: 0, max: 4, step: 0.05, unit: '×' },
      { key: 'prismPlates', label: 'Plate scale', min: 0.2, max: 1.5, step: 0.05, unit: '×' },
      { key: 'prismPlateTint', label: 'Plate tint', min: 0, max: 2, step: 0.05 },
      { key: 'prismDepth', label: 'Depth layer', min: 0, max: 2, step: 0.05 },
      { key: 'prismSpark', label: 'Sparkle', min: 0, max: 0.6, step: 0.01 },
    ],
  },
  {
    title: 'Shadows',
    description: 'Set the shadow weight, edge, and render quality.',
    controls: [
      { key: 'shadowIntensity', label: 'Shadow strength', min: 0, max: 1, step: 0.05 },
      { key: 'shadowRadius', label: 'Edge softness', min: 0, max: 12, step: 0.5 },
    ],
  },
]

export const MARBLE_HAND_ORIENTATIONS = [
  { id: 'classic', label: 'Classic', baseRotation: Math.PI * 0.75, sculptureRoll: 2.7, sculpturePitch: 0.45 },
  { id: 'palm', label: 'Palm', baseRotation: Math.PI * 0.75, sculptureRoll: -1.4, sculpturePitch: 0.25 },
  { id: 'profile', label: 'Profile', baseRotation: Math.PI * 0.75, sculptureRoll: 2.15, sculpturePitch: 0.55 },
  { id: 'upright', label: 'Upright', baseRotation: Math.PI / 2, sculptureRoll: 2.7, sculpturePitch: 0.45 },
] as const
