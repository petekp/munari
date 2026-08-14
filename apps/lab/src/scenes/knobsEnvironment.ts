// Where the room's light is allowed to come from.
//
// `scene.environment` is a claim about DIRECTION: whatever color stands
// at a direction is the light a surface facing that way receives. The
// artwork is a plane BEHIND the slab, so it may occupy only the
// hemisphere behind the slab, and the hemisphere behind the VIEWER —
// where every camera-facing knob top samples — must be room.
//
// The first bake did not obey that. It painted the picture twice around
// the sphere "so every reflection angle finds it", the second copy
// sitting squarely behind the camera, over a backdrop that filled the
// remaining sphere. The cost was measurable: a knob face picked up the
// artwork's magenta, and WHICH magenta depended on where the slab
// happened to stand, because the slab's yaw steers which part of the
// wrap each normal samples. Nulling `scene.environment` for one frame
// at the left station dropped the face's magenta excess from 29 to 3,
// and restoring it brought all 29 back — the whole defect, in one term
// (docs/spikes/knobs-lighting.md).
//
// So this module owns the geometry, and the suite pins one law: every
// point of the art plane lands in the art's own hemisphere, and nothing
// the artwork draws can reach the viewer's side of the room. The scene
// paints; it does not decide where.
//
// Frames, stated once. World space is the scene's: CSS px, origin at
// the viewport center, +x right, +y UP, +z toward the viewer. Art space
// is the SVG's `-100 -100 200 200` box, y DOWN, letterboxed into the
// shorter viewport axis. Canvas space is the equirect bitmap, row 0 at
// the top — which is the ZENITH, because a CanvasTexture uploads with
// `flipY` and three's default is true.

/** Equirect coordinates: `u` wraps at the −x seam, `v` runs 0 at the
 *  nadir to 1 at the zenith. */
export interface EnvUV {
  u: number
  v: number
}

/** A pixel of the equirect bitmap. */
export interface EnvPixel {
  x: number
  y: number
}

/** The column the artwork stands in: −z, dead behind the slab. */
export const ART_U = 0.25

/** The column the camera stands in: +z. Nothing the artwork draws may
 *  come near this — there is no picture behind the viewer. */
export const CAMERA_U = 0.75

/**
 * three's `equirectUv`, in the same form the shader uses — so what this
 * module paints is what the material samples. The direction need not be
 * normalized.
 */
export function equirectUV(x: number, y: number, z: number): EnvUV {
  const len = Math.hypot(x, y, z) || 1
  const up = Math.min(Math.max(y / len, -1), 1)
  return {
    u: Math.atan2(z, x) / (Math.PI * 2) + 0.5,
    v: Math.asin(up) / Math.PI + 0.5,
  }
}

/** The pixel a direction samples on a W×H equirect bitmap uploaded with
 *  `flipY` — row 0 is v = 1, the zenith. */
export function envPixel(uv: EnvUV, W: number, H: number): EnvPixel {
  return { x: uv.u * W, y: (1 - uv.v) * H }
}

/**
 * A point of the artwork → the pixel of the environment that stands for
 * it. `px`/`py` are world CSS px on the art plane (y UP, viewport-center
 * origin); the plane itself stands `depth` px behind the world origin.
 *
 * Because the plane's z is strictly negative, `u` is strictly inside
 * (0, 0.5) for every point on it, at any depth and any page size. That
 * is the whole guarantee: the artwork cannot reach the viewer's half of
 * the room, so a camera-facing surface can never mirror it.
 */
export function artPixel(
  px: number,
  py: number,
  depth: number,
  W: number,
  H: number,
): EnvPixel {
  return envPixel(equirectUV(px, py, -Math.max(depth, 1e-6)), W, H)
}

/** Parse the art's own `"x,y x,y …"` polygon format into art-space
 *  pairs. Malformed pairs are dropped rather than poisoning the path
 *  with NaN — a half-written frame must not blank the room. */
export function parseArtPoints(points: string): [number, number][] {
  const out: [number, number][] = []
  for (const pair of points.split(' ')) {
    if (!pair) continue
    const parts = pair.split(',')
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '') continue
    const x = Number(parts[0])
    const y = Number(parts[1])
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y])
  }
  return out
}

/**
 * Project a polygon of the artwork onto the environment, subdividing
 * every edge `steps` ways.
 *
 * The subdivision is not decoration. The art plane sits tens of px
 * behind a slab that is hundreds of px wide, so one facet of one layer
 * can span a quarter of the sphere — and a straight edge on a plane is
 * a CURVE through an equirect map. Joining projected vertices with
 * straight lines would cut the corners of the picture badly enough to
 * change what the metal reflects. Interpolating on the PLANE first and
 * projecting each sample is the correct order.
 *
 * `pts` are art-space (SVG box, y DOWN); `scale` is world px per art
 * unit — the letterbox factor `min(viewportW, viewportH) / 200`.
 */
export function projectArtPolygon(
  pts: readonly (readonly [number, number])[],
  scale: number,
  depth: number,
  W: number,
  H: number,
  steps = 12,
): EnvPixel[] {
  const n = pts.length
  if (n < 2) return []
  const cuts = Math.max(1, Math.floor(steps))
  const out: EnvPixel[] = []
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[(i + 1) % n]
    for (let s = 0; s < cuts; s++) {
      const t = s / cuts
      // SVG y runs DOWN; the world's runs up.
      const x = (ax + (bx - ax) * t) * scale
      const y = -(ay + (by - ay) * t) * scale
      out.push(artPixel(x, y, depth, W, H))
    }
  }
  return out
}

/**
 * The artwork's silhouette in the room: the page rectangle itself,
 * projected the same way. The picture is a window of finite size, not
 * an infinite wall, so its light stops — at the grazing columns near
 * the seam and at the poles, where the page has run out. Everything
 * outside this outline is room.
 */
export function projectViewportOutline(
  viewportW: number,
  viewportH: number,
  depth: number,
  W: number,
  H: number,
  steps = 24,
): EnvPixel[] {
  const hw = viewportW / 2
  const hh = viewportH / 2
  const corners: [number, number][] = [
    [-hw, hh],
    [hw, hh],
    [hw, -hh],
    [-hw, -hh],
  ]
  const cuts = Math.max(1, Math.floor(steps))
  const out: EnvPixel[] = []
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i]
    const [bx, by] = corners[(i + 1) % 4]
    for (let s = 0; s < cuts; s++) {
      const t = s / cuts
      out.push(artPixel(ax + (bx - ax) * t, ay + (by - ay) * t, depth, W, H))
    }
  }
  return out
}

/** The bounding box of a projected path, for laying a gradient along
 *  the picture's own height rather than the whole bitmap's. */
export function pathBounds(pts: readonly EnvPixel[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}
