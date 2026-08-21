import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { deformSurfaceGeometry } from './surfaceDeform'

const W = 300
const H = 352

describe('the callback speaks content coordinates', () => {
  it('an identity place restores the flat plane exactly', () => {
    const geometry = new THREE.PlaneGeometry(W, H, 3, 5)
    const fresh = new THREE.PlaneGeometry(W, H, 3, 5)
    // Scramble first, so identity is proven to REWRITE, not to skip.
    deformSurfaceGeometry(geometry, [W, H], (x, y) => ({ x: x + 40, y: y - 25, z: 7 }))
    deformSurfaceGeometry(geometry, [W, H], (x, y) => ({ x, y }))
    const a = geometry.getAttribute('position')
    const b = fresh.getAttribute('position')
    // Attributes store float32: round-tripping through uv·size costs a few
    // ulp against the plane's own construction. 1e-4 px is far under any
    // raycast's or texel's notice.
    for (let i = 0; i < a.count; i++) {
      expect(a.getX(i)).toBeCloseTo(b.getX(i), 4)
      expect(a.getY(i)).toBeCloseTo(b.getY(i), 4)
      expect(a.getZ(i)).toBeCloseTo(b.getZ(i), 4)
    }
  })

  it('content y runs DOWN from the top-left: the top edge is y=0, not uv.y=0', () => {
    const geometry = new THREE.PlaneGeometry(W, H, 1, 1)
    const seen: Array<[number, number]> = []
    deformSurfaceGeometry(geometry, [W, H], (x, y) => {
      seen.push([x, y])
      return { x, y }
    })
    // A plane's four corners, in content px — the uv flip is this
    // helper's whole reason to exist, so the corners are pinned.
    expect(seen).toContainEqual([0, 0])
    expect(seen).toContainEqual([W, 0])
    expect(seen).toContainEqual([0, H])
    expect(seen).toContainEqual([W, H])
  })

  it('a displaced content point lands at the mirrored local position', () => {
    const geometry = new THREE.PlaneGeometry(W, H, 1, 1)
    // Every point stands 10px further DOWN the content…
    deformSurfaceGeometry(geometry, [W, H], (x, y) => ({ x, y: y + 10 }))
    const pos = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')
    for (let i = 0; i < pos.count; i++) {
      const flatLocalY = H / 2 - (1 - uv.getY(i)) * H
      // …which is 10 world units further down in three's y-up space.
      expect(pos.getY(i)).toBeCloseTo(flatLocalY - 10, 10)
    }
  })

  it('z defaults to 0 and a returned z is honored', () => {
    const geometry = new THREE.PlaneGeometry(W, H, 1, 1)
    deformSurfaceGeometry(geometry, [W, H], (x, y, i) => ({ x, y, z: i === 0 ? 5 : undefined }))
    const pos = geometry.getAttribute('position')
    expect(pos.getZ(0)).toBe(5)
    expect(pos.getZ(1)).toBe(0)
  })
})

describe('the mechanism owns the raycast footguns', () => {
  it('drops the cached bounding sphere so the next raycast measures current vertices', () => {
    const geometry = new THREE.PlaneGeometry(W, H, 1, 1)
    geometry.computeBoundingSphere()
    expect(geometry.boundingSphere).not.toBeNull()
    deformSurfaceGeometry(geometry, [W, H], (x, y) => ({ x, y }))
    expect(geometry.boundingSphere).toBeNull()
  })

  it('marks the position attribute for upload', () => {
    const geometry = new THREE.PlaneGeometry(W, H, 1, 1)
    const position = geometry.getAttribute('position')
    if (!(position instanceof THREE.BufferAttribute)) throw new Error('plane lost its attribute')
    const before = position.version
    deformSurfaceGeometry(geometry, [W, H], (x, y) => ({ x, y }))
    expect(position.version).toBeGreaterThan(before)
  })

  it('leaves the uv attribute untouched — uv is the source address, not the pose', () => {
    const geometry = new THREE.PlaneGeometry(W, H, 2, 2)
    const fresh = new THREE.PlaneGeometry(W, H, 2, 2)
    deformSurfaceGeometry(geometry, [W, H], (x, y) => ({ x: x * 2, y: y * 2 }))
    const a = geometry.getAttribute('uv')
    const b = fresh.getAttribute('uv')
    for (let i = 0; i < a.count; i++) {
      expect(a.getX(i)).toBe(b.getX(i))
      expect(a.getY(i)).toBe(b.getY(i))
    }
  })

  it('refuses a geometry it cannot deform in place', () => {
    const geometry = new THREE.PlaneGeometry(W, H, 1, 1)
    geometry.deleteAttribute('uv')
    expect(() => deformSurfaceGeometry(geometry, [W, H], (x, y) => ({ x, y }))).toThrow(
      /plain position and uv/,
    )
  })
})
