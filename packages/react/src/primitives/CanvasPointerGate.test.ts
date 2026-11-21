// @vitest-environment happy-dom
// Confirmed contracts of CanvasPointerGate: target-only arming, cold-contact
// claim routing through release, duplicate cold-click suppression, and page-chrome precedence.
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { _roots, context, createRoot as createCanvasRoot, type RootState } from '@react-three/fiber'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasPointerGate } from './CanvasPointerGate'

const mounted: Array<{ root: Root; container: HTMLElement; canvas: HTMLCanvasElement }> = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const item of mounted.splice(0)) {
    flushSync(() => item.root.unmount())
    item.container.remove()
    _roots.delete(item.canvas)
  }
  document.body.innerHTML = ''
})

function mountGate(options: { topmost?: () => Element | null } = {}) {
  const canvas = document.createElement('canvas')
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 200, 200)
  document.body.append(canvas)

  createCanvasRoot(canvas)
  const store = _roots.get(canvas)?.store
  if (!store) throw new Error('R3F store was not created')

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()

  // Centered unit plane at z=0 spans roughly (78..122, 78..122) in a 200x200 viewport.
  const targetMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial())
  scene.add(targetMesh)

  const leftEvents: Event[] = []
  const renderer = { domElement: canvas }
  store.setState({
    // SAFETY: CanvasPointerGate reads only gl.domElement from the renderer state.
    gl: renderer as RootState['gl'],
    camera,
    scene,
    events: {
      priority: 1,
      enabled: true,
      compute: () => {},
      connected: canvas,
      handlers: {
        onClick: () => {},
        onContextMenu: () => {},
        onDoubleClick: () => {},
        onWheel: () => {},
        onPointerDown: () => {},
        onPointerUp: () => {},
        onPointerLeave: (event: Event) => {
          leftEvents.push(event)
        },
        onPointerMove: () => {},
        onPointerCancel: () => {},
        onLostPointerCapture: () => {},
      },
    },
  })

  document.elementFromPoint = options.topmost ?? (() => canvas)

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container, canvas })

  const render = (mountedGate: boolean) => {
    flushSync(() =>
      root.render(
        createElement(
          context.Provider,
          { value: store },
          mountedGate ? createElement(CanvasPointerGate, { isTarget: (obj) => obj === targetMesh }) : null,
        ),
      ),
    )
  }
  render(true)

  return { canvas, targetMesh, leftEvents, render }
}

describe('CanvasPointerGate', () => {
  it('arms pointerEvents over target geometry and clears solid state and cursor off target', () => {
    const { canvas } = mountGate()

    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 100, clientY: 100, pointerId: 1 }))
    expect(canvas.style.pointerEvents).toBe('auto')

    canvas.style.cursor = 'pointer'
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5, pointerId: 1 }))
    expect(canvas.style.pointerEvents).toBe('none')
    expect(canvas.style.cursor).toBe('')
  })

  it('routes cold pointerdown through off-canvas release and suppresses the duplicate cold click', async () => {
    const { canvas } = mountGate()
    const seen: string[] = []
    for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) {
      canvas.addEventListener(type, (event) => {
        if (event instanceof PointerEvent) seen.push(`${event.type}:${event.clientX}`)
      })
    }

    const pageTarget = document.createElement('div')
    document.body.append(pageTarget)

    pageTarget.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100, buttons: 1, pointerId: 7 }),
    )
    expect(seen).toEqual(['pointerdown:100'])
    expect(canvas.style.pointerEvents).toBe('auto')

    // Drag moves off the mesh and releases outside the canvas; claim delivers both to R3F.
    pageTarget.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: 300, clientY: 300, buttons: 1, pointerId: 7 }),
    )
    pageTarget.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: 300, clientY: 300, buttons: 0, pointerId: 7 }),
    )
    expect(seen).toEqual(['pointerdown:100', 'pointermove:300', 'pointerup:300'])

    await Promise.resolve()
    expect(canvas.style.pointerEvents).toBe('none')

    // Browser-synthesized click near the press spot is swallowed within the suppression window.
    let pageClicks = 0
    pageTarget.addEventListener('click', () => pageClicks++)
    pageTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 102, clientY: 101 }))
    expect(pageClicks).toBe(0)

    // Subsequent click after the window was consumed passes through.
    pageTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 102, clientY: 101 }))
    expect(pageClicks).toBe(1)
  })

  it('yields cold presses to page chrome painted above the canvas', () => {
    const overlay = document.createElement('button')
    document.body.append(overlay)
    const { canvas } = mountGate({ topmost: () => overlay })
    let routedDowns = 0
    canvas.addEventListener('pointerdown', () => routedDowns++)

    overlay.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100, buttons: 1, pointerId: 3 }),
    )
    expect(routedDowns).toBe(0)
  })

  it('restores gl.domElement pointerEvents when unmounted so pointerMode="scene" receives input again', () => {
    const { canvas, render } = mountGate()

    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5, pointerId: 1 }))
    expect(canvas.style.pointerEvents).toBe('none')

    render(false)
    expect(canvas.style.pointerEvents).toBe('')
  })
})
