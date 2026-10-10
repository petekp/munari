// Hand stroke nodes — a CSS-pixel border around the rendered silhouette.
//
// The law: expand the screen mask, not the model. World-space shell width
// changes with camera distance; split wrist normals also open shell seams.
// The 2026-08-30 visibility request needs one continuous outer contour.
//
// Ownership: the stroke pass supplies a hand-only alpha mask and CSS pixel
// size. This material supplies coverage and color; no page pixels enter here.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type UniformNode } from 'three/webgpu'
import { Discard, Fn, If, Loop, cos, float, mix, sRGBTransferOETF, sin, texture, uniform, uv, varying, vec2, vec4 } from 'three/tsl'
import { encodedOutput } from '@petepetrash/munari'

/** The stroke's live values, written by the frame loop. */
export interface MarbleHandStrokeValues {
  /** The hand's padded screen box: (left, bottom, right, top) in 0..1, y up. */
  readonly bounds: UniformNode<'vec4', THREE.Vector4>
  readonly cssPixel: UniformNode<'vec2', THREE.Vector2>
  readonly width: UniformNode<'float', number>
  readonly color: UniformNode<'color', THREE.Color>
  readonly opacity: UniformNode<'float', number>
}

export function createMarbleHandStrokeValues(): MarbleHandStrokeValues {
  return {
    bounds: uniform(new THREE.Vector4(0, 0, 1, 1)),
    cssPixel: uniform(new THREE.Vector2()),
    width: uniform(0),
    color: uniform(new THREE.Color()),
    opacity: uniform(0),
  }
}

export function createMarbleHandStrokeMaterial(mask: THREE.Texture, v: MarbleHandStrokeValues): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
  })
  const screenUv = varying(mix(v.bounds.xy, v.bounds.zw, uv()))
  // Depth 0.5 is the middle of WebGPU's 0..1 range, so the quad never sits
  // on a clipping boundary. Depth is neither tested nor written.
  material.vertexNode = vec4(screenUv.mul(2).sub(1), 0.5, 1)

  const map = texture(mask)
  // The mask is a render target, which TSL samples with v = 0 at the top of
  // the image drawn into it (passMaterial). screenUv runs bottom-up.
  const handAlpha = (at: Node<'vec2'>): Node<'float'> => {
    const inside = at.x.greaterThanEqual(0).and(at.y.greaterThanEqual(0)).and(at.x.lessThanEqual(1)).and(at.y.lessThanEqual(1))
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    const sample = map.sample(vec2(at.x, float(1).sub(at.y))) as Node<'vec4'>
    return inside.select(sample.a, float(0))
  }

  material.outputNode = Fn(() => {
    const center = handAlpha(screenUv)
    Discard(center.greaterThanEqual(1))
    const expanded = center.toVar()
    // Thirty-two directions keep a 12px circle's angular error below 0.06px.
    // Inner rings keep thin fingertips inside a wide stroke. Small strokes
    // need only the outer ring, with mask filtering supplying edge coverage.
    for (let ring = 1; ring <= 4; ring++) {
      const sweep = () => {
        const radius = v.width.mul(ring * 0.25)
        Loop(32, ({ i }) => {
          const angle = float(i).mul(6.28318530718 / 32)
          const offset = vec2(cos(angle), sin(angle)).mul(v.cssPixel).mul(radius)
          expanded.assign(expanded.max(handAlpha(screenUv.add(offset))))
        })
      }
      if (ring < 4) If(v.width.greaterThan(2), sweep)
      else sweep()
    }
    const alpha = expanded.sub(center).max(0).mul(v.opacity)
    Discard(alpha.lessThanEqual(0))
    // The color in the canvas's sRGB encoding, premultiplied after the
    // encode, so encodedOutput lands it on the canvas unchanged.
    // SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
    // published types leave the result untyped.
    const encoded = sRGBTransferOETF(v.color) as Node<'vec3'>
    return encodedOutput(vec4(encoded.mul(alpha), alpha))
  })()
  return material
}
