// match-DOM placement — screen rectangles round-trip through both cameras.
//
// The result is checked at its four corners. A center-only test cannot see a
// wrong frustum scale, and that fault produces a plane in the right place at
// the wrong size with no renderer error.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createMatchDomResult, matchDomTransform } from './matchDom'

const viewport = { width: 801, height: 603 }
const rect = { left: 113.25, top: 79.5, width: 287.75, height: 191.125 }

function screenCorners(camera: THREE.Camera) {
  const match = matchDomTransform(camera, rect, viewport, 2.4, createMatchDomResult())
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ] as const
  return corners.map(([x, y]) => {
    const world = new THREE.Vector3(x, y, 0)
      .multiply(match.scale)
      .applyQuaternion(match.quaternion)
      .add(match.position)
      .project(camera)
    return {
      x: ((world.x + 1) * viewport.width) / 2,
      y: ((1 - world.y) * viewport.height) / 2,
    }
  })
}

function expectRect(corners: ReturnType<typeof screenCorners>) {
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  expect(Math.min(...xs)).toBeCloseTo(rect.left, 5)
  expect(Math.max(...xs)).toBeCloseTo(rect.left + rect.width, 5)
  expect(Math.min(...ys)).toBeCloseTo(rect.top, 5)
  expect(Math.max(...ys)).toBeCloseTo(rect.top + rect.height, 5)
}

describe('match-DOM camera projection', () => {
  it('round-trips fractional corners through a perspective camera', () => {
    const camera = new THREE.PerspectiveCamera(47, viewport.width / viewport.height, 0.1, 100)
    camera.position.set(2, 1, 6)
    camera.lookAt(-1, 0.5, 0)
    expectRect(screenCorners(camera))
  })

  it('round-trips fractional corners through an orthographic camera', () => {
    const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 100)
    camera.zoom = 1.7
    camera.position.set(-2, 3, 8)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    expectRect(screenCorners(camera))
  })

  it('uses CSS viewport units at DPR 1 and 3', () => {
    const camera = new THREE.PerspectiveCamera(50, viewport.width / viewport.height, 0.1, 100)
    camera.position.z = 5
    for (const dpr of [1, 3]) {
      const corners = screenCorners(camera).map((corner) => ({
        x: (corner.x * dpr) / dpr,
        y: (corner.y * dpr) / dpr,
      }))
      expectRect(corners)
    }
  })
})
