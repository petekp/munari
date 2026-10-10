// The veil's materials. The blur is a two-pass separable gaussian whose
// radius is the law (veilLaw.ts) evaluated per row, restated here in TSL
// and fed the same constants through uniforms. The JS tests check
// veilLaw.ts, not these shaders.
//
// Everything runs in the band's OWN coordinates: row 0 is the seam,
// rows grow downward, and the article y of row 0 arrives as a uniform
// (windowY). The scene positions the canvas in the scrolling layer at
// exactly windowY, so position and content are computed from the same
// number and cannot disagree — the hold fix that replaced trying to
// outguess the compositor's scroll (see Veil.tsx).
//
// Three passes; the two blur passes take 13 taps each:
//
//   copy   article texture -> window RT   (one sample, mipmapped on write)
//   blur   horizontal blur -> strip RT    (mipmapped on write)
//   band   vertical blur, fade, encode -> the quad on screen
//
// Why the copy pass exists: a 13-tap kernel spaced radius/6 apart is a
// comb, not a gaussian, unless each tap integrates the span between
// taps. The DOM texture carries no mip chain (Surface's filter
// policy), so at high dpr the taps point-sample between texels and the
// deep blur turns into a woven lattice of ghost impulses (observed on
// a retina display, 2026-08-08 — a dpr 1 probe cannot see it, the
// coarser texels plug the gaps). Copying the window into an RT WE mip
// gives every tap a footprint that integrates the span to the next, and
// the seam still samples the pristine base level — spacing 0 maps to
// level 0.
//
// The seam needs no special case beyond that. At radius 0 all thirteen
// taps land on the same texel of level 0 and the normalized sum is
// that texel — the band's near edge is the content, exactly. The JS
// side's radius(0) = 0 is what veilLaw.test.ts pins.
//
// Both offscreen passes draw through `passMaterial` (@petepetrash/munari/advanced),
// so a row computed at uv.y = v is the row a later sample at v reads.
//
// Everything before the band's encode stays linear premultiplied: the
// sampler decodes sRGB on read (texture.colorSpace), both RTs are
// HalfFloat linear (mips average premultiplied linear color, the one
// space where averaging is honest), and the single sRGBTransferOETF in
// the band's output is the one place the light leaves linear. The fade
// multiplies AFTER that encode: the browser composites this canvas
// premultiplied in DEVICE space, so identity blending over identical
// pixels needs sRGB(c) × a — fading before the encode hands it
// sRGB(c × a), which is too bright at every partial alpha (observed as
// a glowing stripe, 2026-08-08). `encodedOutput` lands that
// already-encoded value on the canvas as written.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type TextureNode, type UniformNode } from 'three/webgpu'
import { Fn, clamp, float, log2, max, pow, sRGBTransferOETF, texture, uniform, uv, vec2, vec4 } from 'three/tsl'
import { encodedOutput } from '@petepetrash/munari'
import { passMaterial } from '@petepetrash/munari/advanced'
import { VEIL_DEFAULTS } from './veilLaw'

type Float = UniformNode<'float', number>
type Vec2 = UniformNode<'vec2', THREE.Vector2>

/** The uniforms the blur and the band each read, one set per material. */
export interface VeilProfile {
  /** (seam row, band height). */
  readonly band: Vec2
  readonly maxR: Float
  readonly curve: Float
  /** Device texels per CSS px. */
  readonly dpr: Float
  /** (strip top in band rows, strip height). */
  readonly strip: Vec2
  /** The canvas CSS size. */
  readonly size: Vec2
}

function createProfile(): VeilProfile {
  return {
    band: uniform(new THREE.Vector2(0, VEIL_DEFAULTS.height)),
    maxR: uniform(VEIL_DEFAULTS.maxRadius),
    curve: uniform(VEIL_DEFAULTS.curve),
    dpr: uniform(1),
    strip: uniform(new THREE.Vector2(0, 1)),
    size: uniform(new THREE.Vector2(1, 1)),
  }
}

// The twin of veilRadius(d, p): y is a band row, band is
// (seam row, band height), maxR/curve are VEIL_DEFAULTS unless tuned.
function veilRadius(y: Node<'float'>, p: VeilProfile): Node<'float'> {
  const s = clamp(y.sub(p.band.x).div(p.band.y), 0, 1)
  const eased = s.mul(s).mul(float(3).sub(float(2).mul(s)))
  return p.maxR.mul(pow(eased, p.curve))
}

// Gaussian taps at i in [-6, 6], spaced radius/6 apart: the spacing
// scales with the radius while t_i/sigma stays fixed at i/3, so the
// weights are compile-time constants and only the footprint moves.
// veilBias is the mip level that makes one tap's footprint cover the
// spacing to the next (dpr texels per CSS px).
const TAPS = Array.from({ length: 13 }, (_, k) => k - 6)
const veilWeight = (i: number) => Math.exp(-(i * i) / 18)
const WEIGHT_SUM = TAPS.reduce((sum, i) => sum + veilWeight(i), 0)

function veilBias(spacing: Node<'float'>, dpr: Float): Node<'float'> {
  return max(0, log2(max(spacing.mul(dpr), 1)))
}

/** The normalized 13-tap sum, `at(i)` giving tap i's uv. */
function blurTaps(map: TextureNode, at: (i: number) => Node<'vec2'>, bias: Node<'float'>): Node<'vec4'> {
  let acc: Node<'vec4'> = vec4(0)
  for (const i of TAPS) {
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    const tap = map.sample(at(i)).bias(bias) as Node<'vec4'>
    acc = acc.add(tap.mul(veilWeight(i)))
  }
  return acc.div(WEIGHT_SUM)
}

// ── copy ────────────────────────────────────────────────────────────────

export interface VeilCopy {
  readonly material: MeshBasicNodeMaterial
  readonly map: TextureNode
  /** The article's CSS size. */
  readonly content: Vec2
  readonly strip: Vec2
  readonly size: Vec2
  /** The article y of band row 0. */
  readonly windowY: Float
}

// The copy: article paint in, the window's rows out, nothing else —
// this pass exists to be mipmapped. strip is (strip top in band rows,
// strip height), windowY the article y of band row 0, size the canvas
// CSS size, content the article's CSS size.
export function createVeilCopy(placeholder: THREE.Texture): VeilCopy {
  const map = texture(placeholder)
  const content = uniform(new THREE.Vector2(1, 1))
  const strip = uniform(new THREE.Vector2(0, 1))
  const size = uniform(new THREE.Vector2(1, 1))
  const windowY = uniform(0)
  const material = passMaterial()
  material.outputNode = Fn(() => {
    const at = uv()
    const bandY = strip.x.add(float(1).sub(at.y).mul(strip.y))
    const cy = bandY.add(windowY)
    const cx = at.x.mul(size.x)
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    return map.sample(vec2(cx.div(content.x), float(1).sub(cy.div(content.y)))) as Node<'vec4'>
  })()
  return { material, map, content, strip, size, windowY }
}

// ── horizontal pass ─────────────────────────────────────────────────────

export interface VeilBlur {
  readonly material: MeshBasicNodeMaterial
  readonly map: TextureNode
  readonly profile: VeilProfile
}

// Horizontal half of the gaussian: window RT in, half-blurred strip
// out. Row for row — both RTs have identical geometry, so v passes
// through untouched.
export function createVeilBlur(placeholder: THREE.Texture): VeilBlur {
  const map = texture(placeholder)
  const p = createProfile()
  const material = passMaterial()
  material.outputNode = Fn(() => {
    const at = uv()
    const bandY = p.strip.x.add(float(1).sub(at.y).mul(p.strip.y))
    const spacing = veilRadius(bandY, p).div(6).toVar()
    const bias = veilBias(spacing, p.dpr).toVar()
    const cx = at.x.mul(p.size.x)
    return blurTaps(map, (i) => vec2(cx.add(float(i).mul(spacing)).div(p.size.x), at.y), bias)
  })()
  return { material, map, profile: p }
}

// ── the band ────────────────────────────────────────────────────────────

export interface VeilBand {
  readonly material: MeshBasicNodeMaterial
  readonly map: TextureNode
  readonly profile: VeilProfile
  readonly fade: Float
  readonly gate: Float
}

// Vertical half, drawn as the window quad itself: strip in, finished
// veil out. Same profile, same taps, same bias law, other axis — then
// the encode, then the seam fade (order is the load-bearing part, see
// the header).
export function createVeilBand(placeholder: THREE.Texture): VeilBand {
  const map = texture(placeholder)
  const p = createProfile()
  const fade = uniform(VEIL_DEFAULTS.fade)
  const gate = uniform(0)
  // Transparent + premultiplied (decisions.md #5): the fragment fades the
  // band in from the seam, and the live page has to show through the
  // faded rows — an opaque band would replace them.
  const material = new MeshBasicNodeMaterial({ transparent: true, premultipliedAlpha: true })
  material.outputNode = Fn(() => {
    const at = uv()
    const bandY = float(1).sub(at.y).mul(p.size.y).toVar()
    const spacing = veilRadius(bandY, p).div(6).toVar()
    const bias = veilBias(spacing, p.dpr).toVar()
    const c = blurTaps(
      map,
      (i) => vec2(at.x, float(1).sub(bandY.add(float(i).mul(spacing)).sub(p.strip.x).div(p.strip.y))),
      bias,
    ).toVar()
    // SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
    // published types leave the result untyped.
    const encoded = sRGBTransferOETF(c.rgb) as Node<'vec3'>
    const a = clamp(bandY.sub(p.band.x).div(fade), 0, 1)
    const seam = a.mul(a).mul(float(3).sub(float(2).mul(a)))
    // The generation gate: veilReturn is evaluated JS-side per FRAME (it
    // varies per frame, not per fragment — every fragment this frame gets
    // the same value) and arrives here as a plain uniform. Multiplying
    // AFTER the encode keeps the premultiplied story identical to the
    // fade's just above: both are alpha applied to an already-sRGB color,
    // so a still-closing gate composites exactly like a not-yet-faded row.
    return encodedOutput(vec4(encoded, c.a).mul(seam.mul(gate)))
  })()
  return { material, map, profile: p, fade, gate }
}
