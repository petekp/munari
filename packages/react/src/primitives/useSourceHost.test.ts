// @vitest-environment happy-dom
//
// The declared size of a source host is not decoration: `drawElementImage`
// rasterizes the host at its own layout box, so whatever the host says it
// is, is the size of the next capture. That makes WHEN the size reaches
// the DOM a correctness question, not a performance one.
//
// Written from a passive effect it reaches the DOM after paint. A consumer
// resizing a Surface then photographs the old box and stretches it over
// the new geometry for one frame, and a commit React chose to defer can
// land a stale size on top of a fresher write the consumer made inside
// its own pointer event. In the knobs lab that read as the controls on
// the painted face sliding against the hardware standing on them.
//
// Getting a discriminator right took two tries. `flushSync` is NOT one:
// it flushes pending passive effects before it returns, so the size looks
// current either way. What separates the two is the commit phase itself.
// Layout effects run children first, so a PARENT's layout effect runs
// after the host has had its turn in that same commit — and sees the new
// size only if the write happened in the commit rather than after paint.
//
// No JSX here: the runner only discovers `.test.ts`, and one hook's
// contract is not worth widening test discovery across the workspace.
import { createElement, useEffect, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useSourceHost } from './useSourceHost'

// `act` flushes everything, which would erase the distinction under test.
// These renders are driven by hand instead.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false

interface Size {
  w: string
  h: string
}

let container: HTMLElement
let parked: HTMLElement
let root: ReturnType<typeof createRoot>
/** What the host measured during each commit, recorded from the parent. */
let inCommit: (Size | null)[]

const hostSize = (): Size | null => {
  const node = parked.firstElementChild as HTMLElement | null
  return node ? { w: node.style.width, h: node.style.height } : null
}

function Harness({ w, h }: { w: number; h: number }) {
  const { mount } = useSourceHost({ width: w, height: h, className: 'ui-root' })
  useEffect(() => mount(parked), [mount])
  return null
}

function Observer({ w, h }: { w: number; h: number }) {
  // No dependency list: every commit gets looked at.
  useLayoutEffect(() => {
    inCommit.push(hostSize())
  })
  return createElement(Harness, { w, h })
}

const render = (w: number, h: number) => flushSync(() => root.render(createElement(Observer, { w, h })))

beforeEach(() => {
  container = document.createElement('div')
  parked = document.createElement('div')
  document.body.append(container, parked)
  root = createRoot(container)
  inCommit = []
  // Two passes: the first commits the tree, the second lets the pending
  // passive effect run `mount`, which is what creates the host at all.
  render(100, 50)
  render(100, 50)
})

afterEach(() => {
  flushSync(() => root.unmount())
  container.remove()
  parked.remove()
})

describe('the source host declares its size before the frame that uses it', () => {
  it('exists, sized, as soon as it is mounted', () => {
    expect(hostSize()).toEqual({ w: '100px', h: '50px' })
  })

  it('a new size is already in the DOM during the commit that changed it', () => {
    // The whole contract. With a passive effect this reads 100px: the
    // capture taken from that frame is the old box stretched over the
    // new geometry.
    render(200, 80)
    expect(inCommit.at(-1)).toEqual({ w: '200px', h: '80px' })
  })

  it('every step of a drag lands in its own commit, so no capture is a step behind', () => {
    // A resize is not one jump. Each intermediate size gets a frame, and
    // each of those frames is rasterized at the host's box.
    for (const w of [212, 224, 236, 248, 260]) {
      render(w, 80)
      expect(inCommit.at(-1)?.w).toBe(`${w}px`)
    }
  })

  it('a re-render that changes nothing leaves the size alone', () => {
    render(240, 90)
    render(240, 90)
    expect(inCommit.at(-1)).toEqual({ w: '240px', h: '90px' })
    expect(hostSize()).toEqual({ w: '240px', h: '90px' })
  })
})
