// @vitest-environment happy-dom
//
// WorkPanel's root <group> used an inline ref callback that called
// g.lookAt(LOOK_TARGET). An inline arrow re-allocates every render, so
// React detaches (null) and re-attaches (node) the ref on every commit,
// re-running the lookAt and overwriting the drag's camera-facing
// orientation on the next focus/hover state change. These cases pin the
// churn, the useCallback stabilization that fixes it, the same-value bail
// that scopes the trigger, and the full mount-only-lookAt fix pattern.
import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { beforeEach, describe, expect, it } from 'vitest'

// React reads this global to decide whether renders must be wrapped in
// `act`. It is React's own contract, not ours, so it is declared rather
// than asserted onto globalThis at the point of use.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

const mount = (what: ReturnType<typeof createElement>): Root => {
  const root = createRoot(container)
  flushSync(() => root.render(what))
  return root
}

describe('WorkPanel root ref churn', () => {
  it('an inline ref is re-invoked (null, then node) on every re-render', () => {
    const calls: Array<HTMLElement | null> = []
    let bump = () => {}
    function Root() {
      const [, setN] = useState(0)
      bump = () => setN((x) => x + 1)
      return createElement('div', { ref: (el) => { calls.push(el) } })
    }
    const root = mount(createElement(Root))
    const initialNodes = calls.filter((x) => x !== null).length
    for (let i = 0; i < 3; i++) flushSync(() => bump())
    expect(calls.filter((x) => x === null).length).toBeGreaterThanOrEqual(3)
    expect(calls.filter((x) => x !== null).length).toBeGreaterThanOrEqual(initialNodes + 3)
    flushSync(() => root.unmount())
  })

  it('a useCallback-stabilized ref is not re-invoked on re-render', () => {
    const calls: Array<HTMLElement | null> = []
    let bump = () => {}
    function Root() {
      const [, setN] = useState(0)
      bump = () => setN((x) => x + 1)
      const stableRef = useCallback((el: HTMLElement | null) => { calls.push(el) }, [])
      return createElement('div', { ref: stableRef })
    }
    const root = mount(createElement(Root))
    const afterMount = calls.length
    for (let i = 0; i < 3; i++) flushSync(() => bump())
    expect(calls.length).toBe(afterMount)
    flushSync(() => root.unmount())
    expect(calls.filter((x) => x === null).length).toBeGreaterThanOrEqual(1)
  })

  it('a setState to the same value bails before commit and does not re-fire the ref', () => {
    const calls: Array<HTMLElement | null> = []
    let setHoverTrue = () => {}
    function Root() {
      const [, setHover] = useState(false)
      setHoverTrue = () => setHover(true)
      return createElement('div', { ref: (el) => { calls.push(el) } })
    }
    const root = mount(createElement(Root))
    flushSync(() => setHoverTrue())
    const afterChange = calls.length
    flushSync(() => setHoverTrue())
    expect(calls.length).toBe(afterChange)
    flushSync(() => root.unmount())
  })

  it('the fix pattern orients once on mount and survives focus re-renders', () => {
    const refCalls: Array<HTMLElement | null> = []
    const registerCalls: Array<string | null> = []
    const lookAtCalls: number[] = []

    class MockGroup {
      lookAt() {
        lookAtCalls.push(1)
      }
    }
    let toggleFocus = () => {}
    function FixedPanel({ id }: { id: string }) {
      const group = useRef<MockGroup | null>(null)
      const register = useCallback(
        (gid: string, g: MockGroup | null) => {
          registerCalls.push(g ? gid : null)
        },
        [],
      )
      const setGroup = useCallback(
        (node: HTMLElement | null) => {
          refCalls.push(node)
          group.current = node ? new MockGroup() : null
          register(id, group.current)
        },
        [id, register],
      )
      useEffect(() => {
        group.current?.lookAt()
      }, [])
      const [, setFocus] = useState<'none' | 'unit'>('none')
      toggleFocus = () => setFocus((f) => (f === 'none' ? 'unit' : 'none'))
      return createElement('div', { ref: setGroup })
    }
    const root = mount(createElement(FixedPanel, { id: 'panel-16' }))
    expect(refCalls.filter((x) => x !== null).length).toBe(1)
    expect(lookAtCalls.length).toBe(1)
    expect(registerCalls.filter((x) => x !== null).length).toBe(1)
    for (let i = 0; i < 4; i++) flushSync(() => toggleFocus())
    expect(refCalls.filter((x) => x !== null).length).toBe(1)
    expect(refCalls.filter((x) => x === null).length).toBe(0)
    expect(lookAtCalls.length).toBe(1)
    flushSync(() => root.unmount())
    expect(refCalls.filter((x) => x === null).length).toBe(1)
    expect(lookAtCalls.length).toBe(1)
  })
})
