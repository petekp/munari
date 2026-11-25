// Finish material — a MeshPhysicalNodeMaterial body wearing a Surface
// capture, with the capture either lit as the body's albedo or composited
// over the lit body unlit.
//
// The law: the capture is premultiplied in its sRGB encoding (decisions.md
// #5, #48), so it composites over the opaque body in that encoding, as the
// page does, and only then decodes. Over an opaque body that composite is
// the alpha divide's whole job: the result has alpha 1, and no decoded
// premultiplied sample is ever divided. Output goes through
// premultipliedOutput or encodedOutput, because SurfaceCanvas's pipeline
// re-encodes fragments and a bare output lands too dark where it is
// translucent (decisions.md #72).
//
// Lit text is the albedo, so coat highlights, sheen and film land on the
// text too. Unlit text keeps its page color under any light
// (docs/materials-research.md §3).
//
// Ownership: this module builds the node graph. MaterialFinishesSurface
// owns the raw capture view and writes the finish's values before each draw.

import * as THREE from 'three'
import { MeshPhysicalNodeMaterial, type Node, type TextureNode, type UniformNode } from 'three/webgpu'
import { Discard, float, Fn, output, sRGBTransferEOTF, sRGBTransferOETF, uv, vec4 } from 'three/tsl'
import { encodedOutput, premultipliedOutput } from '@petepetrash/munari'
import type { Finish, TextLighting } from './materialFinishesTuning'

// Below this coverage a fragment writes nothing visible; Surface.LitMaterial
// discards at the same value.
const DISCARD_ALPHA = 0.004

export interface FinishMaterialInputs {
  /** A raw (NoColorSpace) view of the capture: encoded, premultiplied. */
  readonly capture: TextureNode
  /** Corner coverage from useSurfaceNodes().radiusMask(). */
  readonly cornerMask: Node<'float'>
  /** Body color in linear light; THREE.Color decodes the hex on write. */
  readonly body: UniformNode<'color', THREE.Color>
}

export function createFinishMaterial({ capture, cornerMask, body }: FinishMaterialInputs, text: TextLighting): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial({ transparent: true, depthWrite: false, premultipliedAlpha: true })
  // SAFETY: a texture sample is a vec4; three's types return a bare Node.
  const page = capture.sample(uv()) as Node<'vec4'>
  const uncovered = float(1).sub(page.a)

  if (text === 'lit') {
    // SAFETY: three declares this TSL function's layout as vec3 to vec3; its
    // published types leave the result untyped.
    const bodyEncoded = sRGBTransferOETF(body) as Node<'vec3'>
    // SAFETY: as above, vec3 to vec3.
    const albedo = sRGBTransferEOTF(page.rgb.add(bodyEncoded.mul(uncovered))) as Node<'vec3'>
    material.colorNode = vec4(albedo, 1)
    material.outputNode = Fn(() => {
      const covered = output.mul(cornerMask)
      Discard(covered.a.lessThan(DISCARD_ALPHA))
      return premultipliedOutput(covered)
    })()
    return material
  }

  material.colorNode = vec4(body, 1)
  material.outputNode = Fn(() => {
    // The canvas stores 0..1, so a highlight clips before the composite
    // rather than bleeding into the text's antialiased edge.
    // SAFETY: as above, vec3 to vec3.
    const litBody = sRGBTransferOETF(output.rgb.saturate()) as Node<'vec3'>
    const covered = vec4(page.rgb.add(litBody.mul(uncovered)), 1).mul(cornerMask)
    Discard(covered.a.lessThan(DISCARD_ALPHA))
    return encodedOutput(covered)
  })()
  return material
}

/** Write a finish's values. Crossing zero on a lobe recompiles; other writes are uniform updates. */
export function writeFinish(material: MeshPhysicalNodeMaterial, body: UniformNode<'color', THREE.Color>, finish: Finish): void {
  body.value.set(finish.color)
  material.roughness = finish.roughness
  material.metalness = finish.metalness
  material.ior = finish.ior
  material.clearcoat = finish.clearcoat
  material.clearcoatRoughness = finish.clearcoatRoughness
  material.sheen = finish.sheen
  material.sheenColor.set(finish.sheenColor)
  material.sheenRoughness = finish.sheenRoughness
  material.anisotropy = finish.anisotropy
  material.anisotropyRotation = finish.anisotropyRotation
  material.iridescence = finish.iridescence
  material.iridescenceIOR = finish.iridescenceIOR
  // Without a thickness map, three reads the range's upper bound as the film thickness.
  material.iridescenceThicknessRange[1] = finish.iridescenceThickness
}
