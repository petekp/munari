import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { markSurfaceMesh, sceneMeshCovers } from './surfaceOcclusion'

const unmark: Array<() => void> = []
const canvas = { clock: { elapsedTime: 1 }, raycaster: new THREE.Raycaster() }

afterEach(() => {
  for (const release of unmark.splice(0)) release()
})

function surfaceAt(z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial())
  mesh.position.z = z
  unmark.push(markSurfaceMesh(mesh, () => canvas))
  return mesh
}

function propAt(z: number, material: THREE.Material | THREE.Material[] = new THREE.MeshBasicMaterial()): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), material)
  mesh.position.z = z
  return mesh
}

function rayDown(): THREE.Raycaster {
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1))
  raycaster.camera = new THREE.PerspectiveCamera()
  return raycaster
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

  it('covers only where the hit material group is visible', () => {
    const scene = new THREE.Scene()
    const surface = surfaceAt(0)
    const faces = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial())
    const facingRay = faces[4]
    if (!facingRay) throw new Error('a box has no +z face material')
    facingRay.visible = false
    scene.add(surface, propAt(2, faces))
    expect(covers(scene, surface)).toBe(false)
    facingRay.visible = true
    canvas.clock.elapsedTime += 1 / 60
    expect(covers(scene, surface)).toBe(true)
  })

  it('does not cover the Surface with points, lines or sprites', () => {
    const scene = new THREE.Scene()
    const surface = surfaceAt(0)
    const near = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1, 0, 2), new THREE.Vector3(1, 0, 2)])
    const sprite = new THREE.Sprite()
    sprite.position.z = 3
    scene.add(surface, new THREE.Points(near), new THREE.Line(near), sprite)
    expect(covers(scene, surface)).toBe(false)
  })

  it('covers a farther Surface after a nearer one asked along the same ray', () => {
    const scene = new THREE.Scene()
    const front = surfaceAt(3)
    const back = surfaceAt(0)
    scene.add(front, propAt(1.5), back)
    scene.updateMatrixWorld()
    const raycaster = rayDown()
    expect(sceneMeshCovers(front, raycaster, surfaceDistance(front, raycaster))).toBe(false)
    expect(sceneMeshCovers(back, raycaster, surfaceDistance(back, raycaster))).toBe(true)
  })

  it('reads a mesh that moved once R3F runs another frame', () => {
    const scene = new THREE.Scene()
    const surface = surfaceAt(0)
    const prop = propAt(-2)
    scene.add(surface, prop)
    const raycaster = rayDown()
    scene.updateMatrixWorld()
    const distance = surfaceDistance(surface, raycaster)
    expect(sceneMeshCovers(surface, raycaster, distance)).toBe(false)
    canvas.clock.elapsedTime += 1 / 60
    prop.position.z = 2
    scene.updateMatrixWorld()
    expect(sceneMeshCovers(surface, raycaster, distance)).toBe(true)
  })
})
