// Material finishes looks — the candidate values for the four newest
// finishes, three looks each, to compare side by side.
//
// A look pairs a finish's values with the studio it is judged in. Each
// finish's first look is its entry in FINISHES.
//
// Ownership: this module holds the candidate values. materialFinishesTuning
// resolves a finish's looks and loads one into the live copy.

import { NO_LOBES, type Finish, type FinishId } from './materialFinishesFinish'
import type { FinishStudio } from './materialFinishesTuning'

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

/** One way to show a finish: its values and the studio it is judged in. */
export interface FinishLook {
  readonly id: string
  readonly label: string
  /** What the look is after, in one sentence. */
  readonly intent: string
  readonly finish: Readonly<Finish>
  readonly studio: FinishStudio
}

// The four newest finishes have looks to choose between. A finish's first
// look is its entry in FINISHES and FINISH_STUDIOS.
export const FINISH_LOOKS: Readonly<Partial<Record<FinishId, readonly FinishLook[]>>> = Object.freeze({
  'thin-film-foil': [
    {
      id: 'holographic',
      label: 'Holographic silver',
      intent: 'Silver foil under a film that thins in fine bands, so each card carries a rainbow that shifts as the light moves.',
      finish: FOIL_HOLOGRAPHIC,
      studio: { environment: 'even' },
    },
    {
      id: 'oil-slick',
      label: 'Oil slick',
      intent: 'Dark gunmetal under a thick film in broad swirls of violet, teal and gold.',
      finish: FOIL_OIL_SLICK,
      studio: { environment: 'even' },
    },
    {
      id: 'crumpled',
      label: 'Crumpled wrapper',
      intent: 'Iridescent wrapper foil crumpled into flat facets, each catching the light and the film at its own angle.',
      finish: FOIL_CRUMPLED,
      studio: { environment: 'even' },
    },
  ],
  paper: [
    {
      id: 'office',
      label: 'Office paper',
      intent: 'Bright white sheet stock with fine fibers and a crisp cut edge.',
      finish: PAPER_OFFICE,
      studio: { environment: 'even' },
    },
    {
      id: 'kraft',
      label: 'Kraft',
      intent: 'Brown unbleached kraft paper whose darker fibers show across the sheet.',
      finish: PAPER_KRAFT,
      studio: { environment: 'even' },
    },
    {
      id: 'cold-press',
      label: 'Cold-press',
      intent: 'Cream watercolor paper with a heavy tooth that catches the light.',
      finish: PAPER_COLD_PRESS,
      studio: { environment: 'even' },
    },
  ],
  'soft-touch-rubber': [
    {
      id: 'black',
      label: 'Black soft-touch',
      intent: 'The dead-matte black coating of a remote or a mouse, with a soft gray sheen at grazing angles over a thick molded edge.',
      finish: RUBBER_BLACK,
      studio: { environment: 'even' },
    },
    {
      id: 'grip',
      label: 'Orange grip',
      intent: 'Safety-orange rubber molded with a grid of raised grip dots.',
      finish: RUBBER_GRIP,
      studio: { environment: 'even' },
    },
    {
      id: 'silicone',
      label: 'Sage silicone',
      intent: 'Soft sage silicone rubber over a wide pillowed edge, with a faint fuzz at grazing angles.',
      finish: RUBBER_SILICONE,
      studio: { environment: 'even' },
    },
  ],
  'translucent-wax': [
    {
      id: 'candle',
      label: 'Candle wax',
      intent: 'Ivory paraffin whose light leaks out pale and warm through the thin rounded edge.',
      finish: WAX_CANDLE,
      studio: { environment: 'even' },
    },
    {
      id: 'beeswax',
      label: 'Beeswax',
      intent: 'A rolled beeswax sheet embossed with honeycomb cells, glowing golden where it thins over the edge.',
      finish: WAX_BEESWAX,
      studio: { environment: 'even' },
    },
    {
      id: 'silicone',
      label: 'Coral silicone',
      intent: 'Glossy translucent coral silicone, like a phone case, glowing pink through a wide edge.',
      finish: WAX_SILICONE,
      studio: { environment: 'even' },
    },
  ],
})
