// Marble-hand tap patch — one vertex chunk, four programs.
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
// `aTap` and the chain constants. This module owns the GLSL and the shared
// uniform bag; the frame loop in MarbleHand.tsx owns what the five bend
// angles are at any moment.

import { Vector3, type WebGLProgramParametersWithUniforms } from 'three'
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
 * One bag of uniform cells for every program that draws the hand. Passing a
 * fresh bag per material would leave three of the four reading stale angles.
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

const HINGE_COUNT = MARBLE_HAND_HINGES.length

// A zero angle is bit-exact identity here: cos is 1 and both other terms are
// multiplied by sin(0). A quiescent hand therefore renders the same pixels
// as an unpatched program, which is what the gate's stillness clause reads.
const TAP_COMMON = /* glsl */`
attribute vec3 aTap;
uniform float uTapBend[${HINGE_COUNT}];
uniform vec3 uTapPivot[${HINGE_COUNT}];
uniform vec3 uTapPivot2[${HINGE_COUNT}];
uniform vec3 uTapAxis[${HINGE_COUNT}];

void marbleHandTapPose(
  out vec3 pivot, out vec3 pivot2, out vec3 axis, out float angle, out float angle2
) {
  pivot = vec3(0.0);
  pivot2 = vec3(0.0);
  axis = vec3(0.0, 0.0, 1.0);
  angle = 0.0;
  angle2 = 0.0;
  // Constant iterations. A dynamic index into a uniform array is not a
  // constant expression in GLSL ES 1.00; a loop counter is.
  for (int finger = 0; finger < ${HINGE_COUNT}; finger++) {
    if (abs(aTap.x - float(finger)) > 0.5) continue;
    pivot = uTapPivot[finger];
    pivot2 = uTapPivot2[finger];
    axis = uTapAxis[finger];
    angle = uTapBend[finger] * aTap.y;
    angle2 = uTapBend[finger] * float(${MARBLE_HAND_CHAIN_GAIN}) * aTap.z;
  }
}

vec3 marbleHandTapTurn(vec3 value, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return value * c + cross(axis, value) * s + axis * dot(axis, value) * (1.0 - c);
}
`

const TAP_NORMAL = /* glsl */`
{
  vec3 mhTapPivot;
  vec3 mhTapPivot2;
  vec3 mhTapAxis;
  float mhTapAngle;
  float mhTapAngle2;
  marbleHandTapPose(mhTapPivot, mhTapPivot2, mhTapAxis, mhTapAngle, mhTapAngle2);
  objectNormal = marbleHandTapTurn(objectNormal, mhTapAxis, mhTapAngle + mhTapAngle2);
  #ifdef USE_TANGENT
    objectTangent = marbleHandTapTurn(objectTangent, mhTapAxis, mhTapAngle + mhTapAngle2);
  #endif
}
`

// The distal joint turns first, about its own pivot; the knuckle turn then
// carries pivot, joint and finger together. This order is what makes the
// composition a chain rather than two independent swings.
const TAP_POSITION = /* glsl */`
{
  vec3 mhTapPivot;
  vec3 mhTapPivot2;
  vec3 mhTapAxis;
  float mhTapAngle;
  float mhTapAngle2;
  marbleHandTapPose(mhTapPivot, mhTapPivot2, mhTapAxis, mhTapAngle, mhTapAngle2);
  transformed = mhTapPivot2 + marbleHandTapTurn(transformed - mhTapPivot2, mhTapAxis, mhTapAngle2);
  transformed = mhTapPivot + marbleHandTapTurn(transformed - mhTapPivot, mhTapAxis, mhTapAngle);
}
`

/**
 * Adds the finger bend to one compiled program. Basic and depth materials
 * omit `beginnormal_vertex` unless they need normals, so that replacement
 * is allowed to find nothing.
 */
export function addMarbleHandTap(
  shader: WebGLProgramParametersWithUniforms,
  uniforms: MarbleHandTapUniforms,
) {
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${TAP_COMMON}`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${TAP_NORMAL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TAP_POSITION}`)
}

/** Every hand program carries the patch, so every cache key has to say so. */
export const MARBLE_HAND_TAP_PROGRAM_KEY = 'tap-v2'
