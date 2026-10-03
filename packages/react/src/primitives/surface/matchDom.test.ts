// match-DOM placement — screen rectangles round-trip through both cameras.
//
// The result is checked at its four corners. A center-only test cannot see a
// wrong frustum scale, and that fault produces a plane in the right place at
// the wrong size with no renderer error.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createMatchDomResult, matchDomTransform } from './matchDom'

// Client rectangles include the canvas origin and CSS scale. R3F's logical
// size alone cannot place a page box inside an inset or scrolling renderer.
describe('match-DOM canvas client coordinates', () => {
  for (const orthographic of [false, true]) {
    for (const canvas of [
      { left: 23, top: 285.859375, width: 344, height: 272 },
      { left: -32, top: -420, width: 801, height: 603 },
      { left: 113.5, top: 81.25, width: 801 * 1.4, height: 603 * 0.8 },
    ]) {
      it(`matches four corners in ${orthographic ? 'orthographic' : 'perspective'} canvas at ${canvas.left},${canvas.top}`, () => {
        const camera = orthographic
          ? new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 100)
          : new THREE.PerspectiveCamera(47, 801 / 603, 0.1, 100)
        // Zoom divides an orthographic frustum, so a zoom of 1 would hide a
        // placement that ignored it.
        if (camera instanceof THREE.OrthographicCamera) camera.zoom = 1.7
        camera.position.set(1, -2, 6)
        camera.lookAt(0, 0, 0)
        camera.updateProjectionMatrix()
        const content = {
          left: canvas.left + canvas.width * 0.2,
          top: canvas.top + canvas.height * 0.3,
          width: canvas.width * 0.4,
          height: canvas.height * 0.25,
        }
        const result = matchDomTransform(camera, content, canvas, 2.4, createMatchDomResult())
        const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => {
          const point = new THREE.Vector3(x, y, 0).multiply(result.scale).applyQuaternion(result.quaternion).add(result.position).project(camera)
          return { x: canvas.left + (point.x + 1) * canvas.width / 2, y: canvas.top + (1 - point.y) * canvas.height / 2 }
        })
        expect(Math.min(...corners.map(point => point.x))).toBeCloseTo(content.left, 5)
        expect(Math.max(...corners.map(point => point.x))).toBeCloseTo(content.left + content.width, 5)
        expect(Math.min(...corners.map(point => point.y))).toBeCloseTo(content.top, 5)
        expect(Math.max(...corners.map(point => point.y))).toBeCloseTo(content.top + content.height, 5)
      })
    }
  }
})
