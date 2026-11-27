// Finish scatter — key light that scatters under a translucent surface such
// as wax, which three has no term for (finishKeyLight.ts), emitted by the
// finish itself.
//
// Its own chunk, loaded when a finish first uses scatter (finishLayerCode.ts).

import { type Node } from 'three/webgpu'
import { clamp, dot, float, max, normalize, positionView } from 'three/tsl'

import type { KeySheenUniforms } from './finishKeyLight'

// Scatter under a wax surface: the wrap reaches this far past the shading's
// terminator (0 is plain Lambert), and light that enters the face leaks out
// through the thin rounded edge at this share. By eye, unmeasured.
const SCATTER_WRAP = 0.6
const SCATTER_EDGE_LEAK = 1.2

/**
 * Key light that scatters under a translucent surface: the part a wrapped
 * diffuse reaches past Lambert, plus what enters through the face and leaks
 * out through the thin rounded edge. Wax is colored by how far light
 * travels in it, so the scattered light carries the body color squared,
 * scaled back to the body's brightest channel.
 */
export function keyScatter(
  normal: Node<'vec3'>,
  face: Node<'vec3'>,
  towardRim: Node<'float'>,
  body: Node<'vec3'>,
  weight: Node<'float'>,
  key: KeySheenUniforms,
): Node<'vec3'> {
  const toKey = key.position.sub(positionView)
  const toLight = normalize(toKey)
  const irradiance = key.intensity.div(dot(toKey, toKey))
  const dotNL = dot(normal, toLight)
  const wrapped = clamp(dotNL.add(SCATTER_WRAP).div(1 + SCATTER_WRAP), float(0), float(1))
  const beyondLambert = wrapped.sub(clamp(dotNL, float(0), float(1)))
  const leak = clamp(dot(face, toLight), float(0), float(1)).mul(towardRim.mul(towardRim)).mul(SCATTER_EDGE_LEAK)
  const deep = body.mul(body).div(max(max(max(body.x, body.y), body.z), float(1e-3)))
  return deep.mul(irradiance).mul(beyondLambert.add(leak)).mul(weight.div(Math.PI))
}
