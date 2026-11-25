// Material finishes tuning — five physical finishes as plain preset objects,
// and the live copy the tweak panel edits.
//
// A finish is the shape a future `finishes` table would take. Every field
// but `color` maps one-to-one to a MeshPhysicalNodeMaterial property;
// `color` is the body the capture is printed on (lit text) or laid over
// (unlit text). The live copy mutates in place and listeners invalidate the
// canvas, so a slider reaches the material with no React render (the polymer
// prototype's pattern).

export type FinishId = 'lacquer' | 'satin-polymer' | 'anodized-aluminum' | 'velvet' | 'glazed-ceramic'

/** Whether the capture is lit with the body or composited over it unlit. */
export type TextLighting = 'lit' | 'unlit'

export interface Finish {
  /** Body color, sRGB hex. */
  color: string
  roughness: number
  metalness: number
  ior: number
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
}

const NO_LOBES = {
  metalness: 0,
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
} as const

// Ranges are docs/materials-research-catalog.md §1. Colors and the values
// picked inside each range are by eye, unmeasured.
export const FINISHES: Readonly<Record<FinishId, Readonly<Finish>>> = Object.freeze({
  // Catalog "Lacquer and glazed ceramic": clearcoat 1, coat roughness
  // 0–0.15, base roughness 0.4–0.8. IOR 1.5 is the 4% dielectric of
  // Filament's reflectance table.
  lacquer: Object.freeze({ ...NO_LOBES, color: '#6b1522', roughness: 0.45, ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.03 }),
  // Catalog "Molded polymer": roughness 0.3–0.6, clearcoat 0–0.3, sheen
  // 0–0.4, IOR about 1.49 for opaque ABS (unverified).
  'satin-polymer': Object.freeze({
    ...NO_LOBES,
    color: '#e7e4dc',
    roughness: 0.5,
    ior: 1.49,
    clearcoat: 0.18,
    clearcoatRoughness: 0.45,
    sheen: 0.25,
    sheenColor: '#ffffff',
    sheenRoughness: 0.6,
  }),
  // Catalog "Brushed and anodized metal": aluminum F0 (0.916, 0.923, 0.924)
  // linear is #f5f6f6, dulled here for a clear anodize; roughness 0.2–0.5,
  // anisotropy 0–0.9, rotation 0–π.
  'anodized-aluminum': Object.freeze({
    ...NO_LOBES,
    color: '#c9ccd0',
    roughness: 0.34,
    metalness: 1,
    ior: 1.5,
    anisotropy: 0.75,
  }),
  // Catalog "Velvet and felt": sheen 0–1, sheen color from sqrt(baseColor)
  // in linear light (#3b1a3f → #7e5a82), sheen roughness 0.3–0.8, base
  // roughness 0.7–1.
  velvet: Object.freeze({
    ...NO_LOBES,
    color: '#3b1a3f',
    roughness: 0.9,
    ior: 1.5,
    sheen: 1,
    sheenColor: '#7e5a82',
    sheenRoughness: 0.45,
  }),
  // Catalog "Lacquer and glazed ceramic", as for lacquer, with a rougher
  // coat for a soft glaze and a rougher body. Soda-lime glass is IOR 1.52.
  'glazed-ceramic': Object.freeze({ ...NO_LOBES, color: '#b4c7b5', roughness: 0.7, ior: 1.52, clearcoat: 1, clearcoatRoughness: 0.09 }),
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

/** The studio light and environment, in viewport CSS terms. */
export interface StudioTuning {
  /** Light position as fractions of the viewport. */
  lightX: number
  lightY: number
  /** Light height above the card plane, CSS px. */
  lightHeight: number
  /** Irradiance straight under the light, before N·L. */
  lightPower: number
  environmentIntensity: number
}

// The light starts over the product and form cards at their mid-height: a
// coat's highlight sits nearly under the light, so a light above the cards
// (the first default, y 0.22) put lacquer's highlight off their top edge.
export const studio: StudioTuning = {
  lightX: 0.42,
  lightY: 0.48,
  lightHeight: 320,
  lightPower: 2.4,
  environmentIntensity: 0.65,
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
