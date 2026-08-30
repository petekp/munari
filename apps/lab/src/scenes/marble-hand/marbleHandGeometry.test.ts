// Marble-hand asset contract — a fingertip pivot and a sealed wrist.
//
// The law: the index is a real vertex at local zero; the wrist ends at
// x=-215 with one closed cap whose faces point out of the hand.
//
// The fault, 2026-08-30: a reversed source axis removed 35 units from the
// index and gave the wrist the cursor hotspot. A fitted ellipse also left
// gaps around the cut. The corrected asset has a 66-vertex wrist contour.
//
// Ownership: make-marble-hand.mjs bakes the mesh. This suite reads the
// shipped STL so a correct hook cannot conceal a broken asset.

import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { Euler, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { marbleHandTuning as tune } from './marbleHandTuning'

const bytes = Uint8Array.from(readFileSync(
  new URL('../../../public/models/marble-hand/classical-hand.stl', import.meta.url),
))
const geometry = new STLLoader().parse(bytes.buffer)
const positions = geometry.getAttribute('position')
const triangles = Array.from({ length: positions.count / 3 }, (_, index) => [
  new Vector3().fromBufferAttribute(positions, index * 3),
  new Vector3().fromBufferAttribute(positions, index * 3 + 1),
  new Vector3().fromBufferAttribute(positions, index * 3 + 2),
] as const)

// These values match the dated crop in make-marble-hand.mjs. The weld
// precision absorbs float32 export noise without merging visible detail.
const WRIST_X = -215
const WELD_PRECISION = 10000
// MarbleHand.tsx uses a 42-degree pixel camera and clamps motion roll to
// 0.07 radians. Keep those authored bounds in the asset's pose contract.
const FOV = 42
const MAX_MOTION_ROLL = 0.07
// The 2026-08-30 vertex sweep measured 5.885px at the press extreme. Keep
// 5.8px clear so a pose change cannot put the curled fingers through paper.
const MIN_CLEARANCE_PX = 5.8

function vertexKey(point: Vector3): string {
  return [point.x, point.y, point.z]
    .map((value) => Math.round(value * WELD_PRECISION))
    .join(',')
}

function faceNormal(face: (typeof triangles)[number]): Vector3 {
  return face[1].clone().sub(face[0]).cross(face[2].clone().sub(face[0]))
}

const vertices = triangles.flat()
const sculptureRotation = new Matrix4().makeRotationFromEuler(
  new Euler(tune.sculptureRoll, tune.sculpturePitch, 0, 'YXZ'),
)
const poses: Matrix4[] = []
for (const pressPitch of [0, tune.pressPitch]) {
  for (const rx of [-tune.maxTilt, 0, tune.maxTilt]) {
    for (const ry of [-tune.maxTilt, 0, tune.maxTilt]) {
      for (const rz of [-MAX_MOTION_ROLL, 0, MAX_MOTION_ROLL]) {
        poses.push(new Matrix4()
          .makeRotationFromEuler(new Euler(rx + pressPitch, ry, tune.baseRotation + rz, 'XYZ'))
          .scale(new Vector3(tune.scale, tune.scale, tune.scale))
          .multiply(sculptureRotation))
      }
    }
  }
}

afterAll(() => geometry.dispose())

describe('the shipped marble-hand mesh', () => {
  it('puts the index vertex at zero and keeps the wrist at the opposite end', () => {
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.min.x).toBe(WRIST_X)
    expect(geometry.boundingBox?.max.x).toBe(0)

    const leadingVertices = vertices.filter((point) => point.x === 0)
    expect(leadingVertices.length).toBeGreaterThan(0)
    expect(new Set(leadingVertices.map(vertexKey))).toEqual(new Set(['0,0,0']))
  })

  it('seals the 66-point wrist contour with 64 outward-facing cap triangles', () => {
    const cap = triangles.filter((face) => face.every((point) => point.x === WRIST_X))
    expect(cap).toHaveLength(64)
    expect(new Set(cap.flat().map(vertexKey)).size).toBe(66)
    for (const face of cap) {
      expect(faceNormal(face).normalize().x).toBeCloseTo(-1, 12)
    }
  })

  it('has two opposite face uses per edge, with no open seam or collapsed triangle', () => {
    const edges = new Map<string, { uses: number; winding: number }>()
    for (const face of triangles) {
      expect(faceNormal(face).lengthSq()).toBeGreaterThan(0)
      for (let corner = 0; corner < 3; corner++) {
        const a = vertexKey(face[corner])
        const b = vertexKey(face[(corner + 1) % 3])
        expect(a).not.toBe(b)
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        const edge = edges.get(key) ?? { uses: 0, winding: 0 }
        edge.uses += 1
        edge.winding += a < b ? 1 : -1
        edges.set(key, edge)
      }
    }

    const broken = [...edges.entries()].filter(([, edge]) => edge.uses !== 2 || edge.winding !== 0)
    expect(broken).toEqual([])
  })
})

describe('the authored marble-hand pose', () => {
  it('keeps the stone at least 5.8 CSS pixels above the page through motion and press', () => {
    let clearance = Infinity
    const point = new Vector3()
    const height = Math.min(tune.heightPx, tune.pressHeightPx)
    for (const pose of poses) {
      for (const vertex of vertices) {
        point.copy(vertex).applyMatrix4(pose)
        clearance = Math.min(clearance, point.z + height)
      }
    }
    expect(clearance).toBeGreaterThanOrEqual(MIN_CLEARANCE_PX)
  })

  it('keeps the cut wrist to the right and below the index in screen-plane coordinates', () => {
    const wrist = new Map(vertices
      .filter((point) => point.x === WRIST_X)
      .map((point) => [vertexKey(point), point]))
    const center = [...wrist.values()]
      .reduce((sum, point) => sum.add(point), new Vector3())
      .divideScalar(wrist.size)
    for (const pose of poses) {
      const trailing = center.clone().applyMatrix4(pose)
      expect(trailing.x).toBeGreaterThan(0)
      expect(-trailing.y).toBeGreaterThan(0)
    }
  })

  it('projects the real tip onto the browser hotspot at both authored heights', () => {
    const tip = vertices.find((point) => point.x === 0 && point.y === 0 && point.z === 0)
    if (!tip) throw new Error('The shipped hand has no index vertex at local zero.')
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const distance = height / (2 * Math.tan(FOV * Math.PI / 360))
      const camera = new PerspectiveCamera(FOV, width / height, 1, distance * 3)
      camera.position.z = distance
      camera.updateMatrixWorld()
      for (const depth of [tune.heightPx, tune.pressHeightPx]) {
        const pageToDepth = (distance - depth) / distance
        for (const [x, y] of [[0, 0], [width / 2, height / 2], [width, height]]) {
          for (const pose of poses) {
            const world = pose.clone().setPosition(
              (x - width / 2) * pageToDepth,
              (height / 2 - y) * pageToDepth,
              depth,
            )
            const projected = tip.clone().applyMatrix4(world).project(camera)
            expect((projected.x + 1) * width / 2).toBeCloseTo(x, 9)
            expect((1 - projected.y) * height / 2).toBeCloseTo(y, 9)
          }
        }
      }
    }
  })
})
