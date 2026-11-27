// Material finishes families — the presets of one material, compared side by
// side on the compare page (?scene=material-finishes&compare=<family id>).
//
// Ownership: the presets' values are recipe/finishes.ts; this module only
// groups them and says what each is after.

import type { FinishPreset } from './recipe/finishes'

/** One preset in a family, with what it is after in one sentence. */
export interface FamilyPreset {
  readonly id: FinishPreset
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
      { id: 'foil-holographic', intent: 'Silver foil under a film that thins in fine bands, so each card carries a rainbow that shifts as the light moves.' },
      { id: 'foil-oil-slick', intent: 'Dark gunmetal under a thick film in broad swirls of violet, teal and gold.' },
      { id: 'foil-crumpled', intent: 'Iridescent wrapper foil crumpled into flat facets, each catching the light and the film at its own angle.' },
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
      { id: 'rubber-black', intent: 'The dead-matte black coating of a remote or a mouse, with a soft gray sheen at grazing angles over a thick molded edge.' },
      { id: 'rubber-grip', intent: 'Safety-orange rubber molded with a grid of raised grip dots.' },
      { id: 'rubber-silicone', intent: 'Soft sage silicone rubber over a wide pillowed edge, with a faint fuzz at grazing angles.' },
    ],
  },
  {
    id: 'translucent-wax',
    label: 'Translucent wax',
    presets: [
      { id: 'wax-candle', intent: 'Ivory paraffin whose light leaks out pale and warm through the thin rounded edge.' },
      { id: 'wax-beeswax', intent: 'A rolled beeswax sheet embossed with honeycomb cells, glowing golden where it thins over the edge.' },
      { id: 'wax-silicone', intent: 'Glossy translucent coral silicone, like a phone case, glowing pink through a wide edge.' },
    ],
  },
]

export function familyOf(id: string | null): FinishFamily | undefined {
  return FINISH_FAMILIES.find((family) => family.id === id)
}

export function familyOfFinish(finish: FinishPreset): FinishFamily | undefined {
  return FINISH_FAMILIES.find((family) => family.presets.some((preset) => preset.id === finish))
}
