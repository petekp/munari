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

// ---------------------------------------------------------------------
// What color the picture spills.
//
// The room bounce is one flat color laid under the whole sphere, and it
// is the ONLY path by which a picture standing behind the slab reaches
// a panel face pointing at the viewer. So the number it averages had
// better be the right number.
//
// It used to be measured off the equirect itself, and that was a
// category mistake. An equirect is equal-ANGLE. The picture is ~918 px
// wide standing 48 px away, so it spans 84 degrees of half-angle: its
// center is magnified enormously and its rim is squashed onto the
// horizon. Integrated against the layer stack, the two smallest blades
// are 4.3% of the picture and set 40% of the color, while the outer
// half of the stack falls from its true 75% share to 21.7%. The bounce
// came out the color of the middle of the picture — which is exactly
// what it looked like.
//
// A second bounce is driven by FLUX, and flux goes with AREA. So the
// average is taken in the picture's own flat space, where each blade
// counts for the size it is. Solid angle still decides HOW MUCH of the
// surroundings is lit picture — that part the equirect had right, and
// the scene still measures coverage there.

/** The picture's flat sample, per side. Small on purpose: this is one
 *  color, and 1024 texels already over-resolve it. */
export const ROOM_SAMPLE = 32

/** The color a picture throws into the room, in 0..1 channels. */
export interface RoomLight {
  r: number
  g: number
  b: number
}

const REC709 = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/**
 * The bounce color of a flat RGBA raster of the picture.
 *
 * Two departures from a plain mean, both of them the difference between
 * light and paint:
 *
 * 1. Each texel is weighted by its own luminance, not just its cover. A
 *    dim wide field and a bright narrow one do not throw equal light,
 *    and a plain color mean says they do.
 * 2. The chroma destroyed by averaging is put back. Opposed hues cancel
 *    in RGB, so a complementary palette — the whole point of the wide
 *    schemes — bounced GRAY, the one color it is not. The mean carries
 *    the right hue and the right brightness; only its saturation is an
 *    artifact of the averaging, so only its saturation is restored, and
 *    only ever upward, to the mean saturation of the texels themselves.
 */
export function roomLight(px: ArrayLike<number>): RoomLight {
  let wr = 0
  let wg = 0
  let wb = 0
  let ws = 0
  let sum = 0
  for (let i = 0; i + 3 < px.length; i += 4) {
    const a = px[i + 3] / 255
    if (a <= 0) continue
    const r = px[i] / 255
    const g = px[i + 1] / 255
    const b = px[i + 2] / 255
    const w = a * REC709(r, g, b)
    if (w <= 0) continue
    wr += w * r
    wg += w * g
    wb += w * b
    const mx = Math.max(r, g, b)
    ws += w * (mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0)
    sum += w
  }
  if (sum <= 0) return { r: 0, g: 0, b: 0 }
  const mean = { r: wr / sum, g: wg / sum, b: wb / sum }
  const want = ws / sum
  // Push the mean away from its own gray until it carries the chroma
  // its texels did. The brightest channel is held fixed, so this moves
  // saturation alone — never hue, never brightness.
  const mx = Math.max(mean.r, mean.g, mean.b)
  if (mx <= 0) return mean
  const have = (mx - Math.min(mean.r, mean.g, mean.b)) / mx
  if (have <= 1e-4 || want <= have) return mean
  const k = want / have
  const pull = (c: number) => Math.max(0, mx - (mx - c) * k)
  return { r: pull(mean.r), g: pull(mean.g), b: pull(mean.b) }
}

/**
 * How much of the room the picture fills — its solid angle, as a
 * fraction of the hemisphere it stands in.
 *
 * This was read back off the equirect with a one-pixel `getImageData`,
 * and that one pixel cost more than everything else the scene does. A
 * readback from a canvas that also feeds a texture makes the CPU wait
 * for the GPU: ~18 ms per call, 20 times a second, and it owned EVERY
 * long task in the scene — 51 across a four-phase run, idle frames
 * spiking to 142 ms (instruments/knobs-hz). Software-backing that canvas
 * cures the stall and doubles the mean frame instead, so the answer is
 * to stop asking the GPU.
 *
 * It was also wrong. A 1x1 `drawImage` downscale is not a box average;
 * Chrome samples near the middle, so the meter reported 1.0000 against a
 * true 0.8137 — the same center bias that made the bounce come out the
 * color of the middle of the picture.
 *
 * Nothing here needs a pixel of the equirect. The lit region is the page
 * at a known depth, and the flat raster the color is already measured
 * from says how solidly each part of it is painted. Each texel of that
 * raster subtends dA·cos(theta)/r^2 = dA·d/r^3, and the hemisphere is
 * 2*pi — so the weights depend only on the viewport and the depth, and
 * are built once per resize rather than per frame.
 */
export function solidAngleField(
  viewportW: number,
  viewportH: number,
  depth: number,
  n = ROOM_SAMPLE,
): Float32Array {
  const w = new Float32Array(n * n)
  const dA = (viewportW / n) * (viewportH / n)
  const d = Math.abs(depth)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const px = ((x + 0.5) / n - 0.5) * viewportW
      const py = ((y + 0.5) / n - 0.5) * viewportH
      const r = Math.hypot(px, py, d)
      w[y * n + x] = (dA * d) / (r * r * r) / (Math.PI * 2)
    }
  }
  return w
}

/** The picture's share of the hemisphere: how solidly each texel is
 *  painted, weighted by the solid angle that texel subtends. */
export function roomCover(px: ArrayLike<number>, field: ArrayLike<number>): number {
  let sum = 0
  const n = Math.min(field.length, px.length >> 2)
  for (let i = 0; i < n; i++) sum += (px[i * 4 + 3] / 255) * field[i]
  return Math.min(1, sum)
}
