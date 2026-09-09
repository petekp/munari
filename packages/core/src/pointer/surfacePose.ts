// The presented pose — where a Surface's content pixels are standing on the
// screen this frame, as one matrix that content px and client px share.
//
// The law: a Surface has ONE presented pose, and every consumer of "where is
// this content right now" reads that one. Two of them exist. The native route
// hands the pose to CSS as a `matrix3d` on the parked canvas and lets the
// browser hit-test the drawn child through it. Everything that reasons about
// the hit region — whether the pose is even expressible as a planar
// homography, which way the sheet is facing, where a texture uv lands on
// screen — reads the same numbers. `posePoint` at rest is the relay's own
// `rect.left + u * rect.width`, derived rather than repeated.
//
// The fault: a projection computed twice is a projection that drifts. The two
// copies agree in the case the author tested and part company under the one
// they did not — a mirrored source, a non-square viewport, a scrolled page —
// and the failure is a click that lands a few pixels off with no error
// anywhere. That class of bug is invisible in review and expensive to notice,
// which is why the pose is a value passed around rather than a recipe
// followed twice.
//
// The chain is three's own (`viewport · P · V · M · pixelToLocal`), measured
// 2026-09-02 against Chrome 151 to predict the browser's transformed client
// rects to 0.01px, with the browser's hit region agreeing with the GL
// rasterization to within 1.25px (median 0.75px) across the sampled poses —
// and the native hit clip following the TRANSFORMED canvas box to 0.25px at
// a perspective edge (docs/platform.md #18–#21). Those numbers are what
// license the native route at all; see decisions.md #39.
//
// Ownership: this module owns the arithmetic and nothing else. It never
// touches the DOM, never reads a camera, and has no opinion about which route
// should run — `pointerRoute.ts` decides that, `nativeRoute.ts` applies it,
// and the binding is the only thing that knows these matrices came from
// three.

/**
 * A 4×4 matrix as 16 numbers in column-major order — three's own
 * `Matrix4.elements` layout, and CSS `matrix3d`'s argument order. The two
 * agreeing is why no transposition happens anywhere below.
 */
export type Mat4Elements = readonly number[]

/** Everything the presented pose is a function of. */
export interface SurfacePoseInput {
  /** The content root's own CSS box, in px. */
  readonly contentWidth: number
  readonly contentHeight: number
  /** True when the presenter samples its texture mirrored in u. */
  readonly mirrorU: boolean
  /** The presented mesh's world matrix. */
  readonly model: Mat4Elements
  /** The camera's world-inverse (three's `matrixWorldInverse`). */
  readonly view: Mat4Elements
  /** The camera's projection matrix. */
  readonly projection: Mat4Elements
  /** The renderer canvas's CSS box, in client coordinates. */
  readonly viewportLeft: number
  readonly viewportTop: number
  readonly viewportWidth: number
  readonly viewportHeight: number
}

/**
 * The pose, in client coordinates. Mutable and reused: a presenter recomputes
 * this every frame, and a per-frame allocation of two arrays per Surface is
 * the kind of garbage that shows up as a stutter under a scene of panels.
 */
export interface SurfacePose {
  /** Content px → client px. Column-major; CSS performs the w divide. */
  matrix: number[]
  /** The content box's corners in client px: TL, TR, BR, BL, as x,y pairs. */
  quad: number[]
  /** The content box this pose was built for, in CSS px. */
  contentWidth: number
  contentHeight: number
  /** The quad's axis-aligned bounds in client px. */
  left: number
  top: number
  right: number
  bottom: number
  /**
   * False when this pose has no planar answer for the browser: a corner
   * behind the camera, a non-finite matrix, or a quad too thin to point at.
   * A consumer that ignores this reads stale bounds.
   */
  planar: boolean
  /**
   * True when the sheet's FRONT face is toward the camera, read from the
   * projected quad's winding (mirrorU flips the winding of the map, not the
   * facing of the mesh, so the sign test accounts for it). Three's default
   * raycast refuses a back-facing hit under `FrontSide`; the native route
   * has to refuse the same poses or the same Surface takes clicks on one
   * route and not the other. False whenever `planar` is false.
   */
  frontFacing: boolean
}

/** A point in client coordinates. */
export interface PosePoint {
  x: number
  y: number
}

export function createSurfacePose(): SurfacePose {
  return {
    matrix: new Array<number>(16).fill(0),
    quad: new Array<number>(8).fill(0),
    contentWidth: 0,
    contentHeight: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    planar: false,
    frontFacing: false,
  }
}

/**
 * A hit region thinner than one CSS pixel in either axis is not something a
 * hand can land on, and an edge-on plane's matrix is singular — engines are
 * free to drop a singular transform out of hit-testing entirely. One pixel is
 * the smallest region a pointer can address, so it is the floor.
 */
const MIN_HIT_EDGE_PX = 1

/**
 * Corners closer to the camera plane than this have already lost their sign,
 * and a w divide there produces coordinates in the millions. The projection
 * is only meaningful strictly in front, so anything at or below this counts
 * as behind.
 */
const MIN_CLIP_W = 1e-6

const _a = new Array<number>(16).fill(0)
const _b = new Array<number>(16).fill(0)

/** C = A · B, column-major, written into `out`. `out` may alias neither input. */
function multiply(a: Mat4Elements, b: Mat4Elements, out: number[]) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0)
      out[c * 4 + r] = sum
    }
  }
}

/** Apply `m` to (x, y, 0, 1) and divide through. Returns w, which the caller judges. */
function project(m: Mat4Elements, x: number, y: number, out: PosePoint): number {
  const px = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[12] ?? 0)
  const py = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[13] ?? 0)
  const pw = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[15] ?? 0)
  out.x = px / pw
  out.y = py / pw
  return pw
}

const _corner: PosePoint = { x: 0, y: 0 }

function matrixIsFinite(m: Mat4Elements): boolean {
  for (const value of m) if (!Number.isFinite(value)) return false
  return true
}

/**
 * Project the content box's corners TL→TR→BR→BL into `out.quad` and the
 * client-px bounds. False when any corner sits at or behind the eye plane
 * (clip w ≤ `MIN_CLIP_W`) — a quad with a corner there has no finite screen
 * position to hit-test.
 */
function projectCorners(m: Mat4Elements, w: number, h: number, out: SurfacePose): boolean {
  const corners: number[] = [0, 0, w, 0, w, h, 0, h]
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (let i = 0; i < 4; i++) {
    const clipW = project(m, corners[i * 2] ?? 0, corners[i * 2 + 1] ?? 0, _corner)
    if (!(clipW > MIN_CLIP_W)) return false
    out.quad[i * 2] = _corner.x
    out.quad[i * 2 + 1] = _corner.y
    left = Math.min(left, _corner.x)
    top = Math.min(top, _corner.y)
    right = Math.max(right, _corner.x)
    bottom = Math.max(bottom, _corner.y)
  }
  out.left = left
  out.top = top
  out.right = right
  out.bottom = bottom
  return true
}

/** Twice the signed shoelace area of the projected quad, in y-down client px. */
function windingDoubled(quad: number[]): number {
  let doubled = 0
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    doubled += (quad[i * 2] ?? 0) * (quad[j * 2 + 1] ?? 0) - (quad[j * 2] ?? 0) * (quad[i * 2 + 1] ?? 0)
  }
  return doubled
}

/**
 * The presented pose, from the matrices three already keeps.
 *
 * `pixelToLocal` is the only part that is munari's rather than three's: a
 * Surface's content px run y-down from the top-left corner, and the unit
 * plane's local coordinates run y-up from the centre, so the content box maps
 * onto [-0.5, 0.5]² with y inverted. A mirrored source flips x on top of
 * that, because `repeat.x = -1` means the pixel drawn at geometry u is the
 * content pixel at 1 - u — the same flip, expressed where the pose can carry
 * it instead of at every call site.
 */
export function surfacePose(input: SurfacePoseInput, out: SurfacePose): SurfacePose {
  const w = input.contentWidth
  const h = input.contentHeight
  const cw = input.viewportWidth
  const ch = input.viewportHeight
  out.planar = false
  out.frontFacing = false
  out.contentWidth = w
  out.contentHeight = h
  if (w <= 0 || h <= 0 || cw <= 0 || ch <= 0) return out

  // content px → unit-plane local
  const sx = input.mirrorU ? -1 / w : 1 / w
  const tx = input.mirrorU ? 0.5 : -0.5
  const pixelToLocal: number[] = [
    sx, 0, 0, 0,
    0, -1 / h, 0, 0,
    0, 0, 1, 0,
    tx, 0.5, 0, 1,
  ]

  // ndc → client px, applied to CLIP coordinates so the divide stays at the
  // end where CSS performs it. The z row passes through at unit scale: a zero
  // row would make the matrix singular, and a singular transform is one an
  // engine may refuse to hit-test.
  const viewport: number[] = [
    cw / 2, 0, 0, 0,
    0, -ch / 2, 0, 0,
    0, 0, 1, 0,
    input.viewportLeft + cw / 2, input.viewportTop + ch / 2, 0, 1,
  ]

  multiply(input.view, input.model, _a)
  multiply(input.projection, _a, _b)
  multiply(viewport, _b, _a)
  multiply(_a, pixelToLocal, out.matrix)

  if (!matrixIsFinite(out.matrix)) return out
  if (!projectCorners(out.matrix, w, h, out)) return out
  out.planar =
    out.right - out.left >= MIN_HIT_EDGE_PX && out.bottom - out.top >= MIN_HIT_EDGE_PX

  // Shoelace over TL→TR→BR→BL in y-down client coordinates: positive for a
  // front-facing unmirrored sheet, and mirrorU flips the winding of the map
  // without turning the mesh, so the expectation flips with it.
  const doubled = windingDoubled(out.quad)
  out.frontFacing = out.planar && (input.mirrorU ? doubled < 0 : doubled > 0)
  return out
}

/**
 * Where a texture uv lands on screen, in client px.
 *
 * This is the relay's own hit geometry, derived instead of repeated: at rest
 * the parked source stands at its layout box with no transform, and this
 * returns exactly `rect.left + u * rect.width`, `rect.top + (1 - v) *
 * rect.height`. Under any other pose it returns where the pixels actually
 * are. The two routes place a uv at the same point because there is only one
 * map.
 */
export function posePoint(pose: SurfacePose, u: number, v: number, out: PosePoint): PosePoint {
  // The matrix, not an interpolation across the projected corners: under
  // perspective the map is projective, so lerping the corners drifts toward
  // the middle of a tilted quad by whatever the foreshortening is worth.
  project(pose.matrix, u * pose.contentWidth, (1 - v) * pose.contentHeight, out)
  return out
}

/** CSS number formatting: fixed notation, because `matrix3d` parses no exponents. */
function css(value: number): string {
  return value.toFixed(8)
}

/**
 * The pose as a CSS `matrix3d` for an element whose border-box origin stands
 * at (originX, originY) in client coordinates, with `transform-origin: 0 0`.
 *
 * The parked canvas wears this. It is parked at client (0, 0)
 * (`position: fixed; left: 0; top: 0`, `paint/htmlInCanvas.ts`), so the
 * caller passes that origin and the transform maps content px to offsets
 * from it — the client-space pose with the box origin subtracted.
 * Subtracting a translation from a projective matrix is a row operation on
 * the w row, not a change to the projection.
 */
export function poseMatrix3d(pose: SurfacePose, originX: number, originY: number): string {
  const m = pose.matrix
  const parts: string[] = []
  for (let c = 0; c < 4; c++) {
    const wRow = m[c * 4 + 3] ?? 0
    parts.push(css((m[c * 4] ?? 0) - originX * wRow))
    parts.push(css((m[c * 4 + 1] ?? 0) - originY * wRow))
    parts.push(css(m[c * 4 + 2] ?? 0))
    parts.push(css(wRow))
  }
  return `matrix3d(${parts.join(', ')})`
}

/**
 * Does the projected quad reach the viewport at all?
 *
 * A parked canvas whose transformed box leaves the screen entirely stops
 * getting paint records — the compositor skips it — so a Surface whose pose
 * has flown off screen must not drag its source out of the compositor's
 * reach on the way. The canvas's transformed box IS the quad under the
 * native rig, so testing the quad is testing the box.
 */
export function poseOnScreen(
  pose: SurfacePose,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  return (
    pose.planar &&
    pose.right > 0 &&
    pose.bottom > 0 &&
    pose.left < viewportWidth &&
    pose.top < viewportHeight
  )
}
