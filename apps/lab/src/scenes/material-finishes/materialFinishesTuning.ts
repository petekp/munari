// Material finishes tuning — nine physical finishes as plain preset objects,
// the studio light rigs they are judged under, and the live copies the
// tweak panel edits.
//
// A finish is the shape a future `finishes` table would take. Most fields
// map one-to-one to a MeshPhysicalNodeMaterial property; `color` is the
// body the capture is printed on (lit text) or laid over (unlit text), and
// the edge and detail fields shape the body's normal. The live copies mutate
// in place and listeners invalidate the canvas, so a slider reaches the
// material with no React render (the polymer prototype's pattern).

import { NO_LOBES, type Finish, type FinishId } from './materialFinishesFinish'
import { FINISH_LOOKS, FOIL_HOLOGRAPHIC, PAPER_OFFICE, RUBBER_BLACK, WAX_CANDLE, type FinishLook } from './materialFinishesLooks'

export type { Finish, FinishId, SurfaceDetail, TextLighting } from './materialFinishesFinish'
export type { FinishLook } from './materialFinishesLooks'

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
  // far brighter than the body (body 0.023/0/0.038 linear under sheen
  // 0.404/0.058/1); here a navy body under a periwinkle sheen. Sheen
  // roughness 0.5 is open_pbr_velvet's fuzz roughness, a lobe tight enough
  // that the glow gathers into a bright line along the rim facing the key.
  // The relief is the pile; the edge is cloth over a thin padded panel.
  velvet: Object.freeze({
    ...NO_LOBES,
    color: '#141a3a',
    roughness: 0.9,
    ior: 1.5,
    specularIntensity: 0,
    sheen: 1,
    sheenColor: '#b8c4ff',
    sheenRoughness: 0.5,
    edgeWidth: 48,
    detail: 'pile',
    detailScale: 24,
    detailDepth: 0.08,
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
  'thin-film-foil': FOIL_HOLOGRAPHIC,
  paper: PAPER_OFFICE,
  'soft-touch-rubber': RUBBER_BLACK,
  'translucent-wax': WAX_CANDLE,
})

export const FINISH_ORDER: readonly { readonly id: FinishId; readonly label: string }[] = [
  { id: 'lacquer', label: 'Lacquer' },
  { id: 'satin-polymer', label: 'Satin polymer' },
  { id: 'anodized-aluminum', label: 'Anodized aluminum' },
  { id: 'velvet', label: 'Velvet' },
  { id: 'glazed-ceramic', label: 'Glazed ceramic' },
  { id: 'thin-film-foil', label: 'Thin-film foil' },
  { id: 'paper', label: 'Paper' },
  { id: 'soft-touch-rubber', label: 'Soft-touch rubber' },
  { id: 'translucent-wax', label: 'Translucent wax' },
]

export function isFinishId(value: string | null): value is FinishId {
  return FINISH_ORDER.some((item) => item.id === value)
}

// ── studio per finish ──────────────────────────────────────────────────

/**
 * What a finish reflects besides the lights.
 * - `even`: one tone across the whole mirror cone.
 * - `gradient`: a fill behind the viewer that brightens toward the top,
 *   so a gloss shows a sky-to-floor falloff across each card.
 */
export type EnvironmentKind = 'even' | 'gradient'

/** The studio a finish is judged in. */
export interface FinishStudio {
  /** Studio values set over the rig's start. */
  readonly studio?: Readonly<Partial<StudioTuning>>
  readonly environment: EnvironmentKind
}

// The coated finishes, lacquer and the glaze, reflect the gradient fill, so
// each card shows the top-to-bottom falloff of a glossy panel.
//
// Velvet's sheen is Charlie sheen, which three evaluates for point and
// directional lights and the environment but not for the softbox
// (directRectArea at r186); the material adds the key's sheen itself
// (keySheen in materialFinishesNodes). The lobe is strongest where light
// and view both graze, so the glow sits on the rounded edge facing the key
// and moves with it. Velvet puts most of its light in the key, which can be
// dragged, and little in the fixed environment. On m2 (2026-11-26) dragging
// the key from the page's lower middle to its upper left or right changed
// velvet's card pixels by a mean of sRGB 16 to 19, against 1.4 with the
// environment-lit sheen and 19 to 21 on lacquer. An environment of 2 to 3
// brought back more of the environment-lit look and cut that change to 13 to 18.
// The pile relief is what reads as cloth: with no relief blind readers
// called the cards frosted glass, and with a grain 2 to 6 px across, leather.
export const FINISH_STUDIOS: Readonly<Record<FinishId, FinishStudio>> = Object.freeze({
  lacquer: { environment: 'gradient' },
  'satin-polymer': { environment: 'even' },
  'anodized-aluminum': { environment: 'even' },
  velvet: { studio: Object.freeze({ environmentIntensity: 1.4, lightPower: 5, rimPower: 1.5 }), environment: 'even' },
  'glazed-ceramic': { environment: 'gradient' },
  'thin-film-foil': { environment: 'even' },
  paper: { environment: 'even' },
  'soft-touch-rubber': { environment: 'even' },
  'translucent-wax': { environment: 'even' },
})

/** The looks of a finish; a settled finish has one, its tuned values. */
export function looksOf(finish: FinishId): readonly FinishLook[] {
  return FINISH_LOOKS[finish] ?? [{ id: 'tuned', label: 'Tuned', intent: '', finish: FINISHES[finish], studio: FINISH_STUDIOS[finish] }]
}

/** Whether a finish has more than one look to choose between. */
export function hasLookChoice(finish: FinishId): boolean {
  return looksOf(finish).length > 1
}

/** A finish's look by id, or its first look. */
export function lookOf(finish: FinishId, id: string | null | undefined): FinishLook {
  const looks = looksOf(finish)
  const found = looks.find((look) => look.id === id) ?? looks[0]
  if (!found) throw new Error(`The ${finish} finish has no looks`)
  return found
}

export const liveFinish: Finish = { ...FINISHES.lacquer }

/** Load a finish's tuned values, or one of its looks', into the live copy. */
export function applyFinish(finish: FinishId, look?: string | null): void {
  Object.assign(liveFinish, lookOf(finish, look).finish)
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

/** Start the studio at a rig's values and a finish's or look's, key position included. Does not notify. */
export function startStudio(rig: LightRig, finish: FinishId, look?: string | null): void {
  Object.assign(studio, STUDIO_START[rig], lookOf(finish, look).studio.studio)
}

/** Restart the studio at a rig's values and a finish's or look's, keeping the key where it was dragged. */
export function applyStudio(rig: LightRig, finish: FinishId, look?: string | null): void {
  const { lightX, lightY } = studio
  Object.assign(studio, STUDIO_START[rig], lookOf(finish, look).studio.studio, { lightX, lightY })
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
