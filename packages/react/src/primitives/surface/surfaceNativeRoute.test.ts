// @vitest-environment happy-dom
//
// The binding's half of the pointer-route law (decisions.md #39): observe,
// then apply. The kernel's suites pin the verdict and the pose; this one pins
// the two things only the binding can get wrong.
//
// First, planarity. It is the one condition read from three rather than from
// numbers, and a wrong "yes" does not fail loudly — the content still draws
// from the texture, so the panel looks right, and only the hit region has
// moved, to wherever a flat quad would have been. The measured cost of that
// class of miss is already on record (2026-08-20, gate:fisheye-pointer: 60px
// of displacement over 44px rows).
//
// Second, the duty order. Both routes speak through the same DOM and the relay
// reads the drawn root's UNTRANSFORMED layout box, so a handoff that re-armed
// the relay before parking the rig would read the transformed AABB and land
// the arrival hover somewhere else entirely. The law states the order; this is
// where the presenter is held to it.

import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { deformSurfaceGeometry } from './surfaceDeform'
import {
  createSurfaceRoute,
  materialIsDoubleSided,
  presentsUnitPlane,
  type SurfaceRouteRelayDuties,
  type SurfaceRouteStep,
} from './surfaceNativeRoute'

const CONTENT_W = 320
const CONTENT_H = 200

let mesh: THREE.Mesh
let camera: THREE.PerspectiveCamera
let glCanvas: HTMLCanvasElement
let parkedCanvas: HTMLCanvasElement
let root: HTMLElement
let called: string[]
let duties: SurfaceRouteRelayDuties

/** A pixel-calibrated camera, the way every lab scene sets one up. */
function calibrate(width: number, height: number) {
  const cam = new THREE.PerspectiveCamera(45, width / height, 1, 5000)
  cam.position.set(0, 0, height / 2 / Math.tan((45 * Math.PI) / 360))
  cam.updateMatrixWorld()
  cam.updateProjectionMatrix()
  return cam
}

beforeEach(() => {
  document.body.innerHTML = ''
  called = []
  duties = {
    closeRelay: () => called.push('closeRelay'),
    rearmRelay: () => called.push('rearmRelay'),
    bridgePage: () => called.push('bridgePage'),
  }

  mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CONTENT_W, CONTENT_H),
    new THREE.MeshBasicMaterial(),
  )
  mesh.updateWorldMatrix(true, false)
  camera = calibrate(800, 600)

  glCanvas = document.createElement('canvas')
  glCanvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
  parkedCanvas = document.createElement('canvas')
  parkedCanvas.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;'
  root = document.createElement('div')
  root.style.pointerEvents = 'auto'
  parkedCanvas.append(root)
  document.body.append(parkedCanvas, glCanvas)
})

function step(overrides: Partial<SurfaceRouteStep> = {}): SurfaceRouteStep {
  return {
    mesh,
    camera,
    glCanvas,
    parkedCanvas,
    root,
    request: 'auto',
    capable: true,
    hearing: true,
    mirrorU: false,
    contentWidth: CONTENT_W,
    contentHeight: CONTENT_H,
    authoredGeometry: false,
    authoredRaycast: false,
    ...overrides,
  }
}

/** Bend the mesh's plane in place, the way a scene's frame loop would. */
function deform() {
  deformSurfaceGeometry(mesh.geometry, [CONTENT_W, CONTENT_H], (x, y) => ({ x, y, z: x / 10 }))
}

describe('claiming planarity', () => {
  it('claims the library\'s own undeformed plane', () => {
    expect(presentsUnitPlane(mesh, false, false)).toBe(true)
  })

  it('refuses a geometry the scene supplied', () => {
    // However flat it happens to be. A geometry this library did not build is
    // one it cannot vouch for the next frame either — nothing stops the scene
    // rewriting the vertices without leaving a receipt.
    expect(presentsUnitPlane(mesh, true, false)).toBe(false)
  })

  it('refuses a scene that supplied its own raycast', () => {
    // An authored raycast is a hit POLICY — which points count as the Surface
    // — and the browser cannot be told to honor one. Riding anyway would make
    // the same Surface touchable in places the scene's own policy refuses,
    // depending on which route happens to own it.
    expect(presentsUnitPlane(mesh, false, true)).toBe(false)
  })

  it('refuses a plane whose vertices have moved', () => {
    // `deformSurfaceGeometry` stamps its marker on the geometry instance
    // (surfaceDeform.ts), and that stamp is the receipt. On the instance
    // rather than a prop or a version: a scene deforms the default plane
    // through a mesh ref (Slider does), and a version resets when a presenter
    // swap rebuilds the attribute. Checked as a receipt rather than a
    // tolerance on the vertices — a Surface bent by less than a tolerance is
    // still a Surface whose pointer lands in the wrong row.
    deform()
    expect(presentsUnitPlane(mesh, false, false)).toBe(false)
  })

  it('refuses a mesh with no position attribute at all', () => {
    const bare = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
    expect(presentsUnitPlane(bare, false, false)).toBe(false)
  })
})

describe('reading the material\'s side policy', () => {
  it('matches three\'s own raycast rule', () => {
    // Three's default mesh raycast refuses a back-facing hit under FrontSide,
    // and CSS `backface-visibility` is the only way to tell the browser the
    // same thing. Without this a Surface turned away keeps taking clicks
    // natively and stops taking them on the relay — the same Surface behaving
    // two ways depending on which route happens to own it.
    expect(materialIsDoubleSided(new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial()))).toBe(false)
    const twoSided = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    expect(materialIsDoubleSided(new THREE.Mesh(mesh.geometry, twoSided))).toBe(true)
  })

  it('takes the loosest answer across a material array', () => {
    const mixed = new THREE.Mesh(mesh.geometry, [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    ])
    expect(materialIsDoubleSided(mixed)).toBe(true)
  })
})

describe('applying the verdict', () => {
  it('rides the resting pose, and hands the browser the hit region', () => {
    const controller = createSurfaceRoute()
    const handoff = controller.step(step(), duties)

    expect(handoff.to).toBe('native')
    expect(controller.riding()).toBe(true)
    expect(parkedCanvas.style.visibility).toBe('hidden')
    expect(root.style.visibility).toBe('visible')
    // The pose goes on the CANVAS — its transformed box is the native hit
    // clip (platform.md #21) — and the drawn child stays identity.
    expect(parkedCanvas.style.transform.startsWith('matrix3d(')).toBe(true)
    expect(root.style.transform).toBe('')
    // Above the renderer canvas, and the cascade the relay depends on intact.
    expect(Number(parkedCanvas.style.zIndex)).toBeGreaterThan(0)
    expect(parkedCanvas.style.pointerEvents).toBe('none')
  })

  it('takes the relay when the caller did not ask for the other one', () => {
    const controller = createSurfaceRoute()

    expect(controller.step(step({ request: 'relay' }), duties).to).toBe('relay')
    expect(controller.riding()).toBe(false)
    expect(parkedCanvas.style.transform).toBe('')
  })

  it('takes the relay for a deformed Surface, and leaves nothing behind', () => {
    const controller = createSurfaceRoute()
    controller.step(step(), duties)
    called = []

    deform()
    const handoff = controller.step(step(), duties)

    expect(handoff.to).toBe('relay')
    expect(controller.riding()).toBe(false)
    expect(parkedCanvas.style.transform).toBe('')
    expect(parkedCanvas.style.visibility).toBe('')
  })

  it('parks before it re-arms the relay', () => {
    // The order the whole handoff exists to fix. `rearmRelay` forwards a move
    // at the pointer's last trusted place, and it derives that place from the
    // drawn root's bounding rect — which the transform on the parked canvas
    // ABOVE it distorts while the rig is riding. Re-arming first lands the
    // arrival hover on the wrong element and looks like a rounding bug.
    const controller = createSurfaceRoute()
    controller.step(step(), duties)
    called = []

    let transformWhenRearmed: string | null = null
    controller.step(step({ request: 'relay' }), {
      ...duties,
      rearmRelay: () => {
        transformWhenRearmed = parkedCanvas.style.transform
        called.push('rearmRelay')
      },
    })

    expect(called).toEqual(['rearmRelay'])
    expect(transformWhenRearmed).toBe('')
  })

  it('closes the relay before it lifts the rig', () => {
    const controller = createSurfaceRoute()
    controller.step(step({ request: 'relay' }), duties)
    called = []

    let ridingWhenClosed: boolean | null = null
    controller.step(step(), {
      ...duties,
      closeRelay: () => {
        ridingWhenClosed = controller.riding()
        called.push('closeRelay')
      },
    })

    expect(called).toEqual(['closeRelay'])
    expect(ridingWhenClosed).toBe(false)
  })

  it('parks and bridges when the page takes the pixels back', () => {
    const controller = createSurfaceRoute()
    controller.step(step(), duties)
    called = []

    const handoff = controller.step(step({ hearing: false }), duties)

    expect(handoff.to).toBe('page')
    expect(called).toEqual(['bridgePage'])
    expect(controller.riding()).toBe(false)
    expect(parkedCanvas.style.transform).toBe('')
  })

  it('runs no duty on a frame that changed nothing', () => {
    // A Surface at rest holds one route for as long as nobody touches it. A
    // handoff per frame would cancel a live press every frame.
    const controller = createSurfaceRoute()
    controller.step(step(), duties)
    called = []

    for (let i = 0; i < 4; i++) expect(controller.step(step(), duties).moved).toBe(false)

    expect(called).toEqual([])
  })

  it('writes no style on a frame that moved nothing', () => {
    // Every inline write invalidates style on the parked subtree, and the
    // compositor self-paints on mutation (platform.md #2) — so a rig that
    // restated the same pose every frame would cost a paint per frame on
    // content nobody changed, which is the idle-zero gate's whole subject.
    const controller = createSurfaceRoute()
    controller.step(step(), duties)
    const settled = parkedCanvas.style.transform

    let writes = 0
    const watch = new MutationObserver(() => {})
    watch.observe(parkedCanvas, { attributes: true, subtree: true, attributeFilter: ['style'] })
    for (let i = 0; i < 4; i++) controller.step(step(), duties)
    writes = watch.takeRecords().length
    watch.disconnect()

    expect(writes).toBe(0)
    expect(parkedCanvas.style.transform).toBe(settled)
  })

  it('parks when its source goes away', () => {
    const controller = createSurfaceRoute()
    controller.step(step(), duties)

    controller.step(step({ parkedCanvas: null, root: null }), duties)

    expect(controller.riding()).toBe(false)
    expect(parkedCanvas.style.transform).toBe('')
    expect(parkedCanvas.style.visibility).toBe('')
  })

  it('keeps a second presenter of the same source on the relay while the first rides', () => {
    // Two presenters of one source share ONE parked element, and each
    // computes its own pose. Both riding would mean each frame's last writer
    // wins and the hit region teleports between the two copies. First to lift
    // holds the canvas until it parks; the other's native request quietly
    // stays on the relay — and engages once the canvas is free.
    const first = createSurfaceRoute()
    const second = createSurfaceRoute()
    first.step(step(), duties)
    expect(first.riding()).toBe(true)

    expect(second.step(step(), duties).to).toBe('relay')
    expect(second.riding()).toBe(false)

    first.step(step({ request: 'relay' }), duties)
    expect(second.step(step(), duties).to).toBe('native')
  })

  it('parks on release, consulting no law', () => {
    // Teardown is not a route change. An unmounting presenter has no verdict
    // to reach and must still put the DOM back.
    const controller = createSurfaceRoute()
    controller.step(step(), duties)

    controller.release()

    expect(controller.riding()).toBe(false)
    expect(controller.route()).toBe('page')
    expect(parkedCanvas.style.visibility).toBe('')
  })
})
