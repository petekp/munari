// @vitest-environment happy-dom
// Drag release uses recent hand movement, then the real Dial force field.
// The React/R3F frame subscription below runs without a renderer or module mocks.
import { createElement, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { _roots, context, createRoot as createCanvasRoot, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { composeFields, damping, detentField } from '@munari/core'
import { afterEach, describe, expect, it } from 'vitest'
import { use1DOF } from './use1DOF'

const mounted: Array<{ root: Root; container: HTMLElement; canvas: HTMLCanvasElement }> = []
afterEach(() => { for (const item of mounted.splice(0)) { flushSync(() => item.root.unmount()); item.container.remove(); _roots.delete(item.canvas) } })

function control() {
  class CameraControls extends THREE.EventDispatcher { enabled = true }
  const controls = new CameraControls()
  const canvas = document.createElement('canvas')
  createCanvasRoot(canvas)
  const frameStore = _roots.get(canvas)?.store
  if (!frameStore) throw new Error('R3F did not create its store')
  const renderer = { domElement: canvas }
  // SAFETY: the unconfigured root stays inactive; its invalidation guard
  // only needs a non-null renderer and never calls a WebGL method.
  frameStore.setState({ controls, gl: renderer as THREE.WebGLRenderer })
  const result: RefObject<ReturnType<typeof use1DOF> | null> = { current: null }
  const field = composeFields(detentField(8, 50), damping(6))
  function Probe() {
    result.current = use1DOF({ field, localToQ: point => point.x })
    return null
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container, canvas })
  flushSync(() => root.render(createElement(context.Provider, { value: frameStore }, createElement(Probe))))
  const instance = result.current
  if (!instance) throw new Error('The control did not mount')
  const object = new THREE.Object3D()
  const event = (q: number, timeStamp: number): ThreeEvent<PointerEvent> => {
    const input = {
      eventObject: object,
      ray: new THREE.Ray(new THREE.Vector3(q, 0, 1), new THREE.Vector3(0, 0, -1)),
      stopPropagation() {}, target: null, pointerId: 1, timeStamp,
    }
    // SAFETY: the handlers read only the ray, object, target and event fields above.
    return input as ThreeEvent<PointerEvent>
  }
  return {
    ...instance,
    controls,
    down: (q: number, time: number) => instance.bind.onPointerDown(event(q, time)),
    move: (q: number, time: number) => instance.bind.onPointerMove(event(q, time)),
    up: (q: number, time: number) => instance.bind.onPointerUp(event(q, time)),
    frames(count: number) {
      for (let index = 0; index < count; index++) {
        for (const subscription of frameStore.getState().internal.subscribers) subscription.ref.current(frameStore.getState(), 1 / 60)
      }
    },
  }
}

function flick(hand: ReturnType<typeof control>) {
  hand.down(0, 0)
  hand.move(0.5, 10); hand.move(1, 20); hand.move(1.5, 30)
}

describe('release momentum', () => {
  it('settles in the released detent after a motionless one-second hold', () => {
    const hand = control()
    flick(hand)
    expect(hand.body.current.v).toBeGreaterThan(30)
    expect(hand.controls.enabled).toBe(false)
    hand.frames(60)
    hand.up(1.5, 1030)
    expect(Math.abs(hand.body.current.v)).toBeLessThan(1e-12)
    expect(hand.controls.enabled).toBe(true)
    hand.frames(600)
    expect(hand.body.current.q).toBeCloseTo(Math.PI / 2, 8)
  })

  it('keeps a quick flick and lets it cross detents after release', () => {
    const hand = control()
    flick(hand)
    const velocity = hand.body.current.v
    hand.up(1.5, 31)
    expect(hand.body.current.v).toBeGreaterThan(velocity * 0.9)
    hand.frames(600)
    expect(hand.body.current.q).toBeGreaterThan(Math.PI / 2 + Math.PI / 4)
  })

  it('drops stale velocity before a small movement resumes after a pause', () => {
    const hand = control()
    flick(hand)
    hand.move(1.501, 1030)
    hand.up(1.501, 1031)
    expect(Math.abs(hand.body.current.v)).toBeLessThan(0.001)
    hand.frames(600)
    expect(hand.body.current.q).toBeCloseTo(Math.PI / 2, 8)
  })

  it('drains momentum continuously as the release pause grows', () => {
    const velocities = [0, 5, 10, 20, 100, 1000].map(pause => {
      const hand = control()
      flick(hand)
      hand.up(1.5, 30 + pause)
      return hand.body.current.v
    })
    for (let index = 1; index < velocities.length; index++) {
      expect(velocities[index]).toBeLessThan(velocities[index - 1]!)
    }
    expect(velocities[0]).toBeGreaterThan(30)
    expect(velocities.at(-1)).toBeLessThan(1e-12)
  })
})
