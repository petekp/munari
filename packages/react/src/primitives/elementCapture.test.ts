// @vitest-environment happy-dom
// Capture attachment follows the DOM node's lifetime without taking the original node.
import { act, Component, createElement, StrictMode, useLayoutEffect, type ReactNode } from 'react'
import { context as threeRootContext, type RootStore } from '@react-three/fiber'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { CaptureContent, copyElementForCapture, useElementCapture, type ElementCapture } from './elementCapture'
import { createCapture, inspectCapture } from './capture'

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

function measured(element: HTMLElement) {
  Object.defineProperty(element, 'offsetWidth', { value: 320, configurable: true })
  Object.defineProperty(element, 'offsetHeight', { value: 180, configurable: true })
  return element
}

it('copies current form values without moving, renaming, or making the native form inert', () => {
  const source = measured(document.createElement('div'))
  source.id = 'native-form'
  source.innerHTML = '<form><input id="name" value="initial"><input type="checkbox"><textarea>old</textarea></form>'
  document.body.append(source)
  source.querySelector('input')!.value = 'edited'
  source.querySelector<HTMLInputElement>('[type=checkbox]')!.checked = true
  source.querySelector('textarea')!.value = 'new note'
  const copied = copyElementForCapture(source)
  expect(copied.size).toEqual([320, 180])
  expect(copied.element.querySelector('input')!.value).toBe('edited')
  expect(copied.element.querySelector<HTMLInputElement>('[type=checkbox]')!.checked).toBe(true)
  expect(copied.element.querySelector('textarea')!.value).toBe('new note')
  expect(copied.element.querySelector('[id]')).toBeNull()
  expect(source.parentElement).toBe(document.body)
  expect(source.id).toBe('native-form')
  expect(source.inert).toBeFalsy()
})

it('rejects custom elements before cloning can run their constructors a second time', () => {
  let constructed = 0
  customElements.define('capture-fixture', class extends HTMLElement { constructor() { super(); constructed++ } })
  const source = measured(document.createElement('div'))
  source.append(document.createElement('capture-fixture'))
  document.body.append(source)
  expect(() => copyElementForCapture(source)).toThrow('custom elements')
  expect(constructed).toBe(1)
  expect(copyElementForCapture(source, 'capture-fixture').element.children).toHaveLength(0)
})

it('keeps a stable capture identity through late attachment, replacement, and removal', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('CanvasRenderingContext2D', undefined)
  let latest: ElementCapture | undefined
  function Fixture({ version }: { version: string | null }) {
    const capture = useElementCapture()
    useLayoutEffect(() => { latest = capture })
    return version ? createElement('article', { key: version, ref: capture.ref }, version) : null
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = async (version: string | null) => { await act(async () => root.render(createElement(StrictMode, null, createElement(Fixture, { version })))) }
  try {
    await render(null)
    const capture = latest!
    expect(inspectCapture(capture).status.status).toBe('waiting')
    await render('first')
    const first = container.querySelector('article')!
    expect(inspectCapture(capture).status.status).toBe('unsupported')
    expect(capture.getBounds()).not.toBeNull()
    expect(first.parentElement).toBe(container)
    await render('second')
    expect(latest).toBe(capture)
    expect(container.querySelector('article')).not.toBe(first)
    expect(document.querySelectorAll('canvas')).toHaveLength(0)
    await render(null)
    expect(capture.getBounds()).toBeNull()
    expect(inspectCapture(capture).status.status).toBe('waiting')
  } finally { await act(async () => root.unmount()) }
})

class Catch extends Component<{ children?: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { this.props.onError(error) }
  render() { return this.state.failed ? null : this.props.children }
}

it('refuses to render CaptureContent inside a react-three-fiber tree', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let caught: Error | undefined
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  // SAFETY: only the provider's presence is read; no store member is touched before the throw.
  const store = {} as RootStore
  // createElement's overload requires CaptureContent's children as a prop.
  // eslint-disable-next-line react/no-children-prop
  const content = createElement(CaptureContent, { capture: createCapture(), size: [100, 50], children: 'x' })
  await act(async () => root.render(createElement(threeRootContext, { value: store },
    createElement(Catch, { onError: error => { caught = error } }, content))))
  expect(caught?.message).toContain('must be placed in the page tree')
  await act(async () => root.unmount())
  vi.restoreAllMocks()
})
