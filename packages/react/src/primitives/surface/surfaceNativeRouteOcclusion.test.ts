// @vitest-environment happy-dom

import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { surfaceHitRegion } from './surfaceHitRegion'
import { markSurfaceMesh } from './surfaceOcclusion'
import {
  createSurfaceRoute,
  registerSurfacePlane,
  type SurfaceRouteRelayDuties,
  type SurfaceRouteStep,
} from './surfaceNativeRoute'

const CONTENT_W = 320
const CONTENT_H = 200

let mesh: THREE.Mesh
let camera: THREE.PerspectiveCamera
let glCanvas: HTMLCanvasElement
let host: HTMLCanvasElement
let root: HTMLElement
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
  duties = { closeRelay: () => {}, rearmRelay: () => {}, bridgePage: () => {} }

  mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CONTENT_W, CONTENT_H),
    new THREE.MeshBasicMaterial(),
  )
  registerSurfacePlane(mesh.geometry)
  mesh.updateWorldMatrix(true, false)
  camera = calibrate(800, 600)

  glCanvas = document.createElement('canvas')
  glCanvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
  host = document.createElement('canvas')
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;'
  root = document.createElement('div')
  root.style.pointerEvents = 'auto'
  host.append(root)
  document.body.append(host, glCanvas)
})

function step(overrides: Partial<SurfaceRouteStep> = {}): SurfaceRouteStep {
  return {
    mesh,
    camera,
    glCanvas,
    host,
    root,
    request: 'auto',
    capable: true,
    hearing: true,
    pointerEvents: 'geometry',
    contentWidth: CONTENT_W,
    contentHeight: CONTENT_H,
    authoredGeometry: false,
    authoredRaycast: false,
    pointer: null,
    ...overrides,
  }
}

describe('a scene mesh in front of the Surface', () => {
  const CENTER = { x: 400, y: 300, buttons: 0 }
  const BESIDE = { x: 540, y: 300, buttons: 0 }
  let releaseMark: () => void

  beforeEach(() => {
    const scene = new THREE.Scene()
    const prop = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 40), new THREE.MeshBasicMaterial())
    prop.position.z = 100
    scene.add(mesh, prop)
    scene.updateMatrixWorld()
    const canvas = { clock: { elapsedTime: 1 }, raycaster: new THREE.Raycaster() }
    releaseMark = markSurfaceMesh(mesh, () => canvas)
  })

  afterEach(() => releaseMark())

  function trusted<T extends Event>(event: T): T {
    Object.defineProperty(event, 'isTrusted', { value: true })
    return event
  }

  it('relays where the mesh covers the pointer, and rides beside it', () => {
    const route = createSurfaceRoute()
    expect(route.step(step({ pointer: CENTER }), duties).to).toBe('relay')
    expect(route.step(step({ pointer: BESIDE }), duties).to).toBe('native')
    route.release()
  })

  it('keeps the route of a press in progress when the mesh comes between', () => {
    const route = createSurfaceRoute()
    route.step(step({ pointer: BESIDE }), duties)
    expect(route.step(step({ pointer: { ...CENTER, buttons: 1 } }), duties).to).toBe('native')
    route.release()
  })

  it('parks on the move that reaches the mesh, before the next press is hit-tested', () => {
    const route = createSurfaceRoute()
    route.step(step({ pointer: BESIDE }), duties)
    expect(route.riding()).toBe(true)
    root.dispatchEvent(trusted(new PointerEvent('pointermove', { bubbles: true, clientX: CENTER.x, clientY: CENTER.y })))
    expect(route.riding()).toBe(false)
    root.dispatchEvent(trusted(new PointerEvent('pointermove', { bubbles: true, clientX: BESIDE.x, clientY: BESIDE.y })))
    expect(route.riding()).toBe(true)
    route.release()
  })

  it('gives the scene a cold tap aimed through the mesh at the lifted HTML', () => {
    const route = createSurfaceRoute()
    route.step(step({ pointer: BESIDE }), duties)
    const heardByContent: string[] = []
    const heardByScene: string[] = []
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      root.addEventListener(type, (event) => heardByContent.push(event.type))
      glCanvas.addEventListener(type, (event) => heardByScene.push(event.type))
    }
    const at = { bubbles: true, cancelable: true, pointerId: 7, clientX: CENTER.x, clientY: CENTER.y }
    const press = trusted(new PointerEvent('pointerdown', { ...at, buttons: 1 }))
    root.dispatchEvent(press)
    expect(route.riding()).toBe(false)
    root.dispatchEvent(trusted(new PointerEvent('pointerup', at)))
    const click = trusted(new PointerEvent('click', { ...at, detail: 1 }))
    root.dispatchEvent(click)
    expect(press.defaultPrevented).toBe(true)
    expect(click.defaultPrevented).toBe(true)
    expect(heardByContent).toEqual([])
    expect(heardByScene).toEqual(['pointerdown', 'pointerup'])
    route.release()
  })

  it('leaves the next click alone once a press reached the content', () => {
    const route = createSurfaceRoute()
    route.step(step({ pointer: BESIDE }), duties)
    root.dispatchEvent(trusted(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, buttons: 1, clientX: CENTER.x, clientY: CENTER.y })))
    const heardByContent: string[] = []
    root.addEventListener('click', (event) => heardByContent.push(event.type))
    root.dispatchEvent(trusted(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, buttons: 1, clientX: BESIDE.x, clientY: BESIDE.y })))
    root.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: BESIDE.x, clientY: BESIDE.y })))
    expect(heardByContent).toEqual(['click'])
    route.release()
  })

  it('leaves a keyboard click alone after a covered tap was cancelled', () => {
    const route = createSurfaceRoute()
    route.step(step({ pointer: BESIDE }), duties)
    const at = { bubbles: true, cancelable: true, pointerId: 7, clientX: CENTER.x, clientY: CENTER.y }
    root.dispatchEvent(trusted(new PointerEvent('pointerdown', { ...at, buttons: 1 })))
    root.dispatchEvent(trusted(new PointerEvent('pointercancel', at)))
    const heardByContent: string[] = []
    root.addEventListener('click', (event) => heardByContent.push(event.type))
    root.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })))
    expect(heardByContent).toEqual(['click'])
    route.release()
  })

  it('relays a touch beside the mesh after a touch on it, and rides again after its click', () => {
    const route = createSurfaceRoute()
    mesh.raycast = surfaceHitRegion({
      hears: () => true,
      riding: () => route.riding(),
      authoredRaycast: () => undefined,
      pointerEvents: () => 'geometry',
      element: () => root,
      radii: () => [0, 0, 0, 0],
      size: () => [CONTENT_W, CONTENT_H],
    })
    expect(route.step(step({ pointer: CENTER }), duties).to).toBe('relay')
    const relayHits: number[] = []
    glCanvas.addEventListener('pointerdown', (event) => {
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2((event.clientX / 800) * 2 - 1, 1 - (event.clientY / 600) * 2), camera)
      relayHits.push(raycaster.intersectObject(mesh).length)
    })
    const at = { bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch', clientX: BESIDE.x, clientY: BESIDE.y }
    const press = trusted(new PointerEvent('pointerdown', { ...at, buttons: 1 }))
    glCanvas.dispatchEvent(press)
    expect(route.riding()).toBe(false)
    expect(press.defaultPrevented).toBe(false)
    expect(relayHits).toEqual([1])
    glCanvas.dispatchEvent(trusted(new PointerEvent('pointerup', at)))
    expect(route.step(step(), duties).to).toBe('relay')
    glCanvas.dispatchEvent(trusted(new PointerEvent('click', { ...at, detail: 1 })))
    expect(route.step(step(), duties).to).toBe('native')
    route.release()
  })

  it('rides again after a touch beside the mesh is cancelled', () => {
    const route = createSurfaceRoute()
    route.step(step({ pointer: CENTER }), duties)
    const at = { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', clientX: BESIDE.x, clientY: BESIDE.y }
    glCanvas.dispatchEvent(trusted(new PointerEvent('pointerdown', { ...at, buttons: 1 })))
    expect(route.step(step(), duties).to).toBe('relay')
    glCanvas.dispatchEvent(trusted(new PointerEvent('pointercancel', at)))
    expect(route.step(step(), duties).to).toBe('native')
    route.release()
  })
})
