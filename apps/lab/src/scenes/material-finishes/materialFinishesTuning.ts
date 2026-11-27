// Material finishes tuning — the finish the page wears, the studio light it
// is judged under, and the stores the tweak panel writes.
//
// The finish is a SurfaceFinish value from the preset table
// (recipe/finishes.ts); a tweak replaces it with a changed copy, and the
// page renders the new value onto every card. The key light is a
// createSurfaceLight handle, so dragging it redraws the canvas with no React
// render. A second handle follows the pointer, and the page lights its cards
// with one or the other. The rest of the studio is SurfaceCanvas's `lighting` object, in
// its units: 1 is the studio's own brightness.
//
// Ownership: this module holds the live values and their listeners; the
// library owns the lights, environments and material.

import { createSurfaceLight, type SurfaceFinish, type SurfaceLighting } from '@petepetrash/munari'
import { finishes, type FinishPreset } from './recipe/finishes'

export type FinishId = FinishPreset
export type TextLighting = 'lit' | 'unlit'

export const FINISH_ORDER: readonly { readonly id: FinishId; readonly label: string }[] = [
  { id: 'lacquer-crimson', label: 'Lacquer' },
  { id: 'polymer-charcoal', label: 'Satin polymer' },
  { id: 'aluminum-blue', label: 'Anodized aluminum' },
  { id: 'velvet-midnight', label: 'Velvet' },
  { id: 'ceramic-celadon', label: 'Glazed ceramic' },
  { id: 'foil-holographic', label: 'Holographic foil' },
  { id: 'foil-oil-slick', label: 'Oil-slick foil' },
  { id: 'foil-crumpled', label: 'Crumpled foil' },
  { id: 'paper-office', label: 'Office paper' },
  { id: 'paper-kraft', label: 'Kraft paper' },
  { id: 'paper-cold-press', label: 'Cold-press paper' },
  { id: 'rubber-black', label: 'Black soft-touch' },
  { id: 'rubber-grip', label: 'Orange grip rubber' },
  { id: 'rubber-silicone', label: 'Sage silicone rubber' },
  { id: 'wax-candle', label: 'Candle wax' },
  { id: 'wax-beeswax', label: 'Beeswax' },
  { id: 'wax-silicone', label: 'Coral silicone' },
]

export function isFinishId(value: string | null): value is FinishId {
  return FINISH_ORDER.some((item) => item.id === value)
}

// ── live finish ────────────────────────────────────────────────────────

let live: SurfaceFinish = finishes['lacquer-crimson']

/** The finish every card on the page wears. */
export function liveFinish(): SurfaceFinish {
  return live
}

export function setLiveFinish(next: SurfaceFinish): void {
  live = next
  notifyFinishTuning()
}

/** Load a preset's tuned values into the live finish. */
export function applyFinish(finish: FinishId): void {
  setLiveFinish(finishes[finish])
}

// ── studio ─────────────────────────────────────────────────────────────

/** The key's kind: a rectangular softbox, or a point. */
export type LightRig = 'softbox' | 'point'

export const LIGHT_RIGS: readonly { readonly id: LightRig; readonly label: string }[] = [
  { id: 'softbox', label: 'Softbox' },
  { id: 'point', label: 'Point' },
]

export function isLightRig(value: string | null): value is LightRig {
  return LIGHT_RIGS.some((item) => item.id === value)
}

/** Whether each card tilts toward the pointer. */
export type CardTilt = 'none' | 'pointer'

/** The studio, in SurfaceCanvas lighting units, with the key's position as viewport fractions. */
export interface StudioTuning {
  keyX: number
  keyY: number
  /** CSS px above the page. */
  keyHeight: number
  keyBrightness: number
  /** Softbox size, CSS px. */
  softboxWidth: number
  softboxHeight: number
  rimBrightness: number
  /** Degrees above the page. */
  rimElevation: number
  environmentIntensity: number
}

// A coat's highlight lands between the key and the camera's axis: at
// height 480, about halfway (measured on m2: the key at y 618 CSS px put
// lacquer's bar at 536, with the axis at 450). The key starts below the
// form card's centre, 0.517 across, so the bar lies in the text-free band
// between "Not saved" and Save, and the light handle sits below the card.
// The softbox is wide and short to fit that band: 200 px wide left a small
// isolated spot, and 560 px ran the bar over "Not saved".
const STUDIO_START: Readonly<StudioTuning> = Object.freeze({
  keyX: 0.517,
  keyY: 0.687,
  keyHeight: 480,
  keyBrightness: 1,
  softboxWidth: 290,
  softboxHeight: 80,
  rimBrightness: 1,
  rimElevation: 15,
  environmentIntensity: 1,
})

export const studio: StudioTuning = { ...STUDIO_START }

/** The page's key light. Every card on every canvas of the page is lit by it. */
export const keyLight = createSurfaceLight()

/** The key when it follows the pointer. It rests where keyLight stands, which is also where it stays under reduced motion. */
export const pointerLight = createSurfaceLight({ follow: 'pointer' })

/** Stand the key where the studio says, in the rig's kind. */
export function placeKey(rig: LightRig): void {
  const key = {
    x: studio.keyX * window.innerWidth,
    y: studio.keyY * window.innerHeight,
    z: studio.keyHeight,
    brightness: studio.keyBrightness,
    size: rig === 'softbox' ? ([studio.softboxWidth, studio.softboxHeight] as const) : undefined,
  }
  keyLight.set(key)
  pointerLight.set(key)
}

/** Restart the studio at its start values and stand the key there. */
export function startStudio(rig: LightRig): void {
  Object.assign(studio, STUDIO_START)
  placeKey(rig)
}

/** The canvas's lighting for the studio's current values. */
export function lightingOf(followsPointer: boolean): SurfaceLighting {
  return {
    key: followsPointer ? pointerLight : keyLight,
    rim: { brightness: studio.rimBrightness, elevation: studio.rimElevation },
    environmentIntensity: studio.environmentIntensity,
  }
}

type Listener = () => void
const listeners = new Set<Listener>()
let version = 0

export function subscribeFinishTuning(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A number that changes on every write, for useSyncExternalStore. */
export function tuningVersion(): number {
  return version
}

export function notifyFinishTuning(): void {
  version += 1
  for (const listener of listeners) listener()
}
