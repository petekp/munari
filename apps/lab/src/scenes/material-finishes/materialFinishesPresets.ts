// Material finishes presets — the four newest finish families, three
// presets each, and the families the compare page shows side by side.
//
// Each preset is a finish of its own, listed in FINISHES, FINISH_ORDER and
// FINISH_STUDIOS by its id. A family groups the presets of one material so
// they can be judged against each other under the same rig.
//
// Ownership: this module holds the preset values and the families.
// materialFinishesTuning lists each preset as a finish.

import { NO_LOBES, type Finish, type FinishId } from './materialFinishesFinish'

// A foil is a metal sheet under a thin film. The film is three's
// thin-film model (Belcour and Barla 2017); the material applies it to the
// metal's reflectance for every light, the softbox included. The base
// colors are metal F0 from physicallybased.info: aluminum 0.916/0.923/0.924
// linear, written as sRGB. Film IOR 1.3 to 1.45 brackets KHR_materials_iridescence's
// 1.3 default and a polymer film; thickness and pattern by eye.
export const FOIL_HOLOGRAPHIC: Readonly<Finish> = Object.freeze({
  ...NO_LOBES,
  color: '#f5f6f6',
  roughness: 0.18,
  metalness: 1,
  ior: 1.5,
  iridescence: 1,
  iridescenceIOR: 1.45,
  iridescenceThickness: 700,
  filmVariation: 0.6,
  filmScale: 70,
  edgeWidth: 3,
})
export const FOIL_OIL_SLICK: Readonly<Finish> = Object.freeze({
  ...NO_LOBES,
  color: '#4a4c52',
  roughness: 0.22,
  metalness: 1,
  ior: 1.5,
  iridescence: 1,
  iridescenceIOR: 1.4,
  iridescenceThickness: 900,
  filmVariation: 0.55,
  filmScale: 260,
  edgeWidth: 4,
})
export const FOIL_CRUMPLED: Readonly<Finish> = Object.freeze({
  ...NO_LOBES,
  color: '#f5f6f6',
  roughness: 0.16,
  metalness: 1,
  ior: 1.5,
  iridescence: 1,
  iridescenceIOR: 1.35,
  iridescenceThickness: 550,
  filmVariation: 0.45,
  filmScale: 140,
  edgeWidth: 2,
  detail: 'crumple',
  detailScale: 20,
  detailDepth: 0.07,
})

// Paper is matte stock: roughness 0.8 and office paper's albedo
// 0.794/0.834/0.884 linear from physicallybased.info, written as sRGB.
// A sheet has a cut edge, not a rounded one. Fiber size and tint by eye.
export const PAPER_OFFICE: Readonly<Finish> = Object.freeze({
  ...NO_LOBES,
  color: '#f6f6f3',
  roughness: 0.92,
  ior: 1.5,
  specularIntensity: 0.35,
  edgeWidth: 1,
  detail: 'fiber',
  detailScale: 3.5,
  detailDepth: 0.045,
})
export const PAPER_KRAFT: Readonly<Finish> = Object.freeze({
  ...NO_LOBES,
  color: '#be956a',
  roughness: 0.9,
  ior: 1.5,
  specularIntensity: 0.4,
  edgeWidth: 1,
  detail: 'fiber',
  detailScale: 3.5,
  detailDepth: 0.06,
})
export const PAPER_COLD_PRESS: Readonly<Finish> = Object.freeze({
  ...NO_LOBES,
  color: '#f1e9d6',
  roughness: 0.9,
  ior: 1.5,
  specularIntensity: 0.4,
  edgeWidth: 1,
  detail: 'fiber',
  detailScale: 4,
  detailDepth: 0.06,
})

// Soft-touch rubber is roughness 0.7 to 0.9 with specularIntensity 0.3 to
// 0.6 (docs/materials-research-catalog.md §1; tire rubber 0.7 on
// physicallybased.info). A molded part has a thick rounded edge.
export const RUBBER_BLACK: Readonly<Finish> = Object.freeze({
  ...NO_LOBES,
  color: '#2a2b2e',
  roughness: 0.95,
  ior: 1.5,
  specularIntensity: 0.25,
  sheen: 0.8,
  sheenColor: '#8a8d93',
  sheenRoughness: 0.8,
  edgeWidth: 20,
})
export const RUBBER_GRIP: Readonly<Finish> = Object.freeze({
  ...NO_LOBES,
  color: '#d4561f',
  roughness: 0.8,
  ior: 1.5,
  specularIntensity: 0.4,
  edgeWidth: 22,
  detail: 'dots',
  detailScale: 8,
  detailDepth: 0.6,
})
export const RUBBER_SILICONE: Readonly<Finish> = Object.freeze({
  ...NO_LOBES,
  color: '#8ba595',
  roughness: 0.68,
  ior: 1.41,
  specularIntensity: 0.5,
  sheen: 0.25,
  sheenColor: '#dfe9e2',
  sheenRoughness: 0.6,
  edgeWidth: 44,
})

// Wax and silicone scatter light under the surface, so the material adds a
// scatter term that reaches past the shading's terminator and leaks out
// through the thin rounded edge. IOR 1.44 is paraffin, 1.41 silicone.
// Scatter share, colors and edges by eye.
export const WAX_CANDLE: Readonly<Finish> = Object.freeze({
  ...NO_LOBES,
  color: '#efe5cf',
  roughness: 0.6,
  ior: 1.44,
  specularIntensity: 0.45,
  subsurface: 0.45,
  rimColor: '#f7efdf',
  edgeWidth: 18,
})
export const WAX_BEESWAX: Readonly<Finish> = Object.freeze({
  ...NO_LOBES,
  color: '#d99a3a',
  roughness: 0.6,
  ior: 1.44,
  specularIntensity: 0.45,
  subsurface: 0.5,
  rimColor: '#ecbd6a',
  edgeWidth: 18,
  detail: 'honeycomb',
  detailScale: 10,
  detailDepth: 0.18,
})
export const WAX_SILICONE: Readonly<Finish> = Object.freeze({
  ...NO_LOBES,
  color: '#e2584f',
  roughness: 0.22,
  ior: 1.41,
  specularIntensity: 1,
  subsurface: 0.8,
  rimColor: '#ffb3a3',
  edgeWidth: 32,
})

/** One preset in a family, with what it is after in one sentence. */
export interface FamilyPreset {
  readonly id: FinishId
  readonly intent: string
}

/** The presets of one material, compared side by side. */
export interface FinishFamily {
  readonly id: string
  readonly label: string
  readonly presets: readonly FamilyPreset[]
}

export const FINISH_FAMILIES: readonly FinishFamily[] = [
  {
    id: 'thin-film-foil',
    label: 'Thin-film foil',
    presets: [
      { id: 'thin-film-foil-holographic', intent: 'Silver foil under a film that thins in fine bands, so each card carries a rainbow that shifts as the light moves.' },
      { id: 'thin-film-foil-oil-slick', intent: 'Dark gunmetal under a thick film in broad swirls of violet, teal and gold.' },
      { id: 'thin-film-foil-crumpled', intent: 'Iridescent wrapper foil crumpled into flat facets, each catching the light and the film at its own angle.' },
    ],
  },
  {
    id: 'paper',
    label: 'Paper',
    presets: [
      { id: 'paper-office', intent: 'Bright white sheet stock with fine fibers and a crisp cut edge.' },
      { id: 'paper-kraft', intent: 'Brown unbleached kraft paper whose darker fibers show across the sheet.' },
      { id: 'paper-cold-press', intent: 'Cream watercolor paper with a heavy tooth that catches the light.' },
    ],
  },
  {
    id: 'soft-touch-rubber',
    label: 'Soft-touch rubber',
    presets: [
      { id: 'soft-touch-rubber-black', intent: 'The dead-matte black coating of a remote or a mouse, with a soft gray sheen at grazing angles over a thick molded edge.' },
      { id: 'soft-touch-rubber-grip', intent: 'Safety-orange rubber molded with a grid of raised grip dots.' },
      { id: 'soft-touch-rubber-silicone', intent: 'Soft sage silicone rubber over a wide pillowed edge, with a faint fuzz at grazing angles.' },
    ],
  },
  {
    id: 'translucent-wax',
    label: 'Translucent wax',
    presets: [
      { id: 'translucent-wax-candle', intent: 'Ivory paraffin whose light leaks out pale and warm through the thin rounded edge.' },
      { id: 'translucent-wax-beeswax', intent: 'A rolled beeswax sheet embossed with honeycomb cells, glowing golden where it thins over the edge.' },
      { id: 'translucent-wax-silicone', intent: 'Glossy translucent coral silicone, like a phone case, glowing pink through a wide edge.' },
    ],
  },
]

export function familyOf(id: string | null): FinishFamily | undefined {
  return FINISH_FAMILIES.find((family) => family.id === id)
}

export function familyOfFinish(finish: FinishId): FinishFamily | undefined {
  return FINISH_FAMILIES.find((family) => family.presets.some((preset) => preset.id === finish))
}
