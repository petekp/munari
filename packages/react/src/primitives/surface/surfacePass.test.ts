import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyPassWrites, authoredWrites } from './surfaceWrites'
import { beginSurfaceOutputDraw, beginSurfacePass, drawnByOverride, geometryDraws, readPassEvidence, surfaceOutputDrawCompleted } from './surfacePass'

describe('geometryDraws', () => {
  it('is false when the vertices, the draw range or the instance count leave nothing to draw', () => {
    expect(geometryDraws(new THREE.PlaneGeometry(1, 1))).toBe(true)

    const empty = new THREE.BufferGeometry()
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    expect(geometryDraws(empty)).toBe(false)

    const ranged = new THREE.PlaneGeometry(1, 1)
    ranged.setDrawRange(0, 0)
    expect(geometryDraws(ranged)).toBe(false)
    // The plane's index has 6 entries; a range starting past them is empty.
    ranged.setDrawRange(6, 3)
    expect(geometryDraws(ranged)).toBe(false)
    ranged.setDrawRange(3, 3)
    expect(geometryDraws(ranged)).toBe(true)

    const plane = new THREE.PlaneGeometry(1, 1)
    const instanced = new THREE.InstancedBufferGeometry()
    instanced.setIndex(plane.index)
    instanced.setAttribute('position', plane.getAttribute('position'))
    instanced.instanceCount = 0
    expect(geometryDraws(instanced)).toBe(false)
    instanced.instanceCount = 1
    expect(geometryDraws(instanced)).toBe(true)
  })
})

describe('drawnByOverride', () => {
  it('is true for the override material itself and for a material that allows override', () => {
    const scene = new THREE.Scene()
    const override = new THREE.MeshBasicMaterial()
    scene.overrideMaterial = override
    expect(drawnByOverride(scene, override)).toBe(true)

    const allowing = new THREE.MeshBasicMaterial()
    allowing.allowOverride = true
    expect(drawnByOverride(scene, allowing)).toBe(true)
  })

  it('is false for the mesh own material while an override is set', () => {
    const scene = new THREE.Scene()
    scene.overrideMaterial = new THREE.MeshBasicMaterial()
    const own = new THREE.MeshBasicMaterial()
    own.allowOverride = false
    expect(drawnByOverride(scene, own)).toBe(false)
  })

  it('is false when the scene has no override, even for a material that allows one', () => {
    const scene = new THREE.Scene()
    const allowing = new THREE.MeshBasicMaterial()
    allowing.allowOverride = true
    expect(drawnByOverride(scene, allowing)).toBe(false)
  })

  it('is false when the render root is not a Scene', () => {
    // A WebGLRenderer root can be any Object3D, and only a Scene has an override.
    const root = new THREE.Scene()
    const material = new THREE.MeshBasicMaterial()
    root.overrideMaterial = material
    Object.defineProperty(root, 'isScene', { value: false })
    expect(drawnByOverride(root, material)).toBe(false)
  })
})

describe('readPassEvidence', () => {
  it('names the default framebuffer by a null render target', () => {
    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshBasicMaterial()
    expect(readPassEvidence({ getRenderTarget: () => null }, geometry, material).defaultFramebuffer).toBe(true)
    expect(readPassEvidence({ getRenderTarget: () => new THREE.RenderTarget() }, geometry, material).defaultFramebuffer).toBe(false)
  })

  it('reports the write flags a borrowed pass will draw with, not the authored ones', () => {
    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshBasicMaterial()
    material.stencilWrite = true
    applyPassWrites(authoredWrites(), material, false)
    expect(readPassEvidence({ getRenderTarget: () => null }, geometry, material)).toEqual({
      defaultFramebuffer: true,
      colorWrite: false,
      depthWrite: false,
      stencilWrite: false,
      drawable: true,
    })
  })
})

describe('compositor output draws', () => {
  it('requires actual primitives from the same renderer call', () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial())
    const renderer = { getRenderTarget: () => null, info: { render: { calls: 1, triangles: 0, lines: 0, points: 0 } } }
    const draw = beginSurfaceOutputDraw(renderer, mesh, mesh.geometry)
    expect(surfaceOutputDrawCompleted(renderer, draw)).toBe(false)
    renderer.info.render.triangles = 2
    expect(surfaceOutputDrawCompleted(renderer, draw)).toBe(true)
    renderer.info.render.calls++
    expect(surfaceOutputDrawCompleted(renderer, draw)).toBe(false)
  })

  it('rejects zero mesh instances and incomplete triangle geometry', () => {
    const material = new THREE.MeshBasicMaterial()
    const empty = new THREE.InstancedMesh(new THREE.PlaneGeometry(), material, 0)
    const incomplete = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)), material)
    const renderer = { getRenderTarget: () => null, info: { render: { calls: 1, triangles: 0, lines: 0, points: 0 } } }
    const emptyDraw = beginSurfaceOutputDraw(renderer, empty, empty.geometry)
    const incompleteDraw = beginSurfaceOutputDraw(renderer, incomplete, incomplete.geometry)
    renderer.info.render.triangles = 4
    expect(surfaceOutputDrawCompleted(renderer, emptyDraw)).toBe(false)
    expect(surfaceOutputDrawCompleted(renderer, incompleteDraw)).toBe(false)
  })
})

describe('beginSurfacePass', () => {
  it('marks compile-only or unready passes non-drawable when no primitives advance', () => {
    const scene = new THREE.Scene()
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial())
    const renderer = {
      getRenderTarget: () => null,
      info: { render: { calls: 1, triangles: 6, lines: 0, points: 0 } },
    }

    const compilePass = beginSurfacePass(renderer, scene, mesh, mesh.geometry, mesh.material)
    expect(compilePass.finish(renderer).drawable).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(scene, 'onAfterRender')).toBe(false)

    const realPass = beginSurfacePass(renderer, scene, mesh, mesh.geometry, mesh.material)
    renderer.info.render.triangles += 2
    expect(realPass.finish(renderer).drawable).toBe(true)
  })

  it('refreshes the primitive baseline across nested shadow-map scene renders', () => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial())
    const renderer = {
      getRenderTarget: () => null,
      info: { render: { calls: 1, triangles: 0, lines: 0, points: 0 } },
    }
    // SAFETY: default Scene.onAfterRender is a no-op; our wrapper reads only `renderer.info`.
    const gl = renderer as THREE.WebGLRenderer

    // Shadow casters advance triangles before the outer mesh skipped its own draw.
    const skippedAfterShadow = beginSurfacePass(renderer, scene, mesh, mesh.geometry, mesh.material)
    renderer.info.render.calls++
    renderer.info.render.triangles += 12
    scene.onAfterRender(gl, scene, camera, mesh.geometry, mesh.material, new THREE.Group())
    expect(skippedAfterShadow.finish(renderer).drawable).toBe(false)

    // Shadow casters draw, then the lit mesh draws 2 triangles of its own.
    const drawnAfterShadow = beginSurfacePass(renderer, scene, mesh, mesh.geometry, mesh.material)
    renderer.info.render.calls++
    renderer.info.render.triangles += 12
    scene.onAfterRender(gl, scene, camera, mesh.geometry, mesh.material, new THREE.Group())
    renderer.info.render.triangles += 2
    expect(drawnAfterShadow.finish(renderer).drawable).toBe(true)
  })

  it('refreshes the primitive baseline across non-Scene nested renderer.render passes such as VSM blur quads', () => {
    const scene = new THREE.Scene()
    const ortho = new THREE.OrthographicCamera()
    const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial())
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial())
    const info = { render: { calls: 1, triangles: 0, lines: 0, points: 0 } }
    const renderer = {
      getRenderTarget: () => null,
      info,
      render(subRoot: THREE.Object3D, _cam: THREE.Camera) {
        if (subRoot === blurQuad) {
          info.render.calls++
          info.render.triangles += 2
        }
      },
    }
    const priorRender = renderer.render

    const skippedAfterBlur = beginSurfacePass(renderer, scene, mesh, mesh.geometry, mesh.material)
    renderer.render(blurQuad, ortho)
    expect(skippedAfterBlur.finish(renderer).drawable).toBe(false)
    expect(renderer.render).toBe(priorRender)

    const drawnAfterBlur = beginSurfacePass(renderer, scene, mesh, mesh.geometry, mesh.material)
    renderer.render(blurQuad, ortho)
    info.render.triangles += 2
    expect(drawnAfterBlur.finish(renderer).drawable).toBe(true)
    expect(renderer.render).toBe(priorRender)
  })

  it('rejects zero-count InstancedMesh even when geometry is non-empty', () => {
    const scene = new THREE.Scene()
    const material = new THREE.MeshBasicMaterial()
    const instanced = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, 0)
    const renderer = {
      getRenderTarget: () => null,
      info: { render: { calls: 1, triangles: 0, lines: 0, points: 0 } },
    }
    const pass = beginSurfacePass(renderer, scene, instanced, instanced.geometry, material)
    renderer.info.render.triangles += 2
    expect(pass.finish(renderer).drawable).toBe(false)
  })
})
