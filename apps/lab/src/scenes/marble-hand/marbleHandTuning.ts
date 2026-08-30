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
}

// A fresh scene copies these defaults. The panel never mutates them, so
// Reset all restores the tested pose instead of a previously edited bag.
export const marbleHandTuning: Readonly<MarbleHandTuning> = Object.freeze({
  materialMode: 'marble',
  // The 2026-08-30 user export makes the 215-unit fragment about 148px
  // at the page plane. Keep the selected values exact for Reset all.
  scale: 0.69,
  mobileScale: 0.76,
  // A 40px press closes the tip shadow. The exported pose leaves at least
  // 15.94px above the page across the motion/press sweep (2026-08-30).
  heightPx: 92,
  pressHeightPx: 52,
  pressPitch: -0.2565634000431664,
  // One ordinary 30px pointer step produces 0.054rad of tilt, below the
  // 0.12rad clamp where the curled fingers stay above the page on press.
  velocityTilt: 0.0018,
  maxTilt: 0.12,
  maxSpin: 0.07,
  // 12/s settles 98% in about 330ms: weight after the hand stops, without
  // making the cursor look detached from its own input.
  poseDamping: 12,
  // Local +X points from wrist to tip. The user's 151.9-degree direction
  // retains the index upper-left and wrist down-right cursor relation.
  baseRotation: 2.651155133779387,
  // The user-selected roll and tilt remain in radians here; the panel
  // displays degrees without rounding these stored values on focus.
  sculptureRoll: 1.8081611050661253,
  sculpturePitch: 0.6387905062299246,
  motionEnabled: true,
  keepAbovePage: true,
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
  // Bare polished metal needs its own finish: reusing the saved stone's
  // broad clearcoat would obscure the mirror. These values never overwrite
  // the user's marble settings when the material mode changes.
  chromeRoughness: 0.008,
  chromeReflectionIntensity: 1.65,
  chromeTint: '#eef2f7',
  // Preserve the 2026-08-30 full-page reflection cadence as the default.
  // This limit does not change the hand's own animation frame rate.
  reflectionFps: 20,
  ambientIntensity: 0,
  keyIntensity: 0.8,
  lightX: -280,
  lightY: 280,
  lightZ: 430,
  lightColor: '#fff3db',
  exposure: 0.8,
  // Like Knobs, native colour fields illuminate the object through a dim
  // room bounce and page-plane lights. Pixel-scale inverse-square falloff
  // needs candela in the thousands; neither term changes the native page.
  roomBounce: 0.35,
  pageLightIntensity: 16000,
  shadowsEnabled: true,
  shadowIntensity: 1,
  shadowRadius: 1,
  // The final DPR 2 browser frame keeps the long index shadow smooth at
  // 2048. A larger map would quadruple this candidate's shadow storage.
  shadowMapSize: 2048,
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
      { key: 'poseDamping', label: 'Settle speed', min: 2, max: 30, step: 0.5, unit: '/s' },
      { key: 'velocityTilt', label: 'Tilt sensitivity', min: 0, max: 0.008, step: 0.0001 },
      { key: 'maxTilt', label: 'Rock limit', min: 0, max: 30, step: 0.1, degrees: true },
      { key: 'maxSpin', label: 'Spin limit', min: 0, max: 20, step: 0.1, degrees: true },
      { key: 'pressPitch', label: 'Press tilt', min: -35, max: 35, step: 0.1, degrees: true },
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
      { key: 'chromeRoughness', label: 'Mirror roughness', min: 0, max: 0.2, step: 0.001 },
      { key: 'chromeReflectionIntensity', label: 'Mirror reflection', min: 0, max: 4, step: 0.05 },
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
