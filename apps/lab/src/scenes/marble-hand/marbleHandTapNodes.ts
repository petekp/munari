// Marble-hand tap nodes — one vertex bend, three materials and a shadow pass.
//
// The law: the sculpture, its cast shadow and its outline are the same
// stone. Whatever bends the drawn finger has to bend the depth pass and the
// stroke mask in the same frame, from the same uniform cells.
//
// The fault this prevents, 2026-08-31: a bend applied only to the visible
// material leaves a still shadow under a moving finger and a stroke that
// floats beside it. Both read as a rendering failure rather than motion,
// and neither appears in a screenshot of the hand alone.
//
// Ownership: marbleHandTapLaw.ts owns the per-vertex weights baked into
// `aTap` and the chain constants. This module owns the bend nodes and the
// shared uniform bag; the frame loop in MarbleHand.tsx owns what the five
// bend angles are at any moment.

import { Vector3, type Node } from 'three/webgpu'
import { Fn, If, attribute, cos, cross, dot, float, normalGeometry, positionGeometry, sin, uniformArray, vec3 } from 'three/tsl'
import {
  MARBLE_HAND_CHAIN_GAIN,
  MARBLE_HAND_HINGES,
  marbleHandChainPivot,
  type MarbleHandTapHinge,
} from './marbleHandTapLaw'

export interface MarbleHandTapUniforms {
  uTapBend: { value: number[] }
  uTapPivot: { value: Vector3[] }
  uTapPivot2: { value: Vector3[] }
  uTapAxis: { value: Vector3[] }
}

/**
 * One bag of uniform cells for every material that draws the hand. Each
 * material's uniform arrays read these same arrays on every render, so a
 * bend written here reaches all of them in the same frame.
 */
export function createMarbleHandTapUniforms(
  hinges: readonly MarbleHandTapHinge[] = MARBLE_HAND_HINGES,
): MarbleHandTapUniforms {
  return {
    uTapBend: { value: hinges.map(() => 0) },
    uTapPivot: { value: hinges.map((hinge) => new Vector3(...hinge.pivot)) },
    uTapPivot2: { value: hinges.map((hinge) => new Vector3(...marbleHandChainPivot(hinge))) },
    uTapAxis: { value: hinges.map((hinge) => new Vector3(...hinge.axis)) },
  }
}

export interface MarbleHandTapNodes {
  /** The bent local position, for a material's `positionNode`. Three's
   *  shadow pass reuses `positionNode`, so the cast shadow bends too. */
  readonly position: Node<'vec3'>
  /** The bent local normal. */
  readonly normal: Node<'vec3'>
}

// A zero angle is bit-exact identity here: cos is 1 and both other terms are
// multiplied by sin(0). A quiescent hand therefore renders the same pixels
// as an unbent one, which is what the gate's stillness clause reads.
function turn(value: Node<'vec3'>, axis: Node<'vec3'>, angle: Node<'float'>): Node<'vec3'> {
  const c = cos(angle)
  const s = sin(angle)
  return value.mul(c).add(cross(axis, value).mul(s)).add(axis.mul(dot(axis, value)).mul(float(1).sub(c)))
}

export function createMarbleHandTapNodes(tap: MarbleHandTapUniforms): MarbleHandTapNodes {
  const bend = uniformArray<'float'>(tap.uTapBend.value, 'float')
  const pivots = uniformArray<'vec3'>(tap.uTapPivot.value, 'vec3')
  const pivots2 = uniformArray<'vec3'>(tap.uTapPivot2.value, 'vec3')
  const axes = uniformArray<'vec3'>(tap.uTapAxis.value, 'vec3')
  const weights = attribute<'vec3'>('aTap', 'vec3')

  // Must run inside an Fn: it declares shader variables.
  const pose = () => {
    const pivot = vec3(0).toVar()
    const pivot2 = vec3(0).toVar()
    const axis = vec3(0, 0, 1).toVar()
    const angle = float(0).toVar()
    const angle2 = float(0).toVar()
    for (let finger = 0; finger < MARBLE_HAND_HINGES.length; finger++) {
      If(weights.x.sub(finger).abs().lessThanEqual(0.5), () => {
        pivot.assign(pivots.element(finger))
        pivot2.assign(pivots2.element(finger))
        axis.assign(axes.element(finger))
        angle.assign(bend.element(finger).mul(weights.y))
        angle2.assign(bend.element(finger).mul(MARBLE_HAND_CHAIN_GAIN).mul(weights.z))
      })
    }
    return { pivot, pivot2, axis, angle, angle2 }
  }

  // The distal joint turns first, about its own pivot; the knuckle turn then
  // carries pivot, joint and finger together. This order is what makes the
  // composition a chain rather than two independent swings.
  const position = Fn(() => {
    const { pivot, pivot2, axis, angle, angle2 } = pose()
    const distal = pivot2.add(turn(positionGeometry.sub(pivot2), axis, angle2))
    return pivot.add(turn(distal.sub(pivot), axis, angle))
  })()

  const normal = Fn(() => {
    const { axis, angle, angle2 } = pose()
    return turn(normalGeometry, axis, angle.add(angle2))
  })()

  return { position, normal }
}
