// Premultiplied output — what a custom node material returns so its color
// lands on the canvas as the page would composite it.
//
// The law: SurfaceCanvas draws through Three's DirectRenderPipeline, which
// converts each fragment's output to the canvas's sRGB encoding by
// unpremultiplying, encoding, and premultiplying again. WebGL encoded the
// premultiplied color directly. The two agree only at alpha 1: a
// half-transparent white capture texel landed as 88 instead of 128
// (measured 2026-10-08, Chrome 155, Three 0.186.1, both backends). These
// helpers return the value whose conversion is WebGL's encode, so a
// translucent HTML pixel keeps its page value.
//
// A fragment with alpha 0 contributes nothing through either helper:
// Three's conversion drops its color. Light added over transparent pixels
// must come from the material's blend factors instead.

import type { Node } from 'three/webgpu'
import { sRGBTransferEOTF, sRGBTransferOETF, vec4 } from 'three/tsl'

/**
 * The `outputNode` for premultiplied color already in the canvas's sRGB
 * encoding, such as a color passed through `sRGBTransferOETF` and then faded
 * or premultiplied, or a texture sample that should reach the canvas
 * unconverted.
 */
export function encodedOutput(encoded: Node<'vec4'>): Node<'vec4'> {
  const alpha = encoded.a
  // SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
  // published types leave the result untyped.
  const straight = sRGBTransferEOTF(encoded.rgb.div(alpha.max(1e-6))) as Node<'vec3'>
  return vec4(straight.mul(alpha), alpha)
}

/**
 * The `outputNode` for premultiplied linear color, such as a sample of a
 * Surface capture: it lands as WebGL's per-fragment sRGB encode did.
 */
export function premultipliedOutput(color: Node<'vec4'>): Node<'vec4'> {
  // SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
  // published types leave the result untyped.
  const encoded = sRGBTransferOETF(color.rgb) as Node<'vec3'>
  return encodedOutput(vec4(encoded, color.a))
}
