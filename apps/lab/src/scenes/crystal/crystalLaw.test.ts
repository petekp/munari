// The crystal's contract.
//
// Two things are pinned here and they are pinned for different reasons.
//
// The NUMBERS are pinned because they are the scene's argument. How far the
// page moves under the hotspot is how big a claim the demo is making, and
// how far a hand tremor moves it is whether the claim is usable. Neither is
// visible in a screenshot: a crystal with a 5px bend and a crystal with a
// 47px bend look equally like glass, and only one of them can miss a key.
//
// The TRANSCRIPTION is pinned because `crystalLaw.ts` and
// `crystalShaders.ts` are one function written in two languages. The shader
// draws and the law decides where a click lands, so a difference between
// them is a click landing where nobody looked — and the picture stays
// perfect the whole time, because the picture comes from the copy that is
// right. Nothing about that failure is visible in review.
//
// This suite does not run GLSL. The end-to-end weld — the shader's own
// pixels against the law's own correction — is `gate:crystal-pointer`,
// which does it in a browser, because that is the only place the two ever
// actually meet.

import { describe, expect, it } from 'vitest'
import { cameraDistance } from '@petepetrash/munari/advanced'
import {
  ARROW,
  ARROW_AXIS,
  GRAD_EPS,
  MARCH_EPS,
  MARCH_STEPS,
  REST_FRAME,
  MAX_BOUNCES,
  WEIGHT_FLOOR,
  bendAt,
  bottomAt,
  boundsOf,
  frameOf,
  hotspotDrop,
  lightDirOf,
  makePose,
  normalAt,
  sdArrowPolygon,
  sdCrystal,
  schlick,
  sdInner2,
  stepCrystal,
  toLocal,
  topAt,
  traceCrystal,
  type CrystalFrame,
  type Vec3,
} from './crystalLaw'
import { CRYSTAL_FRAG } from './crystalShaders'
import { crystalTuning as tune } from './crystalTuning'

/** The shader with its comments stripped, so a phrase in prose proves nothing. */
const CODE = CRYSTAL_FRAG.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// The lab's own window, and the camera `PixelPerfect` puts in it. Every
// number below is a number for THIS view: the ray into the glass starts at
// the eye, so a different viewport bends the page by a different amount.
const W = 1280
const H = 860
const EYE: Vec3 = [W / 2, H / 2, cameraDistance(H, 42)]

/** The crystal at rest, tip at a given point of the screen. */
function frameAt(x: number, y: number, t = tune): CrystalFrame {
  return frameOf(makePose(x, y), t, EYE)
}

/**
 * How far a +/-2px hand tremor moves the corrected point, worst of 8 ways.
 *
 * The crystal MOVES WITH THE HAND, which is the whole question: the shake
 * carries the glass along with it, so what is being measured is whether the
 * correction is stable under a hand that cannot hold still, not what the
 * field looks like 2px sideways of a crystal nailed to the screen.
 */
function tremorAt(x: number, y: number): number {
  const [bx, by] = bendAt(x, y, frameAt(x, y), tune, EYE)
  let worst = 0
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    const sx = x + 2 * Math.cos(a)
    const sy = y + 2 * Math.sin(a)
    const [nx, ny] = bendAt(sx, sy, frameAt(sx, sy), tune, EYE)
    worst = Math.max(worst, Math.hypot(nx - bx, ny - by))
  }
  return worst
}

describe('the arrow', () => {
  it('is the pointer every desktop ships: 16 units across, 26.5 down', () => {
    const xs = ARROW.map(([x]) => x)
    const ys = ARROW.map(([, y]) => y)
    expect(Math.min(...xs)).toBe(0)
    expect(Math.max(...xs)).toBe(16)
    expect(Math.min(...ys)).toBe(0)
    expect(Math.max(...ys)).toBe(26.5)
    // The tip is the origin. Everything in the file — the hotspot, the
    // chamfer, the tilt's pivot — is measured from it.
    expect(ARROW[0]).toEqual([0, 0])
  })

  it('is concave, which is why no rounded-rect field could stand in', () => {
    // The notch between the shoulder and the tail. A convex hull of these
    // seven points would swallow it, and every field the lab already owns
    // is convex.
    expect(sdArrowPolygon(11, 21)).toBeGreaterThan(0)
    expect(sdArrowPolygon(4, 10)).toBeLessThan(0)
  })

  it('hangs its mass down and to the right of the tip', () => {
    expect(ARROW_AXIS[0]).toBeGreaterThan(0)
    expect(ARROW_AXIS[1]).toBeGreaterThan(0)
    expect(Math.hypot(ARROW_AXIS[0], ARROW_AXIS[1])).toBeCloseTo(1, 12)
  })
})

describe('the solid', () => {
  const TOP = tune.pavilionPx + tune.girdleThickPx + tune.crownPx - hotspotDrop(tune)

  // The widest point of the arrow, 30.9px inside its own outline. Nothing on
  // this shape is deeper: the polygon is 16 units across and `scalePx` is
  // 4.75, so the whole silhouette is 76px wide.
  const FAT: [number, number] = [25, 63]

  it('is a solid all the way through, not a bump on a plane', () => {
    // Straight up the middle of the body. A height field would put the
    // material only under its own surface and read as a relief.
    //
    // The midpoint is taken between the two SURFACES here rather than
    // between the table and the keel, because this stone never reaches its
    // keel: the pavilion facets would converge 233.7px in from the girdle
    // and the arrow runs out of width at 30.9. The culet clamp in
    // `bottomAt` is dead code at this cut, and the underside is a facet
    // everywhere.
    const d2 = sdInner2(FAT[0], FAT[1], tune)
    expect(d2).toBeCloseTo(-30.9, 1)
    const mid: Vec3 = [FAT[0], FAT[1], (topAt(d2, tune) + bottomAt(d2, tune)) / 2]
    expect(d2).toBeLessThan(-tune.girdlePx)
    expect(sdCrystal(mid, tune)).toBeLessThan(0)
    expect(sdCrystal([FAT[0], FAT[1], TOP + 1], tune)).toBeGreaterThan(0)
    expect(sdCrystal([FAT[0], FAT[1], -hotspotDrop(tune) - 1], tune)).toBeGreaterThan(0)
  })

  it('hangs its underside BELOW the hotspot, which is what a pavilion is', () => {
    // The pavilion is the change that makes this a cut stone rather than a
    // lens, and this is the shape of it: the stone's lowest point is on the
    // medial axis, deep in the body, and it rises to the girdle at the rim.
    // At the arrow's own POINT there is barely any stone left, which is why
    // `hotspotDrop` exists — see the hotspot suite.
    expect(bottomAt(sdInner2(0, 0, tune), tune)).toBeCloseTo(0, 6)
    expect(bottomAt(sdInner2(FAT[0], FAT[1], tune), tune)).toBeCloseTo(-7.14, 1)
    // And it rises going outward: the girdle is the widest and highest part
    // of the underside.
    expect(bottomAt(tune.girdlePx, tune)).toBeGreaterThan(bottomAt(-30, tune))
  })

  it('bends every ray on the way OUT, which a flat bottom could not', () => {
    // `pavilionDeg: 0` is exactly the shape this scene had before: a flat
    // face underneath, which deviates nothing at normal incidence, so the
    // ray left the way it arrived and only the crown had done any work.
    const flat = { ...tune, pavilionDeg: 0 }
    expect(bottomAt(sdInner2(FAT[0], FAT[1], flat), flat)).toBeCloseTo(0, 6)
    const off = bendAt(W / 2, H / 2, frameAt(W / 2, H / 2, flat), flat, EYE)
    const on = bendAt(W / 2, H / 2, frameAt(W / 2, H / 2), tune, EYE)
    expect(Math.hypot(off[0], off[1])).toBeLessThan(Math.hypot(on[0], on[1]))
  })

  it('is a lens over its whole face, which a flat top could not be', () => {
    // The fault the crown exists to fix. A slab with parallel faces deviates
    // NOTHING at normal incidence, so a flat-topped extrusion is a window
    // over its interior and a lens only at its rim. Measured 2026-08-25 on
    // that shape: the median displacement over the crystal's interior was
    // 2.7px, and on screen it read as grey plastic.
    //
    // The TABLE is still flat. What makes that affordable is that the arrow
    // is a thin shape and the crown facets reach `crownPx / tan(crownDeg)`
    // = 15.1px in from the silhouette, so 78% of this outline is within that
    // of an edge and the table is an island down the middle of the shaft.
    //
    // 15.1px is a much shorter reach than the 41.6 this test pinned at
    // crown 30, and the share still holds up, because the silhouette shrank
    // with it: `scalePx` is 4.75 and the arrow is 76px across.
    let facet = 0
    let table = 0
    for (let y = -40; y < 280; y += 2) {
      for (let x = -40; x < 190; x += 2) {
        const d2 = sdInner2(x, y, tune)
        if (d2 > tune.girdlePx) continue
        if (topAt(d2, tune) < TOP - 1e-6) facet++
        else table++
      }
    }
    expect(facet / (facet + table)).toBeCloseTo(0.78, 2)

    // And a facet bends where the flat top did not: the same ray at the
    // hotspot, on the same solid with its crown ground off.
    const flat = { ...tune, crownDeg: 0 }
    const off = bendAt(W / 2, H / 2, frameAt(W / 2, H / 2, flat), flat, EYE)
    const on = bendAt(W / 2, H / 2, frameAt(W / 2, H / 2), tune, EYE)
    expect(Math.hypot(off[0], off[1])).toBeLessThan(Math.hypot(on[0], on[1]) / 2)
  })

  it('keeps the two angles inside the budget, with 2.3 degrees to spare', () => {
    // THE constraint on this cut, and the reason it is not a brilliant. A
    // ray entering a crown facet leaves the entry turned `crownDeg -
    // asin(sin(crownDeg) / ior)` off vertical, then meets a pavilion facet
    // already tilted `pavilionDeg` the other way, so the incidence inside is
    // about the sum. Past the critical angle that pavilion is a MIRROR and
    // the page is not visible through the stone at all — which is exactly
    // why a real brilliant sparkles instead of being see-through.
    //
    // Measured 2026-08-26: 30 + 15 gives 26.6 degrees, 12.7 below critical,
    // and the hotspot's correction moves 0.66px under a 2px hand tremor;
    // 70 + 58 gives 91.5, far past it, and 59.8% of the pad gets no
    // correction at all.
    //
    // The committed 50 + 16 sits 2.27 degrees BELOW critical, which is the
    // narrowest margin of any cut measured, and the margin is what the
    // tremor is bought with — the hotspot suite pins what 2.27 costs.
    const critical = (Math.asin(1 / tune.ior) * 180) / Math.PI
    expect(critical).toBeCloseTo(39.27, 1)
    const rad = (tune.crownDeg * Math.PI) / 180
    const deflect = tune.crownDeg - (Math.asin(Math.sin(rad) / tune.ior) * 180) / Math.PI
    expect(deflect).toBeCloseTo(21.0, 1)
    expect(deflect + tune.pavilionDeg).toBeCloseTo(37.0, 1)
    expect(critical - deflect - tune.pavilionDeg).toBeCloseTo(2.27, 1)
    expect(deflect + tune.pavilionDeg).toBeLessThan(critical)
  })

  it('points its normals OUT of the stone, which is what makes a bounce a bounce', () => {
    // `traceCrystal` and the shader both flip this normal to refract on the
    // way out and use it unflipped to reflect. Get the sign wrong on one
    // face and the ray leaves through the surface it was supposed to bounce
    // off, which draws as a hole in the solid and reports a click there.
    //
    // `FAT` is the widest place on the outline, 30.9px inside it — the only
    // kind of place wide enough to still be under the table, since the crown
    // facet eats 15.1px of width before the table starts.
    const deep = sdInner2(FAT[0], FAT[1], tune)
    expect(deep).toBeCloseTo(-30.9, 1)
    const nTable = normalAt([FAT[0], FAT[1], topAt(deep, tune) - 0.2], tune)
    expect(nTable[2]).toBeGreaterThan(0.99)
    const nUnder = normalAt([FAT[0], FAT[1], bottomAt(deep, tune) + 0.2], tune)
    expect(nUnder[2]).toBeLessThan(-0.9)

    // On a crown facet it leans out by exactly the crown angle. (30,100) is
    // 4.7px inside the outline, well within the facet's 15.1px reach.
    const nFacet = normalAt([30, 100, topAt(sdInner2(30, 100, tune), tune) - 0.2], tune)
    expect((Math.acos(nFacet[2]) * 180) / Math.PI).toBeCloseTo(tune.crownDeg, 1)
    // The pavilion runs 233.7px before its facets meet and the arrow is 76px
    // across, so it never converges: there is no flat culet anywhere, and
    // the underside above reads as a facet rather than as a floor.
    expect(tune.pavilionPx / Math.tan((tune.pavilionDeg * Math.PI) / 180)).toBeGreaterThan(200)
  })

  it('never lies about distance: one step of the field cannot reach through it', () => {
    // The marches take steps of the field's own value, which is only safe
    // while the field never overstates. Every term of the profile is a
    // half-space with a unit gradient and `max` of those is one too, so no
    // step-size fudge is needed anywhere. Sampled along a slanted line
    // through the body, no pair of points may be further apart in value than
    // they are in space.
    let worst = 0
    for (let i = 0; i < 400; i++) {
      const a: Vec3 = [-60 + i * 0.9, -40 + i * 0.7, -30 + i * 0.3]
      const b: Vec3 = [a[0] + 1, a[1] + 0.5, a[2] + 0.4]
      const gap = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      worst = Math.max(worst, Math.abs(sdCrystal(b, tune) - sdCrystal(a, tune)) / gap)
    }
    expect(worst).toBeLessThanOrEqual(1.001)
  })
})

describe('the hotspot', () => {
  it('sits under the ground face and not under a vertex', () => {
    // `chamferPx - roundPx` is how deep into the inner field the tip is, and
    // `girdlePx` is where the silhouette sits, so the tip is 7px inside the
    // girdle — on a crown facet, well clear of the girdle band.
    //
    // 7 is the DEEPEST this cut can put it: raising `chamferPx` moves the
    // hotspot toward the rim, not away from it, and `roundPx` and `girdlePx`
    // are the only two knobs that push the other way. Measured 2026-08-26
    // at the committed cut, sweeping `chamferPx` and taking the correction
    // at five screen positions: 0 is the only value where all five report an
    // answer, 2 misses two of them and 8 puts the hotspot outside the stone
    // altogether and misses all five.
    expect(sdInner2(0, 0, tune)).toBeCloseTo(tune.chamferPx - tune.roundPx, 9)
    expect(tune.girdlePx - (tune.chamferPx - tune.roundPx)).toBe(7)
    // On a facet and not on the table: the table is flat and would deviate
    // a straight-down ray by nothing at all.
    const top = tune.pavilionPx + tune.girdleThickPx + tune.crownPx - hotspotDrop(tune)
    expect(topAt(sdInner2(0, 0, tune), tune)).toBeLessThan(top)
  })

  it('is ON the glass, which a pavilion does not give for free', () => {
    // The frame anchors the hotspot at local (0, 0, 0) and the view ray is
    // built to pass through it, so that point has to be on the stone. It was
    // while the bottom was a flat face at z = 0. A pavilion lifts the
    // underside off the keel everywhere except along the medial axis, and
    // the arrow's point is the furthest place on the stone from that axis:
    // measured 2026-08-25 before `hotspotDrop` existed, the underside under
    // the tip sat 28px above the keel and the anchor floated in mid-air
    // below the glass. Straight down that still hit, because the ray passed
    // up through the stone anyway — but at the right of the screen the line
    // of sight is 11 degrees off vertical, it walked 7px sideways out past
    // the point, and the hotspot's correction reported a miss.
    expect(hotspotDrop(tune)).toBeCloseTo(64.99, 2)
    expect(sdCrystal([0, 0, 0], tune)).toBeCloseTo(0, 2)
    // The glass over it is a thin wedge — 11.3px from pavilion to crown,
    // against 28.1px at the widest part of the body — which is why
    // `chamferPx` has to keep it as far inside the girdle as it can.
    const d2 = sdInner2(0, 0, tune)
    expect(topAt(d2, tune) - bottomAt(d2, tune)).toBeCloseTo(11.3, 1)
  })

  it('reads the page 48px away from where the hand is', () => {
    // Against a 52px key pitch, so an uncorrected click still lands a whole
    // key away and in the next row down. It is a good deal SMALLER than the
    // 130px the stone displaces over the rest of its face — the tip looks
    // through the thinnest wedge on the solid, and the body through 28px of
    // glass at a 50 degree crown.
    const f = frameAt(W / 2, H / 2)
    const [bx, by] = bendAt(W / 2, H / 2, f, tune, EYE)
    expect(Math.hypot(bx, by)).toBeCloseTo(48.1, 1)
    // Out along the arrow's own axis, because that is the way the ground
    // face faces: the key that answers is down and to the right of the tip.
    expect(bx).toBeGreaterThan(0)
    expect(by).toBeGreaterThan(0)
  })

  it('moves 6.1px under a 2px hand tremor, which is what 2.3 degrees costs', () => {
    // The number that decides whether any of this is usable, and the one
    // this cut spends to look like a gem.
    //
    // The tremor tracks the margin to the critical angle and nothing else.
    // Measured 2026-08-26 at the hotspot, sweeping the two facet angles at
    // ior 1.58, worst of 8 directions under a 2px shake:
    //
    //     crown/pav   internal   margin   tremor
    //       30 / 15     26.6      12.7      0.66 px
    //       40 / 14     30.0       9.3      1.86
    //       45 / 12     30.4       8.9      2.21
    //       50 / 10     31.0       8.3      2.92
    //       40 / 20     36.0       3.3      4.45
    //       50 / 16     37.0       2.3      6.09   <- committed
    //
    // Monotone across every pair measured. The mechanism: at 2.3 degrees
    // below critical the ray reaching the pavilion is on the edge of total
    // internal reflection, so a small change in the line of sight flips it
    // between crossing the face and bouncing off it, and the two exits are
    // nowhere near each other. Nothing else on the solid is near a
    // discontinuity — off the centre of the screen the same shake moves the
    // correction 0.05 to 1.06px.
    //
    // For contrast, the FLAT version of this scene put its hotspot on a
    // polygon vertex and measured 8.37px of bend against 10.65px of tremor,
    // a ratio of 1.27 — the target moved further than the hand did. That was
    // a singular point of the distance field and no radius of rounding
    // fixed it. This is a different fault with a different fix: the cut, not
    // the outline.
    const f = frameAt(W / 2, H / 2)
    const [bx, by] = bendAt(W / 2, H / 2, f, tune, EYE)
    const shake = tremorAt(W / 2, H / 2)
    expect(shake).toBeCloseTo(6.09, 1)
    expect(shake / Math.hypot(bx, by)).toBeCloseTo(0.127, 2)
    // Still well under the hand's own step, which is the floor that matters:
    // a correction that moved further than the pointer would be unusable.
    expect(shake / Math.hypot(bx, by)).toBeLessThan(1)
  })

  it('carries that jitter across 14% of the pad, which is the hover flicker', () => {
    // What the number above looks like to a hand. The keys are 48px on a
    // 52px pitch, so 4px of gap: a correction that jumps more than that
    // crosses into the next key and the hover highlight flicks with it.
    //
    // Measured 2026-08-26 over the pad's own box at a 12px grid, 816
    // positions, worst of 8 shake directions at each:
    //
    //     median 0.52px    p90 2.40    p99 6.34    max 9.16
    //     112 of 816 over 2px, 15 over 5px
    //
    // So it is not the whole pad and it is not one bad spot. Most of the
    // time the tip is steady to half a pixel; over about a seventh of the
    // pad the ray is close enough to critical to flip, and there the
    // highlight moves without the hand.
    const t: number[] = []
    let over2 = 0
    let over5 = 0
    for (let y = 380; y <= 560; y += 12) {
      for (let x = 340; x <= 940; x += 12) {
        const v = tremorAt(x, y)
        t.push(v)
        if (v > 2) over2++
        if (v > 5) over5++
      }
    }
    t.sort((a, b) => a - b)
    expect(t.length).toBe(816)
    expect(t[Math.floor(t.length * 0.5)]).toBeCloseTo(0.52, 1)
    expect(t[Math.floor(t.length * 0.9)]).toBeCloseTo(2.4, 0)
    expect(t[t.length - 1]).toBeCloseTo(9.16, 0)
    expect(over2).toBe(112)
    expect(over5).toBe(15)
  })

  it('holds up away from the middle, where the ray is no longer straight down', () => {
    // A perspective camera, so nothing here is vertical. The tip is placed
    // on the ray the hand is looking along (`tipPlanePoint`) — put at the
    // hand's own page coordinate instead it would be drawn up to 20px away
    // from the cursor out here.
    //
    // Measured 2026-08-26 at all four screen edges: the bend runs 63 to
    // 119px and the worst tremor is 1.06px, at the bottom of the screen. It
    // is LARGER off-centre because the ray arrives at an angle that adds to
    // the facets' own slopes instead of meeting them square.
    //
    // It is also STEADIER off-centre, which is the opposite of what the
    // shape would suggest and is worth stating: the slant carries the
    // internal incidence away from the critical angle, and away from
    // critical the exit stops flipping. The 6.09px of jitter the hotspot
    // suite pins is a middle-of-the-screen number.
    const f = frameAt(220, H / 2)
    const [bx, by] = bendAt(220, H / 2, f, tune, EYE)
    expect(Math.hypot(bx, by)).toBeCloseTo(65.8, 1)
    expect(tremorAt(220, H / 2)).toBeLessThan(0.3)

    const g = bendAt(1060, H / 2, frameAt(1060, H / 2), tune, EYE)
    expect(Math.hypot(g[0], g[1])).toBeCloseTo(74.7, 1)
    expect(tremorAt(1060, H / 2)).toBeLessThan(1)
  })

  it('leaves through the FIRST face it meets, and reports that one', () => {
    // The picture superimposes every exit; a pointer cannot. It has to name
    // one page pixel, so `traceCrystal` returns the direct path — the ray
    // that crossed the stone once — and falls back to a bounced one only
    // where that path does not exist. Measured 2026-08-25 over the arrow's
    // 33,253 interior pixels: every one of them has a direct path, so the
    // correction never has to make that choice at this cut.
    //
    // Re-measured 2026-08-26 at the committed cut over 7,319 interior
    // pixels: still every one of them, and not one ray missed the solid.
    const f = frameAt(W / 2, H / 2)
    const dz = -EYE[2]
    const hit = traceCrystal(EYE, [0, 0, dz / Math.abs(dz)], f, tune)
    expect(hit).not.toBeNull()
    expect(hit!.bounces).toBe(0)
    // Longer than the 11.3px the stone stands at the hotspot: the ray enters
    // on a crown facet, is bent off the vertical there, and takes a slanted
    // path down to the pavilion.
    expect(hit!.through).toBeCloseTo(11.8, 1)
    // What is left after Fresnel takes its share at both faces and the glass
    // absorbs over 11.8px. The 17% that does not come this way is not lost —
    // it reflects back inside and the picture shows it as the stone's own
    // interior. The pointer has to pick one exit and picks this one.
    expect(hit!.weight).toBeCloseTo(0.83, 2)
  })
})

describe('the bend', () => {
  it('is exactly zero everywhere outside the glass', () => {
    // Not small — zero. Every pixel the crystal is not standing on is the
    // DOM's own rasterisation and its own click, and the relay is only
    // correct there because there is nothing to correct.
    const f = frameAt(W / 2, H / 2)
    for (const [x, y] of [
      [40, 40],
      [W - 40, 40],
      [W / 2, H - 40],
      [W / 2 - 200, H / 2],
      [W / 2, H / 2 - 200],
    ]) {
      expect(bendAt(x, y, f, tune, EYE)).toEqual([0, 0])
    }
  })

  it('clears the cap everywhere but the rim, by 8px at the 99th percentile', () => {
    // The cap is a guard, not a scale on the effect — but at this cut the
    // margin is thin and the test says so rather than pretending otherwise.
    // Measured 2026-08-26 over the crystal at rest with the clamp lifted:
    //
    //     median 130px    p90 170    p99 172    cap 180
    //     19 of 2,223 sampled pixels — 0.85% — want more
    //
    // The 63px this test pinned at crown 30 was the whole stone. 130 is what
    // a 50 degree crown over 28px of glass does, and the hotspot's own 48px
    // is now the outlier rather than the rule.
    //
    // The 19 are the rim. A ray arriving there meets the crown at a grazing
    // angle, bounces off the pavilion instead of crossing it, and leaves
    // pointing almost along the page: uncapped, the worst of them wants
    // 44,775px, and it moves by hundreds when the hand moves by one.
    //
    // Raising `crownDeg` or `pavilionDeg` from here walks the median INTO
    // the cap, and a clamped median is the clamp drawing the picture rather
    // than the glass. That is what `maxBendPx` has 8px of headroom against.
    //
    // This test steps 2px, so it sees 19 of them.
    const f = frameAt(W / 2, H / 2)
    let worst = 0
    let hits = 0
    let capped = 0
    const all: number[] = []
    for (let y = H / 2 - 40; y < H / 2 + 300; y += 2) {
      for (let x = W / 2 - 60; x < W / 2 + 220; x += 2) {
        const [bx, by] = bendAt(x, y, f, tune, EYE)
        const m = Math.hypot(bx, by)
        if (m > 0) {
          hits++
          all.push(m)
        }
        if (m > tune.maxBendPx - 0.01) capped++
        worst = Math.max(worst, m)
      }
    }
    all.sort((p, q) => p - q)
    expect(hits).toBeCloseTo(2223, -2)
    expect(all[Math.floor(all.length * 0.5)]).toBeCloseTo(130.4, 0)
    expect(all[Math.floor(all.length * 0.99)]).toBeCloseTo(172.2, 0)
    expect(all[Math.floor(all.length * 0.99)]).toBeLessThan(tune.maxBendPx)
    expect(capped).toBe(19)
    expect(worst).toBeCloseTo(tune.maxBendPx, 6)

    // And the clamp is the whole of what holds those pixels: turn it down
    // and it takes over everywhere, in the law, which is the copy the click
    // goes through.
    const tight = { ...tune, maxBendPx: 20 }
    const g = frameAt(W / 2, H / 2, tight)
    let tightCapped = 0
    for (let y = H / 2; y < H / 2 + 200; y += 4) {
      for (let x = W / 2; x < W / 2 + 140; x += 4) {
        const [bx, by] = bendAt(x, y, g, tight, EYE)
        expect(Math.hypot(bx, by)).toBeLessThanOrEqual(20 + 1e-6)
        if (Math.hypot(bx, by) > 19.99) tightCapped++
      }
    }
    expect(tightCapped).toBe(386)
  })

  it('rides the crystal: tilting the body moves the bend with it', () => {
    // The pointer correction is a function of the POSE, not of the screen.
    // Nothing else in this file would notice if the tilt were dropped on the
    // way to the raycast, and the scene would keep looking right.
    const level = frameAt(W / 2, H / 2)
    const thrown = makePose(W / 2, H / 2)
    thrown.bodyX -= 80
    thrown.bodyY -= 30
    const tilted = frameOf(thrown, tune, EYE)
    const a = bendAt(W / 2 + 30, H / 2 + 60, level, tune, EYE)
    const b = bendAt(W / 2 + 30, H / 2 + 60, tilted, tune, EYE)
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(4)
  })
})

describe('the hand', () => {
  it('never lags the tip: the drawn point is the reported point', () => {
    // A cursor that reported a position its own hand had not reached would
    // be lying. What lags is the mass hanging off the tip.
    const pose = makePose(100, 100)
    stepCrystal(pose, 500, 300, 1 / 60, tune)
    expect(pose.tipX).toBe(500)
    expect(pose.tipY).toBe(300)
    expect(pose.bodyX).toBeLessThan(500)
  })

  it('settles a 400px jump in 16 frames, one past critical damping', () => {
    const pose = makePose(0, 0)
    let frames = 0
    for (; frames < 240; frames++) {
      stepCrystal(pose, 400, 0, 1 / 60, tune)
      if (Math.hypot(pose.tipX - pose.bodyX, pose.tipY - pose.bodyY) < 1) break
    }
    // Critical damping for followK 1700 is followD 82.5, and the committed
    // 86 is 4% past it — so the body never overshoots, and it costs one
    // frame: 16 at 60Hz against the 15 a critically damped spring needs.
    //
    // That is a much snappier cursor than the 31 frames this pinned at
    // followK 900 / followD 82, where the damping was 37% past critical.
    // What the test holds either way is that it ARRIVES: an underdamped
    // spring would cross the mark and come back, and this one is pinned
    // not to.
    expect(frames).toBe(16)
    expect(tune.followD).toBeGreaterThan(2 * Math.sqrt(tune.followK))
    expect(pose.bodyX).toBeLessThanOrEqual(400)
  })

  it('tilts out of the page, and not at all when it is standing still', () => {
    // The deformation the flat version could only fake by stretching. It
    // needs the object to have a thickness to be visible at all.
    expect(frameAt(400, 400).rot).toEqual(REST_FRAME.rot)

    const thrown = makePose(400, 400)
    thrown.bodyX -= 90
    const f = frameOf(thrown, tune, EYE)
    // A flick to the right lifts the LEFT flank: a point out on that side
    // stands higher off the page than one on the right.
    const left = toLocal([f.tipX - 60, f.tipY + 60, 0], f)
    const right = toLocal([f.tipX + 60, f.tipY + 60, 0], f)
    expect(left[2]).toBeLessThan(right[2])
    // And it is a rotation, so nothing about it changes a length.
    const r = f.rot
    for (let i = 0; i < 3; i++) {
      expect(Math.hypot(r[i * 3], r[i * 3 + 1], r[i * 3 + 2])).toBeCloseTo(1, 9)
    }
  })

  it('survives a backgrounded tab handing back a whole second', () => {
    // `stepCrystal` clamps the step to 1/30s and integrates once. That keeps
    // the spring finite, and it does NOT keep the pose's lag small: one
    // 1/30s step at followK 1700 throws the body 875px past a tip 984px
    // away. The bound that holds is downstream — `frameOf` clamps the lag it
    // builds spin and tilt from, so however far the body is flung the DRAWN
    // crystal never exceeds the maxLagPx budget.
    //
    // This assertion used to be on the pose itself, and it passed for the
    // wrong reason: at followK 900 the arithmetic happened to land the body
    // exactly on the tip in one step. Nothing in the code promised that.
    const pose = makePose(0, 0)
    stepCrystal(pose, 900, 400, 1, tune)
    expect(Number.isFinite(pose.bodyX)).toBe(true)
    expect(Number.isFinite(pose.bodyY)).toBe(true)

    const flung = frameOf(pose, tune, EYE)
    const rest = frameOf(makePose(pose.tipX, pose.tipY), tune, EYE)
    // The rotation stays a rotation: no NaN, no blown-up basis.
    for (const v of flung.rot) expect(Number.isFinite(v)).toBe(true)
    expect(Math.hypot(flung.rot[0], flung.rot[1], flung.rot[2])).toBeCloseTo(1, 6)
    // And it is a bounded departure from rest, not an arbitrary one.
    const swing = Math.acos(
      Math.min(1, flung.rot[8] * rest.rot[8] + flung.rot[7] * rest.rot[7] + flung.rot[6] * rest.rot[6]),
    )
    expect((swing * 180) / Math.PI).toBeLessThanOrEqual(
      tune.maxLagPx * Math.max(tune.spinPerLag, tune.tiltPerLag) * 0.01 + 1e-6,
    )
  })
})

describe('the light', () => {
  it('comes over the left shoulder and travels down into the page', () => {
    const [lx, ly, lz] = lightDirOf(tune)
    expect(lx).toBeGreaterThan(0)
    expect(ly).toBeGreaterThan(0)
    expect(lz).toBeLessThan(0)
    expect(Math.hypot(lx, ly, lz)).toBeCloseTo(1, 12)
    // Slanted, not overhead: at 90 degrees the light passes straight down
    // through the glass and there is no caustic worth the name.
    //
    // It is STEEP at the committed 75 degrees, and the consequence is that
    // the shadow does not clear the object: the offset is `liftPx /
    // tan(elevation)` = 29px against a solid 187px across, so the whole
    // shadow lies under the crystal and what reaches the page is the
    // caustic. That is a look, not a fault, but it is the reason nothing
    // dark shows beside the arrow.
    expect(tune.lightElevationDeg).toBeLessThan(90)
    const offset = tune.liftPx / Math.tan((tune.lightElevationDeg * Math.PI) / 180)
    expect(offset).toBeCloseTo(29.5, 1)
    expect(offset).toBeLessThan(boundsOf(tune).r)
  })
})

describe('the GLSL is the same function', () => {
  it('carries the seven vertices, verbatim and in order', () => {
    ARROW.forEach(([x, y], i) => {
      const g = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`)
      expect(CODE).toContain(`const vec2 A${i} = vec2(${g(x)}, ${g(y)});`)
    })
  })

  it('walks the same seven edges, each as (previous, current)', () => {
    const n = ARROW.length
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      expect(CODE).toContain(`arrowEdge(p, A${j}, A${i}, d, s);`)
    }
  })

  it('derives the rest axis from those vertices rather than restating it', () => {
    expect(CODE).toContain('normalize(A0 + A1 + A2 + A3 + A4 + A5 + A6)')
  })

  it('grinds the point off with the same intersection', () => {
    expect(CODE).toContain('float cut = uChamferPx - dot(q, arrowAxis());')
    expect(CODE).toContain('return max(poly, cut) - uRoundPx;')
  })

  it('cuts the gem profile from the same five half-spaces', () => {
    // Wall, culet, crown facet, pavilion facet, table — combined with `max`,
    // which is an intersection. Every term is Lipschitz-1 on its own and a
    // `max` of Lipschitz-1 under-estimators is one too, so the marches stay
    // safe across the facet breaks with no step fudge.
    expect(CODE).toContain('float d2 = sdInner2(q.xy) - uGirdlePx;')
    expect(CODE).toContain('float zg0 = uPavilionPx - drop;')
    expect(CODE).toContain('float zg1 = zg0 + uGirdleThickPx;')
    expect(CODE).toContain('float crown = d2 * sin(ac) + (q.z - zg1) * cos(ac);')
    expect(CODE).toContain('float pavilion = d2 * sin(ap) - (q.z - zg0) * cos(ap);')
    expect(CODE).toContain('float table = q.z - (zg1 + uCrownPx);')
    expect(CODE).toContain(
      'return max(max(d2, -drop - q.z), max(max(crown, pavilion), table));',
    )
  })

  it('drops local zero onto the underside at the arrow`s point, the same way', () => {
    // The frame anchors the hotspot at local (0,0,0) and builds the view ray
    // to pass through it, so that point has to be ON the glass. A pavilion
    // lifts the underside off the keel everywhere but the medial axis, and
    // the arrow's point is the furthest place from it. Off by this much, the
    // anchor floats under the stone and slanted rays miss it entirely.
    expect(CODE).toContain('float hotDrop() {')
    expect(CODE).toContain('return max(uPavilionPx + (uChamferPx - uRoundPx - uGirdlePx)')
    expect(CODE).toContain('* tan(radians(uPavilionDeg)), 0.0);')
    expect(hotspotDrop(tune)).toBeCloseTo(64.99, 2)
  })

  it('puts BOTH surfaces and their normals at the same two angles', () => {
    // The LIGHT's chain uses these instead of a second march, so a
    // difference here is a caustic drawn by a shape nobody is looking at.
    // Two facets now, and the pavilion is the one that decides whether the
    // page is visible through the stone at all.
    expect(CODE).toContain(
      'return min(zg1 - (d2 - uGirdlePx) * tan(radians(uCrownDeg)), zg1 + uCrownPx);',
    )
    expect(CODE).toContain(
      'return max(uPavilionPx + (d2 - uGirdlePx) * tan(radians(uPavilionDeg)), 0.0)',
    )
    expect(CODE).toContain('return normalize(vec3(outlineGrad(xy) * sin(a), cos(a)));')
    expect(CODE).toContain('return normalize(vec3(outlineGrad(xy) * sin(a), -cos(a)));')
    // The flat parts, where the facet has run out: table up, culet down.
    expect(CODE).toContain('return vec3(0.0, 0.0, 1.0);')
    expect(CODE).toContain('return vec3(0.0, 0.0, -1.0);')
  })

  it('takes the gradient over the same epsilon, in three dimensions', () => {
    expect(GRAD_EPS).toBe(0.5)
    expect(CODE).toContain(`float e = ${GRAD_EPS};`)
    expect(CODE).toContain('sdCrystal(q + vec3(0.0, 0.0, e)) - sdCrystal(q - vec3(0.0, 0.0, e))')
  })

  it('marches to the same tolerance, for the same number of steps', () => {
    expect(MARCH_EPS).toBe(0.15)
    expect(MARCH_STEPS).toBe(96)
    expect(CODE).toContain(`for (int i = 0; i < ${MARCH_STEPS}; i++)`)
    expect(CODE).toContain(`if (sd < ${MARCH_EPS}) { hit = true; break; }`)
    // Out of the glass the field is negative, so the test and the step both
    // flip, and the walk starts clear of the surface it just came through.
    expect(CODE).toContain(`float u = ${MARCH_EPS} * 4.0;`)
    expect(CODE).toContain(`if (sd > -${MARCH_EPS}) { out_ = true; break; }`)
    expect(CODE).toContain('u -= sd;')
  })

  it('bounds the shape with the same sphere', () => {
    const { c, r } = boundsOf(tune)
    expect(c[0]).toBe(8 * tune.scalePx)
    expect(c[1]).toBe(13.25 * tune.scalePx)
    expect(CODE).toContain(
      'float halfZ = (uPavilionPx + uGirdleThickPx + uCrownPx) * 0.5;',
    )
    expect(CODE).toContain(
      'return vec3(8.0 * uScalePx, 13.25 * uScalePx, halfZ - hotDrop());',
    )
    expect(CODE).toContain('float pad = uRoundPx + uGirdlePx;')
    // Big enough to hold the whole solid, and no bigger by much: it is also
    // the radius of the patch of page that pays for the shadow.
    expect(r).toBeGreaterThan(13.25 * tune.scalePx)
    expect(r).toBeLessThan(13.25 * tune.scalePx * 1.6)
  })

  it('refracts in once and then bounces, the same number of times', () => {
    expect(CODE).toContain('refractAt(d, n0, 1.0 / max(uIor, 1.0), ray)')
    expect(CODE).toContain('o = eta * i - (eta * ndi + sqrt(k)) * n;')
    expect(MAX_BOUNCES).toBe(4)
    expect(CODE).toContain(`for (int b = 0; b < ${MAX_BOUNCES}; b++) {`)
    expect(CODE).toContain('if (refractAt(ray, -n1, max(uIor, 1.0), leaving)) {')
    expect(CODE).toContain('ray = reflect(ray, n1);')
  })

  it('weighs each exit by Schlick on the OUTGOING angle, both copies', () => {
    // The form that holds going from dense to rare: the approximation is
    // written around the angle in the RARER medium. Using the internal angle
    // reports a mirror as a window right where the mirror matters most —
    // past the critical angle, where `refractAt` returns false and the whole
    // beam stays inside.
    expect(CODE).toContain('float f0 = pow((uIor - 1.0) / (uIor + 1.0), 2.0);')
    expect(CODE).toContain(
      'back = f0 + (1.0 - f0) * pow(1.0 - clamp(dot(leaving, n1), 0.0, 1.0), 5.0);',
    )
    // Head on, glass hands back its 5.1%; edge on, all of it.
    expect(schlick(1, tune.ior)).toBeCloseTo(0.051, 3)
    expect(schlick(0, tune.ior)).toBeCloseTo(1, 6)
    // And the same f0 both ways, so the law and the shader agree on how much
    // the first face keeps before anything else happens.
    expect(schlick(1, tune.ior)).toBeCloseTo(((tune.ior - 1) / (tune.ior + 1)) ** 2, 12)
  })

  it('gives up on a path once there is nothing left of it, at the same floor', () => {
    expect(WEIGHT_FLOOR).toBe(0.02)
    expect(CODE).toContain(
      `if (max(tint.r, max(tint.g, tint.b)) < ${WEIGHT_FLOOR}) break;`,
    )
    // Beer's law over each segment, tinted so red goes first: the green cast
    // every thick edge of real glass has. With bounces it also says WHICH
    // exit the eye is looking at, because a ray that crossed three times
    // arrives visibly darker than one that went straight through.
    expect(CODE).toContain(
      'tint *= exp(-vec3(1.15, 0.85, 1.0) * (uAbsorbPer100 * 0.01) * u);',
    )
  })

  it('reflects the page and not an invented sky, wherever the ray points down', () => {
    // The environment IS the page. Anything leaving the stone downward is
    // read out of the same texture the refraction reads, so the underside of
    // every facet carries the keyboard rather than a grey. Only the rays that
    // leave upward get the two-grey sky, because upward there is nothing to
    // sample.
    expect(CODE).toContain('vec3 environment(vec3 from, vec3 d) {')
    expect(CODE).toContain('if (d.z < -1e-6) {')
    expect(CODE).toContain('vec2 q = from.xy + d.xy * (from.z / -d.z);')
    expect(CODE).toContain(
      'return texture2D(tMap, clamp(vec2(q.x, uSheet.y - q.y) / uSheet, 0.0, 1.0)).rgb;',
    )
    expect(CODE).toContain('return vec3(mix(uSkyLow, uSkyHigh, up * up) + sun);')
    // And the entry face's own reflection reads the same environment, so the
    // rim and the highlight fall out of the geometry instead of being drawn.
    expect(CODE).toContain(
      'vec3 mirror = environment(toSheet(p0), reflect(dir, nSheet)) * uEdgeLight;',
    )
    expect(CODE).toContain('rgb = mix(acc, mirror, clamp(fin, 0.0, 1.0));')
  })

  it('caps the DISPLACEMENT and not the landing point', () => {
    // Capping a position would drag the whole picture toward one spot as the
    // crystal moved. Both copies clamp the same vector by the same length.
    expect(CODE).toContain('vec2 flat_ = uEye.xy + dir.xy * (uEye.z / -dir.z);')
    expect(CODE).toContain('if (m > uMaxBendPx) bend *= uMaxBendPx / m;')
  })

  it('reads the page in the law`s frame, y down, and flips back once', () => {
    expect(CODE).toContain('vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSheet;')
    expect(CODE).toContain('vec2 uvAt = vec2(flat_.x + bend.x, uSheet.y - flat_.y - bend.y) / uSheet;')
  })

  it('leaves the page alone wherever the crystal cannot reach it', () => {
    // The shadow and the caustic cost four traces per pixel, and the page is
    // the whole viewport. Both live inside one bounded test.
    expect(CODE).toContain('float reach = boundsRadius() + uMaxBendPx + uShadowSoftPx * 2.0;')
    expect(CODE).toContain('if (dot(p - centre, p - centre) < reach * reach) {')
  })

  it('casts the shadow off the girdle plane, where the solid is widest', () => {
    // Walking the light backwards to the girdle and asking the silhouette
    // there is exact at any tilt, because the solid is a straight prism in
    // that one plane and the ray is a straight line. The girdle is also the
    // widest section, so the shadow is the shape of the stone's outline
    // rather than of whichever facet happened to be nearest the page.
    expect(CODE).toContain(
      'float girdleZ() { return uPavilionPx + uGirdleThickPx * 0.5 - hotDrop(); }',
    )
    expect(CODE).toContain('vec2 q = (ol + dl * ((girdleZ() - ol.z) / dl.z)).xy;')
    expect(CODE).toContain(
      'smoothstep(-uShadowSoftPx, uShadowSoftPx, sdInner2(q) - uGirdlePx)',
    )
  })

  it('brightens the caustic by how much the light squeezed, and says where it stopped', () => {
    expect(CODE).toContain('vec2 a = p - lightDisp(p);')
    expect(CODE).toContain('float det = (1.0 + jx.x) * (1.0 + jy.y) - jy.x * jx.y;')
    expect(CODE).toContain('gain = min(1.0 / max(abs(det), 1e-3), uCausticClamp) - 1.0;')
  })
})
