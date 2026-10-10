// The glass is a distance field, not a mesh. Every glass panel builds on
// this file.
//
// The mesh spike gave every panel an extruded rounded-rect wearing drei's
// MeshTransmissionMaterial, and paid for it with one full scene render PER
// PANEL: MTM refracts by sampling a screen-space buffer, so each panel needs
// its own buffer with itself (and everything in front of it) hidden. Three
// panels, three scene renders, and the bookkeeping to keep them ordered.
//
// This is the other way round. Render the scene ONCE, then composite each
// panel as a full-screen pass that:
//
//   1. rebuilds the eye ray for the pixel and intersects it with the panel's
//      own plane — so the panel keeps an arbitrary 3D pose; the SDF is
//      evaluated in PANEL-LOCAL 2D, not in screen space,
//   2. evaluates a rounded-rect SDF there. That is the whole shape: no
//      geometry, no curveSegments, no MSAA — coverage comes out of the
//      distance with an exact analytic antialias,
//   3. builds a bezel normal from the SDF's gradient and an analytic height
//      profile, refracts the eye ray through it, and samples the ACCUMULATED
//      image behind it,
//   4. lays the panel's own DOM texture on top, unrefracted, clipped by the
//      same coverage that drew the glass.
//
// Because the passes ping-pong far→near, a panel samples the composite of
// everything already laid down behind it — glass, ink and world. Multi-level
// refraction is not a feature here, it's the shape of the loop; the mesh
// path's cumulative-hide ordering rule is deleted rather than
// reimplemented.
//
// Everything below runs in linear light: the scene target is HalfFloat, a
// render into a target gets no tone mapping and no output transfer, and the
// blit is the one place tone mapping and the sRGB transfer happen, once, on
// the way to the screen.
//
// The passes draw with clip y negated, so a pass's uv lands where a later
// sample at that uv reads it (`passMaterial` in @petepetrash/munari/advanced
// states the law and its measurement). The ray and every re-projection below are in
// screen uv, y up, and `flipV` turns one into a target coordinate.
//
// Ownership: this module owns the pixels. glassSdf.tsx owns the targets, the
// pass order, and every uniform write.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type TextureNode, type UniformArrayNode, type UniformNode } from 'three/webgpu'
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  atan,
  clamp,
  dot,
  exp,
  float,
  fwidth,
  inverseSqrt,
  length,
  max,
  min,
  mix,
  normalize,
  perspectiveDepthToViewZ,
  pow,
  reflect,
  refract,
  sign,
  sin,
  smoothstep,
  sqrt,
  texture,
  toneMapping,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput } from '@petepetrash/munari'
import { passMaterial } from '@petepetrash/munari/advanced'

type Float = UniformNode<'float', number>
type Int = UniformNode<'int', number>

/**
 * Taps per pixel (8 is the tuned default): each sample walks one step along
 * a spectral ramp, so a single loop buys BOTH dispersion (the step indexes an
 * ior between ior±chroma) and frost (it also jitters the sample point).
 * Weighting the taps by a spectral response and normalising means chroma=0
 * degrades to a plain blur instead of a tinted one.
 */
const SAMPLES = 8

/** How many of each array slot one panel may carry. */
export interface GlassSdfLimits {
  blobs: number
  rects: number
  ripples: number
  glows: number
}

/**
 * Every value one glass pass reads. The compositor writes `.value` on these
 * before each pass; the one material keeps sampling the same nodes.
 *
 * The panel may carry up to `limits.blobs` and `limits.rects` coplanar
 * satellites — circles and rounded rects — smooth-min-unioned into its
 * field. That union is the reason the shape had to stop being a mesh — two
 * meshes can only overlap, but two distances can merge, and the neck between
 * them is three lines of arithmetic rather than a remesh.
 *
 * A panel therefore need not be one card. It can be a LAYOUT: a rail and a
 * pane that started life as the same rounded rect, a column of message
 * bubbles that fuse where they crowd. One pass, one bezel, one refraction,
 * and the boundaries between the parts are decided by a blend radius rather
 * than by a scene graph.
 */
export interface GlassSdfValues {
  /** Everything composited so far (linear). */
  readonly src: TextureNode
  /** Scene depth, for occlusion. */
  readonly depth: TextureNode
  /** The panel's live DOM (premultiplied, sRGB tex). */
  readonly ink: TextureNode
  /** 1 when `ink` holds this panel's DOM, 0 when it has none yet. */
  readonly hasInk: Float
  readonly inkOpacity: Float
  // The DOM's own frame in panel-local units: xy = centre, zw = half extents.
  // Decoupled from the field on purpose. The ink is a property of the PANEL,
  // not of whatever the field currently happens to be — so a shell can melt
  // from one rounded rect into two without dragging its texture along, and a
  // column of bubbles can share a single DOM that spans all of them.
  readonly inkRect: UniformNode<'vec4', THREE.Vector4>

  // camera
  readonly camPos: UniformNode<'vec3', THREE.Vector3>
  /** clip -> world */
  readonly invProjView: UniformNode<'mat4', THREE.Matrix4>
  /** world -> clip */
  readonly projView: UniformNode<'mat4', THREE.Matrix4>
  /** world -> view */
  readonly view: UniformNode<'mat4', THREE.Matrix4>
  readonly near: Float
  readonly far: Float

  // panel frame
  /** world -> panel local */
  readonly panelInv: UniformNode<'mat4', THREE.Matrix4>
  /** panel local -> world (rotation) */
  readonly panelRot: UniformNode<'mat3', THREE.Matrix3>
  /** half extents, world units */
  readonly half: UniformNode<'vec2', THREE.Vector2>
  /** corner radius, world units */
  readonly radius: Float
  // ...and whether that rect is in the field at all (1 or 0). A panel whose
  // shape is entirely satellites (a chat rail that is only its rows) turns it
  // off; the rect then survives solely as the ink's default frame and the
  // raycast quad.
  readonly hasBase: Float

  // satellites: shapes COPLANAR with the panel (same local z = 0), unioned
  // into its field with a smooth minimum. They carry no DOM of their own —
  // they are shape, not surface; the panel's one texture spans all of them.
  //   blobs: xy = centre, z = radius (a circle, three ops)
  //   rects: xy = centre, zw = half extents; rectR = corner radius
  readonly blobs: UniformArrayNode<'vec3'>
  readonly blobSlots: THREE.Vector3[]
  readonly blobCount: Int
  readonly rects: UniformArrayNode<'vec4'>
  readonly rectSlots: THREE.Vector4[]
  readonly rectR: UniformArrayNode<'float'>
  readonly rectRadii: number[]
  readonly rectCount: Int
  /** blend radius: how far out a neck forms */
  readonly smooth: Float

  // ripples: expanding wave packets on the panel's surface, emitted where a
  // satellite makes or breaks contact. xy = origin (panel-local), z = age in
  // seconds, w = signed amplitude (negative for a release, so the surface
  // recoils instead of swelling).
  readonly ripples: UniformArrayNode<'vec4'>
  readonly rippleSlots: THREE.Vector4[]
  // The velocity of whatever MADE each ripple, panel-local world units per
  // second. This is what stops a ripple being a circle: see the Doppler note
  // down in the wave loop. A ripple uploaded with zero velocity reproduces the
  // stationary law exactly, so this is a strict extension of it.
  readonly rippleVel: UniformArrayNode<'vec2'>
  readonly rippleVelSlots: THREE.Vector2[]
  /** reference c, for v/c */
  readonly rippleWaveSpeed: Float
  readonly rippleCount: Int
  /** phase constant, 4/(27 sigma/rho) — sets scale */
  readonly rippleK: Float
  /** viscosity: how fast short waves are eaten */
  readonly rippleNu: Float
  // Source RADIUS, PER RIPPLE — a contact is not a delta, and crucially not
  // every contact is the same size. This is the knob that separates an impact
  // from a release: see the note at the source term in the wave loop.
  readonly rippleSrcR: UniformArrayNode<'float'>
  readonly rippleSrcRadii: number[]
  /** bulk loss, seconds */
  readonly rippleDecay: Float
  /** 0 = the DOM stays flat and crisp (see below) */
  readonly rippleInk: Float

  // glows: light struck INTO the glass where a pointer landed. Same array
  // contract as the ripples — xy = origin (panel-local), z = age in seconds,
  // w = amplitude — but a ripple bends the surface and a glow does not touch
  // it at all. This is emission: the panel stops being purely a lens for one
  // beat and becomes a source, which is why it is added after the refraction
  // loop and before the ink. The label keeps its own pixels and the light
  // comes out from underneath it.
  readonly glows: UniformArrayNode<'vec4'>
  readonly glowSlots: THREE.Vector4[]
  readonly glowCount: Int
  readonly glowColor: UniformNode<'color', THREE.Color>
  /** how far the bloom opens, world units */
  readonly glowReach: Float
  /** seconds from strike to dark */
  readonly glowLife: Float

  // glass
  /** width of the lensing rim, world units */
  readonly bezel: Float
  /** height of the bezel bulge, world units */
  readonly thickness: Float
  /** how far the refracted ray travels before we re-project it — the strength of the bend */
  readonly spread: Float
  readonly ior: Float
  readonly chroma: Float
  /** frost */
  readonly rough: Float
  readonly tint: UniformNode<'color', THREE.Color>
  readonly tintAmount: Float
  /** gain on the light piped out at the rim */
  readonly edgeLight: Float
  /** how much environment the grazing bezel mirrors */
  readonly edgeReflect: Float
  /** peak displacement of the living boundary */
  readonly edgeWarp: Float
  readonly edgeWarpSpeed: Float
  // The one genuine clock in this material. Everything else here takes an AGE
  // the compositor already differenced, because an event knows how old it is
  // and not what time it is. A standing oscillation is the exception that
  // proves it: it is not an event, it has no birth to be measured from, so it
  // needs the wall clock itself.
  readonly time: Float
  readonly specular: Float
  readonly lightDir: UniformNode<'vec3', THREE.Vector3>
}

/**
 * The nodes for one compositor. Every number is rewritten before each pass,
 * so these starting values only have to be valid.
 */
export function createGlassSdfValues(
  limits: GlassSdfLimits,
  textures: { src: THREE.Texture; depth: THREE.Texture; ink: THREE.Texture },
): GlassSdfValues {
  // Allocated full-length once: the array uploads whole, so it must keep its
  // size even when the panel carries fewer blobs — blobCount is what bounds
  // the loop.
  const blobSlots = Array.from({ length: limits.blobs }, () => new THREE.Vector3())
  const rectSlots = Array.from({ length: limits.rects }, () => new THREE.Vector4())
  const rectRadii = new Array<number>(limits.rects).fill(0)
  const rippleSlots = Array.from({ length: limits.ripples }, () => new THREE.Vector4())
  const rippleVelSlots = Array.from({ length: limits.ripples }, () => new THREE.Vector2())
  const rippleSrcRadii = new Array<number>(limits.ripples).fill(0.04)
  const glowSlots = Array.from({ length: limits.glows }, () => new THREE.Vector4())
  return {
    src: texture(textures.src),
    depth: texture(textures.depth),
    ink: texture(textures.ink),
    hasInk: uniform(0),
    inkOpacity: uniform(1),
    inkRect: uniform(new THREE.Vector4(0, 0, 1, 1)),
    camPos: uniform(new THREE.Vector3()),
    invProjView: uniform(new THREE.Matrix4()),
    projView: uniform(new THREE.Matrix4()),
    view: uniform(new THREE.Matrix4()),
    near: uniform(0.1),
    far: uniform(100),
    panelInv: uniform(new THREE.Matrix4()),
    panelRot: uniform(new THREE.Matrix3()),
    half: uniform(new THREE.Vector2()),
    radius: uniform(0.09),
    hasBase: uniform(1),
    blobs: uniformArray<'vec3'>(blobSlots, 'vec3'),
    blobSlots,
    blobCount: uniform(0, 'int'),
    rects: uniformArray<'vec4'>(rectSlots, 'vec4'),
    rectSlots,
    rectR: uniformArray<'float'>(rectRadii, 'float'),
    rectRadii,
    rectCount: uniform(0, 'int'),
    smooth: uniform(0.14),
    ripples: uniformArray<'vec4'>(rippleSlots, 'vec4'),
    rippleSlots,
    rippleVel: uniformArray<'vec2'>(rippleVelSlots, 'vec2'),
    rippleVelSlots,
    rippleWaveSpeed: uniform(1.55),
    rippleCount: uniform(0, 'int'),
    rippleK: uniform(3.0),
    rippleNu: uniform(0.0018),
    rippleSrcR: uniformArray<'float'>(rippleSrcRadii, 'float'),
    rippleSrcRadii,
    rippleDecay: uniform(0.9),
    rippleInk: uniform(0),
    glows: uniformArray<'vec4'>(glowSlots, 'vec4'),
    glowSlots,
    glowCount: uniform(0, 'int'),
    glowColor: uniform(new THREE.Color('#ffb38a')),
    glowReach: uniform(0.5),
    glowLife: uniform(0.85),
    bezel: uniform(0.13),
    thickness: uniform(0.1),
    spread: uniform(0.34),
    ior: uniform(1.42),
    chroma: uniform(0.035),
    rough: uniform(0.28),
    tint: uniform(new THREE.Color('#dfe8ff')),
    tintAmount: uniform(0.06),
    edgeLight: uniform(0.28),
    edgeReflect: uniform(0.55),
    edgeWarp: uniform(0.018),
    edgeWarpSpeed: uniform(1),
    time: uniform(0),
    specular: uniform(0.55),
    lightDir: uniform(new THREE.Vector3(4, 7, 5)),
  }
}

/** Screen uv (y up) to the coordinate a target is sampled at, and back. */
const flipV = (c: Node<'vec2'>): Node<'vec2'> => vec2(c.x, float(1).sub(c.y))

// SAFETY: a texture sample is a vec4; Three's types return a bare Node.
const sample = (map: TextureNode, at: Node<'vec2'>) => map.sample(at) as Node<'vec4'>

// A rounded rect as a signed distance. Negative inside, and — unlike a
// coverage mask — it keeps meaning outside the shape, which is what the
// bezel profile below is a function of.
function sdRoundRect(p: Node<'vec2'>, b: Node<'vec2'>, r: Node<'float'>): Node<'float'> {
  const d = abs(p).sub(b).add(r)
  return min(max(d.x, d.y), 0).add(length(max(d, vec2(0)))).sub(r)
}

// Its gradient — the outward direction, unit length everywhere the field is
// a true distance. This is the "which way does the rim face" that a mesh
// would have had to store as vertex normals.
function sdRoundRectGrad(p: Node<'vec2'>, b: Node<'vec2'>, r: Node<'float'>): Node<'vec2'> {
  const s = sign(p)
  const d = abs(p).sub(b).add(r)
  return d.x
    .greaterThan(0)
    .and(d.y.greaterThan(0))
    .select(s.mul(normalize(d)), d.x.greaterThan(d.y).select(vec2(s.x, 0), vec2(0, s.y)))
}

// Polynomial smooth minimum (iq). A plain min() unions two shapes with a
// crease; this one trades a band of width k around the seam for a tangent
// join — which is the entire liquid effect. Nothing about it is a special
// case: the union of a card and a circle IS one shape, so it gets one
// coverage, one bezel, one refraction, and a rim that flows around the neck.
function smin(a: Node<'float'>, b: Node<'float'>, k: Node<'float'>): Node<'float'> {
  const h = clamp(float(0.5).add(float(0.5).mul(b.sub(a)).div(k)), 0, 1)
  return mix(b, a, h).sub(k.mul(h).mul(float(1).sub(h)))
}

// EMPTY is the identity of smin, not a special case: h clamps to 0 against
// anything finite, so smin(EMPTY, x, k) is exactly x. A panel with no base
// rect and no satellites therefore reports a huge positive distance, which
// the coverage test below rejects on its own. Nothing has to check for it.
const EMPTY = 1e5

// Spectral response of one tap. The red ramp falls from 1 at f = 0 to 0 at
// 0.62, written as 1 - smoothstep(0, 0.62, f) because smoothstep with its
// edges reversed is undefined.
function spectralWeight(f: number): Node<'vec3'> {
  return max(
    vec3(float(1).sub(smoothstep(0, 0.62, f)), float(1).sub(abs(float(f).sub(0.5)).mul(2)), smoothstep(0.38, 1, f)),
    vec3(0),
  )
}

/** One glass panel, composited over `src`. */
export function createGlassMaterial(v: GlassSdfValues): MeshBasicNodeMaterial {
  const material = passMaterial()

  // A body held together by surface tension does not have an OUTLINE, it has a
  // boundary that is still being negotiated — and a rounded rect that holds
  // perfectly still announces that it was authored rather than formed. This
  // perturbs the distance itself, which is why the effect is structural rather
  // than decorative: the bezel, the normal, the coverage test and the ripples'
  // rim absorption all read the same field, so they all follow the new edge
  // without knowing anything about it.
  //
  // Three angular harmonics at rates that share no small integer factor, drifting
  // at speeds that likewise don't, so the boundary never repeats within any span
  // a viewer will sit through. Weighted to sum to 1 so the amplitude means what
  // it says: peak displacement in world units.
  //
  // Kept SMALL on purpose. This is a distance field, and adding an angle-varying
  // term to one costs it the property that its gradient has unit length; a few
  // percent of the panel is invisible to everything downstream, a large warp
  // would make the bezel width drift around the outline.
  const edgeWarp = (p: Node<'vec2'>): Node<'float'> => {
    const a = atan(p.y, p.x)
    const s = v.time.mul(v.edgeWarpSpeed)
    const warp = v.edgeWarp
      .mul(sin(a.mul(3).add(s.mul(0.53))).add(sin(a.mul(5).sub(s.mul(0.37))).mul(0.6)).add(sin(a.mul(8).add(s.mul(0.71))).mul(0.35)))
      .mul(0.5128)
    return v.edgeWarp.lessThanEqual(0).select(float(0), warp)
  }

  // The panel's whole field. A circle needs no new primitive — but it does
  // need its own cheap one, because sdRoundRect with b = vec2(r) would be an
  // exact circle and three times the arithmetic. Builds loops, so it runs
  // inside an Fn.
  const fieldAt = (p: Node<'vec2'>): Node<'float'> => {
    const d = v.hasBase.greaterThan(0).select(sdRoundRect(p, v.half, v.radius), float(EMPTY)).toVar()
    Loop(v.rectSlots.length, ({ i }) => {
      If(i.greaterThanEqual(v.rectCount), () => {
        Break()
      })
      const rect = v.rects.element(i)
      d.assign(smin(d, sdRoundRect(p.sub(rect.xy), rect.zw, v.rectR.element(i)), v.smooth))
    })
    Loop(v.blobSlots.length, ({ i }) => {
      If(i.greaterThanEqual(v.blobCount), () => {
        Break()
      })
      const blob = v.blobs.element(i)
      d.assign(smin(d, length(p.sub(blob.xy)).sub(blob.z), v.smooth))
    })
    // After the union, so the warp travels around the MERGED silhouette — an
    // orb halfway into the card gets the same living edge as the card does,
    // and the neck between them breathes instead of sitting still.
    return d.sub(edgeWarp(p))
  }

  const projectToUv = (world: Node<'vec3'>): Node<'vec2'> => {
    const clip = v.projView.mul(vec4(world, 1))
    return clip.xy.div(clip.w).mul(0.5).add(0.5)
  }

  material.outputNode = Fn(() => {
    const at = uv()
    const screen = flipV(at)
    const base = sample(v.src, at).rgb.toVar()
    const result = vec4(base, 1).toVar()

    // --- the eye ray, rebuilt from the pixel ------------------------------
    const farClip = v.invProjView.mul(vec4(screen.mul(2).sub(1), 1, 1))
    const rd = normalize(farClip.xyz.div(farClip.w).sub(v.camPos)).toVar()

    // --- intersect the panel's own plane (local z = 0) --------------------
    const lo = v.panelInv.mul(vec4(v.camPos, 1)).xyz.toVar()
    const ld = v.panelInv.mul(vec4(rd, 0)).xyz.toVar()
    If(abs(ld.z).greaterThanEqual(1e-6), () => {
      const t = lo.z.negate().div(ld.z).toVar()
      If(t.greaterThan(0), () => {
        const q = lo.add(ld.mul(t)).xy.toVar()

        // --- coverage: the shape IS the distance ------------------------------
        const d = fieldAt(q).toVar()
        const aa = max(fwidth(d), 1e-6).toVar()
        const cov = float(1).sub(smoothstep(aa.negate(), aa, d)).toVar()
        If(cov.greaterThan(0.002), () => {
          // --- occlusion against the one scene render ---------------------------
          // View-space z is negative ahead of the camera, so "nearer" is greater.
          // Background pixels sit at depth 1 → -far → never in front of anything.
          const hit = v.camPos.add(rd.mul(t)).toVar()
          const panelZ = v.view.mul(vec4(hit, 1)).z
          const sceneZ = perspectiveDepthToViewZ(sample(v.depth, at).x, v.near, v.far)
          If(sceneZ.lessThanEqual(panelZ.add(1e-4)), () => {
            // --- the bezel, as a height field over the distance -------------------
            // h(d) rises from 0 at the outline to thickness over bezel, on a
            // quarter-circle profile, then goes flat. The normal is what that slope
            // does to the gradient direction — a lens rim with no vertices in it.
            const e = clamp(d.negate().div(v.bezel), 0, 1).toVar()
            const k = float(1).sub(e)
            const prof = sqrt(max(float(1).sub(k.mul(k)), 0))
            const slope = e
              .greaterThanEqual(1)
              .select(float(0), v.thickness.negate().mul(k.div(max(prof, 0.02))).div(v.bezel))
              .toVar()
            // With satellites in the field the analytic gradient is wrong — it only
            // knows the rect. A central difference on the UNIONED field is what makes
            // the rim follow the merged outline: through the neck the normal turns
            // continuously from card to blob, so the lens does too, and the two read as
            // one body of glass rather than two overlapping ones. Four extra field
            // evaluations, and only on covered pixels (the early-outs are above).
            const g = vec2(0).toVar()
            // The warp disqualifies the analytic path for the same reason satellites do:
            // sdRoundRectGrad only knows the rect, so it would return the gradient of a
            // boundary that is no longer the one being drawn, and the rim would light a
            // silhouette the coverage test disagrees with.
            If(
              v.blobCount
                .equal(0)
                .and(v.rectCount.equal(0))
                .and(v.hasBase.greaterThan(0))
                .and(v.edgeWarp.lessThanEqual(0)),
              () => {
                g.assign(sdRoundRectGrad(q, v.half, v.radius))
              },
            ).Else(() => {
              const eps = max(aa, 0.0015).toVar()
              const gr = vec2(
                fieldAt(q.add(vec2(eps, 0))).sub(fieldAt(q.sub(vec2(eps, 0)))),
                fieldAt(q.add(vec2(0, eps))).sub(fieldAt(q.sub(vec2(0, eps)))),
              ).toVar()
              g.assign(dot(gr, gr).greaterThan(1e-12).select(normalize(gr), vec2(0, 1)))
            })

            // --- ripples: a capillary impulse, not a scrolled texture -------------
            // The bezel is already h(d) and the normal is already what h's slope does
            // to a direction, so a ripple needs no new machinery — it contributes a
            // second slope, along its own radial direction, and the two add.
            //
            // What it does need is to disperse. A rigid packet translated outward at a
            // fixed speed reads as a decal being scrolled; a real impact ring STRETCHES,
            // because different wavelengths travel at different speeds. At this scale
            // the regime is capillary (surface tension, not gravity): w = C k^(3/2), so
            // the group velocity is (3/2) C sqrt(k) and SHORT waves lead. Feeding the
            // stationary-phase condition r = v_group * t back into the phase collapses
            // the whole train to one expression:
            //
            //   theta(r,t) = K r^3 / t^2,        K = 4 / (27 C^2)
            //   k(r,t)     = d(theta)/dr = 3 K r^2 / t^2
            //
            // (Those two are consistent by construction — the derivative of the phase
            // IS the stationary wavenumber. Verified numerically before it was written.)
            // The pattern therefore gets finer outward and self-similar along
            // r ~ t^(2/3), which is what a fixed-wavelength packet cannot fake.
            const tilt = slope.negate().mul(g).toVar()
            const rippleTilt = vec2(0).toVar()
            Loop(v.rippleSlots.length, ({ i }) => {
              If(i.greaterThanEqual(v.rippleCount), () => {
                Break()
              })
              const rp = v.ripples.element(i).toVar()
              const dv = q.sub(rp.xy).toVar()
              const r = max(length(dv), 1e-4).toVar()
              const age = max(rp.z, 0.02).toVar()

              // --- the wake leans the way the bead went ---------------------------
              // Everything else in this loop is a function of r alone, and a radially
              // symmetric function sampled at a radius is geometrically a texture
              // lookup no matter how good its radial profile is. That is what makes a
              // physically correct ripple still read as dead. Real impact rings are
              // not circles, and the reason is not noise — the thing that made them
              // was MOVING.
              //
              // A source travelling through a dispersive medium lays crests it emits
              // forward into ground it is closing on, so they bunch, and crests behind
              // into ground it is leaving, so they stretch. To first order that is the
              // classical Doppler factor, and it enters in exactly ONE place: the age
              // that sets the phase. A smaller age means a larger local wavenumber, so
              // the pattern compresses ahead and opens behind.
              //
              // Deliberately only tw — viscosity, bulk decay and the source spectrum
              // below all read the TRUE age, because those are about how long the
              // wave has really been running and losing energy, not about the geometry
              // of where its crests landed.
              const vel = v.rippleVel.element(i).toVar()
              const sp = length(vel).toVar()
              const dopp = float(1).toVar()
              If(sp.greaterThan(1e-6), () => {
                const mach = min(sp.div(max(v.rippleWaveSpeed, 1e-6)), 0.65)
                dopp.assign(float(1).sub(mach.mul(dot(vel.div(sp), dv.div(r)))))
              })
              const tw = age.mul(dopp).toVar()

              const th = v.rippleK.mul(r).mul(r).mul(r).div(tw.mul(tw))
              const kk = float(3).mul(v.rippleK).mul(r).mul(r).div(tw.mul(tw)).toVar()

              // Amplitude, three physical terms and no fudge:
              //   inverseSqrt(r) — a circular front spreads its energy over a growing
              //     circumference, so the wave MUST weaken as it travels. Its absence
              //     was the loudest thing wrong with the first version.
              //   exp(-nu k^2 t) — viscosity eats short waves quadratically. This is
              //     also what gives the train a soft leading edge instead of the hard
              //     drawn ring a gaussian window produces.
              //   exp(-t/decay) — bulk loss, so the sheet eventually goes still.
              // A finite SOURCE. Modelling the contact as a delta impulse makes the
              // first frames sixteen times more violent than the last — the wave
              // arrives as a crack and then behaves. But a bead is not a point: it
              // cannot radiate wavelengths shorter than itself, and suppressing those
              // (a gaussian source spectrum) flattens the whole run to a smooth decay
              // without a single artificial ramp.
              // The source radius is PER RIPPLE, and that is what makes an impact and a
              // release different events rather than the same event at two volumes.
              //
              // A body striking a sheet loads it over its whole contact patch, so the
              // source is bead-sized and cannot radiate anything shorter than itself:
              // a broad, low-frequency, long-lived ring.
              //
              // A body LEAVING is a different phenomenon. The sheet does not let go
              // when the body does — capillary adhesion drags a liquid bridge out
              // behind it, the bridge necks under the Rayleigh–Plateau instability, and
              // the wave is launched at PINCH-OFF, from the neck. The neck is far
              // smaller than the body, so the source is small and the radiated spectrum
              // runs correspondingly finer. The energy is different in kind too: an
              // impact spends bulk kinetic energy, a pinch-off releases surface energy,
              // which is the smaller budget by a wide margin.
              //
              // So a release is not a quieter impact. It is a finer, tighter, faster-
              // fading disturbance, and it comes out of this one term — the shorter
              // waves a small source is free to radiate are also the ones viscosity
              // (exp(-nu k^2 t), just above) eats first.
              const srcR = v.rippleSrcR.element(i)
              const src = exp(float(-0.5).mul(kk).mul(kk).mul(srcR).mul(srcR))

              const amp = rp.w
                .mul(inverseSqrt(float(1).add(r.div(0.25))))
                .mul(exp(v.rippleNu.negate().mul(kk).mul(kk).mul(age)))
                .mul(src)
                .mul(exp(age.negate().div(v.rippleDecay)))
                // The same factor, once more: crests that bunch ahead of the source
                // have to put the energy they gain somewhere, and the ones stretching
                // behind have to give it up. One number driving both the spacing and
                // the brightness is why the wake looks like one phenomenon rather than
                // two effects tuned to agree.
                .div(dopp)
                .toVar()

              // Nothing may oscillate faster than the pixel grid can carry. This is the
              // antialias, but it is not only cosmetic: those are exactly the waves
              // viscosity has already taken. aa is the panel's world units per pixel.
              amp.mulAssign(float(1).sub(smoothstep(1, 2.4, kk.mul(aa))))

              // h = amp cos(theta)  ->  dh/dr = -amp k sin(theta). The d(amp)/dr term
              // is dropped as slowly varying next to k.
              rippleTilt.addAssign(amp.negate().mul(kk).mul(sin(th)).mul(dv.div(r)))
            })
            // Waves break. Past a certain steepness a real surface stops being a
            // graph over the plane at all, so a soft saturation is nearer the truth
            // than letting an early frame fold the lens inside out.
            const steep = length(rippleTilt).toVar()
            If(steep.greaterThan(1e-5), () => {
              rippleTilt.mulAssign(float(1).div(float(1).add(steep.div(1.1))))
            })
            // The rim is a thick edge, not a membrane. Letting the wave die into it
            // keeps the one hairline that has to stay crisp from wobbling — and a
            // boundary that absorbs is closer to the truth than one that ignores.
            // (e is 1 on the flat glass, 0 at the outline.)
            rippleTilt.mulAssign(e)
            tilt.addAssign(rippleTilt)

            const nLocal = normalize(vec3(tilt, 1)).toVar()
            // seen from behind: the far face
            If(ld.z.greaterThan(0), () => {
              nLocal.assign(nLocal.negate())
            })
            const n = normalize(v.panelRot.mul(nLocal)).toVar()

            // --- refraction: dispersion and frost in one loop ---------------------
            // Frost is a property of the FLAT glass, and the rim is where the lens
            // does its work — blurring there (the first thing this pass did) turns
            // the bezel into a soft white halo and throws away the one detail the
            // whole approach buys: a crisp, strongly displaced edge. So the profile
            // runs the other way, easing OFF as the bezel takes over.
            const blur = v.rough.mul(0.05).mul(float(0.35).add(float(0.65).mul(e))).toVar()
            const acc = vec3(0).toVar()
            const wsum = vec3(0).toVar()
            for (let i = 0; i < SAMPLES; i++) {
              const f = (i + 0.5) / SAMPLES
              const ior = v.ior.add(float(f - 0.5).mul(2).mul(v.chroma))
              const bent = refract(rd, n, float(1).div(max(ior, 1.0001))).toVar()
              // total internal reflection
              If(dot(bent, bent).lessThan(1e-6), () => {
                bent.assign(reflect(rd, n))
              })
              // Golden-angle spiral: cheap, isotropic, and no texture lookup.
              const a = i * 2.39996323
              const tap = vec2(Math.cos(a), Math.sin(a)).mul(Math.sqrt(f))
              const tapUv = projectToUv(hit.add(bent.mul(v.spread))).add(tap.mul(blur))
              const w = spectralWeight(f)
              acc.addAssign(sample(v.src, flipV(clamp(tapUv, 0.001, 0.999))).rgb.mul(w))
              wsum.addAssign(w)
            }
            const glass = acc.div(max(wsum, vec3(1e-4))).toVar()

            // --- the surface's own light ------------------------------------------
            glass.assign(mix(glass, v.tint, v.tintAmount))

            const fres = pow(float(1).sub(abs(dot(rd, n))), 5).toVar()
            const lightDir = normalize(v.lightDir)
            const hv = normalize(lightDir.sub(rd))
            const spec = pow(max(dot(n, hv), 0), 180).mul(v.specular)

            // --- the edge, and why it is not an outline ---------------------------
            // This used to ADD a white hairline scaled by how close the pixel was to
            // the outline. That is a sticker, not an edge: a constant colour, blind to
            // everything the panel is standing in front of. Against a neon wall the
            // glass wore a cool white border belonging to no light in the scene, and
            // the eye reads that as a drawn stroke — the halo that looked tacked on.
            //
            // A real edge is never emitted. It is BORROWED, twice over:
            //
            //   reflection — the bezel curves away from the eye, so near the outline
            //     the view ray grazes it and the surface turns into a mirror. Fresnel
            //     is exactly how much. On an orange wall the edge reflects orange.
            //
            //   piped light — a ray travelling inside the sheet meets the curved edge
            //     past the critical angle and leaves there instead of continuing, so
            //     the outermost sliver carries a concentrated dose of what the glass
            //     is ALREADY transmitting.
            //
            // Both take their colour and their brightness from the scene, which is the
            // whole difference. It also means the edge now tracks the panel: darken the
            // content and the edge darkens with it, because there is less light inside
            // the sheet to leave at the rim. An additive constant could never do that.
            const rr = reflect(rd, n)
            const envRefl = sample(v.src, flipV(clamp(projectToUv(hit.add(rr.mul(v.spread))), 0.001, 0.999))).rgb
            glass.assign(mix(glass, envRefl, clamp(fres.mul(v.edgeReflect), 0, 1)))
            // The hairline is a HAIRLINE: the outermost eighth of the bezel, where the
            // rim has turned far enough to pipe light out. A GAIN on what is there, not
            // a wash over it — widen it and the panel grows a chunky border instead of
            // an edge.
            const bezelBand = float(1).sub(smoothstep(0, 0.14, e))
            glass.mulAssign(float(1).add(bezelBand.mul(v.edgeLight).mul(float(0.35).add(fres))))
            glass.addAssign(spec)

            // --- the strike: light let into the glass where a pointer landed -------
            // Two terms, and the second is why a click reads as an event rather than a
            // lamp being switched on. The CORE is where the energy went in. The SHELL
            // is the front it left on: it opens as sqrt(age), the deceleration any
            // disturbance spreading into a resisting medium has, so the bloom lunges
            // and then eases instead of travelling at a constant speed like a decal
            // being scaled. Brightness falls twice over — once because the strike is
            // dying, once because what is left is spread across a growing disc.
            //
            // The white-hot heart is a POWER of the core, not a second gaussian: it
            // costs nothing extra and it guarantees the hot centre always sits exactly
            // inside the coloured falloff, which two independently tuned radii would
            // eventually let drift apart.
            Loop(v.glowSlots.length, ({ i }) => {
              If(i.greaterThanEqual(v.glowCount), () => {
                Break()
              })
              const gw = v.glows.element(i).toVar()
              const life = clamp(gw.z.div(v.glowLife), 0, 1).toVar()
              const s = float(0.035).add(v.glowReach.mul(sqrt(life))).toVar()
              const fade = float(1).sub(life).mul(float(1).sub(life))
              const gr = length(q.sub(gw.xy)).div(s)
              const core = exp(gr.mul(gr).negate().mul(0.5)).toVar()
              // The front is a fixed FRACTION of the current radius wide, so it thins
              // in proportion as it opens rather than staying a drawn ring.
              const front = length(q.sub(gw.xy)).sub(s).div(float(0.42).mul(s))
              const shell = exp(front.mul(front).negate())
              // The heart is the SIXTH power of the core, not the third. Cubed, the
              // white ran most of the way to the falloff and the strike read as a pale
              // wash; at six it collapses to a hot centre with the colour doing all the
              // spreading, which is what a light source in a coloured medium actually
              // looks like.
              const lit = v.glowColor.mul(core.mul(0.95).add(shell.mul(0.6))).add(pow(core, 6).mul(0.85))
              glass.addAssign(lit.mul(gw.w).mul(fade))
            })

            // --- the ink, on top, in the panel's own UV ---------------------------
            // Clipped to the INK RECT, not to the coverage: the DOM is a property of
            // the panel, and a satellite the field has swallowed is glass with nothing
            // written on it. Without the clip the sampler's clamp-to-edge would smear
            // the texture's border row out across every blob.
            //
            // Note the other half of that: where the ink rect extends BEYOND the field
            // — the gaps between a column of message bubbles — the final mix() is
            // weighted by cov, which is zero there. So one DOM can span many separate
            // pieces of glass and simply not be drawn in between them. The layout is
            // the union; the texture is along for the ride.
            If(v.hasInk.greaterThan(0), () => {
              const iq = q.sub(v.inkRect.xy).toVar()
              const outside = max(abs(iq.x).sub(v.inkRect.z), abs(iq.y).sub(v.inkRect.w))
              const m = float(1).sub(smoothstep(aa.negate(), aa, outside)).toVar()
              If(m.greaterThan(0), () => {
                // The ink barely rides the wave. It is laid on unrefracted BY DESIGN —
                // the world bends through the glass, the DOM sits on it and stays
                // crisp — so warping its UV trades the thesis for the effect. The
                // default (GLASS_DEFAULTS.rippleInk) only lets the ink shift with its
                // surface; __glass.set('rippleInk', 0.4) shows the other reading.
                const iuv = iq.add(rippleTilt.mul(v.rippleInk)).div(v.inkRect.zw.mul(2)).add(0.5)
                const ink = sample(v.ink, iuv).mul(v.inkOpacity.mul(m)).toVar() // premultiplied
                glass.assign(glass.mul(float(1).sub(ink.a)).add(ink.rgb))
              })
            })

            result.assign(vec4(mix(base, glass, cov), 1))
          })
        })
      })
    })
    return result
  })()
  return material
}

/** The blit and the source slot the compositor points at the last pass. */
export interface GlassBlit {
  readonly material: MeshBasicNodeMaterial
  readonly src: TextureNode
}

/**
 * The only place the pipeline leaves linear light.
 *
 * The renderer applies no tone mapping (SurfaceCanvas logs an error in
 * development if renderer.toneMapping is anything but NoToneMapping), so this
 * blit is the scene's only tone map. It uses Neutral (Khronos PBR Neutral), not ACES:
 * ACES rotates saturated oranges toward yellow as they brighten, so a neon
 * token would not land on screen as the token. Neutral leaves in-gamut colour
 * where the author put it and only rolls off the highlights, so the DOM's
 * colours arrive as CSS specified them while the glass's speculars and the
 * strike still shoulder off instead of clipping to white. Exposure is a fixed
 * 1; this blit does not read renderer.toneMappingExposure.
 */
export function createBlitMaterial(src: THREE.Texture): GlassBlit {
  const material = passMaterial()
  const node = texture(src)
  const toned = toneMapping(THREE.NeutralToneMapping, 1, vec4(sample(node, uv()).rgb, 1))
  material.outputNode = premultipliedOutput(vec4(toned.rgb, 1))
  return { material, src: node }
}
