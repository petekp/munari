// Surface finish — the physical look a Surface's mesh wears, as plain data.
//
// The law: a finish is a value, never a renderer object, so page code builds
// one on the server and before any canvas mounts, and the page bundle stays
// free of three (surfaceSceneLookup.tsx). A field a finish leaves out takes
// its neutral default, which is a plain dielectric with no layers; a layer is
// present when its object is present, and its amount is then a uniform. So
// an amount that crosses zero rebuilds nothing, and a layer added or removed
// rebuilds that one Surface's material (decisions.md #79).
//
// `color` decides who paints the body. A color is painted by the material,
// and Munari writes it as `--munari-body` on the page copy and
// `transparent` into the capture (surfaceBodyColor.ts). Null leaves the body to
// the HTML in both places, and the whole capture is lit.
//
// Ownership: this module owns the finish's shape, its defaults and the
// context a Root hands its mesh. SurfaceFinishMaterial builds the material.

import { createContext, useRef } from 'react'

/**
 * The relief a finish carries below its edge. Each kind compiles its own
 * noise, so changing kind rebuilds the material.
 * - `orange-peel`: the coat ripples of a sprayed lacquer, in the coat.
 * - `brushed`: grooves along x from a brushed sheet.
 * - `pile`: velvet pile laid in patches, with fiber grain.
 * - `glaze`: the slow waviness of a fired glaze, in the coat.
 * - `crumple`: the flat facets of crumpled foil.
 * - `fiber`: paper fibers and the sheet's tooth; the fibers also tint the body.
 * - `dots`: raised dots molded into a rubber grip.
 * - `honeycomb`: hexagonal cells embossed into a beeswax sheet.
 */
export type SurfaceDetailKind = 'orange-peel' | 'brushed' | 'pile' | 'glaze' | 'crumple' | 'fiber' | 'dots' | 'honeycomb'

export interface FinishValues {
  /** Body color, sRGB hex. Null: the HTML paints the body and the whole capture is lit. */
  color: string | null
  /** Read only when `color` is set: `lit` prints the capture on the body as albedo; `unlit` lays it over the lit body. */
  text: 'unlit' | 'lit'
  roughness: number
  metalness: number
  ior: number
  /** Weight of the base layer's dielectric reflection (three's `specularIntensity`). */
  specularIntensity: number
  /** A clear coat over the base. */
  coat: { amount: number; roughness: number } | null
  /** Fabric sheen; `color` is sRGB hex. */
  sheen: { amount: number; color: string; roughness: number } | null
  /** A stretched highlight; `rotation` is radians in the Surface's UV frame. */
  anisotropy: { amount: number; rotation: number } | null
  /** A thin film over the base: `thickness` is the thickest film in nm, `variation` how far it thins as a fraction of that, `scale` its pattern's feature size in CSS px. */
  film: { amount: number; ior: number; thickness: number; variation: number; scale: number } | null
  /** Share of the key's diffuse light that scatters under the surface, 0 to 1. */
  scatter: { amount: number } | null
  /** A rounded edge `width` CSS px wide; `rimColor` (sRGB hex) is the body at the rim, null keeps `color`. */
  edge: { width: number; rimColor: string | null }
  /** Surface relief: `scale` is its feature size in CSS px, `depth` the steepest slope it adds. */
  detail: { kind: SurfaceDetailKind; scale: number; depth: number } | null
  /** A crackle network darkening the body by `amount`, cells `scale` CSS px across. */
  crackle: { amount: number; scale: number } | null
  /** How much of the lit color is emitted rather than lit, so the content keeps its brightness under a dim light. */
  emissiveIntensity: number
  /** What the finish reflects besides the lights: one even tone, or a fill that brightens toward the top. */
  environment: 'even' | 'gradient'
  /** Scales the direct lights on this finish, 0 or more; the environment and emission do not scale. */
  lightGain: number
  side: 'front' | 'double'
}

/** A finish: any of FinishValues, each missing field at its neutral default. */
export type SurfaceFinish = { readonly [K in keyof FinishValues]?: FinishValues[K] }

// The neutral finish is the lit slab Surface.LitMaterial drew: roughness
// 0.55 and a dielectric at three's defaults (IOR 1.5, full specular).
export const NEUTRAL_FINISH: Readonly<FinishValues> = Object.freeze({
  color: null,
  text: 'unlit',
  roughness: 0.55,
  metalness: 0,
  ior: 1.5,
  specularIntensity: 1,
  coat: null,
  sheen: null,
  anisotropy: null,
  film: null,
  scatter: null,
  edge: Object.freeze({ width: 0, rimColor: null }),
  detail: null,
  crackle: null,
  emissiveIntensity: 0,
  environment: 'even',
  lightGain: 1,
  side: 'front',
})

/** Every field of a finish, the missing ones at their neutral defaults. */
export function resolveFinish(finish: SurfaceFinish): FinishValues {
  return { ...NEUTRAL_FINISH, ...withoutUndefined(finish) }
}

function withoutUndefined(finish: SurfaceFinish): SurfaceFinish {
  const defined: { -readonly [K in keyof FinishValues]?: FinishValues[K] } = {}
  // SAFETY: SurfaceFinish's keys are FinishValues' keys, and a caller's
  // object with extra keys only copies values no reader asks for.
  for (const key of Object.keys(finish) as (keyof FinishValues)[]) {
    if (finish[key] !== undefined) Object.assign(defined, { [key]: finish[key] })
  }
  return defined
}

/**
 * The finish a Root gives its HTML. The source host publishes it with the
 * part, so every mesh of the Surface wears it, including a mesh declared by
 * handle in another tree.
 */
export const SurfaceFinishContext = createContext<SurfaceFinish | null>(null)

/**
 * The previous finish while the next one holds the same values. An inline
 * `finish={{ … }}` is a new object each render; publishing each one would
 * notify every presenter of the Surface on every render.
 */
export function useHeldFinish(finish: SurfaceFinish | null): SurfaceFinish | null {
  const held = useRef(finish)
  if (held.current !== finish && JSON.stringify(held.current) !== JSON.stringify(finish)) held.current = finish
  return held.current
}
