// Finish presets — seventeen tuned finishes for Surface.Root's `finish`,
// and an ink for each that reads on its body.
//
// A preset is a plain SurfaceFinish value, so a page passes it as is or
// spreads it under its own overrides:
// `finish={{ ...finishes['lacquer-crimson'], color: '#0d3b66' }}`. Names are
// <family>-<look>. Each layer the finish carries (coat, sheen, anisotropy,
// film, scatter, detail, crackle) compiles while its object is present, so
// a tweak that moves an amount through zero rebuilds nothing.
//
// Lobe values follow the MaterialX example presets (Apache-2.0) at
// github.com/AcademySoftwareFoundation/MaterialX, resources/Materials/
// Examples: OpenPbr/open_pbr_carpaint, open_pbr_aluminum_brushed,
// open_pbr_velvet and StandardSurface/standard_surface_plastic,
// standard_surface_velvet, standard_surface_metal_brushed. Body colors,
// edge widths and detail values are by eye, unmeasured; every preset was
// tuned under SurfaceCanvas's studio lighting (docs/materials-api/lighting.md).
//
// OpenPBR reads a coated base's specular IOR relative to the coat, so a
// base whose IOR matches its coat reflects nothing at that interface. three
// does not divide the IORs, and the base's own 4% lobe at the base
// roughness drew a broad wash under the coat's highlight. Coated presets
// set `specularIntensity` 0 instead.
//
// Ownership: this file is copied into a project (registry/finishes) and
// byte-welded to the lab's reference copy by tests/registry/finishesPack.test.ts.

import type { SurfaceFinish } from '@petepetrash/munari'

// Velvet's direct light, relative to the studio's. Tuned under its own
// lights, velvet raised the key 3.2 times and the rim 1.25 times; one gain
// raises both. Swept from 1.5 to 4 against that look at 1440×900 (m2,
// 2026-11-26), 2.5 drew the fewest pixels more than 8/255 away from it and
// the smallest largest difference, 44/255.
const VELVET_LIGHT_GAIN = 2.5

export type FinishPreset =
  | 'lacquer-crimson'
  | 'polymer-charcoal'
  | 'aluminum-blue'
  | 'velvet-midnight'
  | 'ceramic-celadon'
  | 'foil-holographic'
  | 'foil-oil-slick'
  | 'foil-crumpled'
  | 'paper-office'
  | 'paper-kraft'
  | 'paper-cold-press'
  | 'rubber-black'
  | 'rubber-grip'
  | 'rubber-silicone'
  | 'wax-candle'
  | 'wax-beeswax'
  | 'wax-silicone'

export const finishes: Readonly<Record<FinishPreset, Readonly<SurfaceFinish>>> = Object.freeze({
  // Crimson car paint. open_pbr_carpaint: coat 1 at roughness 0.02 over a
  // base whose IOR equals the coat's. Orange peel within the catalog's
  // 0–0.05 coat-normal range. The gradient fill shows the top-to-bottom
  // falloff of a glossy panel.
  'lacquer-crimson': {
    color: '#8c1022',
    roughness: 0.3,
    ior: 1.5,
    specularIntensity: 0,
    coat: { amount: 1, roughness: 0.02 },
    edge: { width: 6, rimColor: null },
    detail: { kind: 'orange-peel', scale: 18, depth: 0.004 },
    environment: 'gradient',
  },
  // Charcoal satin polymer. standard_surface_plastic: one dielectric lobe at
  // roughness 0.32, no coat and no sheen. IOR 1.49 is polypropylene and PMMA
  // on physicallybased.info. A dark body lets the soft highlight stand out.
  'polymer-charcoal': {
    color: '#3a3d42',
    roughness: 0.36,
    ior: 1.49,
    edge: { width: 12, rimColor: null },
  },
  // Blue anodized aluminum. open_pbr_aluminum_brushed: roughness 0.2,
  // anisotropy 0.9; standard_surface_metal_brushed: roughness 0.25,
  // anisotropy 0.65. The grooves run along x, which spreads the highlight
  // across them, along y: rotation π/2 turns three's stretched axis from u to v.
  'aluminum-blue': {
    color: '#7da2d4',
    roughness: 0.26,
    metalness: 1,
    ior: 1.5,
    anisotropy: { amount: 0.65, rotation: Math.PI / 2 },
    edge: { width: 3, rimColor: null },
    detail: { kind: 'brushed', scale: 1.2, depth: 0.06 },
  },
  // Midnight velvet. standard_surface_velvet: base specular 0, sheen 1, with
  // a sheen color far brighter than the body; here a navy body under a
  // periwinkle sheen. Sheen roughness 0.5 is open_pbr_velvet's fuzz
  // roughness, tight enough that the glow gathers into a bright line along
  // the rim facing the key. The pile relief is what reads as cloth: with no
  // relief blind readers called the cards frosted glass. Charlie sheen peaks
  // where light and view both graze, so velvet takes most of its light from
  // the key and rim: `lightGain` raises both. By eye, unmeasured.
  'velvet-midnight': {
    color: '#141a3a',
    roughness: 0.9,
    ior: 1.5,
    specularIntensity: 0,
    sheen: { amount: 1, color: '#b8c4ff', roughness: 0.5 },
    edge: { width: 48, rimColor: null },
    detail: { kind: 'pile', scale: 24, depth: 0.08 },
    lightGain: VELVET_LIGHT_GAIN,
  },
  // Celadon glazed ceramic. A glass glaze on a porcelain body
  // (physicallybased.info: roughness 0, IOR 1.5). Coat roughness 0.02, so the
  // softbox's image keeps a sharp edge. Glaze and body match in IOR, so the
  // base reflects nothing. The glaze runs thin and pale over the rounded
  // edge, with a sparse, faint crackle.
  'ceramic-celadon': {
    color: '#8db59a',
    roughness: 0.5,
    ior: 1.52,
    specularIntensity: 0,
    coat: { amount: 1, roughness: 0.02 },
    edge: { width: 12, rimColor: '#e6eee2' },
    detail: { kind: 'glaze', scale: 120, depth: 0.035 },
    crackle: { amount: 0.2, scale: 90 },
    environment: 'gradient',
  },
  // A foil is a metal sheet under a thin film (Belcour and Barla 2017),
  // applied to the metal's reflectance for every light. The silver bodies
  // are aluminum's F0 from physicallybased.info, 0.916/0.923/0.924 linear,
  // written as sRGB. Film IOR 1.3 to 1.45 brackets KHR_materials_iridescence's
  // 1.3 default and a polymer film; thickness and pattern by eye.
  'foil-holographic': {
    color: '#f5f6f6',
    roughness: 0.18,
    metalness: 1,
    ior: 1.5,
    film: { amount: 1, ior: 1.45, thickness: 700, variation: 0.6, scale: 70 },
    edge: { width: 3, rimColor: null },
  },
  'foil-oil-slick': {
    color: '#4a4c52',
    roughness: 0.22,
    metalness: 1,
    ior: 1.5,
    film: { amount: 1, ior: 1.4, thickness: 900, variation: 0.55, scale: 260 },
    edge: { width: 4, rimColor: null },
  },
  'foil-crumpled': {
    color: '#f5f6f6',
    roughness: 0.16,
    metalness: 1,
    ior: 1.5,
    film: { amount: 1, ior: 1.35, thickness: 550, variation: 0.45, scale: 140 },
    edge: { width: 2, rimColor: null },
    detail: { kind: 'crumple', scale: 20, depth: 0.07 },
  },
  // Paper is matte stock: office paper's albedo 0.794/0.834/0.884 linear
  // from physicallybased.info, written as sRGB. A sheet has a cut edge, not
  // a rounded one. Fiber size and tint by eye.
  'paper-office': {
    color: '#f6f6f3',
    roughness: 0.92,
    ior: 1.5,
    specularIntensity: 0.35,
    edge: { width: 1, rimColor: null },
    detail: { kind: 'fiber', scale: 3.5, depth: 0.045 },
  },
  'paper-kraft': {
    color: '#be956a',
    roughness: 0.9,
    ior: 1.5,
    specularIntensity: 0.4,
    edge: { width: 1, rimColor: null },
    detail: { kind: 'fiber', scale: 3.5, depth: 0.06 },
  },
  'paper-cold-press': {
    color: '#f1e9d6',
    roughness: 0.9,
    ior: 1.5,
    specularIntensity: 0.4,
    edge: { width: 1, rimColor: null },
    detail: { kind: 'fiber', scale: 4, depth: 0.06 },
  },
  // Soft-touch rubber is roughness 0.7 to 0.9 with specularIntensity 0.3 to
  // 0.6 (docs/materials-research-catalog.md §1; tire rubber 0.7 on
  // physicallybased.info). A molded part has a thick rounded edge.
  'rubber-black': {
    color: '#2a2b2e',
    roughness: 0.95,
    ior: 1.5,
    specularIntensity: 0.25,
    sheen: { amount: 0.8, color: '#8a8d93', roughness: 0.8 },
    edge: { width: 20, rimColor: null },
  },
  'rubber-grip': {
    color: '#d4561f',
    roughness: 0.8,
    ior: 1.5,
    specularIntensity: 0.4,
    edge: { width: 22, rimColor: null },
    detail: { kind: 'dots', scale: 8, depth: 0.6 },
  },
  'rubber-silicone': {
    color: '#8ba595',
    roughness: 0.68,
    ior: 1.41,
    specularIntensity: 0.5,
    sheen: { amount: 0.25, color: '#dfe9e2', roughness: 0.6 },
    edge: { width: 44, rimColor: null },
  },
  // Wax and silicone scatter light under the surface, past the shading's
  // terminator and out through the thin rounded edge. IOR 1.44 is paraffin,
  // 1.41 silicone. Scatter share, colors and edges by eye.
  'wax-candle': {
    color: '#efe5cf',
    roughness: 0.6,
    ior: 1.44,
    specularIntensity: 0.45,
    scatter: { amount: 0.45 },
    edge: { width: 18, rimColor: '#f7efdf' },
  },
  'wax-beeswax': {
    color: '#d99a3a',
    roughness: 0.6,
    ior: 1.44,
    specularIntensity: 0.45,
    scatter: { amount: 0.5 },
    edge: { width: 18, rimColor: '#ecbd6a' },
    detail: { kind: 'honeycomb', scale: 10, depth: 0.18 },
  },
  'wax-silicone': {
    color: '#e2584f',
    roughness: 0.22,
    ior: 1.41,
    specularIntensity: 1,
    scatter: { amount: 0.8 },
    edge: { width: 32, rimColor: '#ffb3a3' },
  },
})

/**
 * Text colors that read on each preset's body color, for the page's CSS:
 * `ink` for body text, `quietInk` for labels and fine print. `ink` is
 * whichever of a near-black and a near-white has more contrast on the body.
 * `quietInk` mixes it toward the body as far as keeps 7:1 on the body color
 * (WCAG 2.2 criterion 1.4.6), whose headroom keeps 4.5:1 on the lit body;
 * where even `ink` falls short of 7:1, `quietInk` is `ink`.
 */
export const inks: Readonly<Record<FinishPreset, { readonly ink: string; readonly quietInk: string }>> = Object.freeze({
  'lacquer-crimson': { ink: '#f5f2ee', quietInk: '#ebdbda' },
  'polymer-charcoal': { ink: '#f5f2ee', quietInk: '#d3d1cf' },
  'aluminum-blue': { ink: '#15181c', quietInk: '#15181c' },
  'velvet-midnight': { ink: '#f5f2ee', quietInk: '#a9a9b1' },
  'ceramic-celadon': { ink: '#15181c', quietInk: '#1c2124' },
  'foil-holographic': { ink: '#15181c', quietInk: '#4f5255' },
  'foil-oil-slick': { ink: '#f5f2ee', quietInk: '#ebe8e5' },
  'foil-crumpled': { ink: '#15181c', quietInk: '#4f5255' },
  'paper-office': { ink: '#15181c', quietInk: '#505254' },
  'paper-kraft': { ink: '#15181c', quietInk: '#15181c' },
  'paper-cold-press': { ink: '#15181c', quietInk: '#4a4a49' },
  'rubber-black': { ink: '#f5f2ee', quietInk: '#b8b6b4' },
  'rubber-grip': { ink: '#15181c', quietInk: '#15181c' },
  'rubber-silicone': { ink: '#15181c', quietInk: '#15181c' },
  'wax-candle': { ink: '#15181c', quietInk: '#494947' },
  'wax-beeswax': { ink: '#15181c', quietInk: '#191b1d' },
  'wax-silicone': { ink: '#15181c', quietInk: '#15181c' },
})
