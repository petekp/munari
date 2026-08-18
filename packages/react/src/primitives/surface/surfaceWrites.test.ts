import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyPassWrites,
  authoredWrites,
  restoreAuthoredWrites,
  type SurfaceMaterialWrites,
} from './surfaceWrites'

// One warm-up then one presenting pass, which is the sequence every
// exclusive handoff runs at least once.
const twoPasses = (material: SurfaceMaterialWrites) => {
  const slot = authoredWrites()
  applyPassWrites(slot, material, false)
  const warmUp = { ...material }
  restoreAuthoredWrites(slot)
  const betweenPasses = { ...material }
  applyPassWrites(slot, material, true)
  const presenting = { ...material }
  restoreAuthoredWrites(slot)
  return { warmUp, betweenPasses, presenting, after: { ...material } }
}

describe('pass writes', () => {
  it('a warm-up disables all three writes', () => {
    const material = new THREE.MeshBasicMaterial()
    const { warmUp } = twoPasses(material)
    expect(warmUp.colorWrite).toBe(false)
    expect(warmUp.depthWrite).toBe(false)
    expect(warmUp.stencilWrite).toBe(false)
  })

  it('restores a default material exactly', () => {
    const material = new THREE.MeshBasicMaterial()
    const authored = {
      colorWrite: material.colorWrite,
      depthWrite: material.depthWrite,
      stencilWrite: material.stencilWrite,
    }
    const { betweenPasses, after } = twoPasses(material)
    expect(betweenPasses).toMatchObject(authored)
    expect(after).toMatchObject(authored)
  })

  // The fault this module exists for: the old warm-up wrote `false` onto
  // the material and read the next pass's value back out of it, so depth
  // never came back and the Surface stopped sorting against the scene.
  it('a presenting pass writes depth again after a warm-up', () => {
    const material = new THREE.MeshBasicMaterial()
    const { presenting, after } = twoPasses(material)
    expect(presenting.depthWrite).toBe(true)
    expect(after.depthWrite).toBe(true)
  })

  it('a stencil-writing material keeps its stencil across a warm-up', () => {
    const material = new THREE.MeshStandardMaterial()
    material.stencilWrite = true
    material.stencilRef = 3
    const { warmUp, presenting, after } = twoPasses(material)
    expect(warmUp.stencilWrite).toBe(false)
    expect(presenting.stencilWrite).toBe(true)
    expect(after.stencilWrite).toBe(true)
    expect(material.stencilRef).toBe(3)
  })

  // An authored `false` is the caller's decision about their own scene —
  // a transparent overlay that must not occlude what is behind it — and a
  // presenting pass may not turn it back on.
  it('never enables a write the caller disabled', () => {
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
    const { warmUp, presenting, after } = twoPasses(material)
    expect(warmUp.depthWrite).toBe(false)
    expect(presenting.depthWrite).toBe(false)
    expect(after.depthWrite).toBe(false)
  })

  it('a custom material with color off stays off through a presenting pass', () => {
    const material = new THREE.ShaderMaterial()
    material.colorWrite = false
    const { presenting, after } = twoPasses(material)
    expect(presenting.colorWrite).toBe(false)
    expect(after.colorWrite).toBe(false)
  })

  // Two meshes drawn in one frame share one material instance in three's
  // own render loop; the second borrow must not capture the first's
  // borrowed values as if they were authored.
  it('overlapping presenters restore the same material once each', () => {
    const material = new THREE.MeshBasicMaterial()
    const first = authoredWrites()
    const second = authoredWrites()
    applyPassWrites(first, material, false)
    restoreAuthoredWrites(first)
    applyPassWrites(second, material, false)
    restoreAuthoredWrites(second)
    expect(material.colorWrite).toBe(true)
    expect(material.depthWrite).toBe(true)
    expect(material.stencilWrite).toBe(false)
  })

  it('a second restore does not undo a value written in between', () => {
    const material = new THREE.MeshBasicMaterial()
    const slot = authoredWrites()
    applyPassWrites(slot, material, false)
    restoreAuthoredWrites(slot)
    material.depthWrite = false
    restoreAuthoredWrites(slot)
    expect(material.depthWrite).toBe(false)
  })

  it('restores nothing when no pass was taken', () => {
    const slot = authoredWrites()
    expect(() => restoreAuthoredWrites(slot)).not.toThrow()
  })
})
