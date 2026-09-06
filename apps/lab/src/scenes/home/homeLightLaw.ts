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
// headline only. The masthead has three kinds of matter (glyphs, raised
// controls, wells), so the projection is one pure function here and the
// shader mirrors it per kind.
//
// Ownership: this module owns the projection and the fixed standoffs.
// homeLight.ts owns the GLSL that applies them per fragment. HomeMasthead.tsx
// owns where the light is.

export interface Point {
  readonly x: number
  readonly y: number
}

/** The light's height above the page, CSS px. Lower throws longer shadows;
 * at 120 a glyph a screen away threw a detached ghost of itself (2026-09-05). */
export const LIGHT_HEIGHT = 380
/** Headline glyphs stand this far off the paper. */
export const GLYPH_STANDOFF = 22
/** Buttons, cards and media stand this far off. */
export const RAISED_STANDOFF = 12
/** Inputs and code wells sink this far in. */
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
