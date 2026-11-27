// Lamp position — where the bulb starts, how it drifts at rest, and how far
// it may be dragged.
//
// The law: idle motion stays inside the gap above the headline (decision
// #50), and the bulb stays a margin inside the viewport.
//
// Ownership: LightLamp moves the bulb; this module only computes positions.

import { BULB_RADIUS } from './lightBulb'

// Small idle motion stays inside the gap above the headline (decision #50).
const DRIFT_RADIUS_X = 12
const DRIFT_RADIUS_Y = 3
const DRIFT_PERIOD_MS = 24000
// The bulb can be dragged this close to the viewport's edge.
const LIGHT_MARGIN = BULB_RADIUS + 8

export interface Point {
  x: number
  y: number
}

export function ellipseOffset(elapsedMs: number): Point {
  const angle = (elapsedMs / DRIFT_PERIOD_MS) * Math.PI * 2
  return { x: Math.sin(angle) * DRIFT_RADIUS_X, y: (1 - Math.cos(angle)) * DRIFT_RADIUS_Y }
}

export function clampToViewport(point: Point, page: HTMLElement | null): Point {
  return {
    x: Math.min(Math.max(point.x, LIGHT_MARGIN), Math.max(LIGHT_MARGIN, (page?.clientWidth ?? 0) - LIGHT_MARGIN)),
    y: Math.min(Math.max(point.y, LIGHT_MARGIN), Math.max(LIGHT_MARGIN, (page?.clientHeight ?? 0) - LIGHT_MARGIN)),
  }
}

// Above the postcard when the page has one, otherwise above the headline's
// right side, so the first shadows fall across the content.
export function initialLightPosition(line: HTMLElement | null, masthead: HTMLElement | null, page: HTMLElement | null): Point {
  if (!page || !masthead) return { x: LIGHT_MARGIN, y: LIGHT_MARGIN }
  const viewport = page.getBoundingClientRect()
  const box = masthead.getBoundingClientRect()
  const heading = line?.getBoundingClientRect()
  const card = masthead.querySelector('.postcard-hero-viewport')?.getBoundingClientRect()
  const desktop = viewport.width > 760
  const x = card ? card.left + card.width / 2 : heading ? heading.left + heading.width * 0.75 : box.right - LIGHT_MARGIN
  const top = card?.top ?? heading?.top ?? box.top
  return clampToViewport({ x: x - viewport.left, y: desktop ? top - viewport.top - 54 : 68 }, page)
}
