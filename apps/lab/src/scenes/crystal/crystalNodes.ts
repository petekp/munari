// The crystal's pixels — a solid of glass ray-traced over a live page, and
// the shadow and the focused light it throws down onto it.
//
// One material, one shape, three jobs. It draws the page. It asks the LIGHT's
// ray where the solid shades the page, and where the light it let through
// piles up. Then it marches the EYE's ray to the surface it is looking at,
// refracts in through a crown facet, bounces it between the inside faces
// until its light runs out, and reads the page along everything that escaped
// downward.
//
// The law: OUTSIDE the crystal's silhouette this material is the identity plus
// a shadow. The shadow adds nothing where no light ray reaches the solid, and
// the glass writes nothing where its march misses, so every pixel the crystal
// is not standing on or shading is the DOM's own rasterisation. That is what
// lets the pointer relay stay correct everywhere the crystal is not.
//
// `sdCrystal` and the chain below are `crystalLaw.ts` transcribed. Not
// resembling it — the same arithmetic in the same order, down to the
// central difference's epsilon, the march's tolerance and the order of the
// two rotations (which is why the rotation arrives as a matrix and is not
// rebuilt here). The CPU copy is what a click is corrected by and this copy
// is what the eye sees, so a difference between them is a click landing
// where nobody looked. `gate:crystal-pointer` compares the two in a browser;
// `crystalLaw.test.ts` checks the CPU copy alone.
//
// The light is FIXED IN THE SHEET, not attached to the crystal. A highlight
// that travelled with the object would be a decal and would read as one; a
// fixed light means the streak sweeps across the glass and the shadow swings
// as the hand moves it, which is the strongest cue that the thing has a
// surface and a height at all.
//
// The FAULT the shading answers: the first solid lit the whole top face with
// one broad specular lobe. Measured 2026-08-25 with that lobe zeroed, the
// interior read (16,16,9) — exactly the page colour beneath it — so 100% of
// what was visible was the wash, and it looked like grey plastic. What
// replaced it is Fresnel choosing between the refracted page and a reflected
// sky, plus Beer's law over the path length. Nothing is painted on.
//
// PREMULTIPLIED (decisions.md #5): the page arrives premultiplied and the
// glass writes alpha 1 over it, so `glassAt` works in straight colour and the
// output node composites with the over operator written out. That node
// replaces Three's output, so Three applies no second premultiplication, and
// `premultipliedOutput` makes the premultiplied linear result land with the
// value the page would composite (decisions.md #72).
//
// Ownership: this module owns the shading and the uniform bag it reads.
// crystalMaterial.tsx owns the pose, the uniform writes and the mesh slot.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type UniformNode } from 'three/webgpu'
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  bool,
  clamp,
  cos,
  dot,
  exp,
  float,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  radians,
  reflect,
  sin,
  smoothstep,
  sqrt,
  tan,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput, type SurfaceNodes } from '@petepetrash/munari'
import type { CrystalTuning } from './crystalTuning'

// ── the uniform bag ────────────────────────────────────────────────────

/** The tuned lengths, angles and optics, each one a float uniform of the same name. */
const TUNED_KEYS = [
  'scalePx', // CSS px per polygon unit
  'roundPx', // how far the outline is pushed out
  'chamferPx', // how far up the axis the point is ground off
  'girdlePx', // how far past sdInner2's zero the girdle is
  'girdleThickPx', // the vertical band at the girdle
  'crownDeg', // the crown facets' angle off the page
  'crownPx', // girdle up to the flat table
  'pavilionDeg', // the pavilion facets' angle off the page
  'pavilionPx', // the keel up to the girdle
  'ior',
  'maxBendPx', // the cap on displacement, both copies
  'dispersion',
  'edgeLight', // how much of the sky the glass shows
  'skyHigh',
  'skyLow',
  'specular', // the sun in that sky, and how tight
  'specularPow',
  'absorbPer100', // Beer's law, per 100px of path
  'shadow',
  'shadowSoftPx',
  'caustic',
  'causticWidthPx',
] as const satisfies readonly (keyof CrystalTuning)[]

export type TunedKey = (typeof TUNED_KEYS)[number]

/** The values the material reads, written in place each frame. */
export interface CrystalValues extends Readonly<Record<TunedKey, UniformNode<'float', number>>> {
  /** The hotspot, sheet px, floating at .z */
  readonly tip: UniformNode<'vec3', THREE.Vector3>
  /** Local -> sheet, built once in crystalLaw.ts */
  readonly rot: UniformNode<'mat3', THREE.Matrix3>
  /** The sheet's size in CSS px */
  readonly sheet: UniformNode<'vec2', THREE.Vector2>
  /** The camera, sheet px */
  readonly eye: UniformNode<'vec3', THREE.Vector3>
  /** The way the light TRAVELS, sheet space */
  readonly lightDir: UniformNode<'vec3', THREE.Vector3>
}

export function createCrystalValues(tune: CrystalTuning, sheetW: number, sheetH: number): CrystalValues {
  return {
    tip: uniform(new THREE.Vector3()),
    rot: uniform(new THREE.Matrix3()),
    sheet: uniform(new THREE.Vector2(sheetW, sheetH)),
    eye: uniform(new THREE.Vector3()),
    lightDir: uniform(new THREE.Vector3(0, 0, -1)),
    scalePx: uniform(tune.scalePx),
    roundPx: uniform(tune.roundPx),
    chamferPx: uniform(tune.chamferPx),
    girdlePx: uniform(tune.girdlePx),
    girdleThickPx: uniform(tune.girdleThickPx),
    crownDeg: uniform(tune.crownDeg),
    crownPx: uniform(tune.crownPx),
    pavilionDeg: uniform(tune.pavilionDeg),
    pavilionPx: uniform(tune.pavilionPx),
    ior: uniform(tune.ior),
    maxBendPx: uniform(tune.maxBendPx),
    dispersion: uniform(tune.dispersion),
    edgeLight: uniform(tune.edgeLight),
    skyHigh: uniform(tune.skyHigh),
    skyLow: uniform(tune.skyLow),
    specular: uniform(tune.specular),
    specularPow: uniform(tune.specularPow),
    absorbPer100: uniform(tune.absorbPer100),
    shadow: uniform(tune.shadow),
    shadowSoftPx: uniform(tune.shadowSoftPx),
    caustic: uniform(tune.caustic),
    causticWidthPx: uniform(tune.causticWidthPx),
  }
}

/** Copy every tuned number into its uniform. */
export function writeTuned(values: CrystalValues, tune: CrystalTuning): void {
  for (const key of TUNED_KEYS) values[key].value = tune[key]
}

// ── the shape ──────────────────────────────────────────────────────────

// The arrow, vertex for vertex from ARROW in crystalLaw.ts. No unit test
// compares the two lists. `gate:crystal-pointer` compares them only through
// the key drawn under the tip.
const ARROW: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 24],
  [5.5, 18.5],
  [9, 26.5],
  [12.5, 25],
  [9, 17],
  [16, 17],
]
type Vec2 = Node<'vec2'>
type Vec3 = Node<'vec3'>
type Vec4 = Node<'vec4'>
type Float = Node<'float'>

const arrow: Vec2[] = ARROW.map(([x, y]) => vec2(x, y))

function solidOf(v: CrystalValues) {
  // One edge of the winding test per vertex: nearest-point distance, and the
  // crossing flip. `a` is the previous vertex and `b` the current one, which
  // is the order the TS loop visits them in. The edges unroll at build time,
  // so no edge can be silently skipped.
  const sdArrowPolygon = Fn(([p]: [Vec2]) => {
    const d = dot(p.sub(arrow[0]), p.sub(arrow[0])).toVar()
    const s = float(1).toVar()
    arrow.forEach((b, i) => {
      const a = arrow[(i + arrow.length - 1) % arrow.length]
      const e = a.sub(b)
      const w = p.sub(b)
      const t = clamp(dot(w, e).div(dot(e, e)), 0, 1)
      const q = w.sub(e.mul(t))
      d.assign(min(d, dot(q, q)))
      const c0 = p.y.greaterThanEqual(b.y)
      const c1 = p.y.lessThan(a.y)
      const c2 = e.x.mul(w.y).greaterThan(e.y.mul(w.x))
      If(c0.and(c1).and(c2).or(c0.not().and(c1.not()).and(c2.not())), () => {
        s.assign(s.negate())
      })
    })
    return s.mul(sqrt(d))
  }, { name: 'sdArrowPolygon', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] })

  // The arrow's rest axis, derived from the same seven vertices rather than
  // written down again — a transcribed constant is one more thing that can
  // disagree with crystalLaw.ts, and this cannot.
  const arrowAxis = normalize(arrow.reduce((sum, vertex) => sum.add(vertex)))

  const sdInner2 = Fn(([q]: [Vec2]) => {
    const poly = sdArrowPolygon(q.div(v.scalePx)).mul(v.scalePx)
    // The chamfer: a flat face square across the arrow's axis, so the
    // hotspot at the point sits under a half-plane instead of under a
    // vertex. crystalLaw.ts carries the measurement that made it necessary.
    const cut = v.chamferPx.sub(dot(q, arrowAxis))
    return max(poly, cut).sub(v.roundPx)
  }, { name: 'sdInner2', type: 'float', inputs: [{ name: 'q', type: 'vec2' }] })

  // hotspotDrop in crystalLaw.ts: the shift that puts local z = 0 on the
  // stone's underside at the arrow's own point, which is where the frame
  // anchors the hotspot and where the view ray is built to pass through.
  const hotDrop = max(v.pavilionPx.add(v.chamferPx.sub(v.roundPx).sub(v.girdlePx).mul(tan(radians(v.pavilionDeg)))), 0)

  // sdCrystal in crystalLaw.ts: a brilliant cut swept along the arrow's
  // outline — keel, pavilion, girdle band, crown, table. Every term is a
  // half-space in the (sdInner2, z) plane, each Lipschitz-1, and `max` of
  // Lipschitz-1 under-estimators is one too, so the marches below stay safe
  // across the facet edges without a step-size fudge.
  const sdCrystal = Fn(([q]: [Vec3]) => {
    const d2 = sdInner2(q.xy).sub(v.girdlePx)
    const zg0 = v.pavilionPx.sub(hotDrop)
    const zg1 = zg0.add(v.girdleThickPx)
    const ac = radians(v.crownDeg)
    const ap = radians(v.pavilionDeg)
    const crown = d2.mul(sin(ac)).add(q.z.sub(zg1).mul(cos(ac)))
    const pavilion = d2.mul(sin(ap)).sub(q.z.sub(zg0).mul(cos(ap)))
    const table = q.z.sub(zg1.add(v.crownPx))
    return max(max(d2, hotDrop.negate().sub(q.z)), max(max(crown, pavilion), table))
  }, { name: 'sdCrystal', type: 'float', inputs: [{ name: 'q', type: 'vec3' }] })

  // GRAD_EPS in crystalLaw.ts. Analytic would be exact but jumps direction
  // across the medial axis between two edges, and the two copies agreeing
  // matters more here than either one being exact.
  const normalAt = Fn(([q]: [Vec3]) => {
    const e = 0.5
    const n = vec3(
      sdCrystal(q.add(vec3(e, 0, 0))).sub(sdCrystal(q.sub(vec3(e, 0, 0)))),
      sdCrystal(q.add(vec3(0, e, 0))).sub(sdCrystal(q.sub(vec3(0, e, 0)))),
      sdCrystal(q.add(vec3(0, 0, e))).sub(sdCrystal(q.sub(vec3(0, 0, e)))),
    )
    return n.div(max(length(n), 1e-9))
  }, { name: 'normalAt', type: 'vec3', inputs: [{ name: 'q', type: 'vec3' }] })

  // `rot` is orthonormal, so `v * m` is the inverse rotation. Spelled this
  // way round in both directions so neither is a transpose written by hand.
  const toLocal = (p: Vec3): Vec3 => p.sub(v.tip).mul(v.rot)
  const toLocalDir = (d: Vec3): Vec3 => d.mul(v.rot)
  const toSheetDir = (d: Vec3): Vec3 => v.rot.mul(d)
  const toSheet = (q: Vec3): Vec3 => v.rot.mul(q).add(v.tip)

  // The height of the girdle, the one plane where the solid's silhouette is
  // exactly `sdInner2 = girdlePx`. The shadow is thrown from here rather
  // than from mid-height: this cut has no straight prism anywhere, and the
  // girdle is both the widest section and the one with a closed form.
  const girdleZ = v.pavilionPx.add(v.girdleThickPx.mul(0.5)).sub(hotDrop)

  const halfZ = v.pavilionPx.add(v.girdleThickPx).add(v.crownPx).mul(0.5)
  const boundsCentre = vec3(v.scalePx.mul(8), v.scalePx.mul(13.25), halfZ.sub(hotDrop))
  const boundsPad = v.roundPx.add(v.girdlePx)
  const boundsRadius = length(vec3(v.scalePx.mul(8).add(boundsPad), v.scalePx.mul(13.25).add(boundsPad), halfZ))

  // Distance to the near intersection with that sphere, or -1 for a miss.
  const sphereEntry = Fn(([o, d, c, r]: [Vec3, Vec3, Vec3, Float]) => {
    const m = o.sub(c)
    const b = dot(m, d)
    const cc = dot(m, m).sub(r.mul(r))
    const h = b.mul(b).sub(cc)
    const s = sqrt(max(h, 0))
    const missed = h.lessThan(0).or(b.negate().add(s).lessThan(0))
    return missed.select(float(-1), max(b.negate().sub(s), 0))
  }, { name: 'sphereEntry', type: 'float', inputs: [{ name: 'o', type: 'vec3' }, { name: 'd', type: 'vec3' }, { name: 'c', type: 'vec3' }, { name: 'r', type: 'float' }] })

  // refract() with its total-internal-reflection case reported rather than
  // returned as a zero vector, which is indistinguishable from a ray that
  // happens to be zero. Same arithmetic as crystalLaw.ts's copy. The result
  // is (direction, 1) or (0, 0, 0, 0) on total internal reflection.
  const refractAt = Fn(([i, n, eta]: [Vec3, Vec3, Float]) => {
    const ndi = dot(i, n)
    const k = float(1).sub(eta.mul(eta).mul(float(1).sub(ndi.mul(ndi))))
    const o = eta.mul(i).sub(eta.mul(ndi).add(sqrt(max(k, 0))).mul(n))
    return k.lessThan(0).select(vec4(0), vec4(o, 1))
  }, { name: 'refractAt', type: 'vec4', inputs: [{ name: 'i', type: 'vec3' }, { name: 'n', type: 'vec3' }, { name: 'eta', type: 'float' }] })

  // The outline's own 2D gradient, unit — which way is downhill out of the
  // stone. Both facet normals are this vector tipped over by their angle.
  const outlineGrad = Fn(([xy]: [Vec2]) => {
    const e = 0.5
    const g = vec2(
      sdInner2(xy.add(vec2(e, 0))).sub(sdInner2(xy.sub(vec2(e, 0)))),
      sdInner2(xy.add(vec2(0, e))).sub(sdInner2(xy.sub(vec2(0, e)))),
    )
    return g.div(max(length(g), 1e-9))
  }, { name: 'outlineGrad', type: 'vec2', inputs: [{ name: 'xy', type: 'vec2' }] })

  return {
    sdInner2,
    sdCrystal,
    normalAt,
    toLocal,
    toLocalDir,
    toSheetDir,
    toSheet,
    girdleZ,
    boundsCentre,
    boundsRadius,
    sphereEntry,
    refractAt,
    outlineGrad,
  }
}

// ── one pass: the page, its shadow, and the glass standing on it ───────

export function createCrystalMaterial(surface: SurfaceNodes, v: CrystalValues): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  })
  const solid = solidOf(v)
  const { sdInner2, sdCrystal, normalAt, toLocal, toLocalDir, toSheetDir, toSheet, outlineGrad } = solid

  // The page, the Surface's own capture, at a sheet-space uv.
  // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
  const page = (at: Vec2): Vec4 => surface.map.sample(at) as Vec4

  // What a ray leaving the glass sees, given where it left and where it is
  // going. Sheet space, where +z is out of the page toward the eye.
  //
  // Downward, it sees the PAGE — extended to z = 0 and sampled. That is a
  // real screen-space reflection and it costs one tap: the environment this
  // object stands in is lying right underneath it, and inventing a grey for
  // it instead is most of what made the first version read as plastic.
  //
  // Upward there is nothing to sample, so it gets two greys and a sun:
  // bright overhead, dark below the horizon, one tight lobe at the light.
  const environment = Fn(([origin, d]: [Vec3, Vec3]) => {
    const seen = vec3(0).toVar()
    If(d.z.lessThan(-1e-6), () => {
      const q = origin.xy.add(d.xy.mul(origin.z.div(d.z.negate())))
      seen.assign(page(clamp(vec2(q.x, v.sheet.y.sub(q.y)).div(v.sheet), 0, 1)).rgb)
    }).Else(() => {
      const up = clamp(d.z.mul(0.5).add(0.5), 0, 1)
      const sun = pow(max(dot(d, v.lightDir.negate()), 0), v.specularPow).mul(v.specular)
      seen.assign(vec3(mix(v.skyLow, v.skyHigh, up.mul(up)).add(sun)))
    })
    return seen
  }, { name: 'environment', type: 'vec3', inputs: [{ name: 'origin', type: 'vec3' }, { name: 'd', type: 'vec3' }] })

  // The page as seen along one exit ray: displaced, capped, and split by
  // wavelength. `flat_` is where this pixel's ray would have landed with no
  // glass in the way, so the cap lands on the displacement and not on a
  // position — the same clamp crystalLaw.ts applies to the click.
  //
  // One chain at the middle index, with red read a little short of it and
  // blue a little long. Tracing all three separately would be three times
  // the marches for a fringe a few pixels wide.
  const pageAt = Fn(([origin, d, flat_]: [Vec3, Vec3, Vec2]) => {
    const bend = origin.xy.add(d.xy.mul(origin.z.div(d.z.negate()))).sub(flat_).toVar()
    const m = length(bend)
    If(m.greaterThan(v.maxBendPx), () => {
      bend.mulAssign(v.maxBendPx.div(m))
    })
    const uvAt = vec2(flat_.x.add(bend.x), v.sheet.y.sub(flat_.y).sub(bend.y)).div(v.sheet)
    const duv = vec2(bend.x, bend.y.negate()).div(v.sheet)
    const g = page(clamp(uvAt, 0, 1)).g
    const r = page(clamp(uvAt.add(duv.mul(v.dispersion)), 0, 1)).r
    const b = page(clamp(uvAt.sub(duv.mul(v.dispersion)), 0, 1)).b
    return vec3(r, g, b)
  }, { name: 'pageAt', type: 'vec3', inputs: [{ name: 'origin', type: 'vec3' }, { name: 'd', type: 'vec3' }, { name: 'flat_', type: 'vec2' }] })

  // One view ray through the solid, following the ZIGZAG: in through a crown
  // facet, then bouncing between the inside faces until its light runs out.
  //
  // At every face the ray meets from inside, Snell either lets a share
  // through — which is a place this pixel could have come from, and gets
  // added — or, past the critical angle, hands the whole thing back. Either
  // way the remainder reflects and carries on. Four segments, which is the
  // brilliant's own signature path: crown in, pavilion, pavilion, crown out.
  //
  // The old version of this function refracted ONCE and dropped whatever
  // total-internal-reflected, which meant the pixels a gem is brightest at
  // were the pixels it drew as nothing. What is added back is not a
  // highlight: it is the page, seen from somewhere else entirely, several
  // copies of it superimposed. That superposition is the thing the eye reads
  // as a cut stone rather than a lens.
  //
  // Straight (not premultiplied) colour in rgb, and alpha 1 where the ray
  // hits the solid; (0, 0, 0, 0) wherever it misses.
  const glassAt = Fn(([p]: [Vec2]) => {
    const result = vec4(0).toVar()
    const dir = normalize(vec3(p, 0).sub(v.eye)).toVar()
    const o = toLocal(v.eye).toVar()
    const d = toLocalDir(dir).toVar()
    const bc = solid.boundsCentre
    const br = solid.boundsRadius.toVar()

    const s = solid.sphereEntry(o, d, bc, br).toVar()
    If(s.greaterThanEqual(0), () => {
      // In from outside: the field is positive out here, so a step of its own
      // value can never pass through the surface it is measuring.
      const hit = bool(false).toVar()
      const limit = float(2).mul(br).add(length(o.sub(bc)))
      Loop(96, () => {
        const sd = sdCrystal(o.add(d.mul(s))).toVar()
        If(sd.lessThan(0.15), () => {
          hit.assign(true)
          Break()
        })
        s.addAssign(sd)
        If(s.greaterThan(limit), () => {
          Break()
        })
      })

      If(hit, () => {
        const p0 = o.add(d.mul(s)).toVar()
        const n0 = normalAt(p0).toVar()
        const entry = solid.refractAt(d, n0, float(1).div(max(v.ior, 1))).toVar()
        If(entry.w.greaterThan(0.5), () => {
          const ray = entry.xyz.toVar()
          const f0 = pow(v.ior.sub(1).div(v.ior.add(1)), 2)
          const flat_ = v.eye.xy.add(dir.xy.mul(v.eye.z.div(dir.z.negate())))
          const acc = vec3(0).toVar()
          const tint = vec3(1).toVar()
          const pos = p0.toVar()

          Loop(4, () => {
            // Out from inside: the field is negative in here, so the step is its
            // magnitude. Started clear of the face it just left, or the first step
            // is zero and the march never moves.
            const u = float(0.15 * 4).toVar()
            const out = bool(false).toVar()
            Loop(96, () => {
              const sd = sdCrystal(pos.add(ray.mul(u))).toVar()
              If(sd.greaterThan(-0.15), () => {
                out.assign(true)
                Break()
              })
              u.subAssign(sd)
              If(u.greaterThan(br.mul(4)), () => {
                Break()
              })
            })
            If(out.not(), () => {
              Break()
            })

            const p1 = pos.add(ray.mul(u)).toVar()

            // Beer's law over the segment just crossed, tinted so red goes first —
            // the green cast every thick edge of real glass has. This is the cue
            // that says the thing has a volume and not just a surface, and with
            // bounces it also says WHICH exit the eye is looking at: a ray that has
            // crossed the stone three times arrives visibly darker than one that
            // went straight through.
            tint.mulAssign(exp(vec3(1.15, 0.85, 1.0).negate().mul(v.absorbPer100.mul(0.01)).mul(u)))

            const n1 = normalAt(p1).toVar()
            const leaving = solid.refractAt(ray, n1.negate(), max(v.ior, 1)).toVar()
            const back = float(1).toVar()
            If(leaving.w.greaterThan(0.5), () => {
              // Schlick on the OUTGOING angle, which is the form that holds going
              // from dense to rare: the approximation is written around the angle
              // in the rarer medium, and using the internal one reports a mirror as
              // a window right where the mirror matters most.
              back.assign(f0.add(float(1).sub(f0).mul(pow(float(1).sub(clamp(dot(leaving.xyz, n1), 0, 1)), 5))))
              const E = toSheet(p1)
              const A = toSheetDir(leaving.xyz)
              const seen = vec3(0).toVar()
              If(A.z.lessThan(-1e-6), () => {
                seen.assign(pageAt(E, A, flat_))
              }).Else(() => {
                seen.assign(environment(E, A).mul(v.edgeLight))
              })
              acc.addAssign(tint.mul(float(1).sub(back)).mul(seen))
            })

            tint.mulAssign(back)
            If(max(tint.r, max(tint.g, tint.b)).lessThan(0.02), () => {
              Break()
            })
            ray.assign(reflect(ray, n1))
            pos.assign(p1)
          })

          // The entry face's own reflection, on top of everything the inside sent
          // back. Glass is a window head on and a mirror at grazing incidence, and
          // letting that one number choose between the inside and the environment
          // is what makes the rim, the facet breaks and the highlight all fall out
          // of the same geometry.
          const nSheet = toSheetDir(n0)
          const fin = f0.add(float(1).sub(f0).mul(pow(float(1).sub(clamp(dot(dir.negate(), nSheet), 0, 1)), 5)))
          const mirror = environment(toSheet(p0), reflect(dir, nSheet)).mul(v.edgeLight)
          result.assign(vec4(mix(acc, mirror, clamp(fin, 0, 1)), 1))
        })
      })
    })
    return result
  }, { name: 'glassAt', type: 'vec4', inputs: [{ name: 'p', type: 'vec2' }] })

  material.outputNode = Fn(() => {
    // Sheet pixels with y DOWN, which is the frame crystalLaw.ts, a bounding
    // rect and a pointermove all already speak. uv's v runs the other way, so
    // this flip is the only conversion in the file.
    const vUv = uv()
    const p = vec2(vUv.x, float(1).sub(vUv.y)).mul(v.sheet).toVar()
    const c = page(vUv).toVar()

    // ── what the crystal throws down ───────────────────────────────────
    //
    // Everything here is confined to the patch of page the solid can reach,
    // and the test is one length against one radius. Without it the whole
    // viewport would pay for a shadow the size of a playing card.
    // `tip.z + girdleZ` is the height the shadow is thrown from; the
    // light's own displacement is not capped the way the eye's is, but it is
    // the same glass, so the eye's cap bounds how far it can carry.
    const lift = v.tip.z.add(solid.girdleZ)
    const centre = v.tip.xy.add(v.lightDir.xy.mul(lift.div(v.lightDir.z.negate())))
    const reach = solid.boundsRadius.add(v.shadowSoftPx.mul(2))
    If(dot(p.sub(centre), p.sub(centre)).lessThan(reach.mul(reach)), () => {
      // The shadow: walk the light BACKWARDS to the girdle plane and ask the
      // silhouette there. The stone tapers above and below it, so this is the
      // widest section rather than the average one — a shadow a little larger
      // than the true one, cast by the outline the eye reads as the object's.
      const ol = toLocal(vec3(p, 0))
      const dl = toLocalDir(v.lightDir).toVar()
      const occ = float(0).toVar()
      const band = float(0).toVar()
      const inner = float(0).toVar()
      If(abs(dl.z).greaterThan(1e-6), () => {
        const q = ol.add(dl.mul(solid.girdleZ.sub(ol.z).div(dl.z))).xy.toVar()
        const sdS = sdInner2(q).sub(v.girdlePx).toVar()
        occ.assign(float(1).sub(smoothstep(v.shadowSoftPx.negate(), v.shadowSoftPx, sdS)))

        // The caustic. The stone gathers light hardest at the rim, where the
        // facet slope is steepest, and drops it just inside the shadow's
        // down-light edge — so the band rides the same silhouette distance
        // the shadow does, weighted to the side facing away from the light.
        // The interior it gathers FROM is left lighter than a flat occluder
        // would leave it.
        //
        // Inverting the light map is what this did until 2026-08-27, and it
        // drew nothing at all: the map's image is a sliver of page mostly
        // hidden under the stone, so a single Newton step from a pixel
        // outside that sliver lands where no ray enters, the guard on the
        // Jacobian never opened, and the gain stayed zero for every pixel on
        // screen. Inverting it properly is not a tuning fix — at a fold the
        // map is many-to-one and the iteration has no fixed point to find.
        // Light that lands in more than one place at once has to be
        // SCATTERED, which is a second pass, not a fragment.
        // Centred just OUTSIDE the silhouette, not inside it like the bead
        // in the selection scene: the light here comes down at 75 degrees
        // over a solid 187px across, so only about 29px of shadow ever
        // clears the stone and a band drawn inside the outline is a band
        // drawn underneath the thing casting it.
        const cw = max(v.causticWidthPx, 0.5)
        const away = clamp(
          float(0.5).add(float(0.5).mul(dot(outlineGrad(q), normalize(dl.xy.add(vec2(1e-5)))))),
          0,
          1,
        )
        const qb = sdS.sub(cw.mul(0.4)).div(cw)
        band.assign(exp(qb.negate().mul(qb)).mul(away).mul(away))
        inner.assign(smoothstep(0, max(v.shadowSoftPx, 1).mul(2.5), sdS.negate()))
      })

      // Shadow first, focused light on top of it: the light the glass bent
      // had to pass through the glass, so it lands inside the glass's own
      // shadow and nowhere else.
      const carve = clamp(float(1).sub(v.caustic.mul(1.5).mul(band)), 0, 1)
      const darkened = c.rgb.mul(
        float(1).sub(occ.mul(v.shadow).mul(float(1).sub(v.caustic.mul(0.35).mul(inner))).mul(carve)),
      )
      // Squared before the renderer's sRGB encode, which lifts small linear
      // values about 5x — additive blew out at the lowest knob settings without it.
      const gleam = v.caustic.mul(0.75).mul(band)
      c.assign(vec4(darkened.add(vec3(1.0, 0.97, 0.88).mul(gleam).mul(gleam).mul(c.a)), c.a))
    })

    // ── the glass ──────────────────────────────────────────────────────
    //
    // Four rays on a rotated grid, always — the silhouette is a marched
    // surface with no derivative for the hardware to filter, and the facet
    // breaks inside it are step edges too. The whole solid covers a few per
    // cent of the viewport, so the cost lands only where the aliasing is.
    //
    // Measured 2026-08-25, headless Chrome at 1280x860, 30 renders per sync:
    // 3.7 ms a frame with the median batch and 1.5 with the fastest. Shrink
    // the solid to nothing and the same scene costs 1.1 / 0.8, so the glass
    // — four rays, each up to four bounces — is about 2.5 ms of it.
    const acc = vec3(0).toVar()
    const cov = float(0).toVar()
    for (const [x, y] of [
      [-0.375, -0.125],
      [-0.125, 0.375],
      [0.125, -0.375],
      [0.375, 0.125],
    ]) {
      const g = glassAt(p.add(vec2(x, y)))
      // A miss is (0, 0, 0, 0), so adding it changes neither sum.
      acc.addAssign(g.rgb)
      cov.addAssign(g.a)
    }
    // `acc` is already premultiplied: each sample carries alpha 1, so the
    // sum over four is the coverage-weighted colour and `cov * 0.25` is its
    // alpha. This is the over operator, spelled out.
    c.assign(vec4(acc.mul(0.25), cov.mul(0.25)).add(c.mul(float(1).sub(cov.mul(0.25)))))

    return premultipliedOutput(c.mul(surface.radiusMask(vUv)))
  })()
  return material
}
