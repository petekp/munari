// The genie sheet's material. The warp itself is NOT here — the law lives
// in genieLaw.ts and the driver applies it to the geometry's position
// attribute on the CPU, so the raycast hits the same funnel the eye sees
// and a mid-drain click lands on the content it appears to land on. (The
// flight card keeps its bend on the GPU and raycasts the flat plane; that
// trade is right for a mild bow and wrong for a warp that moves the sheet
// half a viewport from its rect. genieLaw.test.ts proves the funnel never
// folds over, which is the case that would make CPU picking ambiguous.)
//
// So these two materials only rasterize: keep the deformed position, mask
// the element's corners, and fade the shadow where the funnel has squeezed
// it past legibility. Both return the premultiplied composite through
// premultipliedOutput, so a translucent shade texel lands on the canvas at
// its page value (decisions.md #72).
//
// ── why the shadow needs a shader at all ────────────────────────────────
//
// The shade is ink INSIDE the capture (genie.css explains why it cannot
// be a box-shadow), which is right at rest and right under a
// translation, and wrong under a minification — because ink scales with
// the paper and a shadow does not. A shadow's offset is set by the light
// and by how far the thing floats above the ground, not by how big the
// thing is; shrink a window to a ninth and its shadow should not become
// a ninth of a shadow. Poured into the mouth, 5px of drop at the
// funnel's 0.11 scale is 0.55px, and half a pixel of translucent grey is
// not a shadow — it is a dark fringe crawling down one edge of the neck,
// and (because the bottom band is shade too) the first thing that enters
// the bay is a smear rather than the window.
//
// So the shade fades out. What it fades ON is the whole design. Fading
// on `t` is the obvious move and it is wrong: during a minimize the top
// of the sheet is still near full size while the bottom is already at
// the mouth, so a fade driven by the clock strips a perfectly legible
// 5px band off the part of the sheet that still reads correctly. The
// fade is driven instead by how hard the funnel is squeezing THIS ROW —
// carried per-vertex from the law, which computes it anyway. The shadow
// then survives exactly where it still resolves and leaves where it
// cannot, which is also what makes it need no special case for a
// manual scrub, a catch mid-flight, or a restore: none of those know
// what time it is either.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type TextureNode, type UniformNode } from 'three/webgpu'
import { Discard, Fn, attribute, float, mix, smoothstep, step, texture, uniform, uv, varying, vec2, vec4 } from 'three/tsl'
import { premultipliedOutput, surfaceRadiusMask, type SurfaceNodes } from '@petepetrash/munari'

/** The values both sheets read, written in place each render. */
export interface GenieShade {
  /** Where the window stops and the shade begins, as a fraction of the
   *  capture root, in the DOM's own coordinates: (windowW / rootW,
   *  windowH / rootH). (1, 1) means this sheet has no shade band and
   *  nothing below can fade anything. */
  readonly edge: UniformNode<'vec2', THREE.Vector2>
  /** The band of row-compression the shade fades across: fully present
   *  at or above .y, gone at or below .x. */
  readonly fade: UniformNode<'vec2', THREE.Vector2>
}

export function createGenieShade(fade: readonly [number, number]): GenieShade {
  return { edge: uniform(new THREE.Vector2(1, 1)), fade: uniform(new THREE.Vector2(fade[0], fade[1])) }
}

// The row's width as a fraction of the sheet's resting width, written by
// the same loop that writes position — genieWarp returns it as k.
const squeeze = varying(attribute<'float'>('squeeze', 'float'))

function sheetMaterial(): MeshBasicNodeMaterial {
  return new MeshBasicNodeMaterial({
    transparent: true,
    // decisions.md #5: a 2D canvas's backing store is already
    // premultiplied, so a material consuming one has to blend that way.
    // The sheet was fully opaque until it grew a translucent shadow,
    // which is why this could be missing and look correct — with the
    // default blend the shade gets multiplied by its alpha a second
    // time and lands a few luma dark of the page copy it has to be
    // identical to at the swap.
    premultipliedAlpha: true,
    // Four sheets can be in the air at once and every one of them sits
    // at z = 0, so the depth buffer has no opinion worth having about
    // which is in front — and with writes on, whichever drew first
    // would silently reject the rest. The group's renderOrder decides
    // instead (see Flight), which is the desk's own paint order.
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
}

// The shade occupies an L along the root's right and bottom edges, and the
// window in front of it is opaque, so a texel is shade if and only if it is
// outside the window's box. The two empty corners fall in the same region
// and are already alpha 0, so they neither need nor notice this.
//
// uv().y runs bottom → top and the DOM's runs top → bottom, the same flip
// the driver applies when it feeds the law. The capture is premultiplied
// (decisions.md #5), so scaling the whole texel — colour and alpha
// together — is exactly a fade, and leaves it premultiplied.
function fadeShade(color: Node<'vec4'>, shade: GenieShade): Node<'vec4'> {
  const at = uv()
  const inShade = step(shade.edge.x, at.x).add(step(shade.edge.y, float(1).sub(at.y))).min(1)
  return color.mul(mix(1, smoothstep(shade.fade.x, shade.fade.y, squeeze), inShade))
}

// A one-pixel horizontal border becomes a dark bar when the funnel makes
// that row narrow. Keep it at rest for exact DOM parity, then replace only
// the squeezed bottom-border texels with the window color sampled just above
// them. This removes the bar without cutting a transparent slit in the sheet.
function withoutSqueezedBottomBorder(
  color: Node<'vec4'>,
  map: TextureNode,
  size: Node<'vec2'>,
  shade: GenieShade,
): Node<'vec4'> {
  const at = uv()
  const windowBottom = float(1).sub(shade.edge.y)
  const pixel = float(1).div(size.y.max(1))
  const inBottomBorder = step(windowBottom, at.y).mul(float(1).sub(step(windowBottom.add(pixel.mul(1.25)), at.y)))
  const squeezed = float(1).sub(smoothstep(0.72, 0.96, squeeze))
  // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
  const windowFill = map.sample(vec2(at.x, windowBottom.add(pixel.mul(2.25)).min(1))) as Node<'vec4'>
  return mix(color, windowFill, inBottomBorder.mul(squeezed))
}

// The element's corners, enforced analytically. The flight card needs this
// because its .ui-root paints them opaque and the texture cannot say where
// the card ends; the genie sheet turns that background off (genie.css) so
// its shadow can carry real alpha, which leaves the mask doing nothing at
// this scene's zero radius — kept because the radius is the window's to
// choose, not this material's to assume. Coverage scales RGB and alpha
// together, as premultiplied color requires.
function finish(color: Node<'vec4'>, mask: Node<'float'>): Node<'vec4'> {
  return Fn(() => {
    const covered = color.mul(mask)
    Discard(covered.a.lessThan(0.004))
    return premultipliedOutput(covered)
  })()
}

/** The plain sheet: the window capture with its shade fade. */
export function createGenieMaterial(surface: SurfaceNodes, shade: GenieShade): MeshBasicNodeMaterial {
  const material = sheetMaterial()
  // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
  const sample = surface.map.sample(uv()) as Node<'vec4'>
  const color = withoutSqueezedBottomBorder(fadeShade(sample, shade), surface.map, surface.size, shade)
  material.outputNode = finish(color, surface.radiusMask())
  return material
}

/** Where the film sits in the window capture, written in place each render. */
export interface GenieFilmPlacement {
  /** (left, top, width, height) in normalized capture coordinates. */
  readonly rect: UniformNode<'vec4', THREE.Vector4>
  /** The two bottom corners' radius in source CSS pixels. */
  readonly radius: UniformNode<'float', number>
  /** The window capture's CSS size. */
  readonly size: UniformNode<'vec2', THREE.Vector2>
}

export function createGenieFilmPlacement(): GenieFilmPlacement {
  return { rect: uniform(new THREE.Vector4(0, 0, 1, 1)), radius: uniform(0), size: uniform(new THREE.Vector2(1, 1)) }
}

// filmUv follows DOM coordinates: (0, 0) is the film's top-left. The top
// corners stay square. Only the bottom pair use the CSS radius.
function filmRadiusDistance(filmUv: Node<'vec2'>, filmSize: Node<'vec2'>, cornerRadius: Node<'float'>): Node<'float'> {
  const p = filmUv.sub(0.5).mul(filmSize)
  const maxRadius = filmSize.x.min(filmSize.y).mul(0.5)
  const radius = p.y.greaterThan(0).select(cornerRadius.clamp(0, maxRadius), float(0))
  const d = p.abs().sub(filmSize.mul(0.5)).add(vec2(radius))
  return d.x.max(d.y).min(0).add(d.max(0).length()).sub(radius)
}

const NO_RADII = uniform(new THREE.Vector4(0, 0, 0, 0))

/**
 * The film window's sheet. Its DOM capture supplies the premultiplied
 * chrome, while one persistent, opaque canvas supplies the moving picture.
 * Both textures use SRGBColorSpace, so samples return linear values and the
 * renderer performs the output transform once, after the composite.
 */
export function createGenieFilmMaterial(
  chrome: THREE.Texture,
  film: THREE.Texture,
  placement: GenieFilmPlacement,
  shade: GenieShade,
): MeshBasicNodeMaterial {
  const material = sheetMaterial()
  const at = uv()
  const chromeMap = texture(chrome)
  // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
  const chromeSample = chromeMap.sample(at) as Node<'vec4'>
  const rectSize = placement.rect.zw.max(vec2(1e-6))
  const domUv = vec2(at.x, float(1).sub(at.y))
  const filmUv = domUv.sub(placement.rect.xy).div(rectSize)
  const filmSize = rectSize.mul(placement.size).max(vec2(1e-4))
  const filmDistance = filmRadiusDistance(filmUv, filmSize, placement.radius)
  const filmEdge = filmDistance.fwidth().max(1e-4)
  const filmCoverage = float(1).sub(smoothstep(filmEdge.negate(), filmEdge, filmDistance))
  // CanvasTexture UVs are bottom-up. The source is opaque by contract, so
  // its replacement texel is premultiplied with alpha one. Mixing the full
  // vec4 applies the antialiased film coverage without breaking that form.
  const filmSampleUv = vec2(filmUv.x, float(1).sub(filmUv.y)).clamp(0, 1)
  // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
  const filmSample = texture(film, filmSampleUv) as Node<'vec4'>
  const composite = mix(fadeShade(chromeSample, shade), vec4(filmSample.rgb, 1), filmCoverage)
  const color = withoutSqueezedBottomBorder(composite, chromeMap, placement.size, shade)
  // The composite remains premultiplied through the outer window mask too.
  material.outputNode = finish(color, surfaceRadiusMask(at, placement.size, NO_RADII))
  // Off at birth and written from the frame loop (Flight). Two facts have
  // to be true before this composite may be SEEN and both turn inside a
  // frame rather than in a commit: the crossing has given the canvas
  // presentation authority, and the frozen film generation is the one on
  // this geometry.
  material.colorWrite = false
  return material
}
