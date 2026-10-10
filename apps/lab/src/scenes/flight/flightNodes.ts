// The flight card's two node materials. The scene next door owns the physics
// and the React; this file owns the shading, the same way glassSdfNodes.ts
// sits beside glassSdf.tsx — a shader is data, and 300 lines of it wedged
// between components is 300 lines you scroll past to read either one.
//
// Both materials are welded to laws that live elsewhere: the card's bend is
// driven by `aeroAmplitude`/`aeroFollowStep` in `flightPhysicsLaw`, and the
// shadow's layers are the card's own measured `box-shadow`, parsed by
// `onChrome`. What is authored here is only how they RASTERIZE.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type UniformNode } from 'three/webgpu'
import { encodedOutput } from '@petepetrash/munari'
import {
  Discard,
  Fn,
  If,
  Loop,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  mix,
  modelWorldMatrix,
  positionGeometry,
  positionWorld,
  pow,
  sin,
  smoothstep,
  uniform,
  uniformArray,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput, type SurfaceNodes } from '@petepetrash/munari'

// ── the airborne copy's material ─────────────────────────────────────────
//
// Flight passes this as Surface.Mesh's `material` element. It stays UNLIT
// like the default MeshBasicNodeMaterial: a lit standard material would
// shade the texture, and the handoff would stop being invisible the moment
// a light moved. What it adds is the bend, the crumple, and a gloss band
// keyed to the plate's own normal: the only cue that the thing is tilted,
// since an unlit quad has no other way to say so.

/**
 * The sheet's shared state: the driver writes these objects every frame and
 * the material's uniform nodes hold the SAME objects, so there is no
 * per-frame plumbing and no React in the loop. pack = (dir.x, dir.y,
 * amplitude px, reach px); grab = the held point, card-local px — the bend's
 * pin AND the point the crush contracts toward; wad = (crush 0→1, hash seed,
 * wad radius px) — crush 0 is the identity, and a card that is not being
 * deleted never leaves it. There is no fade channel: a wad is opaque until it
 * has left the viewport, and then it is simply gone.
 */
export interface AeroState {
  pack: THREE.Vector4
  grab: THREE.Vector2
  wad: THREE.Vector3
}

// Per-vertex chaos for the crumple. Deterministic in uv (+ the flight's
// seed), so the wad holds one shape across frames instead of boiling.
function crumpleHash(p2: Node<'vec2'>): Node<'float'> {
  return fract(sin(dot(p2, vec2(127.1, 311.7))).mul(43758.5453))
}

export function createCardMaterial(surface: SurfaceNodes, state: AeroState, glossValue: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    // decisions.md #5: the capture is premultiplied. The presenter would
    // write this flag on first commit anyway; set here, the material is
    // built once instead of recompiled.
    premultipliedAlpha: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
  const aero = uniform(state.pack)
  const aeroGrab = uniform(state.grab)
  const wad = uniform(state.wad)
  const gloss = uniform(glossValue)
  // Gain on the curvature shade. The bend's normals only swing ~10-15°,
  // so the pow-6 band needs amplification to move a white pixel a
  // readable ~20 counts; the term is identically zero when flat, so
  // this number never touches a resting card.
  const flex = uniform(2.5)

  // The aero bend: the one thing on this card CSS could never draw. The
  // plate is rigid in the physics; what bends is the SHEET, around the
  // point the fingers pin, by an amount the driver derives from the plate's
  // own velocity (aeroAmplitude — hard zero at rest, so both handoff swaps
  // are geometrically flat by theorem). aero packs (dir.x, dir.y,
  // amplitude px, reach px); aeroGrab is the held point in card-local px.
  // The leading half catches more air than the trailing half — a swished
  // card is not a symmetric parabola — and the normal is the ANALYTIC
  // derivative of the same field, so the gloss band sweeps the flex
  // instead of staying painted on.
  const crush = wad.x
  const dir = aero.xy
  // The bend cedes the sheet to the crush: a held, crushing ball is still
  // being waved around at bend-worthy speeds, and a wad has no sheet left
  // to catch the air with.
  const amt = aero.z.mul(float(1).sub(crush))
  const reach = aero.w.max(1)
  const s = dot(positionGeometry.xy.sub(aeroGrab), dir)
  const t = s.div(reach).clamp(-1, 1)
  const lead = t.max(0)
  const bow = t.mul(t).add(lead.mul(0.45).mul(lead))
  // n = normalize(−∂z/∂x, −∂z/∂y, 1); ∂z/∂s = amt·(2t + 0.9·lead)/L.
  const dzds = amt.mul(t.mul(2).add(lead.mul(0.9))).div(reach)
  const nl = vec3(dir.mul(dzds.negate()), 1).normalize()
  const localNormal = varying(nl)
  const worldNormal = varying(modelWorldMatrix.mul(vec4(nl, 0)).xyz.normalize())

  material.positionNode = Fn(() => {
    // TOWARD the camera (+z). The sign is load-bearing, not aesthetic:
    // bowing away pushed the bent edges BEHIND the shadow plane at
    // z = −0.5 during a fast throw home, and where two surfaces cross, the
    // depth test flips per-pixel — a grainy seam marching along whichever
    // edge led the throw. Bowing toward the viewer keeps every bent
    // fragment strictly in front of the shadow at every altitude (a +z bow
    // in the plate's frame can only RAISE a vertex's world z for any bank
    // < 90°), so the shadow's depth carve (the renderOrder note in
    // Flight.tsx) can never fight its own card.
    const p = vec3(positionGeometry.xy, positionGeometry.z.add(amt.mul(bow))).toVar()

    // ── the crumple: the sheet converges on a wad ──
    //
    // wad = (crush 0→1, seed, wad radius px). Each vertex has its own
    // noise target — the sheet's footprint contracted to 13% AROUND THE
    // GRAB POINT plus a random radial offset inside the wad's ball — and
    // its own PHASE: the hash staggers when each vertex commits, because a
    // real crush is chaotic, not a uniform lerp. Contracting toward
    // aeroGrab rather than the centre is what "crushed in the hand" means:
    // the ball forms under the fingers that pressed the ✕ (the driver pins
    // that same point to the pointer), not half a card away from them. For
    // a keyboard delete the grab is the centre and this is the old formula.
    // The sin(π·lt) term overshoots mid-travel (the sheet bulges and
    // wrinkles before it packs), and dies at both ends so the endpoints are
    // exact: crush 0 is the untouched card (the handoff theorem again),
    // crush 1 is the settled wad. Analytic normals are hopeless on this
    // field — the fragment stage switches to screen-space derivative
    // facets as the crush takes over.
    If(crush.greaterThan(0), () => {
      const seed = wad.y
      const wadR = wad.z
      const at = uv()
      const j = crumpleHash(at.add(seed))
      const lt = smoothstep(j.mul(0.42), 1, crush)
      // Fold coherence: the target field samples the hash on a COARSE uv
      // grid, so neighbouring vertices travel together as chunks — paper
      // folds, it does not shred. (All-per-vertex targets were measured as
      // exactly that: a confetti burst mid-crush, every triangle torn from
      // its neighbours.) A 35% per-vertex remainder puts crease chaos back
      // on top of the folds, and the phase stays per-vertex, so a chunk's
      // vertices crumple INTO their shared destination rather than arriving
      // in lockstep.
      const cell = floor(at.mul(vec2(6, 3))).div(vec2(6, 3))
      const cellDir = vec3(
        crumpleHash(cell.add(seed).add(1.3)).sub(0.5),
        crumpleHash(cell.add(seed).add(2.7)).sub(0.5),
        crumpleHash(cell.add(seed).add(4.1)).sub(0.5),
      )
      const vertDir = vec3(
        crumpleHash(at.add(seed).add(8.2)).sub(0.5),
        crumpleHash(at.add(seed).add(9.6)).sub(0.5),
        crumpleHash(at.add(seed).add(11.4)).sub(0.5),
      )
      const dirn = mix(cellDir, vertDir, 0.35).add(vec3(1e-4)).normalize()
      const rr = crumpleHash(cell.add(seed).add(6.9)).mul(0.65).add(0.35).mul(wadR)
      const wadP = vec3(aeroGrab.add(p.xy.sub(aeroGrab).mul(0.13)), 0).add(dirn.mul(rr))
      const bulged = wadP.add(dirn.mul(sin(lt.mul(3.14159265)).mul(0.35).mul(wadR)))
      p.assign(mix(p, bulged, lt))
    })
    return p
  })()

  material.outputNode = Fn(() => {
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    const c = surface.map.sample(uv()) as Node<'vec4'>
    // A broad highlight from up and to the left, riding the surface normal.
    // At rest the normal is +z, so the term is constant — and it has to be
    // constant ZERO, because a card lying in its slot must be exactly its own
    // pixels, not a shade of them. The bias is therefore the value the band
    // takes at rest, which is L.z raised to the same power: hand-writing it
    // as a literal is how this shipped 4.5% dark, a flat neutral tint that
    // reads as "the texture is slightly transparent" and sends you looking at
    // the blend mode.
    const L = vec3(-0.45, 0.62, 0.65).normalize()
    const sw = dot(worldNormal, L).max(0)
    const band = pow(sw, 6).sub(pow(L.z, 6))
    const glossed = c.rgb.add(gloss.mul(band))
    // The band above rides the WORLD normal — it is the tilt cue, and it is
    // ADDITIVE, which on a white card clips at white: the bend never read
    // through it. This one rides the LOCAL bend normal (localNormal —
    // exactly (0,0,1) whenever the sheet is flat, at any plate tilt, so it
    // is a curvature-only signal), and it can only DARKEN: the curled region
    // turning away from the page light shades itself, and darkening is the
    // only direction a white card can show. Multiplicative with a factor
    // ≤ 1, so premultiplied alpha stays valid where the additive term
    // hasn't already spent it.
    const sl = dot(localNormal.normalize(), L).max(0)
    const flexBand = pow(sl, 6).sub(pow(L.z, 6))
    const flexed = glossed.mul(flex.mul(flexBand).add(1).min(1))
    // ── crumple shading: facets, not fields ──
    //
    // The analytic normals above describe the BEND's smooth field; a wad is
    // the opposite object, all creases and planes. Screen-space derivatives
    // of the world position give the true facet normal of whatever triangle
    // is under the fragment — free, and automatically faceted because the
    // interpolated position is piecewise planar. The band is a broad pow-2
    // (a wad shades everywhere, not just at grazing), multiplicative and
    // floored so the deepest folds go dark grey, never black. And no fade,
    // anywhere: the wad stays fully opaque for its whole life, because it
    // is not allowed to be gone while it can still be seen — the exit is a
    // place, not a time (the driver's wadOffscreen verdict), and a wad that
    // has left the viewport needs no dimming to disappear.
    //
    // The facet is oriented toward +z by its own sign, so the y-axis
    // convention of the screen derivatives (opposite on WebGPU and WebGL)
    // cannot flip it.
    const facet = cross(positionWorld.dFdx(), positionWorld.dFdy()).normalize()
    const fn = facet.mul(facet.z.add(1e-6).sign())
    const sf = dot(fn, L).max(0)
    const facetBand = pow(sf, 2).sub(pow(L.z, 2))
    const k = crush.mul(1.6).clamp(0, 1)
    const shaded = crush
      .greaterThan(0.003)
      .select(flexed.mul(k.mul(1.1).mul(facetBand).add(1).clamp(0.35, 1)), flexed)
    // The element's corners, not the quad's. The texture can't say where the
    // card ends — the .ui-root background paints its corners opaque white —
    // so the measured border-radius is enforced analytically (crisp at any
    // LOD tier), and the gloss band dies with the alpha it rides on.
    const alpha = c.a.mul(surface.radiusMask())
    Discard(alpha.lessThan(0.004))
    // The texture is SRGBColorSpace, so the sample is LINEAR, and
    // premultipliedOutput lands it on the sRGB canvas as a per-fragment
    // encode would. At rest band is exactly zero, so the mesh is exactly its
    // own pixels — in color, not just in geometry.
    return premultipliedOutput(vec4(shaded, alpha))
  })()
  return material
}

// ── the shadow the card throws back onto the page ────────────────────────
//
// Not a decal and not a blob: the plate's four corners projected onto z = 0
// along the light direction, so a tilted card throws a genuinely sheared
// quadrilateral. The softness and the weight are functions of how far off the
// page it is, which is the only reason a shadow reads as height at all.
//
// It darkens the PAGE, not the scene — the canvas composites over the
// document with alpha, so a translucent black quad drawn over the prose is
// a shadow falling on real text.
//
// WHAT it renders is not authored here, though: the layers are the card's own
// measured `box-shadow`, parsed by the library (`onChrome`). At height zero
// the shader draws exactly what the browser draws — same offsets, same
// Gaussian (σ = blur/2, via erf, which IS the analytic form of a Gaussian
// blurred edge), same colors compositing first-layer-on-top — so the liftoff
// swap is invisible: the page hides a DOM shadow and this draws its twin.
// Height then EVOLVES those layers (Driver); it no longer invents a look.
//
// This material samples no texture. Its colors are CSS values, already sRGB,
// so the composited layers are premultiplied sRGB and go out through
// encodedOutput with premultiplied blending (decisions.md #72).

export const SHADOW_MAX_LAYERS = 4

/**
 * The shadow material's uniforms. Written by the driver every frame, held by
 * the material as the very same objects — so this passes by reference, and
 * neither side ever reads the other's copy. The layer lists are plain arrays:
 * each is the array its `uniformArray` node uploads on every render, so a
 * write in place reaches the shader.
 */
export interface ShadowUniforms {
  readonly quadHalf: UniformNode<'vec2', THREE.Vector2>
  readonly cardHalf: UniformNode<'vec2', THREE.Vector2>
  readonly radii: UniformNode<'vec4', THREE.Vector4>
  /** How many of the layer slots below are live this frame. */
  readonly count: UniformNode<'int', number>
  readonly off: THREE.Vector2[]
  readonly sigma: number[]
  readonly spread: number[]
  readonly color: THREE.Vector4[]
}

export function createShadowUniforms(): ShadowUniforms {
  return {
    quadHalf: uniform(new THREE.Vector2(1, 1)),
    cardHalf: uniform(new THREE.Vector2(1, 1)),
    radii: uniform(new THREE.Vector4(0, 0, 0, 0)),
    count: uniform(0, 'int'),
    off: Array.from({ length: SHADOW_MAX_LAYERS }, () => new THREE.Vector2()),
    sigma: new Array<number>(SHADOW_MAX_LAYERS).fill(0),
    spread: new Array<number>(SHADOW_MAX_LAYERS).fill(0),
    color: Array.from({ length: SHADOW_MAX_LAYERS }, () => new THREE.Vector4()),
  }
}

// Abramowitz–Stegun 7.1.26 — plenty for an alpha ramp.
function erfA(x: Node<'float'>): Node<'float'> {
  const a = x.abs()
  const t = float(1).div(a.mul(0.3275911).add(1))
  const poly = t.mul(1.061405429).sub(1.453152027).mul(t).add(1.421413741).mul(t).sub(0.284496736).mul(t).add(0.254829592)
  const y = float(1).sub(poly.mul(t).mul(exp(a.negate().mul(a))))
  return x.sign().mul(y)
}

export function createShadowMaterial(u: ShadowUniforms): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    toneMapped: false,
  })
  // Browser gates read the live layer count from the mesh.
  material.userData.shadow = u
  const off = uniformArray<'vec2'>(u.off, 'vec2')
  const sigma = uniformArray<'float'>(u.sigma, 'float')
  const spread = uniformArray<'float'>(u.spread, 'float')
  const color = uniformArray<'vec4'>(u.color, 'vec4')

  const layerCoverage = (p: Node<'vec2'>, i: Node<'int'>): Node<'float'> => {
    const layerSpread = spread.element(i)
    const half = u.cardHalf.add(layerSpread)
    const q = p.sub(off.element(i))
    const corner = q.x
      .lessThan(0)
      .select(q.y.greaterThan(0).select(u.radii.x, u.radii.w), q.y.greaterThan(0).select(u.radii.y, u.radii.z))
    const r = corner.add(layerSpread).clamp(0, half.x.min(half.y))
    const d = q.abs().sub(half).add(vec2(r))
    const sd = d.x.max(d.y).min(0).add(d.max(0).length()).sub(r)
    // Gaussian-blurred edge: coverage is the CDF of the blur at the signed
    // distance. σ near zero degenerates to a step — the '0px 1px 0px' hairline
    // layer renders as the same hairline the DOM paints.
    const coverage = float(0.5).sub(erfA(sd.div(sigma.element(i).mul(1.4142135).add(1e-4))).mul(0.5))
    return half.x.lessThanEqual(0).or(half.y.lessThanEqual(0)).select(float(0), coverage)
  }

  material.outputNode = Fn(() => {
    const p = uv().mul(2).sub(1).mul(u.quadHalf)
    const acc = vec4(0).toVar()
    // CSS paints the FIRST layer on top: composite back-to-front.
    Loop({ start: SHADOW_MAX_LAYERS - 1, end: 0, type: 'int', condition: '>=' }, ({ i }) => {
      If(i.lessThan(u.count), () => {
        const layer = color.element(i)
        const a = layerCoverage(p, i).mul(layer.a).toVar()
        const keep = float(1).sub(a)
        acc.assign(vec4(layer.rgb.mul(a).add(acc.rgb.mul(keep)), a.add(acc.a.mul(keep))))
      })
    })
    Discard(acc.a.lessThanEqual(0.002))
    // acc is premultiplied sRGB, the CSS shadow colors composited as the page does.
    return encodedOutput(acc)
  })()
  return material
}
