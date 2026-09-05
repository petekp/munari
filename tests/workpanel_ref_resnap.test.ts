// WorkPanel's inline ref called g.lookAt(LOOK_TARGET) on every commit,
// overwriting the drag's camera-facing orientation (g.lookAt(camera.x,
// g.position.y, camera.z)) whenever a focus/hover state change re-rendered
// the panel. These cases use three directly to show a re-fired ref flips
// the world direction away from camera-facing and toward LOOK_TARGET, and
// that the dragged position is unaffected (the defect is orientation).
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

const LOOK_TARGET = new THREE.Vector3(0, 1.7, 0)

describe('WorkPanel drag orientation re-snap', () => {
  it('a re-fired inline ref overwrites the drag camera-facing orientation', () => {
    const group = new THREE.Group()
    group.position.set(3.5, 2.36, -3.2)
    const cameraPos = new THREE.Vector3(0, 2.36, 6)
    group.lookAt(cameraPos.x, group.position.y, cameraPos.z)
    const afterDrag = group.getWorldDirection(new THREE.Vector3()).clone()
    const ref = (g: THREE.Group | null) => {
      if (g) g.lookAt(LOOK_TARGET.x, LOOK_TARGET.y, LOOK_TARGET.z)
    }
    ref(null)
    ref(group)
    const afterReRender = group.getWorldDirection(new THREE.Vector3()).clone()
    const toCamera = cameraPos.clone().sub(group.position).normalize()
    expect(afterReRender.distanceTo(afterDrag)).toBeGreaterThan(0.01)
    expect(afterDrag.dot(toCamera)).toBeGreaterThan(0.999)
    expect(afterReRender.dot(toCamera)).toBeLessThan(0.99)
  })

  it('a re-fired ref does not move the dragged position (orientation, not position)', () => {
    const group = new THREE.Group()
    const dragged = new THREE.Vector3(3.5, 2.36, -3.2)
    group.position.copy(dragged)
    const ref = (g: THREE.Group | null) => {
      if (g) g.lookAt(LOOK_TARGET.x, LOOK_TARGET.y, LOOK_TARGET.z)
    }
    ref(null)
    ref(group)
    expect(group.position.distanceTo(dragged)).toBeLessThan(1e-6)
  })
})
