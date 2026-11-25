import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { markSurfaceMesh, sceneMeshCovers } from './surfaceOcclusion'

const unmark: Array<() => void> = []

afterEach(() => {
  for (const release of unmark.splice(0)) release()
})

function surfaceAt(z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial())
  mesh.position.z = z
  unmark.push(markSurfaceMesh(mesh))
  return mesh
}

function propAt(z: number, material = new THREE.MeshBasicMaterial()): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), material)
  mesh.position.z = z
  return mesh
}

function rayDown(): THREE.Raycaster {
  return new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1))
}

function surfaceDistance(surface: THREE.Mesh, raycaster: THREE.Raycaster): number {
  const hits: THREE.Intersection[] = []
  THREE.Mesh.prototype.raycast.call(surface, raycaster, hits)
  const hit = hits[0]
  if (!hit) throw new Error('the test ray misses the Surface')
  return hit.distance
}

function covers(scene: THREE.Scene, surface: THREE.Mesh): boolean {
  scene.updateMatrixWorld()
  const raycaster = rayDown()
  return sceneMeshCovers(surface, raycaster, surfaceDistance(surface, raycaster))
}

describe('a mesh in front of a Surface', () => {
  it('covers the Surface when it is nearer and visible', () => {
    const scene = new THREE.Scene()
    const surface = surfaceAt(0)
    scene.add(surface, propAt(2))
    expect(covers(scene, surface)).toBe(true)
  })

  it('does not cover the Surface from behind it', () => {
    const scene = new THREE.Scene()
    const surface = surfaceAt(0)
    scene.add(surface, propAt(-2))
    expect(covers(scene, surface)).toBe(false)
  })

  it('does not cover the Surface with a no-op raycast', () => {
    const scene = new THREE.Scene()
    const surface = surfaceAt(0)
    const prop = propAt(2)
    prop.raycast = () => {}
    scene.add(surface, prop)
    expect(covers(scene, surface)).toBe(false)
  })

  it('does not cover the Surface while it or an ancestor is hidden', () => {
    const scene = new THREE.Scene()
    const surface = surfaceAt(0)
    const group = new THREE.Group()
    group.visible = false
    group.add(propAt(2))
    scene.add(surface, group, propAt(3, new THREE.MeshBasicMaterial({ visible: false })))
    expect(covers(scene, surface)).toBe(false)
  })

  it('does not cover its own Surface as a descendant, and covers another Surface', () => {
    const scene = new THREE.Scene()
    const front = surfaceAt(1)
    const overlay = propAt(1)
    front.add(overlay)
    const back = surfaceAt(-1)
    scene.add(front, back)
    expect(covers(scene, front)).toBe(false)
    expect(covers(scene, back)).toBe(true)
  })

  it('leaves a Surface in front of another Surface to the pointer route', () => {
    const scene = new THREE.Scene()
    const back = surfaceAt(0)
    scene.add(back, surfaceAt(2))
    expect(covers(scene, back)).toBe(false)
  })

  it('does not cover the Surface from its own plane', () => {
    const scene = new THREE.Scene()
    const surface = surfaceAt(0)
    const card = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial())
    scene.add(surface, card)
    expect(covers(scene, surface)).toBe(false)
  })

  it('reads a mesh that moved since the last event along the same ray', async () => {
    const scene = new THREE.Scene()
    const surface = surfaceAt(0)
    const prop = propAt(-2)
    scene.add(surface, prop)
    const raycaster = rayDown()
    scene.updateMatrixWorld()
    const distance = surfaceDistance(surface, raycaster)
    expect(sceneMeshCovers(surface, raycaster, distance)).toBe(false)
    await Promise.resolve()
    prop.position.z = 2
    scene.updateMatrixWorld()
    expect(sceneMeshCovers(surface, raycaster, distance)).toBe(true)
  })
})
