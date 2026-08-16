// Reading a geometry's own vertex data back out.
//
// three describes an attribute as "plain or interleaved" and its storage as
// "some typed array", because a caller may hand it either. The scenes in this
// lab hand it neither: every geometry here is one three built (a plane, an
// extrusion) or one this lab set from a Float32Array. Both helpers ask the
// question rather than assume the answer, so a geometry that ever stops being
// what we think it is fails visibly at the call site instead of quietly
// writing through the wrong view.

import * as THREE from 'three'

/** The attribute under `name`, if it is a plain (non-interleaved) one. */
export function plainAttribute(
  geometry: THREE.BufferGeometry,
  name: string,
): THREE.BufferAttribute | undefined {
  const attribute = geometry.getAttribute(name)
  return attribute instanceof THREE.BufferAttribute ? attribute : undefined
}

/** An attribute's storage, if it holds floats. */
export function floatData(attribute: THREE.BufferAttribute): Float32Array | undefined {
  return attribute.array instanceof Float32Array ? attribute.array : undefined
}
