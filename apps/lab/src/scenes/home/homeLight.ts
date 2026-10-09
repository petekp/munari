// Home light — shadows from thin glyphs, selected type, raised controls,
// recessed wells and the moving postcard, under one finite light source.
//
// The law: the pass only darkens. It writes a multiplier the page is
// composited through (mix-blend-mode: multiply on the host), so a lit pixel
// of 1.0 means "leave the page alone" and the brightest thing on screen is
// still the page's own wash. The glow around the light is the fixture's
// job, not this pass's.
//
// Solid shadow casters made the page look extruded (Pete, 2026-09-07).
// Thin surfaces retain the printed appearance; their separation from each
// receiver sets shadow displacement and softness. Decision #50 pins the pixels.
//
// Ownership: this module owns the light and shadow math and the material.
// homeRelief.ts owns glyph and relief distance fields. homeLightLaw.ts owns
// the reference projection and standoffs. HomeMasthead.tsx owns the renderer, the light's
// position, and when the masks are rebuilt.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type TextureNode, type UniformArrayNode, type UniformNode } from 'three/webgpu'
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  attribute,
  bool,
  cameraProjectionMatrix,
  clamp,
  cross,
  dot,
  exp,
  float,
  length,
  max,
  min,
  mix,
  modelViewMatrix,
  normalGeometry,
  normalize,
  positionGeometry,
  pow,
  smoothstep,
  sqrt,
  texture,
  uniform,
  uniformArray,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { encodedOutput } from '@petepetrash/munari'
import { passMaterial } from '@petepetrash/munari/advanced'
import { GLYPH_STANDOFF, LIGHT_HEIGHT, RAISED_STANDOFF, WELL_DEPTH } from './homeLightLaw'
import type { Mask } from './homeRelief'
import { SHADOW_DISTANCE_RANGE } from './homeShadowField'
import { LIGHT_TAPS, bulbBasis, bulbCosine, paperVisibility, sampleBulbRay, type PaperLightValues } from './homePaperNodes'

type Float = Node<'float'>
type Vec2 = Node<'vec2'>
type Vec3 = Node<'vec3'>
type Vec4 = Node<'vec4'>

// Keep the lit receiver inside opaque ink. The native text edge and the
// CSS-resolution lighting filter otherwise expose a bright cutout fringe (#55).
const GLYPH_RECEIVER_INSET = 1.5

const GLYPH_HEIGHT = GLYPH_STANDOFF
const FIELD_RANGE = SHADOW_DISTANCE_RANGE
const RAISED_HEIGHT = RAISED_STANDOFF
const LIGHT_POWER = LIGHT_HEIGHT * LIGHT_HEIGHT
const SELECTION_SLOTS = 8

// Bound while a mask or the paper map is absent; its `ready` flag keeps it unread.
const EMPTY = new THREE.DataTexture(new Uint8Array(4), 1, 1)
EMPTY.needsUpdate = true

/** Every value the light reads, written in place by the masthead and the paper pass. */
export interface HomeLightValues extends PaperLightValues {
  readonly resolution: UniformNode<'vec2', THREE.Vector2>
  readonly light: UniformNode<'vec2', THREE.Vector2>
  readonly lightHeight: UniformNode<'float', number>
  readonly inkRect: UniformNode<'vec4', THREE.Vector4>
  readonly ink: TextureNode
  readonly inkReady: UniformNode<'float', number>
  readonly glyphScale: UniformNode<'float', number>
  readonly reliefRect: UniformNode<'vec4', THREE.Vector4>
  readonly relief: TextureNode
  readonly reliefReady: UniformNode<'float', number>
  /** The flyer's four corners, in canvas px. */
  readonly flyer: readonly [UniformNode<'vec3', THREE.Vector3>, UniformNode<'vec3', THREE.Vector3>, UniformNode<'vec3', THREE.Vector3>, UniformNode<'vec3', THREE.Vector3>]
  readonly flyerReady: UniformNode<'float', number>
  /** Selected-type rects (x, y, width, height), uploaded through `selectionNode`. */
  readonly selection: readonly THREE.Vector4[]
  readonly selectionNode: UniformArrayNode<'vec4'>
  readonly selectionCount: UniformNode<'int', number>
  readonly selectionLift: UniformNode<'float', number>
}

function createHomeLightValues(): HomeLightValues {
  const selection = Array.from({ length: SELECTION_SLOTS }, () => new THREE.Vector4())
  return {
    resolution: uniform(new THREE.Vector2(1, 1)),
    light: uniform(new THREE.Vector2(0, 0)),
    lightHeight: uniform(LIGHT_HEIGHT),
    // A broad source softens separated shadows without blurring contact (#50).
    lightRadius: uniform(30),
    inkRect: uniform(new THREE.Vector4(0, 0, 1, 1)),
    ink: texture(EMPTY),
    inkReady: uniform(0),
    glyphScale: uniform(1),
    reliefRect: uniform(new THREE.Vector4(0, 0, 1, 1)),
    relief: texture(EMPTY),
    reliefReady: uniform(0),
    flyer: [uniform(new THREE.Vector3()), uniform(new THREE.Vector3()), uniform(new THREE.Vector3()), uniform(new THREE.Vector3())],
    flyerReady: uniform(0),
    paperShadow: texture(EMPTY),
    paperShadowMatrix: uniform(new THREE.Matrix4()),
    paperShadowRange: uniform(new THREE.Vector2(1, 1)),
    paperReady: uniform(0),
    frameOrigin: uniform(new THREE.Vector2()),
    selection,
    selectionNode: uniformArray<'vec4'>(selection, 'vec4'),
    selectionCount: uniform(0, 'int'),
    selectionLift: uniform(0),
  }
}

// ── glyphs and fields ───────────────────────────────────────────────────

// Native outlines and selected height supply shadow casters and receivers (#50).
function unpackDistance(bytes: Vec2): Float {
  return dot(bytes, vec2(65280, 255)).div(65535).sub(.5).mul(2 * FIELD_RANGE)
}
function outsideRect(p: Vec2, rect: Vec4): Float {
  return length(max(abs(p.sub(rect.xy).sub(rect.zw.mul(.5))).sub(rect.zw.mul(.5)), 0))
}
function inkDistance(v: HomeLightValues, p: Vec2): Float {
  const at = clamp(p.sub(v.inkRect.xy).div(v.inkRect.zw), 0, 1).toVar()
  // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
  const sample = v.ink.sample(vec2(at.x, float(1).sub(at.y))) as Vec4
  return unpackDistance(sample.rg).add(outsideRect(p, v.inkRect))
}
function selectionDistance(v: HomeLightValues, p: Vec2): Float {
  const distance = float(FIELD_RANGE).toVar()
  Loop(SELECTION_SLOTS, ({ i }) => {
    If(i.greaterThanEqual(v.selectionCount), () => { Break() })
    const rect = v.selectionNode.element(i).toVar()
    const d = abs(p.sub(rect.xy).sub(rect.zw.mul(.5))).sub(rect.zw.mul(.5)).toVar()
    distance.assign(min(distance, min(max(d.x, d.y), 0).add(length(max(d, 0)))))
  })
  return distance
}
function glyphHeight(v: HomeLightValues, p: Vec2): Float {
  const height = float(GLYPH_HEIGHT).mul(v.glyphScale).toVar()
  If(selectionDistance(v, p).lessThan(0), () => { height.addAssign(v.selectionLift) })
  return height
}

function fieldDistances(field: TextureNode, rect: Vec4, p: Vec2): Vec2 {
  const bounded = clamp(p.sub(rect.xy).div(rect.zw), 0, 1).toVar()
  // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
  const value = field.sample(vec2(bounded.x, float(1).sub(bounded.y))).toVar() as Vec4
  return vec2(unpackDistance(value.rg), unpackDistance(value.ba)).add(outsideRect(p, rect))
}

// ── the flyer ───────────────────────────────────────────────────────────

function flyerNormal(v: HomeLightValues): Vec3 {
  return normalize(cross(v.flyer[1].sub(v.flyer[0]), v.flyer[3].sub(v.flyer[0])))
}

// Coordinates in the projected card footprint, and its height at that pixel.
function flyerSurface(v: HomeLightValues, p: Vec2): Vec3 {
  const a = v.flyer[0]
  const u = v.flyer[1].sub(a).toVar()
  const w = v.flyer[3].sub(a).toVar()
  const det = u.x.mul(w.y).sub(u.y.mul(w.x)).toVar()
  const offset = p.sub(a.xy).toVar()
  const at = vec2(offset.x.mul(w.y).sub(offset.y.mul(w.x)), u.x.mul(offset.y).sub(u.y.mul(offset.x))).div(det).toVar()
  return abs(det).lessThan(.001).select(vec3(-1), vec3(at, a.z.add(at.x.mul(u.z)).add(at.y.mul(w.z))))
}

// Each native silhouette occupies one horizontal plane. Selected ink moves
// to its own plane rather than leaving a second caster underneath it.
function sheetOutline(v: HomeLightValues, p: Vec2, layer: number): Float {
  if (layer < 2) {
    const outline = inkDistance(v, p).toVar()
    If(v.selectionLift.greaterThan(.01), () => {
      const selected = selectionDistance(v, p)
      outline.assign(max(outline, layer === 0 ? selected.negate() : selected))
    })
    return outline
  }
  const relief = fieldDistances(v.relief, v.reliefRect, p)
  return layer === 2 ? relief.x : relief.y.negate()
}

function flyerRayVisibility(v: HomeLightValues, receiver: Vec3, light: Vec3): Float {
  const result = float(1).toVar()
  const normal = flyerNormal(v).toVar()
  const ray = light.sub(receiver).toVar()
  const denominator = dot(normal, ray).toVar()
  If(abs(denominator).greaterThanEqual(.001), () => {
    const t = dot(normal, v.flyer[0].sub(receiver)).div(denominator).toVar()
    If(t.greaterThan(.00001).and(t.lessThan(1)), () => {
      const point = receiver.add(ray.mul(t))
      const at = flyerSurface(v, point.xy).xy.toVar()
      const edge = min(at, float(1).sub(at)).mul(vec2(length(v.flyer[1].sub(v.flyer[0])), length(v.flyer[3].sub(v.flyer[0])))).toVar()
      result.assign(float(1).sub(smoothstep(-.5, .5, min(edge.x, edge.y))))
    })
  })
  return result
}

// ── visibility ──────────────────────────────────────────────────────────

function lightVisibility(v: HomeLightValues, receiver: Vec3, light: Vec3): Float {
  const result = float(1).toVar()
  const delta = light.sub(receiver).toVar()
  const lightGap = delta.z
  If(lightGap.greaterThan(0), () => {
    const basis = bulbBasis(delta)
    const cosineLimit = bulbCosine(delta, v.lightRadius).toVar()
    const radiusSquared = v.lightRadius.mul(v.lightRadius).toVar()
    const projection = max(.001, lightGap.mul(lightGap).sub(radiusSquared)).toVar()
    // Each footprint stores its height above the receiver and pixel coverage.
    // The spherical emitter projects to an ellipse, longer at grazing angles.
    const footprint: Node<'vec2'>[] = []
    const partial: Node<'bool'>[] = []
    const anyPartial = bool(false).toVar()
    const blocked = bool(false).toVar()
    for (let layer = 0; layer < 4; layer++) {
      const layerPartial = bool(false).toVar()
      const layerFootprint = vec2(0).toVar()
      partial.push(layerPartial)
      footprint.push(layerFootprint)
      let enabled = layer < 2 ? v.inkReady.greaterThan(.5) : v.reliefReady.greaterThan(.5)
      if (layer === 1) enabled = enabled.and(v.selectionLift.greaterThan(.01))
      let elevation: Float = layer < 2 ? float(GLYPH_HEIGHT).mul(v.glyphScale) : float(RAISED_HEIGHT)
      if (layer === 1) elevation = elevation.add(v.selectionLift)
      if (layer === 3) elevation = float(0)
      const gap = elevation.sub(receiver.z).toVar()
      If(blocked.not().and(enabled).and(gap.greaterThan(.01)).and(gap.lessThan(lightGap)), () => {
        const t = gap.div(lightGap)
        const point = receiver.xy.add(delta.xy.mul(gap.mul(lightGap).div(projection))).toVar()
        const radius = gap.mul(v.lightRadius).mul(sqrt(max(.001, dot(delta, delta).sub(radiusSquared)))).div(projection).toVar()
        const aa = max(.05, float(.5).mul(float(1).sub(t))).toVar()
        const outline = sheetOutline(v, point, layer).toVar()
        If(outline.lessThan(radius.negate().sub(aa)), () => { blocked.assign(true) }).Else(() => {
          layerPartial.assign(outline.lessThan(radius.add(aa)))
          anyPartial.assign(anyPartial.or(layerPartial))
          layerFootprint.assign(vec2(gap, aa))
        })
      })
    }
    If(blocked, () => { result.assign(0) }).Else(() => {
      const flyer = v.flyerReady.greaterThan(.5).and(v.paperReady.lessThan(.5)).toVar()
      If(anyPartial.or(flyer), () => {
        const visible = float(0).toVar()
        // Each sampled bulb ray tests every caster once. Elevation and the light's
        // angle both widen the footprint, without double-darkening overlaps (#50).
        Loop(64, ({ i }) => {
          const ray = sampleBulbRay(basis, cosineLimit, LIGHT_TAPS.element(i)).toVar()
          const rayVisibility = float(1).toVar()
          for (let layer = 0; layer < 4; layer++) {
            If(partial[layer]!, () => {
              const f = footprint[layer]!
              const point = receiver.xy.add(ray.xy.mul(f.x.div(max(ray.z, .0001))))
              const outline = sheetOutline(v, point, layer)
              rayVisibility.assign(min(rayVisibility, smoothstep(f.y.negate(), f.y, outline)))
            })
          }
          If(flyer, () => { rayVisibility.assign(min(rayVisibility, flyerRayVisibility(v, receiver, receiver.add(ray.mul(length(delta)))))) })
          visible.addAssign(rayVisibility)
        })
        result.assign(visible.div(64))
      })
    })
  })
  return result
}

// ── the receiver ────────────────────────────────────────────────────────

interface PaperVaryings {
  readonly position: Vec4
  readonly normal: Vec3
}

// The multiplier, before any canvas output step: raw values, alpha 1.
function lightMultiplier(v: HomeLightValues, paper: PaperVaryings | null): Vec4 {
  return Fn(() => {
    let p: Vec2
    let normal: Vec3
    let height: Float
    let relief: Vec2
    let onPaper: Node<'bool'>
    if (paper) {
      p = paper.position.xy.div(paper.position.w).sub(v.frameOrigin).toVar()
      const n = normalize(paper.normal).toVar()
      normal = n.z.lessThan(0).select(n.negate(), n).toVar()
      height = paper.position.z.add(.35).toVar()
      relief = vec2(FIELD_RANGE)
      onPaper = bool(true)
    } else {
      p = vec2(uv().x, float(1).sub(uv().y)).mul(v.resolution).toVar()
      const ink = v.inkReady.greaterThan(.5).select(fieldDistances(v.ink, v.inkRect, p).x, float(FIELD_RANGE)).toVar()
      relief = v.reliefReady.greaterThan(.5).select(fieldDistances(v.relief, v.reliefRect, p), vec2(FIELD_RANGE)).toVar()
      const h = relief.y.lessThan(0).select(float(-WELL_DEPTH), float(0)).toVar()
      If(relief.x.lessThan(0), () => { h.assign(max(h, RAISED_HEIGHT)) })
      If(ink.lessThan(-GLYPH_RECEIVER_INSET), () => { h.assign(max(h, glyphHeight(v, p))) })
      const n = vec3(0, 0, 1).toVar()
      const paperHit = bool(false).toVar()
      // The curved receiver is drawn separately with geometry coverage at native
      // density. This analytic plane remains the no-float-target fallback (#53).
      If(v.paperReady.lessThan(.5).and(v.flyerReady.greaterThan(.5)), () => {
        const card = flyerSurface(v, p).toVar()
        If(card.x.greaterThanEqual(0).and(card.y.greaterThanEqual(0)).and(card.x.lessThanEqual(1)).and(card.y.lessThanEqual(1)), () => {
          h.assign(card.z.add(.35))
          const flat = flyerNormal(v).toVar()
          n.assign(flat.z.lessThan(0).select(flat.negate(), flat))
          paperHit.assign(true)
        })
      })
      height = h
      normal = n
      onPaper = paperHit
    }
    const receiver = vec3(p, height).toVar()
    const light = vec3(v.light, v.lightHeight).toVar()
    // Page content sits behind the postcard in both presentations. Its shadows
    // must stay behind too; the paper's own occlusion is applied separately (#50).
    const visibility = float(1).toVar()
    if (!paper) If(onPaper.not(), () => { visibility.assign(lightVisibility(v, receiver, light)) })
    If(v.paperReady.greaterThan(.5), () => { visibility.assign(min(visibility, paperVisibility(v, receiver, normal, light))) })
    const direction = normalize(light.sub(receiver)).toVar()
    const facing = clamp(dot(normal, direction).div(max(direction.z, .12)), 0, 1.15)
    // Normalize unoccluded horizontal surfaces to the existing page wash.
    // The ambient/direct ratio still reduces shadow contrast far from the bulb.
    const toLight = light.sub(receiver)
    const direct = float(LIGHT_POWER).div(max(dot(toLight, toLight), 1)).toVar()
    const shade = float(.75).add(direct.mul(visibility).mul(facing)).div(float(.75).add(direct)).toVar()
    const sheen = (): void => {
      // Matte stock leaves headroom for the soft sheen on a turning fold.
      // The same response shades native and scene presentations at rest (#51).
      const glint = float(.06).mul(pow(max(dot(normal, normalize(direction.add(vec3(0, 0, 1)))), 0), 18)).mul(visibility)
      shade.assign(shade.mul(.86).add(glint))
    }
    if (paper) sheen()
    else If(onPaper, sheen)
    // Only recessed wells touch a surrounding rim. Elevated sheets must not
    // leave a fixed dark outline behind when their cast shadow moves away.
    const contact = height.lessThan(0).select(float(.10).mul(exp(min(0, relief.y).div(3))), float(0))
    // The page keeps a readable ambient floor while the lamp's pool moves.
    // Cool blocked light stays subtle on the chartreuse wash (decision #50).
    const away = p.sub(light.xy).toVar()
    const pool = float(.88).add(float(.12).mul(exp(dot(away, away).negate().div(float(4).mul(v.lightHeight).mul(v.lightHeight)))))
    const tint = mix(vec3(.96, .985, 1), vec3(1), visibility)
    return vec4(clamp(vec3(shade.mul(float(1).sub(contact)).mul(pool)).mul(tint), 0, 1), 1)
  })()
}

export interface MaskFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The page pass. It draws into a render target sampled later (passMaterial). */
export function createHomeLightMaterial() {
  const values = createHomeLightValues()
  const material = passMaterial({ name: 'home-light', depthTest: false, depthWrite: false })
  // A render-target pass: no canvas conversion follows, so the raw multiplier lands.
  material.outputNode = lightMultiplier(values, null)
  return Object.assign(material, { values })
}

export type HomeLightMaterial = ReturnType<typeof createHomeLightMaterial>

/** Shade the paper's actual triangles, sharing the page's light and depth map. */
export function createHomePaperMaterial(material: HomeLightMaterial) {
  const paper = new MeshBasicNodeMaterial({ name: 'home-paper-light', side: THREE.DoubleSide, toneMapped: false })
  const projectionW = attribute<'float'>('projectionW', 'float')
  const position = varying(vec4(positionGeometry.xy.mul(projectionW), positionGeometry.z, projectionW))
    .setInterpolation(THREE.InterpolationSamplingType.PERSPECTIVE, THREE.InterpolationSamplingMode.CENTROID)
  const normal = varying(normalGeometry).setInterpolation(THREE.InterpolationSamplingType.PERSPECTIVE, THREE.InterpolationSamplingMode.CENTROID)
  const projected = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionGeometry, 1))
  // Keep the card camera's perspective interpolation and depth order;
  // the receiver's x/y coordinates have already been projected to pixels.
  paper.vertexNode = vec4(projected.xy.mul(projectionW), projectionW.sub(2), projectionW)
  // Drawn onto the canvas with alpha 1, so decoding the raw multiplier lands it unchanged.
  paper.outputNode = encodedOutput(lightMultiplier(material.values, { position, normal }))
  return paper
}

export function setHomeLightFrame(material: HomeLightMaterial, width: number, height: number, lightX: number, lightY: number, lightHeight = LIGHT_HEIGHT) {
  material.values.lightHeight.value = lightHeight
  material.values.resolution.value.set(width, height)
  material.values.light.value.set(lightX, lightY)
}

export function setHomeInkMask(material: HomeLightMaterial, texture: THREE.Texture | null, frame: MaskFrame | null, scale = 1) {
  material.values.glyphScale.value = scale
  material.values.ink.value = texture ?? EMPTY
  material.values.inkReady.value = texture && frame ? 1 : 0
  if (!frame) return
  material.values.inkRect.value.set(frame.x, frame.y, frame.width, frame.height)
}

/** The flyer's corners (see homeFlyer.ts) moved into canvas px, or none. */
export function setHomeFlyerUniform(material: HomeLightMaterial, corners: Float32Array | null, originX: number, originY: number) {
  material.values.flyerReady.value = corners ? 1 : 0
  if (!corners) return
  // Both publishers supply four xyz corners; each target consumes one triple.
  material.values.flyer.forEach((target, index) => {
    target.value.set(corners[index * 3]! - originX, corners[index * 3 + 1]! - originY, corners[index * 3 + 2]!)
  })
}

export function setHomeReliefMask(material: HomeLightMaterial, texture: THREE.Texture | null, frame: MaskFrame | null) {
  material.values.relief.value = texture ?? EMPTY
  material.values.reliefReady.value = texture && frame ? 1 : 0
  if (!frame) return
  material.values.reliefRect.value.set(frame.x, frame.y, frame.width, frame.height)
}

/** Points the paper-shadow sample at `texture`, or at nothing. */
export function setHomePaperShadow(material: HomeLightMaterial, texture: THREE.Texture | null) {
  material.values.paperShadow.value = texture ?? EMPTY
}

/** Uploads a mask's packed bytes as-is; no colour space, no premultiplying. */
export function maskTexture(mask: Mask): THREE.DataTexture {
  const texture = new THREE.DataTexture(mask.data, mask.width, mask.height, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.flipY = true
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}
