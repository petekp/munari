// Material finishes tuning — five physical finishes as plain preset objects,
// the studio light rigs they are judged under, and the live copies the
// tweak panel edits.
//
// A finish is the shape a future `finishes` table would take. Most fields
// map one-to-one to a MeshPhysicalNodeMaterial property; `color` is the
// body the capture is printed on (lit text) or laid over (unlit text), and
// the edge and detail fields shape the body's normal. The live copies mutate
// in place and listeners invalidate the canvas, so a slider reaches the
// material with no React render (the polymer prototype's pattern).

export type FinishId = 'lacquer' | 'satin-polymer' | 'anodized-aluminum' | 'velvet' | 'glazed-ceramic'

/** Whether the capture is lit with the body or composited over it unlit. */
export type TextLighting = 'lit' | 'unlit'

/**
 * The relief a finish carries below the edge. Each kind compiles its own
 * noise, so changing kind rebuilds the material.
 * - `orange-peel`: coat ripples of a sprayed lacquer.
 * - `brushed`: grooves along x from a brushed sheet.
 * - `pile`: velvet pile laid in patches, plus fiber grain.
 * - `glaze`: the slow waviness of a fired glaze.
 */
export type SurfaceDetail = 'none' | 'orange-peel' | 'brushed' | 'pile' | 'glaze'

export interface Finish {
  /** Body color, sRGB hex. */
  color: string
  roughness: number
  metalness: number
  ior: number
  /** Weight of the base layer's dielectric reflection (three's `specularIntensity`). */
  specularIntensity: number
  clearcoat: number
  clearcoatRoughness: number
  sheen: number
  /** sRGB hex. */
  sheenColor: string
  sheenRoughness: number
  anisotropy: number
  /** Radians, in the surface's UV frame. */
  anisotropyRotation: number
  iridescence: number
  iridescenceIOR: number
  /** Film thickness in nm. */
  iridescenceThickness: number
  /** Width of the rounded edge, CSS px. 0 leaves the card flat to its rim. */
  edgeWidth: number
  detail: SurfaceDetail
  /** Feature size of the detail, CSS px. */
  detailScale: number
  /** Steepest slope the detail adds to the normal. */
  detailDepth: number
  /** Body color at the rim, sRGB hex, where a glaze runs thin over the edge; null keeps `color`. */
  rimColor: string | null
  /** How far a crackle network darkens the body, 0 to 1; 0 compiles none. */
  crackle: number
  /** Cell size of the crackle network, CSS px. */
  crackleScale: number
}

const NO_LOBES = {
  metalness: 0,
  specularIntensity: 1,
  clearcoat: 0,
  clearcoatRoughness: 0,
  sheen: 0,
  sheenColor: '#000000',
  sheenRoughness: 1,
  anisotropy: 0,
  anisotropyRotation: 0,
  iridescence: 0,
  // KHR_materials_iridescence defaults: IOR 1.3, thickness 100–400 nm
  // (docs/materials-research-catalog.md §1 sources).
  iridescenceIOR: 1.3,
  iridescenceThickness: 400,
  detail: 'none',
  detailScale: 1,
  detailDepth: 0,
  rimColor: null,
  crackle: 0,
  crackleScale: 40,
} as const

// Lobe values follow the MaterialX example presets (Apache-2.0) at
// github.com/AcademySoftwareFoundation/MaterialX, resources/Materials/
// Examples: OpenPbr/open_pbr_carpaint, open_pbr_aluminum_brushed,
// open_pbr_velvet and StandardSurface/standard_surface_plastic,
// standard_surface_velvet, standard_surface_metal_brushed. Body colors,
// edge widths and detail values are by eye, unmeasured.
//
// OpenPBR reads a coated base's specular IOR relative to the coat, so a
// base whose IOR matches its coat reflects nothing at that interface. three
// does not divide the IORs, and the base's own 4% lobe at the base
// roughness drew the broad wash under lacquer's and the glaze's coat
// highlights. Coated finishes set `specularIntensity` 0 instead.
const FINISHES: Readonly<Record<FinishId, Readonly<Finish>>> = Object.freeze({
  // open_pbr_carpaint: coat 1 at roughness 0.02 over a base whose IOR equals
  // the coat's. Orange peel within the catalog's 0–0.05 coat-normal range.
  lacquer: Object.freeze({
    ...NO_LOBES,
    color: '#8c1022',
    roughness: 0.3,
    ior: 1.5,
    specularIntensity: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    edgeWidth: 6,
    detail: 'orange-peel',
    detailScale: 18,
    detailDepth: 0.004,
  }),
  // standard_surface_plastic: one dielectric lobe at roughness 0.32, no
  // coat and no sheen. "Satin" is the gloss level of a molded part; the
  // fabric sheen lobe the first build gave it has no counterpart in plastic.
  // IOR 1.49 is polypropylene and PMMA on physicallybased.info. A dark
  // body lets the soft highlight stand out.
  'satin-polymer': Object.freeze({
    ...NO_LOBES,
    color: '#3a3d42',
    roughness: 0.36,
    ior: 1.49,
    edgeWidth: 12,
  }),
  // open_pbr_aluminum_brushed: roughness 0.2, anisotropy 0.9;
  // standard_surface_metal_brushed: roughness 0.25, anisotropy 0.65. The body
  // is a blue dyed anodize, by eye.
  // The grooves run along x, which spreads the highlight across them, along
  // y: rotation π/2 turns three's stretched axis from u to v.
  'anodized-aluminum': Object.freeze({
    ...NO_LOBES,
    color: '#7da2d4',
    roughness: 0.26,
    metalness: 1,
    ior: 1.5,
    anisotropy: 0.65,
    anisotropyRotation: Math.PI / 2,
    edgeWidth: 3,
    detail: 'brushed',
    detailScale: 1.2,
    detailDepth: 0.06,
  }),
  // standard_surface_velvet: base specular 0, sheen 1, with a sheen color
  // far brighter and more saturated than the body (body 0.023/0/0.038
  // linear under sheen 0.404/0.058/1); same ratio here in plum.
  // Sheen roughness 0.7, above open_pbr_velvet's fuzz roughness 0.5 and
  // Standard Surface's 0.3: the rougher lobe reaches nearer the view axis,
  // so a card seen face on glows softly across its padded edge instead of
  // a hard bright line at its last pixels, which read as foil. The wide edge
  // is cloth wrapped over a padded panel.
  velvet: Object.freeze({
    ...NO_LOBES,
    color: '#3b1a3f',
    roughness: 0.9,
    ior: 1.5,
    specularIntensity: 0,
    sheen: 1,
    sheenColor: '#aa59bc',
    sheenRoughness: 0.7,
    edgeWidth: 64,
    detail: 'pile',
    detailScale: 40,
    detailDepth: 0.2,
  }),
  // A glass glaze on a ceramic body, which physicallybased.info lists as
  // porcelain: roughness 0, IOR 1.5. Coat roughness 0.02 matches lacquer's,
  // so the softbox's image keeps a sharp edge. Glaze and body match in IOR, so the
  // base reflects nothing; the glaze is the coat. A celadon green that runs
  // thin and pale over the rounded edge, with a sparse, faint crackle.
  'glazed-ceramic': Object.freeze({
    ...NO_LOBES,
    color: '#8db59a',
    roughness: 0.5,
    ior: 1.52,
    specularIntensity: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    edgeWidth: 12,
    detail: 'glaze',
    detailScale: 120,
    detailDepth: 0.035,
    rimColor: '#e6eee2',
    crackle: 0.2,
    crackleScale: 90,
  }),
})

export const FINISH_ORDER: readonly { readonly id: FinishId; readonly label: string }[] = [
  { id: 'lacquer', label: 'Lacquer' },
  { id: 'satin-polymer', label: 'Satin polymer' },
  { id: 'anodized-aluminum', label: 'Anodized aluminum' },
  { id: 'velvet', label: 'Velvet' },
  { id: 'glazed-ceramic', label: 'Glazed ceramic' },
]

export function isFinishId(value: string | null): value is FinishId {
  return FINISH_ORDER.some((item) => item.id === value)
}

// ── looks ──────────────────────────────────────────────────────────────

/**
 * What a finish reflects besides the lights.
 * - `even`: one tone across the whole mirror cone.
 * - `gradient`: a fill behind the viewer that brightens toward the top,
 *   so a gloss shows a sky-to-floor falloff across each card.
 */
export type EnvironmentKind = 'even' | 'gradient'

/** One way to show a finish: its values and the studio it is judged in. */
export interface FinishLook {
  readonly id: string
  readonly label: string
  /** What the look is after, in one sentence. */
  readonly intent: string
  readonly finish: Readonly<Finish>
  /** Studio values this look sets over its rig's start. */
  readonly studio?: Readonly<Partial<StudioTuning>>
  readonly environment: EnvironmentKind
}

// Four finishes are settled and have one look each. Velvet has several to
// choose between, built on its values above. Lobe values stay
// inside the MaterialX presets' ranges; colors, relief and studio changes
// are by eye, checked by blind readers on m2 captures.
//
// Velvet's sheen is Charlie sheen, which three evaluates for point and
// directional lights and the environment but not for the softbox
// (directRectArea at r186). Its environment term is the lobe's albedo,
// which at sheen roughness 0.7 is about 7% face on and 55% at grazing
// (IBLSheenBRDF at r186), so a card lit by the environment glows along its
// rounded edge and stays dark on its face. The velvet looks raise the
// environment to 3 or more and give the sheen a color far lighter than the
// body. On m2 (2026-11-26) that took the edge's median from sRGB 33 to 93
// to 154 and the face's from 22 to 46 to 96.
// The pile relief is what reads as cloth: with no relief blind readers
// called the cards frosted glass, and with a grain 2 to 6 px across, leather.
export const FINISH_LOOKS: Readonly<Record<FinishId, readonly FinishLook[]>> = Object.freeze({
  lacquer: [
    {
      id: 'sky',
      label: 'Crimson under a sky',
      intent: 'A crimson coat that reflects a fill brightening toward the top, so each card shows the falloff of a glossy panel.',
      finish: FINISHES.lacquer,
      environment: 'gradient',
    },
  ],
  'satin-polymer': [
    {
      id: 'charcoal',
      label: 'Charcoal housing',
      intent: 'A dark gray molded part, where the soft satin highlight stands out against the body.',
      finish: FINISHES['satin-polymer'],
      environment: 'even',
    },
  ],
  'anodized-aluminum': [
    {
      id: 'blue-anodize',
      label: 'Blue anodize',
      intent: 'A dyed anodize, the colored brushed metal of a carabiner or a laptop lid.',
      finish: FINISHES['anodized-aluminum'],
      environment: 'even',
    },
  ],
  velvet: [
    {
      id: 'emerald',
      label: 'Emerald cushion',
      intent: 'Deep green pile over a padded edge, lit by a bright fill, so a wide pale-mint glow rings each card.',
      finish: Object.freeze({ ...FINISHES.velvet, color: '#0c3b2c', sheenColor: '#8fe0b8', edgeWidth: 90, detailScale: 24, detailDepth: 0.08 }),
      studio: Object.freeze({ environmentIntensity: 3, rimPower: 3 }),
      environment: 'even',
    },
    {
      id: 'midnight',
      label: 'Midnight rim',
      intent: 'Navy pile with a tighter sheen lobe and a narrow edge, so a bright periwinkle line traces each rim.',
      finish: Object.freeze({ ...FINISHES.velvet, color: '#141a3a', sheenColor: '#b8c4ff', sheenRoughness: 0.5, edgeWidth: 48, detailScale: 24, detailDepth: 0.08 }),
      studio: Object.freeze({ environmentIntensity: 3.5, rimPower: 3 }),
      environment: 'even',
    },
    {
      id: 'plum-sky',
      label: 'Plum under a sky',
      intent: 'Plum pile over a wide padded edge in a fill that brightens toward the top, so the top edges glow brightest.',
      finish: Object.freeze({ ...FINISHES.velvet, sheenColor: '#e2a6f0', edgeWidth: 110, detailScale: 24, detailDepth: 0.08 }),
      studio: Object.freeze({ environmentIntensity: 3, rimPower: 3, rimElevation: 8 }),
      environment: 'gradient',
    },
  ],
  'glazed-ceramic': [
    {
      id: 'celadon',
      label: 'Celadon',
      intent: 'A green glaze that runs thin and pale over the rounded edge and carries a sparse, faint crackle, as old celadon does.',
      finish: FINISHES['glazed-ceramic'],
      environment: 'gradient',
    },
  ],
})

/** Whether a finish has more than one look to choose between. */
export function hasLookChoice(finish: FinishId): boolean {
  return FINISH_LOOKS[finish].length > 1
}

export function lookOf(finish: FinishId, id: string | null): FinishLook {
  const looks = FINISH_LOOKS[finish]
  const found = looks.find((look) => look.id === id)
  if (found) return found
  const first = looks[0]
  if (!first) throw new Error(`The ${finish} finish has no looks`)
  return first
}

export const liveFinish: Finish = { ...FINISHES.lacquer }

/** Load a look's finish values into the live copy. */
export function applyLook(look: FinishLook): void {
  Object.assign(liveFinish, look.finish)
  notifyFinishTuning()
}

// ── studio ─────────────────────────────────────────────────────────────

/**
 * How the cards are lit.
 * - `room`: three's RoomEnvironment and one point light, the first build.
 * - `softbox`: a built studio environment, a rectangular softbox key and a
 *   grazing rim light.
 * - `studio-point`: the same studio and rim with the point light as key.
 */
export type LightRig = 'room' | 'softbox' | 'studio-point'

export const LIGHT_RIGS: readonly { readonly id: LightRig; readonly label: string }[] = [
  { id: 'softbox', label: 'Softbox' },
  { id: 'studio-point', label: 'Studio point' },
  { id: 'room', label: 'Room' },
]

export function isLightRig(value: string | null): value is LightRig {
  return LIGHT_RIGS.some((item) => item.id === value)
}

/** Whether each card tilts toward the pointer. */
export type CardTilt = 'none' | 'pointer'

/** The studio light and environment, in viewport CSS terms. */
export interface StudioTuning {
  /** Key light position as fractions of the viewport. */
  lightX: number
  lightY: number
  /** Key light height above the card plane, CSS px. */
  lightHeight: number
  /** Irradiance straight under the key, before N·L. */
  lightPower: number
  /** Softbox size, CSS px. */
  softboxWidth: number
  softboxHeight: number
  /** Irradiance of the rim light on a plane facing it. */
  rimPower: number
  /** Rim light elevation above the card plane, degrees. */
  rimElevation: number
  environmentIntensity: number
}

// A coat's highlight lands between the key and the camera's axis: at
// height 480, about halfway (measured on m2: the key at y 618 CSS px put
// lacquer's bar at 536, with the axis at 450). The studio rigs start the key
// below the form card's centre, so the bar lies in the text-free band
// between "Not saved" and Save, and the light handle sits below the card.
// The previous start, over the gap between the product and form cards, laid
// the bar over the form card's label; the room rig keeps that start as the
// previous behavior. The softbox is wide and short to fit that band: 200 px
// wide left a small isolated spot, and 560 px ran the bar over "Not saved".
// Powers are set so satin polymer, the brightest body, keeps its body at or
// under the tone curve's shoulder and only its highlight rolls off (probe on
// m2, 2026-11-25: face median sRGB 226 on the form card, at the shoulder,
// and 199 to 200 on the outer cards).
const STUDIO_START: Readonly<Record<LightRig, Readonly<StudioTuning>>> = Object.freeze({
  room: Object.freeze({
    lightX: 0.382,
    lightY: 0.48,
    lightHeight: 320,
    lightPower: 2.4,
    softboxWidth: 0,
    softboxHeight: 0,
    rimPower: 0,
    rimElevation: 15,
    environmentIntensity: 0.65,
  }),
  softbox: Object.freeze({
    lightX: 0.517,
    lightY: 0.687,
    lightHeight: 480,
    lightPower: 1.55,
    softboxWidth: 290,
    softboxHeight: 80,
    rimPower: 1.2,
    rimElevation: 15,
    environmentIntensity: 1.35,
  }),
  'studio-point': Object.freeze({
    lightX: 0.517,
    lightY: 0.687,
    lightHeight: 480,
    lightPower: 1.55,
    softboxWidth: 0,
    softboxHeight: 0,
    rimPower: 1.2,
    rimElevation: 15,
    environmentIntensity: 1.35,
  }),
})

export const studio: StudioTuning = { ...STUDIO_START.softbox }

/** Start the studio at a rig's values and a look's, key position included. Does not notify. */
export function startStudio(rig: LightRig, look: FinishLook): void {
  Object.assign(studio, STUDIO_START[rig], look.studio)
}

/** Restart the studio at a rig's values and a look's, keeping the key where it was dragged. */
export function applyStudio(rig: LightRig, look: FinishLook): void {
  const { lightX, lightY } = studio
  Object.assign(studio, STUDIO_START[rig], look.studio, { lightX, lightY })
  notifyFinishTuning()
}

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribeFinishTuning(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyFinishTuning(): void {
  for (const listener of listeners) listener()
}
