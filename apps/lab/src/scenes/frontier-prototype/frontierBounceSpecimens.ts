// Light bounce viewer specimens — five public-domain paintings and the live
// HTML card that the center emitter shows, with the file name, labels and
// sidebar folder each one selects. Sources and licensing for the paintings are
// in bounce-paintings/SOURCES.md.

import fightingTemeraireSrc from './bounce-paintings/fighting-temeraire.webp'
import grandeJatteSrc from './bounce-paintings/grande-jatte.webp'
import huntersInTheSnowSrc from './bounce-paintings/hunters-in-the-snow.webp'
import impressionSunriseSrc from './bounce-paintings/impression-sunrise.webp'
import starryNightSrc from './bounce-paintings/starry-night.webp'

export type BounceSpecimenId =
  | 'starry-night'
  | 'impression-sunrise'
  | 'fighting-temeraire'
  | 'grande-jatte'
  | 'hunters-in-the-snow'
  | 'synth'

interface SpecimenCommon {
  readonly id: BounceSpecimenId
  readonly fileName: string
  readonly kindLabel: string
  readonly shortLabel: string
  /** The sidebar folder selected alongside this specimen. */
  readonly folder: string
}

export interface PaintingSpecimen extends SpecimenCommon {
  readonly kind: 'painting'
  readonly src: string
  /** Width over height of the image file, so the viewer shows it uncropped. */
  readonly aspect: number
  readonly alt: string
}

export interface LiveSpecimen extends SpecimenCommon {
  readonly kind: 'live'
  readonly badgeBg: string
}

export type SpecimenMeta = PaintingSpecimen | LiveSpecimen

export const BOUNCE_SPECIMENS: readonly SpecimenMeta[] = [
  {
    id: 'starry-night',
    kind: 'painting',
    src: starryNightSrc,
    aspect: 910 / 720,
    fileName: 'The Starry Night.webp',
    kindLabel: 'Vincent van Gogh · 1889',
    shortLabel: 'The Starry Night',
    alt: 'The Starry Night by Vincent van Gogh, 1889',
    folder: 'Pictures',
  },
  {
    id: 'impression-sunrise',
    kind: 'painting',
    src: impressionSunriseSrc,
    aspect: 928 / 720,
    fileName: 'Impression, Sunrise.webp',
    kindLabel: 'Claude Monet · 1872',
    shortLabel: 'Impression, Sunrise',
    alt: 'Impression, Sunrise by Claude Monet, 1872',
    folder: 'Pictures',
  },
  {
    id: 'fighting-temeraire',
    kind: 'painting',
    src: fightingTemeraireSrc,
    aspect: 969 / 720,
    fileName: 'The Fighting Temeraire.webp',
    kindLabel: 'J. M. W. Turner · 1839',
    shortLabel: 'The Fighting Temeraire',
    alt: 'The Fighting Temeraire by J. M. W. Turner, 1839',
    folder: 'Pictures',
  },
  {
    id: 'grande-jatte',
    kind: 'painting',
    src: grandeJatteSrc,
    aspect: 1082 / 720,
    fileName: 'A Sunday on La Grande Jatte.webp',
    kindLabel: 'Georges Seurat · 1884–86',
    shortLabel: 'A Sunday on La Grande Jatte',
    alt: 'A Sunday on La Grande Jatte by Georges Seurat, 1884 to 1886',
    folder: 'Pictures',
  },
  {
    id: 'hunters-in-the-snow',
    kind: 'painting',
    src: huntersInTheSnowSrc,
    aspect: 1012 / 720,
    fileName: 'Hunters in the Snow.webp',
    kindLabel: 'Pieter Bruegel the Elder · 1565',
    shortLabel: 'Hunters in the Snow',
    alt: 'Hunters in the Snow by Pieter Bruegel the Elder, 1565',
    folder: 'Pictures',
  },
  {
    id: 'synth',
    kind: 'live',
    fileName: 'live-emitter-card.tsx',
    kindLabel: 'Interactive HTML · Live controls',
    badgeBg: 'linear-gradient(135deg, #f22e84 0%, #ff8418 100%)',
    shortLabel: 'Live DOM card',
    folder: 'capacitor',
  },
]
