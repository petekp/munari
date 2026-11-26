// Material finishes values — the shape of a finish as a plain object, and
// the zero lobes every finish starts from.
//
// A finish is the shape a future `finishes` table would take: plain
// numbers, sRGB hex strings and a detail kind, so another scene can list a
// finish by adding one entry. Most fields map one-to-one to a
// MeshPhysicalNodeMaterial property.
//
// Ownership: this module holds the types and defaults.
// materialFinishesTuning holds the presets and the live copies.

export type FinishId =
  | 'lacquer'
  | 'satin-polymer'
  | 'anodized-aluminum'
  | 'velvet'
  | 'glazed-ceramic'
  | 'thin-film-foil'
  | 'paper'
  | 'soft-touch-rubber'
  | 'translucent-wax'

/** Whether the capture is lit with the body or composited over it unlit. */
export type TextLighting = 'lit' | 'unlit'

/**
 * The relief a finish carries below the edge. Each kind compiles its own
 * noise, so changing kind rebuilds the material.
 * - `orange-peel`: coat ripples of a sprayed lacquer.
 * - `brushed`: grooves along x from a brushed sheet.
 * - `pile`: velvet pile laid in patches, plus fiber grain.
 * - `glaze`: the slow waviness of a fired glaze.
 * - `crumple`: flat facets of a crumpled foil, each tilted its own way.
 * - `fiber`: paper fibers laid every way, plus the sheet's tooth; the
 *   fibers also tint the body.
 * - `dots`: the raised dots molded into a rubber grip.
 * - `honeycomb`: the hexagonal cells embossed into a beeswax sheet.
 */
export type SurfaceDetail = 'none' | 'orange-peel' | 'brushed' | 'pile' | 'glaze' | 'crumple' | 'fiber' | 'dots' | 'honeycomb'

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
  /** Weight of a thin film over the base, as three's `iridescence`. */
  iridescence: number
  iridescenceIOR: number
  /** Thickest film, nm. */
  iridescenceThickness: number
  /** How far the film thins across the card, as a fraction of its thickness. */
  filmVariation: number
  /** Feature size of the film's thickness pattern, CSS px. */
  filmScale: number
  /** Share of the diffuse light that scatters under the surface, 0 to 1. */
  subsurface: number
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

export const NO_LOBES = {
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
  filmVariation: 0,
  filmScale: 200,
  subsurface: 0,
  detail: 'none',
  detailScale: 1,
  detailDepth: 0,
  rimColor: null,
  crackle: 0,
  crackleScale: 40,
} as const
