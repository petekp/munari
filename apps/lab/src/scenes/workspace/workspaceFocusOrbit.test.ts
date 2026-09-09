// @vitest-environment happy-dom
// Real OrbitControls receives the first press during a focus tween. Proxy
// projection follows its change events through damping, without stepping it twice.
import { createElement, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { _roots, context, createRoot as createCanvasRoot } from '@react-three/fiber'
import { FocusScene, useFocusScene } from '@petepetrash/munari'
import { OrbitControls } from 'three-stdlib'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusOrbitRig, type FocusRigApi } from './recipe/FocusOrbitRig'

const mounted: Array<{ root: Root; container: HTMLElement; canvas: HTMLCanvasElement; controls: OrbitControls }> = []
afterEach(() => {
  for (const item of mounted.splice(0)) {
    flushSync(() => item.root.unmount())
    item.controls.dispose(); item.container.remove(); item.canvas.remove(); _roots.delete(item.canvas)
  }
  vi.restoreAllMocks()
})

function scene() {
  const canvas = document.createElement('canvas')
  Object.defineProperties(canvas, {
    clientWidth: { value: 800 }, clientHeight: { value: 600 },
    setPointerCapture: { value() {} }, releasePointerCapture: { value() {} },
  })
  document.body.append(canvas)
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 100)
  camera.position.set(0, 2, 5)
  // Connect first: the regression depends on OrbitControls registering its
  // bubble listener before the rig installs its cancellation listener.
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  createCanvasRoot(canvas)
  const frameStore = _roots.get(canvas)?.store
  if (!frameStore) throw new Error('R3F did not create its store')
  const renderer = { domElement: canvas }
  // SAFETY: FocusScene and the rig only read gl.domElement. This store is
  // never configured or rendered, so no WebGLRenderer method is reached.
  frameStore.setState({ camera, controls, gl: renderer as THREE.WebGLRenderer })
  const api: RefObject<FocusRigApi | null> = { current: null }
  const focus: RefObject<ReturnType<typeof useFocusScene>> = { current: null }
  function ReadFocus() { focus.current = useFocusScene(); return null }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container, canvas, controls })
  flushSync(() => root.render(createElement(context.Provider, { value: frameStore },
    createElement(FocusScene, null,
      createElement(FocusOrbitRig, { home: { position: [0, 2, 5], target: [0, 1, 0] }, apiRef: api }),
      createElement(ReadFocus),
    ),
  )))
  const focusApi = focus.current
  if (!focusApi || !api.current) throw new Error('The focus rig did not mount')
  const sync = vi.spyOn(focusApi, 'syncProxyRects')
  const frame = () => {
    // Drei owns this one update at priority -1, before the rig's frame.
    const changed = controls.enabled ? controls.update() : false
    for (const subscription of frameStore.getState().internal.subscribers) subscription.ref.current(frameStore.getState(), 1 / 60)
    return changed
  }
  frame(); frame(); sync.mockClear()
  const pointer = (type: string, x: number, y: number) => {
    const target = type === 'pointermove' ? document : canvas
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y }))
  }
  return { canvas, camera, controls, api: api.current, sync, frame, pointer }
}

describe('focus camera gesture ownership', () => {
  it('lets the first pointer drag take over an active tween', () => {
    const view = scene()
    view.api.approach(new THREE.Vector3(2, 1, -2), new THREE.Vector3(0, 0, 1))
    view.frame()
    expect(view.controls.enabled).toBe(false)
    view.pointer('pointerdown', 400, 300)
    expect(view.controls.enabled).toBe(true)
    const grabbed = view.camera.position.clone()
    view.pointer('pointermove', 500, 300)
    expect(view.camera.position.distanceTo(grabbed)).toBeGreaterThan(0.1)
    view.pointer('pointerup', 500, 300)
  })

  it('lets the first wheel event take over an active tween', () => {
    const view = scene()
    view.api.home(new THREE.Vector3(2, 1, -2))
    view.frame()
    const distance = view.controls.getDistance()
    view.canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 }))
    expect(view.controls.enabled).toBe(true)
    expect(view.controls.getDistance()).not.toBe(distance)
  })

  it('allows a scene object to claim the same press after tween cancellation', () => {
    const view = scene()
    view.api.home(new THREE.Vector3(2, 1, -2))
    view.frame()
    const takeDrag = () => { view.controls.enabled = false }
    view.canvas.addEventListener('pointerdown', takeDrag)
    view.pointer('pointerdown', 400, 300)
    const grabbed = view.camera.position.clone()
    view.pointer('pointermove', 500, 300)
    view.frame()
    expect(view.controls.enabled).toBe(false)
    expect(view.camera.position.toArray()).toEqual(grabbed.toArray())
    view.pointer('pointerup', 500, 300)
    expect(view.controls.enabled).toBe(true)
    view.canvas.removeEventListener('pointerdown', takeDrag)
  })
})

it('projects proxies after orbit damping and leaves updates with the existing controls owner', () => {
  const view = scene()
  view.pointer('pointerdown', 400, 300)
  view.pointer('pointermove', 500, 320)
  for (let index = 0; index < 10; index++) view.frame()
  expect(view.sync).not.toHaveBeenCalled()
  view.pointer('pointerup', 500, 320)
  const atRelease = view.camera.position.clone()
  const update = vi.spyOn(view.controls, 'update')
  expect(view.frame()).toBe(true)
  expect(view.camera.position.toArray()).not.toEqual(atRelease.toArray())
  expect(view.sync).not.toHaveBeenCalled()
  for (let index = 0; index < 300; index++) view.frame()
  expect(update).toHaveBeenCalledTimes(301)
  expect(view.sync).toHaveBeenCalled()
  view.sync.mockClear()
  for (let index = 0; index < 20; index++) view.frame()
  expect(view.sync).not.toHaveBeenCalled()
})
