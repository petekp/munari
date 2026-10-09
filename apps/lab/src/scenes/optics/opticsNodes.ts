// The TSL half of the optics. The other half is `opticsLaw.ts`, and the
// two are twins: `lensNormal`, `refract` and `landOffset` appear below
// line for line. The shader decides which page texel a fragment shows;
// the law decides which element a click reaches. Change one, change both.
//
// Everything here works in WORLD xy — the scene's camera is
// pixel-calibrated, so a world unit is a CSS px, and the lens plane is a
// disc parked `standoff` units above the page at z = 0. Page coordinates
// (y down, origin at the sheet's corner) exist only on the CPU, where the
// layout table lives.
//
// Every material here computes linear color and returns it through
// `premultipliedOutput`, which lands it on the canvas as WebGL's per-fragment
// sRGB encode did (decisions.md #72).

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type TextureNode, type UniformNode } from 'three/webgpu'
import {
  Discard,
  Fn,
  If,
  Loop,
  atan,
  clamp,
  cos,
  dot,
  float,
  mix,
  modelWorldMatrix,
  positionGeometry,
  positionWorld,
  pow,
  refract,
  sin,
  smoothstep,
  texture,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput } from '@petepetrash/munari'

/** How many blocks the paint scope can label at once. */
export const SCOPE_RECTS = 8

// ── the mounts ─────────────────────────────────────────────────────────
//
// Rim and collar, from one shader with one switch. No lights and no
// environment map anywhere in this scene: the sheet is paint and the
// instruments are turned metal, and both are drawn rather than lit — so
// the scene has nothing to fetch and nothing to go dark if a preset fails
// to load. `ribs` at 0 is a smooth rim; at 88 it is a knurled collar you
// can see turn.

export function createMetalMaterial(metal: string, innerRadius: number, outerRadius: number, ribCount: number): MeshBasicNodeMaterial {
  const color = uniform(new THREE.Color(metal))
  const inner = uniform(innerRadius)
  const outer = uniform(outerRadius)
  const ribs = uniform(ribCount)
  const pos = varying(positionGeometry.xy)

  const material = new MeshBasicNodeMaterial()
  material.outputNode = Fn(() => {
    const r = pos.length()
    const d = pos.div(r.max(1.0e-4))

    // A cylindrical bevel across the ring's width — bright along the crown,
    // falling to both edges. This is what reads as a turned part rather
    // than as a flat annulus.
    const t = clamp(r.sub(inner).div(outer.sub(inner).max(1.0e-4)), 0, 1)
    const crown = sin(t.mul(3.14159265))
    const key = float(0.5).add(float(0.5).mul(dot(d, vec2(-0.5, 0.78).normalize())))
    const rib = ribs
      .greaterThan(0.5)
      .select(float(0.62).add(float(0.38).mul(pow(float(0.5).add(float(0.5).mul(cos(atan(pos.y, pos.x).mul(ribs)))), 1.4))), float(1))

    const col = color
      .mul(float(0.3).add(float(0.62).mul(key)))
      .mul(float(0.52).add(float(0.72).mul(crown)))
      .mul(rib)
      .add(vec3(1).mul(0.3).mul(pow(key, 14)).mul(crown))
    return premultipliedOutput(vec4(col, 1))
  })()
  return material
}

// ── the free sheet's frame ─────────────────────────────────────────────
//
// The turned instruments wear a ring and a knurled collar. The sheet is
// bare glass, so its whole mount is a thin band around the edge, and that
// band carries all three grips: the sides move it, the corner squares
// resize it, and a knurled track along the bottom sets its power.
//
// The track is the reason this is a shader and not four boxes. As the
// sheet grows, its corner moves further from the axis and CAP_MARGIN takes
// powers away from both ends of the collar — so the reachable part of the
// track is drawn lit and the rest dark. Enlarge the sheet and you watch the
// usable band close in. That is the law, on the instrument, without a word
// of explanation.
//
// The mesh is a unit plane scaled to the outer size, so `pos` is the
// offset from the sheet's centre in world px and every extent below is a
// real distance rather than a fraction.

/** The frame's live values, written by the frame loop. */
export interface FrameValues {
  readonly color: UniformNode<'color', THREE.Color>
  readonly half: UniformNode<'vec2', THREE.Vector2>
  readonly band: UniformNode<'float', number>
  readonly grip: UniformNode<'float', number>
  // Where the collar sits, and the part of the track it can still reach,
  // both as fractions of the instrument's DECLARED range.
  readonly tick: UniformNode<'float', number>
  readonly track: UniformNode<'vec2', THREE.Vector2>
}

export function createFrameValues(metal: string, band: number): FrameValues {
  return {
    color: uniform(new THREE.Color(metal)),
    half: uniform(new THREE.Vector2()),
    band: uniform(band),
    grip: uniform(1),
    tick: uniform(0.5),
    track: uniform(new THREE.Vector2(0, 1)),
  }
}

export function createFrameMaterial(v: FrameValues): MeshBasicNodeMaterial {
  const pos = varying(
    modelWorldMatrix.mul(vec4(positionGeometry, 1)).xy.sub(modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xy),
  )

  const material = new MeshBasicNodeMaterial()
  material.outputNode = Fn(() => {
    const d = pos.abs().sub(v.half)
    const inner = d.max(0).length().add(d.x.max(d.y).min(0))
    // Inside is glass and outside is bench; this shader owns only the band.
    Discard(inner.lessThan(0).or(inner.greaterThan(v.band)))

    const t = clamp(inner.div(v.band), 0, 1)
    const crown = sin(t.mul(3.14159265))
    const key = float(0.5).add(float(0.5).mul(dot(pos.normalize(), vec2(-0.5, 0.78).normalize())))
    const col = v.color
      .mul(float(0.34).add(float(0.56).mul(key)))
      .mul(float(0.55).add(float(0.68).mul(crown)))
      .toVar()

    If(d.x.greaterThan(0).and(d.y.greaterThan(0)), () => {
      // A corner square. Flat and pale, so it reads as something to take
      // hold of rather than as more frame.
      col.assign(mix(v.color.mul(1.4), vec3(0.95), 0.24).mul(float(0.74).add(float(0.42).mul(crown))))
    }).ElseIf(pos.y.lessThan(0).and(d.y.greaterThan(0)).and(pos.x.abs().lessThan(v.grip)), () => {
      // Ribs at a fixed spatial frequency: resizing the sheet must not
      // stretch the knurl, or the grip would read as a different part.
      col.mulAssign(float(0.66).add(float(0.34).mul(pow(float(0.5).add(float(0.5).mul(cos(pos.x.mul(0.7)))), 1.4))))
      const u = pos.x.div(v.grip).mul(0.5).add(0.5)
      If(u.lessThan(v.track.x).or(u.greaterThan(v.track.y)), () => {
        col.mulAssign(0.4)
      })
      const tick = pos.x.sub(v.tick.mul(2).sub(1).mul(v.grip)).abs()
      col.assign(mix(vec3(0.07, 0.08, 0.1), col, smoothstep(0, 1.7, tick)))
    })

    return premultipliedOutput(vec4(col, 1))
  })()
  return material
}

// ── the glass ──────────────────────────────────────────────────────────

/** The lens's live values, written by the frame loop. */
export interface LensValues {
  readonly page: TextureNode
  // The offscreen pass frames exactly the disc that opticsLaw's
  // footprint() reports: centre in .xy, half-extent in .zw, world units.
  readonly frame: UniformNode<'vec4', THREE.Vector4>
  readonly camPos: UniformNode<'vec3', THREE.Vector3>
  readonly center: UniformNode<'vec2', THREE.Vector2>
  readonly aperture: UniformNode<'float', number>
  // Half-width and half-height when the face is a rectangle; (0,0) for a
  // disc. opticsLaw.inAperture, as a distance field.
  readonly half: UniformNode<'vec2', THREE.Vector2>
  readonly curvature: UniformNode<'float', number>
  readonly standoff: UniformNode<'float', number>
  readonly ior: UniformNode<'float', number>
  readonly tint: UniformNode<'float', number>
  // 0 — glass. 1 — the paint scope, which looks through a flat face and
  // spends its contrast on the ledger instead of on the page.
  readonly mode: UniformNode<'float', number>
  /** Each specimen's box, centre in .xy and half-extent in .zw. Uploaded
   *  from this array on every render, so a write in place reaches the shader. */
  readonly rects: THREE.Vector4[]
  /** Each specimen's paint heat, 0..1, uploaded the same way. */
  readonly heat: number[]
}

export function createLensValues(page: THREE.Texture): LensValues {
  return {
    page: texture(page),
    frame: uniform(new THREE.Vector4(0, 0, 1, 1)),
    camPos: uniform(new THREE.Vector3()),
    center: uniform(new THREE.Vector2()),
    aperture: uniform(90),
    half: uniform(new THREE.Vector2()),
    curvature: uniform(130),
    standoff: uniform(150),
    ior: uniform(1.52),
    tint: uniform(0.07),
    mode: uniform(0),
    rects: Array.from({ length: SCOPE_RECTS }, () => new THREE.Vector4()),
    heat: new Array<number>(SCOPE_RECTS).fill(0),
  }
}

// opticsLaw.lensNormal
function lensNormal(p: Node<'vec2'>, curvature: Node<'float'>): Node<'vec3'> {
  const k = curvature.mul(curvature).sub(dot(p, p)).max(1.0e-6).sqrt()
  return curvature
    .abs()
    .greaterThan(1.0e7)
    .select(vec3(0, 0, 1), vec3(curvature.lessThan(0).select(p.negate(), p), k).normalize())
}

// A cool-to-hot ramp for paints per second. Deliberately not a rainbow:
// the reading that matters is "is this block painting at all", and a ramp
// that starts at the page's own grey answers it without a legend.
function heatRamp(t: Node<'float'>): Node<'vec3'> {
  const calm = vec3(0.24, 0.62, 0.47)
  const warm = vec3(0.93, 0.72, 0.22)
  const hot = vec3(0.92, 0.27, 0.22)
  return t.lessThan(0.5).select(mix(calm, warm, t.mul(2)), mix(warm, hot, t.sub(0.5).mul(2)))
}

export function createLensMaterial(v: LensValues): MeshBasicNodeMaterial {
  const rects = uniformArray<'vec4'>(v.rects, 'vec4')
  const heat = uniformArray<'float'>(v.heat, 'float')

  // Signed distance to the edge of the glass: negative inside, 0 on the edge.
  // The disc branch is r minus the aperture and the rect branch the usual box
  // field, so everything downstream — the cut, the cell vignette, the
  // feathered edge — is written once against a number instead of twice
  // against a shape.
  const faceEdge = (p: Node<'vec2'>): Node<'float'> => {
    const d = p.abs().sub(v.half)
    return v.half.x.lessThanEqual(0).select(p.length().sub(v.aperture), d.max(0).length().add(d.x.max(d.y).min(0)))
  }

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  })
  material.outputNode = Fn(() => {
    const p = positionWorld.xy.sub(v.center)
    const edge = faceEdge(p)
    Discard(edge.greaterThan(0))

    // Under a perspective eye the incident ray is per-fragment. This one
    // line is the whole difference from the orthographic spike.
    const I = positionWorld.sub(v.camPos).normalize()

    const n = lensNormal(p, v.curvature)
    const rd = refract(I, n, float(1).div(v.ior))
    // `refract` reports total internal reflection as a zero vector; a ray
    // bent back up never reaches the page either.
    Discard(rd.z.greaterThanEqual(-1.0e-9))

    const landed = v.center.add(p).add(rd.xy.mul(v.standoff.div(rd.z.negate())))
    const at = clamp(landed.sub(v.frame.xy).div(v.frame.zw.mul(2)).add(0.5), 0, 1)
    // The pass draws world y up, and a render target samples v = 0 at the
    // top of the image drawn into it (passMaterial), so v runs down.
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    const col = (v.page.sample(vec2(at.x, float(1).sub(at.y))) as Node<'vec4'>).rgb.toVar()

    If(v.mode.greaterThan(0.5), () => {
      // Drain the page to a ghost, then paint the ledger over it. The
      // outlines are the second reading: they are the Surface boundaries,
      // invisible on the page and the reason the loupe can sharpen one
      // block without paying for the rest.
      const g = dot(col, vec3(0.2126, 0.7152, 0.0722))
      col.assign(mix(vec3(g), col, 0.14).mul(0.85).add(0.09))
      Loop(SCOPE_RECTS, ({ i }) => {
        const q = rects.element(i)
        const d = landed.sub(q.xy).abs().sub(q.zw)
        const outside = d.max(0).length().add(d.x.max(d.y).min(0))
        If(q.z.greaterThan(0).and(outside.lessThanEqual(0)), () => {
          const h = clamp(heat.element(i), 0, 1)
          col.assign(mix(col, heatRamp(h), float(0.16).add(float(0.42).mul(h))))
          col.assign(mix(col, vec3(0.1, 0.11, 0.13), smoothstep(-1.6, -0.2, outside)))
        })
      })
    })

    // A cell, not a decoration: a real loupe's mount vignettes the last
    // couple of millimetres, and the eye reads the darkening as thickness.
    // Measured inward from the edge, so a rectangle darkens along its sides
    // rather than in a circle that would ignore the corners.
    const depth = v.half.x.greaterThan(0).select(v.half.x.min(v.half.y), v.aperture)
    col.mulAssign(float(1).sub(float(0.3).mul(smoothstep(depth.mul(-0.12), 0, edge))))
    // One glint off the curved face, steep enough to stay at the rim where
    // the curvature is, so it never sits on top of the thing being read.
    col.addAssign(v.tint.mul(pow(dot(n, vec3(-0.45, 0.55, 0.7).normalize()).max(0), 9)))

    const alpha = float(1).sub(smoothstep(-1, 0, edge))
    return premultipliedOutput(vec4(col.mul(alpha), alpha))
  })()
  return material
}
