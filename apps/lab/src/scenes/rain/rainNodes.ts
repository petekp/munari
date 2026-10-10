// Rain nodes — one instanced disc for every live drop, one thin instanced
// streak for the background weather, one thin instanced column for water
// standing in the headline's glyph ink.
//
// The law: shape lives in local unit-circle (or unit-column) space, before
// the instance matrix's squash and translate reach it. A sitting bead's
// y-scale of 0.82 then reads as an ellipse for free — the fragment shader
// never needs to know it is squashed, only whether it is sitting, to draw
// the contact darkening beneath it. Real water on glass is mostly the page
// showing through: a body this shader keeps close to transparent, with the
// edge and one small highlight carrying almost all of the read, rather
// than a painted rim and a broad specular disc.
//
// The canvas value is encode(color) · alpha: every colour here was tuned
// with the straight colour encoded first and premultiplied after. Each
// material builds that encoded value and returns it through
// `encodedOutput` (decisions.md #72).
//
// Ownership: these materials own colour and coverage only. Position, radius
// and the sitting/rolling/falling split are rainLaw's; the instance matrix,
// per-instance attributes and uniform writes are rainField's.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type UniformNode } from 'three/webgpu'
import {
  Discard,
  Fn,
  attribute,
  cos,
  float,
  mix,
  mod,
  positionGeometry,
  sRGBTransferOETF,
  sin,
  smoothstep,
  tan,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { encodedOutput } from '@petepetrash/munari'

// The CSS-mapped camera (top 0, bottom height) mirrors Y, which reverses
// on-screen winding — with front-face culling every quad vanishes.
function createRainMaterial(): MeshBasicNodeMaterial {
  return new MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
  })
}

function rainOutput(color: Node<'vec3'>, alpha: Node<'float'>): Node<'vec4'> {
  // SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
  // published types leave the result untyped.
  const encoded = sRGBTransferOETF(color) as Node<'vec3'>
  return encodedOutput(vec4(encoded.mul(alpha), alpha))
}

export function createRainDropMaterial(): MeshBasicNodeMaterial {
  const material = createRainMaterial()
  const local = varying(positionGeometry.xy)
  const sit = varying(attribute('aSit', 'float'))
  const fade = varying(attribute('aFade', 'float'))

  material.outputNode = Fn(() => {
    const dist = local.length().mul(2)
    Discard(dist.greaterThan(1))

    // The body is a cool tint a few steps darker than the page, not a
    // painted disc — the page still shows through it, but at an alpha a
    // real bead of water actually reaches (0.30 against #e9ecef reads as a
    // visible grey-blue bead; 0.14 read as nothing).
    const body = vec3(0.56, 0.64, 0.72)
    const edgeColor = vec3(0.14, 0.18, 0.24)
    // A soft meniscus band right at the silhouette (a hard rim reads as a
    // drawn outline; this is narrow enough to still look like refraction).
    const edge = smoothstep(0.72, 1, dist)
    const color = mix(body, edgeColor, edge).toVar()

    // A faint gradient toward one side, as if catching an overhead source —
    // this alone does most of the "lit water" work; the highlight below only
    // adds the last, small punctuation. Written as 1 - smoothstep(-0.7, 0.3, y)
    // because smoothstep with its edges reversed is undefined in WGSL; the
    // value is the same.
    const wash = float(1).sub(smoothstep(-0.7, 0.3, local.y.mul(2)))
    color.assign(mix(color, vec3(1), wash.mul(0.1)))

    // A contact shadow hugging the lower silhouette, only under a bead that
    // is actually resting on a ledge — a falling drop has nothing beneath it
    // to darken.
    const below = smoothstep(0.05, 0.6, local.y.mul(-2)).mul(smoothstep(0.5, 1, dist))
    color.assign(mix(color, vec3(0), sit.mul(below).mul(0.24)))

    // One tight highlight — a fraction of the drop's own radius, the way a
    // pixel or two of glare reads on real water, not the near-half-drop disc
    // a bigger radius would blur into a painted dot.
    const specOffset = local.mul(2).sub(vec2(-0.34, 0.4))
    const spec = float(1).sub(smoothstep(0, 0.16, specOffset.length()))
    color.assign(mix(color, vec3(1), spec.mul(0.9)))

    const alpha = float(0.3).add(edge.mul(0.32)).add(spec.mul(0.35)).mul(fade)
    return rainOutput(color, alpha)
  })()
  return material
}

/** The streaks' live values, written by rainField. */
export interface RainStreakValues {
  readonly time: UniformNode<'float', number>
  readonly viewport: UniformNode<'vec2', THREE.Vector2>
  readonly angle: UniformNode<'float', number>
  readonly length: UniformNode<'float', number>
  readonly width: UniformNode<'float', number>
}

export function createRainStreakValues(angle: number, length: number, width: number): RainStreakValues {
  return {
    time: uniform(0),
    viewport: uniform(new THREE.Vector2(1, 1)),
    angle: uniform(angle),
    length: uniform(length),
    width: uniform(width),
  }
}

// A streak needs no per-instance transform: its whole path is a function of
// its seed and the clock, so idle costs nothing and a resize never has to
// re-place one.
export function createRainStreakMaterial(v: RainStreakValues): MeshBasicNodeMaterial {
  const material = createRainMaterial()
  const seed = attribute('aSeed', 'vec3')

  material.positionNode = Fn(() => {
    const wrap = v.viewport.y.add(v.length.mul(2))
    const speed = mix(16, 34, seed.z)
    const travel = mod(seed.y.mul(wrap).add(v.time.mul(speed)), wrap).sub(v.length)
    const slope = tan(v.angle)
    const cx = seed.x.mul(v.viewport.x.add(v.length.mul(slope))).add(travel.mul(slope))
    const cy = travel

    const c = cos(v.angle)
    const s = sin(v.angle)
    const local = positionGeometry.xy.mul(vec2(v.width, v.length))
    const rotated = vec2(local.x.mul(c).sub(local.y.mul(s)), local.x.mul(s).add(local.y.mul(c)))
    return vec3(vec2(cx, cy).add(rotated), 0)
  })()

  // Fades in from the top and out toward the bottom of its own run, so a
  // streak never pops at either end of the wrap. The tail is written as
  // 1 - smoothstep(0.85, 1, t) because smoothstep with its edges reversed is
  // undefined in WGSL; the value is the same.
  const alongUnit = positionGeometry.y.add(0.5)
  const edge = smoothstep(0, 0.12, alongUnit).mul(float(1).sub(smoothstep(0.85, 1, alongUnit)))
  const fade = varying(edge.mul(mix(0.5, 1, seed.z)))

  material.outputNode = Fn(() => {
    const color = vec3(0.62, 0.67, 0.74)
    const alpha = fade.mul(0.08)
    return rainOutput(color, alpha)
  })()
  return material
}

// One quad per wet h1 column. rainField.tsx scales/positions the unit quad
// so local y=+0.5 always lands on that column's ink floor and y=-0.5 on
// its open water surface (see writeWaterInstances) — the fragment reads
// that one axis directly, no radius or per-instance uniform needed.
export function createRainWaterMaterial(): MeshBasicNodeMaterial {
  const material = createRainMaterial()
  const local = varying(positionGeometry.xy)

  material.outputNode = Fn(() => {
    const body = vec3(0.55, 0.64, 0.74)
    const floorColor = vec3(0.16, 0.21, 0.27)
    // Darkens toward the ink floor (local.y > 0) — a pooled column reads as
    // deepest right where it touches the glyph, same as the drop's own
    // contact shadow.
    const contact = smoothstep(0, 0.5, local.y)
    const color = mix(body, floorColor, contact.mul(0.6)).toVar()

    // The meniscus at the open surface (local.y approaching -0.5) is a DARK
    // tension rim, not a white line — most of the column floats over the
    // #e8ebee page, where a white meniscus and a 0.30-alpha body both
    // disappeared (2026-09-01 capture: filled bowls read as faint smudges).
    const surfaceLine = float(1).sub(smoothstep(0, 0.12, local.y.add(0.5)))
    color.assign(mix(color, vec3(0.24, 0.32, 0.42), surfaceLine.mul(0.85)))

    // A narrow bright band just under the rim — the one sliver of gathered
    // light that says liquid instead of tinted glass.
    const glare = smoothstep(0.12, 0.2, local.y.add(0.5)).mul(float(1).sub(smoothstep(0.2, 0.34, local.y.add(0.5))))
    color.assign(mix(color, vec3(0.97), glare.mul(0.4)))

    const alpha = float(0.52).add(contact.mul(0.22)).add(surfaceLine.mul(0.25))
    return rainOutput(color, alpha)
  })()
  return material
}
