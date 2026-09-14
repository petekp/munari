// The camera contract: one world unit is one CSS pixel on EXACTLY
// ONE PLANE, z = 0. Every other plane is magnified by perspective;
// screenToPlane/carryToPlane/planeToScreen are the one place allowed
// to know the conversion.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  cameraDistance,
  carryToPlane,
  planeScale,
  planeToScreen,
  screenToPlane,
} from '@munari/core'

const VW = 1600
const VH = 1000
const FOV = 42
const CAM = cameraDistance(VH, FOV)
const RAISED_Z = 96

const _v = new THREE.Vector3()

describe('the pixel-perfect calibration', () => {
  it('puts the viewport on z = 0', () => {
    // At the calibrated distance, a world unit on
    // z = 0 is a CSS pixel, so the plane's half-height IS half the viewport.
    expect(CAM).toBeCloseTo(1302.54, 1)
    expect(planeScale(CAM, 0)).toBe(1)
  })

  it('magnifies a raised plane by about 8%', () => {
    expect(planeScale(CAM, RAISED_Z)).toBeCloseTo(1.0796, 4)
  })
})

describe('screenToPlane', () => {
  it('round-trips through the projection on z = 0', () => {
    for (const [x, y] of [
      [800, 500],
      [900, 405],
      [1500, 800],
      [12, 990],
    ] as const) {
      const s = planeToScreen(screenToPlane(x, y, VW, VH, CAM, 0, _v), VW, VH, CAM)
      expect(s.x).toBeCloseTo(x, 9)
      expect(s.y).toBeCloseTo(y, 9)
    }
  })

  it('round-trips on a raised plane — this is the bug', () => {
    // The shipped code used the z = 0 mapping for an object held at z = 96. That
    // is not an offset that a user could learn: it is a GAIN, so the error is
    // zero at the screen centre and grows with distance from it.
    for (const [x, y] of [
      [800, 500],
      [900, 405],
      [1500, 800],
      [12, 990],
    ] as const) {
      const s = planeToScreen(screenToPlane(x, y, VW, VH, CAM, RAISED_Z, _v), VW, VH, CAM)
      expect(s.x).toBeCloseTo(x, 9)
      expect(s.y).toBeCloseTo(y, 9)
    }
  })

  it('carryToPlane climbs a point without moving it on screen', () => {
    // Moving an anchor between planes must preserve its screen position. The
    // destination plane is also the plane used for texture-density demand.
    for (const [x, y, z] of [
      [220, -180, 12],
      [-600, 340, 55],
      [0, 0, 0],
      [700, 480, 96],
    ] as const) {
      const p = _v.set(x, y, z).clone()
      const before = planeToScreen(p, VW, VH, CAM)
      carryToPlane(p, CAM, RAISED_Z)
      const after = planeToScreen(p, VW, VH, CAM)
      expect(p.z).toBe(RAISED_Z)
      expect(after.x).toBeCloseTo(before.x, 9)
      expect(after.y).toBeCloseTo(before.y, 9)
    }
  })

  it('agrees with an actual three.js unprojected ray', () => {
    // The cheap division has to be the same answer the general method gives,
    // or the shortcut is a second source of truth.
    const cam = new THREE.PerspectiveCamera(FOV, VW / VH, 1, 4000)
    cam.position.set(0, 0, CAM)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld(true)
    cam.updateProjectionMatrix()

    const ray = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -RAISED_Z)
    for (const [x, y] of [
      [900, 405],
      [1500, 800],
      [12, 990],
    ] as const) {
      ray.setFromCamera(
        new THREE.Vector2((x / VW) * 2 - 1, -(y / VH) * 2 + 1),
        cam,
      )
      const hit = ray.ray.intersectPlane(plane, new THREE.Vector3())!
      const ours = screenToPlane(x, y, VW, VH, CAM, RAISED_Z, _v)
      expect(ours.x).toBeCloseTo(hit.x, 6)
      expect(ours.y).toBeCloseTo(hit.y, 6)
      expect(ours.z).toBeCloseTo(hit.z, 6)
    }
  })
})
