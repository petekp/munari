// Masthead — the overview's headline, lit by one draggable light whose
// shadows fall from the page's own matter: the glyphs, every raised
// control, and the rim of every well.
//
// The law: WebGL owns light and shadow, nothing else. The headline, prose
// and buttons are plain DOM, selectable and clickable. A multiply canvas
// darkens what is already there, and a fixed normal-blend canvas renders
// the bulb itself. The light lives in viewport space, so it stays where you
// leave it while the page scrolls under it and every section is lit by the
// same fixture.
//
// The multiply canvas is a band two viewports tall that scrolls WITH the
// page, re-seated once the viewport nears its edge. A fixed canvas repainted
// from requestAnimationFrame runs a frame behind compositor-thread
// scrolling, and the shadows visibly slid off their casters on a brisk
// scroll (Pete, 2026-09-05). Inside the scroll flow the masks stay
// registered; only the light's direction can lag, which is invisible.
//
// Fault: the first build tied the light to the masthead's box, so the
// sections below scrolled through a light the visitor could not reach
// (Pete, 2026-09-05). The masks stay anchored to the page; only the light
// is fixed.
//
// Ownership: this component owns the DOM masthead, the light's position,
// both canvases, and the draw loop. homeRelief.ts owns reading the page
// into masks; homeLight.ts owns the shadow shader; homeLightBulb.ts owns
// the bulb model.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { readHomeFlyer, subscribeHomeFlyer } from './homeFlyer'
import { createHomeLightMaterial, maskTexture, setHomeFlyerUniform, setHomeInkMask, setHomeLightFrame, setHomeReliefMask } from './homeLight'
import { BULB_RADIUS, createLightBulb, fitBulbCamera, type LightBulb } from './homeLightBulb'
import { RAISED_STANDOFF } from './homeLightLaw'
import { buildInkMask, domPainter, measureRelief, paintRelief, type Mask } from './homeRelief'
import type { ReliefReply, ReliefRequest } from './homeReliefWorker'
import { useHomeReducedMotion } from './homeMotion'

const PIXEL_RATIO_CAP = 2
// Idle drift: a slow ellipse so the shadows breathe while nobody drags.
const DRIFT_RADIUS_X = 30
const DRIFT_RADIUS_Y = 18
const DRIFT_PERIOD_MS = 24000
// The light's rest position, relative to the second headline line's box.
const REST_RIGHT_OF_LINE = 96
// Relief is rebuilt this long after the last layout change or interaction.
const RELIEF_SETTLE_MS = 120
// The bulb can be dragged this close to the viewport's edge.
const LIGHT_MARGIN = BULB_RADIUS + 8
// The shadow band spans this many viewport heights, and is re-seated once
// the viewport has used this fraction of the slack on either side.
const BAND_FACTOR = 2
const BAND_SLACK = 0.6

interface Point {
  x: number
  y: number
}

interface ShadowPass {
  renderer: THREE.WebGLRenderer | null
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  ink: { mask: Mask; texture: THREE.DataTexture } | null
  relief: { mask: Mask; texture: THREE.DataTexture } | null
}

interface BulbPass {
  renderer: THREE.WebGLRenderer | null
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  bulb: LightBulb | null
  lastFrame: number
}

interface LightState {
  width: number
  height: number
  shadow: ShadowPass
  bulb: BulbPass
  draw: () => void
  start: () => void
  stop: () => void
}

function createLightState(): LightState {
  const shadowScene = new THREE.Scene()
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), createHomeLightMaterial())
  mesh.frustumCulled = false
  shadowScene.add(mesh)
  return {
    width: 0,
    height: 0,
    shadow: { renderer: null, scene: shadowScene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mesh, ink: null, relief: null },
    bulb: { renderer: null, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), bulb: null, lastFrame: 0 },
    draw: () => {},
    start: () => {},
    stop: () => {},
  }
}

function ellipseOffset(elapsedMs: number): Point {
  const angle = (elapsedMs / DRIFT_PERIOD_MS) * Math.PI * 2
  return { x: Math.cos(angle) * DRIFT_RADIUS_X, y: Math.sin(angle) * DRIFT_RADIUS_Y }
}

const pageFlyerCorners = new Float32Array(12)

// The card resting on the page, measured now: its box with the raised
// standoff, or nothing while it is hidden.
function pageFlyer(element: HTMLElement): Float32Array | null {
  if (element.closest('[hidden], [aria-hidden="true"]')) return null
  const r = element.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return null
  const xs = [r.left, r.right, r.right, r.left]
  const ys = [r.top, r.top, r.bottom, r.bottom]
  for (let index = 0; index < 4; index++) {
    pageFlyerCorners[index * 3] = xs[index]
    pageFlyerCorners[index * 3 + 1] = ys[index]
    pageFlyerCorners[index * 3 + 2] = RAISED_STANDOFF
  }
  return pageFlyerCorners
}

// The relief painter's worker, or none where one cannot be made; the page
// then paints on the main thread.
function createReliefWorker(): Worker | null {
  try {
    return new Worker(new URL('./homeReliefWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

function clampToViewport(point: Point): Point {
  return {
    x: Math.min(Math.max(point.x, LIGHT_MARGIN), Math.max(LIGHT_MARGIN, window.innerWidth - LIGHT_MARGIN)),
    y: Math.min(Math.max(point.y, LIGHT_MARGIN), Math.max(LIGHT_MARGIN, window.innerHeight - LIGHT_MARGIN)),
  }
}

export interface HomeMastheadProps {
  /** The scrolling page; scroll events re-frame the masks. */
  pageRef: React.RefObject<HTMLDivElement | null>
  /** The page body every `[data-relief]` element lives under, and the masks' anchor. */
  innerRef: React.RefObject<HTMLElement | null>
}

export function HomeMasthead({ pageRef, innerRef }: HomeMastheadProps) {
  const host = useRef<HTMLDivElement>(null)
  const bulbHost = useRef<HTMLDivElement>(null)
  const masthead = useRef<HTMLElement>(null)
  const fixture = useRef<HTMLDivElement>(null)
  const lineOne = useRef<HTMLSpanElement>(null)
  const lineTwo = useRef<HTMLSpanElement>(null)
  const lineThree = useRef<HTMLSpanElement>(null)
  const state = useMemo(createLightState, [])
  const [degraded, setDegraded] = useState(false)
  const [bulbless, setBulbless] = useState(false)
  const [dragged, setDragged] = useState(false)
  const reducedMotion = useHomeReducedMotion()
  const reducedMotionRef = useRef(reducedMotion)
  reducedMotionRef.current = reducedMotion

  // The light's position lives in refs: it moves every drift frame and every
  // pointermove of a drag, and neither needs a React render to reach the
  // shader or the fixture's transform. Viewport coordinates.
  const anchor = useRef<Point>({ x: 720, y: 300 })
  const placed = useRef(false)
  const dragging = useRef(false)
  const driftEpoch = useRef(performance.now())

  const currentLight = useCallback((): Point => {
    if (dragging.current || reducedMotionRef.current) return anchor.current
    const offset = ellipseOffset(performance.now() - driftEpoch.current)
    return { x: anchor.current.x + offset.x, y: anchor.current.y + offset.y }
  }, [])

  // Keeps the band around the viewport, moving it only when the viewport
  // nears an edge; returns the band's viewport rect.
  const seatBand = useCallback((box: HTMLDivElement, page: HTMLDivElement, innerRect: DOMRect): DOMRect => {
    let rect = box.getBoundingClientRect()
    const viewHeight = page.clientHeight
    const margin = Math.max(0, (state.height - viewHeight) / 2)
    const slack = margin * (1 - BAND_SLACK)
    if (rect.top > -slack || rect.bottom < viewHeight + slack) {
      const currentTop = parseFloat(box.style.top) || 0
      const contentBottom = innerRect.bottom - rect.top + currentTop
      const top = Math.max(0, Math.min(currentTop + (-margin - rect.top), Math.ceil(contentBottom) - state.height))
      if (top !== currentTop) {
        box.style.top = `${top}px`
        rect = box.getBoundingClientRect()
      }
    }
    return rect
  }, [state])

  const redraw = useCallback(() => {
    const inner = innerRef.current
    const page = pageRef.current
    const box = host.current
    const element = fixture.current
    if (!inner || !page || !box) return
    const light = currentLight()
    if (element) element.style.transform = `translate(${light.x}px, ${light.y}px)`
    const innerRect = inner.getBoundingClientRect()
    // Everything the shader sees is in the band's own pixels, so the band
    // and the page it scrolls with can never disagree.
    const origin = seatBand(box, page, innerRect)
    const material = state.shadow.mesh.material
    setHomeLightFrame(material, state.width, state.height, light.x - origin.left, light.y - origin.top)
    const ink = state.shadow.ink
    setHomeInkMask(material, ink?.texture ?? null, ink ? { x: innerRect.left - origin.left + ink.mask.rect.x, y: innerRect.top - origin.top + ink.mask.rect.y, width: ink.mask.rect.width, height: ink.mask.rect.height } : null)
    const relief = state.shadow.relief
    setHomeReliefMask(material, relief?.texture ?? null, relief ? { x: innerRect.left - origin.left + relief.mask.rect.x, y: innerRect.top - origin.top + relief.mask.rect.y, width: relief.mask.rect.width, height: relief.mask.rect.height } : null)
    const flyer = readHomeFlyer()
    if (!flyer) setHomeFlyerUniform(material, null, 0, 0, 0)
    else if (flyer.kind === 'page') setHomeFlyerUniform(material, pageFlyer(flyer.element), 0, origin.left, origin.top)
    else setHomeFlyerUniform(material, flyer.corners, flyer.lift, origin.left, origin.top)
    const bulb = state.bulb.bulb
    if (bulb) {
      const now = performance.now()
      const dt = state.bulb.lastFrame ? (now - state.bulb.lastFrame) / 1000 : 0
      state.bulb.lastFrame = now
      // World space is CSS px with y up; the shader and DOM use y down.
      bulb.update(light.x, page.clientHeight - light.y, dt, reducedMotionRef.current && !dragging.current)
    }
    state.draw()
  }, [state, innerRef, pageRef, currentLight, seatBand])

  // Mount: the multiply canvas. Created outside React; a lost context
  // degrades to the CSS depth kit rather than an opaque black overlay. A
  // passive effect: the page ref belongs to a parent, and parent refs are
  // not attached yet when a child's layout effect runs.
  useEffect(() => {
    const box = host.current
    const page = pageRef.current
    if (!box || !page) return
    const canvas = document.createElement('canvas')
    canvas.className = 'home-light-canvas'
    box.append(canvas)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false })
    } catch {
      canvas.remove()
      setDegraded(true)
      return
    }
    const pass = state.shadow
    pass.renderer = renderer
    state.width = 0
    state.height = 0
    renderer.setClearColor(0xffffff, 1)

    let raf = 0
    state.draw = () => {
      renderer.render(pass.scene, pass.camera)
      state.bulb.renderer?.render(state.bulb.scene, state.bulb.camera)
    }
    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (readHomeFlyer()?.kind !== 'scene') redraw()
    }
    state.start = () => {
      if (raf) return
      frame()
    }
    state.stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }

    const resize = () => {
      const width = Math.max(1, page.clientWidth)
      const viewHeight = Math.max(1, page.clientHeight)
      const height = Math.ceil(viewHeight * BAND_FACTOR)
      if (width === state.width && height === state.height) return
      state.width = width
      state.height = height
      box.style.height = `${height}px`
      const ratio = Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP)
      renderer.setPixelRatio(ratio)
      renderer.setSize(width, height, false)
      const bulbRenderer = state.bulb.renderer
      if (bulbRenderer) {
        bulbRenderer.setPixelRatio(ratio)
        bulbRenderer.setSize(width, viewHeight, false)
        fitBulbCamera(state.bulb.camera, width, viewHeight)
      }
      anchor.current = clampToViewport(anchor.current)
      redraw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(page)
    resize()

    const lost = (event: Event) => {
      event.preventDefault()
      setDegraded(true)
      state.stop()
    }
    const restored = () => {
      setDegraded(false)
      state.width = 0
      resize()
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)

    return () => {
      state.stop()
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
      state.draw = () => {}
      state.start = () => {}
      state.stop = () => {}
      pass.mesh.material.dispose()
      pass.ink?.texture.dispose()
      pass.relief?.texture.dispose()
      pass.ink = null
      pass.relief = null
      pass.renderer = null
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [state, pageRef, redraw])

  // Mount: the bulb canvas. Its own context, alpha over the page. Losing it
  // leaves the shadows running and shows the plain ink mark instead.
  useEffect(() => {
    const box = bulbHost.current
    if (!box || degraded) return
    const canvas = document.createElement('canvas')
    canvas.className = 'home-light-canvas'
    box.append(canvas)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, depth: true })
    } catch {
      canvas.remove()
      setBulbless(true)
      return
    }
    const pass = state.bulb
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    renderer.outputColorSpace = THREE.SRGBColorSpace
    const pmrem = new THREE.PMREMGenerator(renderer)
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    pass.scene.environment = environment
    const bulb = createLightBulb()
    pass.scene.add(bulb.group)
    pass.bulb = bulb
    pass.renderer = renderer
    pass.lastFrame = 0
    const page = pageRef.current
    if (state.width && page) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP))
      renderer.setSize(state.width, page.clientHeight, false)
      fitBulbCamera(pass.camera, state.width, page.clientHeight)
    }
    setBulbless(false)

    const lost = (event: Event) => {
      event.preventDefault()
      setBulbless(true)
    }
    const restored = () => setBulbless(false)
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    redraw()

    return () => {
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
      pass.scene.remove(bulb.group)
      pass.scene.environment = null
      environment.dispose()
      bulb.dispose()
      pass.bulb = null
      pass.renderer = null
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [state, degraded, pageRef, redraw])

  // The page tells the depth kit whether the shader owns shadows now.
  useEffect(() => {
    const page = pageRef.current
    if (!page) return
    if (degraded) delete page.dataset.lit
    else page.dataset.lit = 'true'
    return () => {
      delete page.dataset.lit
    }
  }, [pageRef, degraded])

  // Read the headline into ink after fonts settle and whenever its layout
  // changes; place the light beside the second line the first time.
  useEffect(() => {
    let alive = true
    const build = () => {
      if (!alive) return
      const inner = innerRef.current
      const lines = [lineOne.current, lineTwo.current, lineThree.current].filter((line) => line !== null)
      state.shadow.ink?.texture.dispose()
      state.shadow.ink = null
      if (inner && lines.length === 3) {
        const mask = buildInkMask(inner, lines)
        if (mask) state.shadow.ink = { mask, texture: maskTexture(mask) }
      }
      if (!placed.current && lines.length === 3) {
        placed.current = true
        const line = lines[1].getBoundingClientRect()
        anchor.current = clampToViewport({ x: line.right + REST_RIGHT_OF_LINE, y: line.top + line.height * 0.45 })
        driftEpoch.current = performance.now()
      }
      redraw()
    }
    build()
    void document.fonts.ready.then(build)
    const observer = new ResizeObserver(build)
    if (masthead.current) observer.observe(masthead.current)
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [state, innerRef, redraw])

  // Read the raised and sunk elements into relief: on mount, after fonts,
  // once layout settles, and at once when an element changes its relief or
  // hides. Scrolling only re-frames it. Painting happens in a worker, so a
  // rebuild costs the main thread a measurement and a texture upload.
  useEffect(() => {
    const page = pageRef.current
    const inner = innerRef.current
    if (!page || !inner) return
    let alive = true
    let timer = 0
    let requestId = 0
    const worker = createReliefWorker()
    const apply = (mask: Mask | null) => {
      if (!alive) return
      state.shadow.relief?.texture.dispose()
      state.shadow.relief = mask ? { mask, texture: maskTexture(mask) } : null
      redraw()
    }
    if (worker) {
      worker.onmessage = (event: MessageEvent<ReliefReply>) => {
        if (event.data.id === requestId) apply(event.data.mask)
      }
    }
    const build = () => {
      if (!alive) return
      const plan = measureRelief(inner, inner)
      if (!plan) {
        apply(null)
        return
      }
      if (worker) {
        const request: ReliefRequest = { id: ++requestId, plan }
        worker.postMessage(request)
      } else {
        apply(paintRelief(plan, domPainter))
      }
    }
    const settle = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(build, RELIEF_SETTLE_MS)
    }
    build()
    void document.fonts.ready.then(build)
    const observer = new ResizeObserver(settle)
    observer.observe(inner)
    const attributes = new MutationObserver(build)
    attributes.observe(inner, { attributes: true, subtree: true, attributeFilter: ['data-relief', 'hidden'] })
    return () => {
      alive = false
      window.clearTimeout(timer)
      observer.disconnect()
      attributes.disconnect()
      worker?.terminate()
    }
  }, [state, pageRef, innerRef, redraw])

  // The flyer publishes from the hero's frame callback; redrawing right
  // there puts the shadow and the card in the same frame whatever order the
  // two animation-frame callbacks run in (the shadow trailed the card by a
  // frame through the launch wiggle, Pete, 2026-09-05). The independent
  // loop yields while the Surface supplies the frames.
  useEffect(() => subscribeHomeFlyer(() => {
    if (!degraded) redraw()
  }), [degraded, redraw])

  // The drift loop runs while motion is allowed. Under reduced motion the
  // light holds still and the page redraws only on scroll and drag.
  useEffect(() => {
    if (degraded) return
    const page = pageRef.current
    if (reducedMotion) {
      state.stop()
      redraw()
      page?.addEventListener('scroll', redraw, { passive: true })
      return () => page?.removeEventListener('scroll', redraw)
    }
    state.start()
    return () => state.stop()
  }, [state, reducedMotion, degraded, redraw, pageRef])

  // Dragging: pointer-captured, clamped to the viewport. Releasing re-seeds
  // the drift clock so the ellipse resumes from where the drag let go.
  useEffect(() => {
    const element = fixture.current
    if (!element) return
    let grip: Point = { x: 0, y: 0 }
    const move = (event: PointerEvent) => {
      if (!dragging.current) return
      anchor.current = clampToViewport({ x: event.clientX - grip.x, y: event.clientY - grip.y })
      if (reducedMotionRef.current) redraw()
    }
    const down = (event: PointerEvent) => {
      const light = currentLight()
      grip = { x: event.clientX - light.x, y: event.clientY - light.y }
      dragging.current = true
      element.setPointerCapture(event.pointerId)
      element.classList.add('is-dragging')
      document.body.style.userSelect = 'none'
      setDragged(true)
      move(event)
    }
    const up = (event: PointerEvent) => {
      dragging.current = false
      element.releasePointerCapture(event.pointerId)
      element.classList.remove('is-dragging')
      document.body.style.userSelect = ''
      driftEpoch.current = performance.now()
    }
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
    return () => {
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
      document.body.style.userSelect = ''
    }
  }, [redraw, currentLight])

  return (
    <>
      <div ref={host} className="home-light-host" aria-hidden="true" data-degraded={degraded || undefined} />
      <div ref={bulbHost} className="home-light-scene" aria-hidden="true" data-degraded={degraded || undefined} />
      <div
        ref={fixture}
        className="home-light"
        aria-hidden="true"
        data-dragged={dragged || undefined}
        data-degraded={degraded || undefined}
        data-bulbless={bulbless || undefined}
      >
        <span className="home-light-mark" />
        <span className="home-light-hint">Drag the light</span>
      </div>
      <header ref={masthead} className="home-masthead">
        <h1 className="home-masthead-title">
          <span ref={lineOne}>HTML, 3D and</span>
          <span ref={lineTwo}>shaders,</span>
          <span ref={lineThree} className="home-masthead-em">unified.</span>
        </h1>
        <p className="home-masthead-copy">
          For years, putting HTML in a Three.js scene meant floating a div over the canvas.
          munari puts the page itself into the scene. It can be lit, bent, shaded and refracted
          like anything else there, and it stays live: buttons click, fields take typing, text stays text.
        </p>
        <div className="home-masthead-links">
          <a className="home-btn home-btn--primary" href="#examples" data-relief="raised">See it work <span aria-hidden>↓</span></a>
          <a className="home-text-link" href="#how-it-works">How it works</a>
        </div>
      </header>
    </>
  )
}
