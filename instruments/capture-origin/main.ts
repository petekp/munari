// Capture origin page — each capture engine draws one element per case, and
// the page reports whether the capture canvas stayed readable and what its
// center pixel holds. run.mjs serves this page and judges the result.

import { htmlInCanvasEngine, type CaptureEngine, type DomTextureSource } from '@petepetrash/munari/advanced'
import { snapdomCaptureEngine } from '@petepetrash/munari/snapdom'

interface CaseResult {
  readonly engine: string
  readonly name: string
  readonly readable: boolean
  readonly pixel: readonly number[] | null
}

const asset = new URLSearchParams(location.search).get('asset')
if (!asset) throw new Error('capture-origin: the page needs ?asset=<cross-origin server>')

const SIZE = 100
const box = `width:${SIZE}px;height:${SIZE}px;display:block`
const CASES = {
  'same-origin image': `<img src="/red.png" style="${box}">`,
  'cross-origin image with CORS': `<img crossorigin="anonymous" src="${asset}/red.png?cors" style="${box}">`,
  'cross-origin image without CORS': `<img src="${asset}/red.png" style="${box}">`,
  'cross-origin CSS background without CORS': `<div style="${box};background:url(${asset}/red.png?background) 0 0/100% 100%"></div>`,
  'cross-origin CSS background with CORS': `<div style="${box};background:url(${asset}/red.png?cors&background) 0 0/100% 100%"></div>`,
  'cross-origin iframe': `<iframe src="${asset}/frame.html" style="${box};border:0"></iframe>`,
} satisfies Record<string, string>

const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
const nextPaint = (source: DomTextureSource) =>
  new Promise<void>(resolve => {
    const stop = source.subscribePaint(() => {
      stop()
      resolve()
    })
  })

const loads = (element: HTMLElement, selector: string) =>
  Promise.all(
    [...element.querySelectorAll(selector)].map(
      child => new Promise(resolve => {
        child.addEventListener('load', resolve, { once: true })
        child.addEventListener('error', resolve, { once: true })
      }),
    ),
  )

// Every image and frame loads in the live page before the engine adopts it,
// so a missing pixel is the engine's omission, not a load still in flight.
// The engine adopts only an unparented element, so it is detached after.
async function loaded(element: HTMLElement): Promise<void> {
  document.body.appendChild(element)
  await loads(element, 'img, iframe')
  // A CSS background has no load event; give it the same settled page.
  await new Promise(resolve => setTimeout(resolve, 500))
  element.remove()
}

async function measure(engine: CaptureEngine, name: string, html: string): Promise<CaseResult> {
  const element = document.createElement('div')
  element.style.cssText = box
  element.innerHTML = html
  await loaded(element)
  // An iframe loads its document again when the engine inserts it.
  const frames = loads(element, 'iframe')
  const source = engine.createSource(element, SIZE, SIZE)
  try {
    await frames
    await nextPaint(source)
    source.repaint({ immediate: true })
    await nextPaint(source)
    // HTML-in-canvas readback trails the paint by one frame (htmlInCanvas.ts).
    await frame()
    await frame()
    const { canvas } = source
    const context = canvas.getContext('2d')
    if (!context) throw new Error(`${engine.name}: the capture canvas has no 2D context`)
    try {
      const pixel = [...context.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data]
      return { engine: engine.name, name, readable: true, pixel }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        return { engine: engine.name, name, readable: false, pixel: null }
      }
      throw error
    }
  } finally {
    source.dispose()
  }
}

try {
  const results: CaseResult[] = []
  for (const engine of [htmlInCanvasEngine, snapdomCaptureEngine]) {
    if (!engine.available()) continue
    for (const [name, html] of Object.entries(CASES)) results.push(await measure(engine, name, html))
  }
  Object.assign(window, { __captureOrigin: { results } })
} catch (error) {
  Object.assign(window, { __captureOrigin: { error: String(error) } })
}
