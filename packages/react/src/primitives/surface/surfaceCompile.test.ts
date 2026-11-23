import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { passMaterials } from './surfaceCompile'

const drawState = (material: THREE.Material) => ({
  colorWrite: material.colorWrite,
  depthWrite: material.depthWrite,
  stencilWrite: material.stencilWrite,
  side: material.side,
})

describe('passMaterials', () => {
  it('builds an opaque material as authored and write-free', () => {
    const states = passMaterials(new THREE.MeshBasicMaterial()).map(drawState)
    expect(states).toEqual([
      { colorWrite: true, depthWrite: true, stencilWrite: false, side: THREE.FrontSide },
      { colorWrite: false, depthWrite: false, stencilWrite: false, side: THREE.FrontSide },
    ])
  })

  it('builds a material born without color writes with color on too', () => {
    const material = new THREE.MeshBasicMaterial({ depthWrite: false })
    material.colorWrite = false
    const states = passMaterials(material).map(drawState)
    expect(states).toEqual([
      { colorWrite: false, depthWrite: false, stencilWrite: false, side: THREE.FrontSide },
      { colorWrite: true, depthWrite: false, stencilWrite: false, side: THREE.FrontSide },
    ])
  })

  it('builds each pass of a transparent double-sided material as a single side', () => {
    const material = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false })
    const sides = passMaterials(material).map((clone) => clone.side)
    expect(sides).toEqual([THREE.BackSide, THREE.FrontSide, THREE.BackSide, THREE.FrontSide])
  })

  it('builds a double-sided material forced to one pass as double-sided', () => {
    const material = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, forceSinglePass: true })
    expect(passMaterials(material).map((clone) => clone.side)).toEqual([THREE.DoubleSide, THREE.DoubleSide])
  })
})
