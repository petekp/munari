// Home light law — where a point light above the page puts the shadow of
// something standing off it, or sunk into it.
//
// The law: a light at height H over the page and a fragment p on the page
// see the occluder plane at height h where the ray from light to p crosses
// it: q = light + (p - light) · (1 - h / H). Ink at q shades p. A well's
// floor sits d below the page, so the ray from the light to a floor point p
// crosses the page surface at q = light + (p - light) · H / (H + d), and
// the floor is shaded when q lies OUTSIDE the well — the rim occludes it.
// Both points sit on the light's side of p, so every shadow falls away
// from the light and every inset shadow hugs the rim nearest it.
//
// Fault: the lamp spike (2026-09-01) hard-coded one standoff for the
// headline only. The masthead has three kinds of content (glyphs, raised
// controls, wells). These plane intersections are the reference cases for
// the shader's thin surfaces; curved receivers require tracing the full ray.
//
// Ownership: this module owns the projection and the fixed standoffs.
// homeLight.ts owns the GLSL that applies them per fragment. HomeMasthead.tsx
// owns where the light is.

export interface Point {
  readonly x: number
  readonly y: number
}

/** Default height in CSS px; the control spans 220–600. Decisions #50–51. */
export const LIGHT_HEIGHT = 260
/** At the largest headline size, CSS px; scales with the type. Decision #50. */
export const GLYPH_STANDOFF = 64
/** Thin controls and gallery images cast long projected shadows. Decision #50. */
export const RAISED_STANDOFF = 40
/** The live postcard's resting plane stays close to its retained slot. Decision #51. */
export const POSTCARD_STANDOFF = 12
/** Inputs and code wells sink this far in, CSS px. Decision #50. */
export const WELL_DEPTH = 3

/** The page point whose ink occludes `p`, for a plane `standoff` px above the page. */
export function occluderPoint(light: Point, p: Point, standoff: number, height = LIGHT_HEIGHT): Point {
  const k = 1 - standoff / height
  return { x: light.x + (p.x - light.x) * k, y: light.y + (p.y - light.y) * k }
}

/** Where the ray to a well-floor point `p`, `depth` px down, crosses the page surface. */
export function wellRimPoint(light: Point, p: Point, depth: number, height = LIGHT_HEIGHT): Point {
  const k = height / (height + depth)
  return { x: light.x + (p.x - light.x) * k, y: light.y + (p.y - light.y) * k }
}

/** Length of the shadow thrown at `p`: how far its occluder point sits from it. */
export function throwLength(light: Point, p: Point, standoff: number, height = LIGHT_HEIGHT): number {
  const q = occluderPoint(light, p, standoff, height)
  return Math.hypot(p.x - q.x, p.y - q.y)
}
