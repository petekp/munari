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
export const FINISHES: Readonly<Record<FinishId, Readonly<Finish>>> = Object.freeze({
  // open_pbr_carpaint: coat 1 at roughness 0.02 over a base whose IOR equals
  // the coat's. Orange peel within the catalog's 0–0.05 coat-normal range.
  lacquer: Object.freeze({
    ...NO_LOBES,
    color: '#6b1522',
    roughness: 0.3,
    ior: 1.5,
    specularIntensity: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    edgeWidth: 6,
    detail: 'orange-peel',
    detailScale: 18,
    detailDepth: 0.006,
  }),
  // standard_surface_plastic: one dielectric lobe at roughness 0.32, no
  // coat and no sheen. "Satin" is the gloss level of a molded part; the
  // fabric sheen lobe the first build gave it has no counterpart in plastic.
  // IOR 1.49 is polypropylene and PMMA on physicallybased.info.
  'satin-polymer': Object.freeze({
    ...NO_LOBES,
    color: '#e7e4dc',
    roughness: 0.34,
    ior: 1.49,
    edgeWidth: 10,
  }),
  // open_pbr_aluminum_brushed: roughness 0.2, anisotropy 0.9;
  // standard_surface_metal_brushed: roughness 0.25, anisotropy 0.65. Body
  // between their base colors (0.912 and 0.5 linear) for a clear anodize.
  // The grooves run along x, which spreads the highlight across them, along
  // y: rotation π/2 turns three's stretched axis from u to v.
  'anodized-aluminum': Object.freeze({
    ...NO_LOBES,
    color: '#c9ccd0',
    roughness: 0.24,
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
  // porcelain: roughness 0, IOR 1.5. Glaze and body match in IOR, so the
  // base reflects nothing; the glaze is the coat.
  'glazed-ceramic': Object.freeze({
    ...NO_LOBES,
    color: '#bcdac3',
    roughness: 0.5,
    ior: 1.52,
    specularIntensity: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    edgeWidth: 8,
    detail: 'glaze',
    detailScale: 160,
    detailDepth: 0.012,
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

export const liveFinish: Finish = { ...FINISHES.lacquer }

export function applyFinish(id: FinishId): void {
  Object.assign(liveFinish, FINISHES[id])
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

// Every rig starts its key over the 40 px gap between the product and form
// cards at their mid-height. The softbox is a tall strip: its image on a
// coat is a narrow bar, where a broad box laid a pale block over the form
// card's input (2026-11-25 shots). A coat's highlight lands between the light and
// the camera's axis, so this puts lacquer's highlight on the form card's
// left side without the light handle covering the card's text. Powers are
// set so satin polymer, the brightest body, keeps its body under the tone
// curve's shoulder and only its highlight rolls off (probe on m2,
// 2026-11-25: face median sRGB 219 against the shoulder's 226).
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
    lightX: 0.382,
    lightY: 0.48,
    lightHeight: 320,
    lightPower: 1.55,
    softboxWidth: 60,
    softboxHeight: 240,
    rimPower: 1.2,
    rimElevation: 15,
    environmentIntensity: 1.2,
  }),
  'studio-point': Object.freeze({
    lightX: 0.382,
    lightY: 0.48,
    lightHeight: 320,
    lightPower: 1.55,
    softboxWidth: 0,
    softboxHeight: 0,
    rimPower: 1.2,
    rimElevation: 15,
    environmentIntensity: 1.2,
  }),
})

export const studio: StudioTuning = { ...STUDIO_START.softbox }

/** Restart the studio at a rig's values, keeping the key where it was dragged. */
export function applyRig(rig: LightRig): void {
  const { lightX, lightY } = studio
  Object.assign(studio, STUDIO_START[rig], { lightX, lightY })
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
