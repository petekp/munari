// match-DOM placement — the world transform that puts a unit plane exactly
// where a page box is.
//
// The law: the plane is placed IN FRONT OF THE CAMERA, facing it, at a
// chosen distance, and sized from the camera's own frustum at that
// distance. It is not unprojected onto some scene plane. The difference
// shows up the moment the camera moves: an unprojected quad slides against
// the page box it is matching, because the page box is a screen fact and
// the scene plane is a world fact. Anchoring to the camera makes the match
// exact for every camera pose by construction, and leaves `distance` as the
// only thing a caller can get wrong — it decides what the Surface occludes
// and is occluded by, nothing else.
//
// The transform chain the browser reports is checked before any of this
// runs. `composeMatchableChain` admits translation and positive scale and
// rejects rotation, skew, mirroring, and 3D transforms, because those
// cannot be expressed by placing an axis-aligned plane and the failure is
// invisible: the Surface renders, in the wrong place, with no error.

import * as THREE from 'three'
import { composeMatchableChain, rectToNdc, type RectLike, type ViewportLike } from '@munari/core'

/** Where the plane sits relative to the camera, in world units. */
export const MATCH_DOM_DISTANCE = 1

export interface MatchDomResult {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  /** For a `PlaneGeometry(1, 1)`. */
  scale: THREE.Vector3
}

const _forward = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()

/**
 * Place a unit plane over `rect`, expressed in `viewport` (the canvas box).
 *
 * `out` is mutated and returned — this runs per frame for every match-DOM
 * Surface on the page, and allocating three vectors and a quaternion per
 * Surface per frame is a garbage-collection pause during exactly the
 * scroll the placement exists to track.
 */
export function matchDomTransform(
  camera: THREE.Camera,
  rect: RectLike,
  viewport: ViewportLike,
  distance: number,
  out: MatchDomResult,
): MatchDomResult {
  const ndc = rectToNdc(rect, viewport)

  camera.updateMatrixWorld()
  out.quaternion.setFromRotationMatrix(camera.matrixWorld)
  _forward.set(0, 0, -1).applyQuaternion(out.quaternion)
  _right.set(1, 0, 0).applyQuaternion(out.quaternion)
  _up.set(0, 1, 0).applyQuaternion(out.quaternion)

  let frustumW: number
  let frustumH: number
  // SAFETY: three's own brand fields, checked before any camera-specific
  // member is read. They are safe across duplicate module copies, where
  // `instanceof` is not, and r3f types the store's camera as the base class
  // so there is nothing narrower to ask first.
  const perspective = camera as THREE.PerspectiveCamera
  // SAFETY: the same brand check, for the other camera kind — read only
  // after `isOrthographicCamera` is true below.
  const orthographic = camera as THREE.OrthographicCamera
  if (perspective.isPerspectiveCamera) {
    frustumH = 2 * distance * Math.tan((perspective.fov * Math.PI) / 360)
    frustumW = frustumH * perspective.aspect
  } else if (orthographic.isOrthographicCamera) {
    const zoom = orthographic.zoom || 1
    frustumW = (orthographic.right - orthographic.left) / zoom
    frustumH = (orthographic.top - orthographic.bottom) / zoom
  } else {
    frustumW = 2
    frustumH = 2
  }

  out.position
    .copy(camera.position)
    .addScaledVector(_forward, distance)
    .addScaledVector(_right, (ndc.x * frustumW) / 2)
    .addScaledVector(_up, (ndc.y * frustumH) / 2)
  out.scale.set(ndc.halfWidth * frustumW, ndc.halfHeight * frustumH, 1)
  return out
}

/**
 * Check the transform chain above a matched page box, and report the first
 * link this placement cannot honor.
 *
 * Reported once per element rather than per frame: this runs from the frame
 * loop, and a rotated ancestor is a standing condition, so a per-frame
 * message would bury every other diagnostic in the console within a second.
 * `getComputedStyle` is only read while the chain is still unknown.
 */
export function reportUnmatchableChain(
  element: HTMLElement,
  report: (error: Error) => void,
): void {
  if (checked.has(element)) return
  checked.add(element)
  const chain: string[] = []
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    chain.unshift(getComputedStyle(node).transform)
  }
  if (composeMatchableChain(chain) !== null) return
  report(
    new Error(
      'munari: a <Surface.DOM> holder sits under a transform this placement ' +
        'cannot match. Translation and positive scale are matchable; rotation, ' +
        'skew, mirroring, and any 3D transform are not — the Surface will render ' +
        'in the wrong place with nothing else to say so.',
    ),
  )
}

// Weak, so an element that leaves the document takes its entry with it —
// this would otherwise retain every holder a long-lived page ever mounted.
const checked = new WeakSet<HTMLElement>()

export function createMatchDomResult(): MatchDomResult {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
  }
}
