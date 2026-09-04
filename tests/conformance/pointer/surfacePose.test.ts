// One pose, two consumers.
//
// The whole reason `surfacePose` exists is that two things need to know where
// a Surface's content pixels are standing: the relay, which turns a texture uv
// into a page point and walks the DOM there, and the native route, which hands
// the browser a `matrix3d` and lets it hit-test the real child. Computed
// twice, those two agree in the case the author tried and part company under
// the one they did not — a mirrored source, a non-square viewport, a scrolled
// page — and the symptom is a click a few pixels off with no error anywhere.
//
// So the contract is agreement, pinned three ways:
//   1. at rest, `posePoint` IS the relay's own arithmetic, digit for digit;
//   2. the `matrix3d` handed to CSS, applied the way CSS applies it, lands on
//      the same client point `posePoint` names;
//   3. the pose refuses — `planar: false` — every case a planar homography
//      cannot express, rather than returning stale bounds.
//
// The matrices are built here by hand rather than pulled from three, because
// this is core's contract and core has no renderer. They are three's own
// layouts: column-major, `Matrix4.elements` order, which is also CSS
// `matrix3d`'s argument order (that agreement is why nothing transposes).

import { describe, expect, it } from 'vitest'
import {
  createSurfacePose,
  poseMatrix3d,
  poseOnScreen,
  posePoint,
  surfacePose,
  type SurfacePose,
  type SurfacePoseInput,
} from '@munari/core'

// ── the fixtures ──────────────────────────────────────────────────────────

const CONTENT_W = 320
const CONTENT_H = 200
const VIEW_LEFT = 40
const VIEW_TOP = 24
const VIEW_W = 800
const VIEW_H = 600

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/**
 * An orthographic projection whose world units are the viewport's own CSS
 * pixels. That is munari at rest: the plane is scaled so its content box lands
 * on the screen at 1:1 (`planeScale`), and every corner carries w = 1.
 */
const ORTHO = [2 / VIEW_W, 0, 0, 0, 0, 2 / VIEW_H, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]

/** A GL perspective, so the w divide is real and the map is projective. */
function perspective(fovDeg: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360)
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]
}

/** The camera's `matrixWorldInverse` for a camera sitting at +z looking down -z. */
function viewAt(distance: number): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -distance, 1]
}

/** `translate(tx, 0, tz) · rotateY(deg) · scale(w, h, 1)`, as a mesh world matrix. */
function model(scaleX: number, scaleY: number, degrees = 0, tx = 0, tz = 0): number[] {
  const t = (degrees * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  return [
    scaleX * c, 0, scaleX * -s, 0,
    0, scaleY, 0, 0,
    s, 0, c, 0,
    tx, 0, tz, 1,
  ]
}

function input(overrides: Partial<SurfacePoseInput> = {}): SurfacePoseInput {
  return {
    contentWidth: CONTENT_W,
    contentHeight: CONTENT_H,
    mirrorU: false,
    model: model(CONTENT_W, CONTENT_H),
    view: IDENTITY,
    projection: ORTHO,
    viewportLeft: VIEW_LEFT,
    viewportTop: VIEW_TOP,
    viewportWidth: VIEW_W,
    viewportHeight: VIEW_H,
    ...overrides,
  }
}

function posed(overrides: Partial<SurfacePoseInput> = {}): SurfacePose {
  return surfacePose(input(overrides), createSurfacePose())
}

const at = (pose: SurfacePose, u: number, v: number) => posePoint(pose, u, v, { x: 0, y: 0 })

/**
 * Read a `matrix3d(...)` back and apply it the way CSS does, from a border-box
 * origin at (originX, originY) with `transform-origin: 0 0`. This is the
 * browser's half of the native route, modelled just closely enough to check
 * that the string we hand it says what the pose says.
 */
function applyMatrix3d(css: string, originX: number, originY: number, x: number, y: number) {
  const body = css.slice(css.indexOf('(') + 1, css.lastIndexOf(')'))
  const m = body.split(',').map((part) => Number(part))
  expect(m).toHaveLength(16)
  const px = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[12] ?? 0)
  const py = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[13] ?? 0)
  const pw = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[15] ?? 0)
  return { x: originX + px / pw, y: originY + py / pw }
}

// ── at rest: the relay's own arithmetic ───────────────────────────────────

describe('the pose at rest', () => {
  // Hand-derivable, and derived: the plane's content box is scaled to
  // 320 × 200 world units, the viewport maps 800 × 600 world units onto its
  // own 800 × 600 CSS box at (40, 24), so the box lands centred at
  // (40 + 400 − 160, 24 + 300 − 100) = (280, 224) and runs to (600, 424).
  const REST = { left: 280, top: 224, right: 600, bottom: 424 }

  it('lands the content box exactly where the page would have drawn it', () => {
    const pose = posed()
    expect(pose.planar).toBe(true)
    expect(pose.left).toBeCloseTo(REST.left, 9)
    expect(pose.top).toBeCloseTo(REST.top, 9)
    expect(pose.right).toBeCloseTo(REST.right, 9)
    expect(pose.bottom).toBeCloseTo(REST.bottom, 9)
  })

  it('agrees with the relay digit for digit', () => {
    // `forwardPointer`'s own two lines, written out. If these ever disagree,
    // the two routes put the same uv on two different elements — and the only
    // visible symptom is that one route's clicks miss near a boundary.
    const rect = { left: REST.left, top: REST.top, width: CONTENT_W, height: CONTENT_H }
    const pose = posed()
    for (const [u, v] of [
      [0, 1], [1, 1], [1, 0], [0, 0], [0.5, 0.5], [0.25, 0.6], [0.03, 0.97],
    ] as const) {
      const point = at(pose, u, v)
      expect(point.x).toBeCloseTo(rect.left + u * rect.width, 9)
      expect(point.y).toBeCloseTo(rect.top + (1 - v) * rect.height, 9)
    }
  })

  it('names the quad corners in TL, TR, BR, BL order', () => {
    const pose = posed()
    const expected = [
      REST.left, REST.top,
      REST.right, REST.top,
      REST.right, REST.bottom,
      REST.left, REST.bottom,
    ]
    for (const [i, value] of expected.entries()) {
      expect(pose.quad[i]).toBeCloseTo(value, 9)
    }
  })

  it('worn from the page origin, is a pure translation onto the layout box', () => {
    // The parked canvas stands at client (0, 0) (`position:fixed;left:0;top:0`,
    // paint/htmlInCanvas) and wears the pose itself, so the matrix's whole job
    // at rest is to carry the content to its box — every pixel by the same
    // offset, nothing scaled, nothing divided. A wrong answer here means the
    // content's hit region jumps the instant the native route takes over.
    const pose = posed()
    const css = poseMatrix3d(pose, 0, 0)
    for (const [x, y] of [[0, 0], [CONTENT_W, 0], [CONTENT_W, CONTENT_H], [80, 80]] as const) {
      const applied = applyMatrix3d(css, 0, 0, x, y)
      expect(applied.x).toBeCloseTo(REST.left + x, 6)
      expect(applied.y).toBeCloseTo(REST.top + y, 6)
    }
  })
})

// ── in projection: the same point, through CSS ────────────────────────────

const TILTED = {
  model: model(CONTENT_W, CONTENT_H, 40),
  view: viewAt(700),
  projection: perspective(50, VIEW_W / VIEW_H, 0.1, 2000),
}

describe('the pose under perspective', () => {
  it('hands CSS a matrix that lands on the point the relay would have used', () => {
    // The one contract that makes "one pose, two consumers" mean something:
    // the string the browser hit-tests through and the point the relay walks
    // to are the same map, checked through a real parse-and-apply rather than
    // by reading the code twice.
    const pose = posed(TILTED)
    const css = poseMatrix3d(pose, 0, 0)
    for (const [u, v] of [
      [0, 1], [1, 1], [1, 0], [0, 0], [0.5, 0.5], [0.18, 0.71],
    ] as const) {
      const expected = at(pose, u, v)
      const applied = applyMatrix3d(css, 0, 0, u * CONTENT_W, (1 - v) * CONTENT_H)
      // 1e-4 px, which is the `toFixed(8)` formatting and nothing else. CSS
      // parses no exponent notation, so the string is fixed-point by
      // necessity; the tolerance is what that costs.
      expect(applied.x).toBeCloseTo(expected.x, 4)
      expect(applied.y).toBeCloseTo(expected.y, 4)
    }
  })

  it('puts the quad corners where the uv corners are', () => {
    const pose = posed(TILTED)
    for (const [i, [u, v]] of ([[0, 1], [1, 1], [1, 0], [0, 0]] as const).entries()) {
      const point = at(pose, u, v)
      expect(pose.quad[i * 2]).toBeCloseTo(point.x, 9)
      expect(pose.quad[i * 2 + 1]).toBeCloseTo(point.y, 9)
    }
  })

  it('foreshortens the edge that turned away, not the one that came forward', () => {
    // A handedness check. `rotateY(+40°)` sends +x toward −z, away from a
    // camera on +z, so the right edge is the far one and must be the SHORT
    // one on screen. Transpose any matrix in the chain and this flips, while
    // every agreement test above still passes — they would all be wrong
    // together.
    const pose = posed(TILTED)
    const leftEdge = at(pose, 0, 0).y - at(pose, 0, 1).y
    const rightEdge = at(pose, 1, 0).y - at(pose, 1, 1).y
    expect(rightEdge).toBeLessThan(leftEdge)
  })

  it('projects the centre rather than averaging the corners', () => {
    // Bilinear interpolation across the projected corners is the obvious
    // wrong answer, and it is wrong by an amount a hand can feel: on this 40°
    // tilt the content's centre sits 16.9px from the centre of its own
    // projected quad, which is most of a control's height. The measured gap is
    // pinned so a "simplification" back to corner lerping fails here instead
    // of in a scene, where it would read as a click that misses by a row.
    const pose = posed(TILTED)
    const centre = at(pose, 0.5, 0.5)
    const corner = (i: number) => pose.quad[i] ?? Number.NaN
    const averageX = (corner(0) + corner(2) + corner(4) + corner(6)) / 4
    const averageY = (corner(1) + corner(3) + corner(5) + corner(7)) / 4
    expect(Math.hypot(centre.x - averageX, centre.y - averageY)).toBeCloseTo(16.9, 1)
  })

  it('reads a mirrored source as a flip in u, once, in the pose', () => {
    // `repeat.x = -1` means the pixel drawn at geometry u is the content pixel
    // at 1 − u. Carrying that in the pose is what keeps every call site from
    // having to remember it — and a call site that forgets produces a Surface
    // whose clicks land on the mirror image of what the user aimed at.
    const plain = posed(TILTED)
    const mirrored = posed({ ...TILTED, mirrorU: true })
    for (const [u, v] of [[0, 1], [0.25, 0.5], [1, 0]] as const) {
      const a = at(mirrored, u, v)
      const b = at(plain, 1 - u, v)
      expect(a.x).toBeCloseTo(b.x, 9)
      expect(a.y).toBeCloseTo(b.y, 9)
    }
    expect(mirrored.left).toBeCloseTo(plain.left, 9)
    expect(mirrored.right).toBeCloseTo(plain.right, 9)
  })
})

// ── the refusals ──────────────────────────────────────────────────────────

describe('what the pose refuses', () => {
  it('refuses an edge-on plane', () => {
    // Exactly side-on, the quad has no width, the homography is singular, and
    // an engine is free to drop a singular transform out of hit-testing
    // entirely. There is nothing to point at, so there is nothing to claim.
    const pose = posed({
      model: model(CONTENT_W, CONTENT_H, 90),
      view: viewAt(700),
      projection: perspective(50, VIEW_W / VIEW_H, 0.1, 2000),
    })
    expect(pose.planar).toBe(false)
  })

  it('refuses a quad thinner than one CSS pixel', () => {
    const pose = posed({ model: model(0.5, CONTENT_H) })
    expect(pose.right - pose.left).toBeCloseTo(0.5, 9)
    expect(pose.planar).toBe(false)
  })

  it('refuses a plane behind the camera', () => {
    // w goes negative and the divide produces coordinates in the millions.
    // A pose that reported those as bounds would park the canvas off in
    // nowhere and take the whole document's hit-testing with it.
    const pose = posed({
      model: model(CONTENT_W, CONTENT_H),
      view: viewAt(-700),
      projection: perspective(50, VIEW_W / VIEW_H, 0.1, 2000),
    })
    expect(pose.planar).toBe(false)
  })

  it('refuses a non-finite matrix', () => {
    const pose = posed({ projection: [...ORTHO.slice(0, 5), Number.NaN, ...ORTHO.slice(6)] })
    expect(pose.planar).toBe(false)
  })

  it('refuses a Surface with no content box and one with no viewport', () => {
    expect(posed({ contentWidth: 0 }).planar).toBe(false)
    expect(posed({ contentHeight: 0 }).planar).toBe(false)
    expect(posed({ viewportWidth: 0 }).planar).toBe(false)
    expect(posed({ viewportHeight: 0 }).planar).toBe(false)
  })

  it('carries the content box it was built for, so a refusal cannot be read as bounds', () => {
    const pose = posed({ contentWidth: 0 })
    expect(pose.contentWidth).toBe(0)
    expect(pose.contentHeight).toBe(CONTENT_H)
  })
})

// ── facing ────────────────────────────────────────────────────────────────

// The canvas wears the pose itself and the browser's hit clip follows the
// TRANSFORMED canvas box (measured 2026-09-02, Chrome 151, platform.md #21),
// so coverage is true by construction and there is no parking geometry to
// judge. What remains geometric is the side the viewer sees: three's default
// raycast refuses a back-facing hit under `FrontSide`, and the browser knows
// nothing of material sides — so the pose reports the winding and the route
// law refuses the same poses the relay would.
describe('which side the pose shows', () => {
  it('faces the camera at rest', () => {
    expect(posed().frontFacing).toBe(true)
  })

  it('still faces through the tilt the old parking law refused', () => {
    // Under a pixel calibrated perspective camera this 40° tilt projects
    // 215.5px tall against a 200px content box — the near edge swings toward
    // the eye and magnifies. A content-sized parked box could never cover
    // that, which is why an earlier draft of this route refused every tilt.
    // The clip following the transformed box is what buys these poses; the
    // pinned overhang stays as the measurement of what was bought.
    const pose = posed(TILTED)
    expect(pose.bottom - pose.top).toBeCloseTo(215.5, 1)
    expect(pose.planar).toBe(true)
    expect(pose.frontFacing).toBe(true)
  })

  it('reports a sheet turned past 90° as facing away', () => {
    // The projected winding reverses — TL→TR runs right-to-left on screen.
    // Claiming this face would hand the browser a hit region for content the
    // relay's raycast (FrontSide) refuses, and the two routes would disagree
    // about whether the Surface is touchable at all.
    const pose = posed({ model: model(CONTENT_W, CONTENT_H, 180) })
    expect(pose.planar).toBe(true)
    expect(pose.frontFacing).toBe(false)
  })

  it('reads a mirrored source with the flipped expectation', () => {
    // `mirrorU` flips the content→screen map's winding without turning the
    // mesh, so the sign test flips with it: a mirrored sheet at rest faces
    // the camera, and a mirrored sheet turned past 90° does not.
    expect(posed({ mirrorU: true }).frontFacing).toBe(true)
    expect(
      posed({ mirrorU: true, model: model(CONTENT_W, CONTENT_H, 180) }).frontFacing,
    ).toBe(false)
  })

  it('never claims a face for a pose that refused', () => {
    expect(posed({ contentWidth: 0 }).frontFacing).toBe(false)
    expect(
      posed({
        model: model(CONTENT_W, CONTENT_H, 90),
        view: viewAt(700),
        projection: perspective(50, VIEW_W / VIEW_H, 0.1, 2000),
      }).frontFacing,
    ).toBe(false)
  })
})

describe('whether the pose still reaches the screen', () => {
  it('accepts a Surface standing in the viewport', () => {
    expect(poseOnScreen(posed(), VIEW_W, VIEW_H)).toBe(true)
  })

  it('refuses a Surface that has flown off the side', () => {
    // A parked canvas outside the viewport stops receiving paint records — the
    // compositor skips it — so a Surface that flies away must not drag its own
    // source out of the compositor's reach on the way.
    const pose = posed({ model: model(CONTENT_W, CONTENT_H, 0, -2000) })
    expect(pose.right).toBeLessThan(0)
    expect(poseOnScreen(pose, VIEW_W, VIEW_H)).toBe(false)
  })

  it('refuses a pose that refused', () => {
    expect(poseOnScreen(posed({ contentWidth: 0 }), VIEW_W, VIEW_H)).toBe(false)
  })
})
