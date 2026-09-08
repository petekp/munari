// Masthead — the overview's headline, lit by one draggable light whose
// shadows fall from the page content: the glyphs, every raised
// control, and the rim of every well.
//
// The headline retains its native layout and selection. WebGL supplies its
// 3D and shader word treatments, plus light and shadow. A multiply canvas
// darkens the page, and a fixed normal-blend canvas renders the bulb.
// The light lives in viewport space, so it stays where you
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
// the lighting canvases, and the draw loop. homeHeadlineTreatments owns the
// word renderer. homeRelief.ts owns reading the page
// into masks; homeLight.ts owns the shadow shader; homeLightBulb.ts owns
// the bulb model.

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { readHomeFlyer, subscribeHomeFlyer } from './homeFlyer'
import { createHomeLightMaterial, maskTexture, setHomeFlyerUniform, setHomeInkMask, setHomeLightFrame, setHomeReliefMask, type HomeLightMaterial } from './homeLight'
import { BULB_RADIUS, createLightBulb, type LightBulb } from './homeLightBulb'
import { LIGHT_HEIGHT, POSTCARD_STANDOFF } from './homeLightLaw'
import { buildInkMask, domPainter, measureRelief, paintRelief, type InkMask, type Mask } from './homeRelief'
import type { ReliefReply, ReliefRequest } from './homeReliefWorker'
import { useHomeReducedMotion } from './homeMotion'
import { HomeMastheadContent } from './HomeMastheadContent'
import { useHomeLightDrag } from './homeLightDrag'
import { advanceHeadlineSelection, useHeadlineSelection, type HomeSelectionState } from './homeSelection'
import { createPaperLighting } from './homePaperLighting'
import { createLampBackdrop, type LampBackdrop } from './homeLampBackdrop'
import { createHomeLightDisplay } from './homeLightDisplay'
import { createLampViewportUpdater, watchLampViewport } from './homeLampViewport'
import { createHeadlineTreatments } from './homeHeadlineTreatments'

// Small idle motion stays inside the gap above the headline (decision #50).
const DRIFT_RADIUS_X = 12
const DRIFT_RADIUS_Y = 3
const DRIFT_PERIOD_MS = 24000
// Raising selected type lengthens its shadow on the page (decision #50).
const SELECTED_TYPE_LIFT = 64
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
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  mesh: THREE.Mesh<THREE.PlaneGeometry, HomeLightMaterial>
  ink: { mask: InkMask; texture: THREE.DataTexture; scale: number } | null
  relief: { mask: Mask; texture: THREE.DataTexture } | null
  paper: ReturnType<typeof createPaperLighting>
  layoutCurrent: () => boolean
}

interface BulbPass {
  renderer: THREE.WebGLRenderer | null
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  bulb: LightBulb | null
  lastFrame: number
  backdrop: LampBackdrop | null
  queued: boolean
  updateViewport: (()=>void) | null
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
    shadow: { scene: shadowScene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mesh, ink: null, relief: null, paper: null, layoutCurrent: () => false },
    bulb: { renderer: null, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), bulb: null, lastFrame: 0, backdrop: null, queued: false, updateViewport:null },
    draw: () => {},
    start: () => {},
    stop: () => {},
  }
}

function ellipseOffset(elapsedMs: number): Point {
  const angle = (elapsedMs / DRIFT_PERIOD_MS) * Math.PI * 2
  return { x: Math.sin(angle) * DRIFT_RADIUS_X, y: (1 - Math.cos(angle)) * DRIFT_RADIUS_Y }
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
    pageFlyerCorners[index * 3 + 2] = POSTCARD_STANDOFF
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
  children: ReactNode
  effectsEnabled: boolean
  onReady: (mode: 'enhanced' | 'native') => void
  /** The scrolling page; scroll events re-frame the masks. */
  pageRef: React.RefObject<HTMLDivElement | null>
  /** The page body every `[data-relief]` element lives under, and the masks' anchor. */
  innerRef: React.RefObject<HTMLElement | null>
}

export function HomeMasthead({ pageRef, innerRef, children, effectsEnabled, onReady }: HomeMastheadProps) {
  const reportReady = useEffectEvent(onReady)
  const host = useRef<HTMLDivElement>(null)
  const bulbHost = useRef<HTMLDivElement>(null)
  const masthead = useRef<HTMLElement>(null)
  const fixture = useRef<HTMLButtonElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const lineOne = useRef<HTMLSpanElement>(null)
  const lineTwo = useRef<HTMLSpanElement>(null)
  const lineThree = useRef<HTMLSpanElement>(null)
  const state = useMemo(createLightState, [])
  const [degraded, setDegraded] = useState(false)
  const [bulbless, setBulbless] = useState(false)
  const [dragged, setDragged] = useState(false)
  const movedByUser = useRef(false)
  const markLightMoved = useCallback(() => {
    movedByUser.current = true
    setDragged(true)
  }, [])
  const [lightHeight, setLightHeight] = useState(LIGHT_HEIGHT)
  const lightHeightRef = useRef(lightHeight)
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

  const selection = useMemo<HomeSelectionState>(
    () => ({ rects: [], target: 0, amount: 0, time: 0 }),
    [],
  )

  const currentLight = useCallback((): Point => {
    if (dragging.current || reducedMotionRef.current) return anchor.current
    const offset = ellipseOffset(performance.now() - driftEpoch.current)
    return clampToViewport({ x: anchor.current.x + offset.x, y: anchor.current.y + offset.y })
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
    material.uniforms.uFrameOrigin.value.set(origin.left, origin.top)
    setHomeLightFrame(material, state.width, state.height, light.x - origin.left, light.y - origin.top, lightHeightRef.current)
    const ink = state.shadow.ink
    const glyphScale = ink?.scale ?? 1
    setHomeInkMask(material, ink?.texture ?? null, ink ? { x: innerRect.left - origin.left + ink.mask.rect.x, y: innerRect.top - origin.top + ink.mask.rect.y, width: ink.mask.rect.width, height: ink.mask.rect.height } : null, glyphScale)
    advanceHeadlineSelection(selection, reducedMotionRef.current, performance.now())
    material.uniforms.uSelectionLift.value = SELECTED_TYPE_LIFT*selection.amount
    material.uniforms.uSelectionCount.value = selection.amount ? selection.rects.length : 0
    selection.rects.forEach((rect,index) => material.uniforms.uSelection.value[index].set(
      innerRect.left-origin.left+rect.x, innerRect.top-origin.top+rect.y, rect.width, rect.height,
    ))
    const relief = state.shadow.relief
    setHomeReliefMask(material, relief?.texture ?? null, relief ? { x: innerRect.left - origin.left + relief.mask.rect.x, y: innerRect.top - origin.top + relief.mask.rect.y, width: relief.mask.rect.width, height: relief.mask.rect.height } : null)
    const flyer = readHomeFlyer()
    if (!flyer) setHomeFlyerUniform(material, null, 0, 0)
    else if (flyer.kind === 'page') setHomeFlyerUniform(material, pageFlyer(flyer.element), origin.left, origin.top)
    else setHomeFlyerUniform(material, flyer.corners, origin.left, origin.top)
    const bulb = state.bulb.bulb
    if (bulb && placed.current) {
      const now = performance.now()
      const dt = state.bulb.lastFrame ? (now - state.bulb.lastFrame) / 1000 : 0
      state.bulb.lastFrame = now
      // World space is CSS px with y up; the shader and DOM use y down.
      bulb.update(light.x, page.clientHeight - light.y, dt, reducedMotionRef.current && !dragging.current, page.clientHeight, lightHeightRef.current)
    }
    state.draw()
  }, [state, innerRef, pageRef, currentLight, seatBand, selection])

  useEffect(() => {
    lightHeightRef.current = lightHeight
    redraw()
  }, [lightHeight, redraw])

  // Mount: the multiply canvas. Created outside React; a lost context
  // degrades to the CSS depth kit rather than an opaque black overlay. A
  // passive effect: the page ref belongs to a parent, and parent refs are
  // not attached yet when a child's layout effect runs.
  useEffect(() => {
    const box = host.current
    const page = pageRef.current
    if (!box || !page || !effectsEnabled) return
    const canvas = document.createElement('canvas')
    canvas.className = 'home-light-canvas'
    box.append(canvas)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, depth: true })
    } catch {
      canvas.remove()
      setDegraded(true)
      reportReady('native')
      return
    }
    const pass = state.shadow
    pass.paper = createPaperLighting(renderer,pass.mesh.material)
    const display = createHomeLightDisplay(renderer,pass.mesh.material)
    const headline = title.current ? createHeadlineTreatments(title.current,pass.mesh.material,redraw) : null
    state.width = 0
    state.height = 0
    renderer.setClearColor(0xffffff, 1)

    let raf = 0, openingFrame = 0, complete = false, headlineReady = false
    const ready = () => document.fonts.status === 'loaded' && pass.layoutCurrent() && headlineReady &&
      !!state.bulb.renderer && !!state.bulb.backdrop?.ready()
    const checkOpening = () => {
      if (complete || openingFrame || !ready()) return
      openingFrame = requestAnimationFrame(() => {
        openingFrame = 0
        if (!ready()) return
        complete = true
        reportReady('enhanced')
      })
    }
    state.draw = () => {
      pass.paper?.update(readHomeFlyer())
      display.render(pass.scene, pass.camera, pass.paper)
      headlineReady = headline?.render(reducedMotionRef.current) ?? true
      // The postcard's pre-draw callback reaches here before its canvas has
      // drawn. A microtask samples that completed canvas in the same frame.
      if (!state.bulb.queued) {
        state.bulb.queued = true
        queueMicrotask(() => {
          state.bulb.queued = false
          if (!state.bulb.renderer) return
          state.bulb.updateViewport?.()
          state.bulb.backdrop?.update(canvas)
          state.bulb.renderer.render(state.bulb.scene, state.bulb.camera)
          checkOpening()
        })
      }
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

    let viewportHeight = 0
    const resize = () => {
      const width = Math.max(1, page.clientWidth)
      const viewHeight = Math.max(1, page.clientHeight)
      let height = Math.ceil(viewHeight * BAND_FACTOR)
      if (width === state.width && viewHeight === viewportHeight && renderer.getPixelRatio() === window.devicePixelRatio) return
      viewportHeight = viewHeight
      renderer.setPixelRatio(window.devicePixelRatio)
      renderer.setSize(width, height, false)
      const gl = renderer.getContext()
      // Chrome can clamp a large drawing buffer without changing canvas.width.
      // Reduce the offscreen band, retaining density and viewport coverage (#53).
      if (gl.drawingBufferWidth < canvas.width || gl.drawingBufferHeight < canvas.height) {
        const pixels = gl.drawingBufferWidth * gl.drawingBufferHeight
        height = Math.max(viewHeight, Math.floor(pixels / (canvas.width * window.devicePixelRatio)))
        renderer.setSize(width, height, false)
      }
      state.width = width
      state.height = height
      pass.paper?.invalidate()
      box.style.height = `${height}px`
      state.bulb.updateViewport?.()
      anchor.current = clampToViewport(anchor.current)
      redraw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(page,{box:'device-pixel-content-box'})
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
      cancelAnimationFrame(openingFrame)
      state.stop()
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
      state.draw = () => {}
      state.start = () => {}
      state.stop = () => {}
      pass.mesh.material.dispose()
      display.dispose()
      headline?.dispose()
      pass.paper?.dispose()
      pass.paper = null
      pass.ink?.texture.dispose()
      pass.relief?.texture.dispose()
      pass.ink = null
      pass.relief = null
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [state, pageRef, redraw, effectsEnabled])

  // Mount: the bulb canvas. Its own context, alpha over the page. Losing it
  // leaves the shadows running and shows the plain ink mark instead.
  useEffect(() => {
    const box = bulbHost.current
    const page = pageRef.current
    if (!box || !page || degraded || !effectsEnabled) return
    const canvas = document.createElement('canvas')
    canvas.className = 'home-light-canvas'
    box.append(canvas)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, depth: true })
    } catch {
      canvas.remove()
      setBulbless(true)
      reportReady('native')
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
    const backdrop = createLampBackdrop(page, redraw)
    pass.backdrop = backdrop
    const bulb = createLightBulb(backdrop)
    pass.scene.add(bulb.group)
    pass.bulb = bulb
    pass.renderer = renderer
    pass.lastFrame = 0
    pass.updateViewport = createLampViewportUpdater(renderer,pass.camera,page)
    pass.updateViewport()
    const stopViewport = watchLampViewport(redraw)
    setBulbless(false)

    const lost = (event: Event) => {
      event.preventDefault()
      setBulbless(true)
    }
    const restored = () => { setBulbless(false); redraw() }
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
      backdrop.dispose()
      stopViewport()
      pass.updateViewport = null
      pass.backdrop = null
      pass.bulb = null
      pass.renderer = null
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [state, degraded, pageRef, redraw, effectsEnabled])

  // The page tells the depth kit whether the shader owns shadows now.
  useEffect(() => {
    const page = pageRef.current
    if (!page) return
    if (degraded || !effectsEnabled) delete page.dataset.lit
    else page.dataset.lit = 'true'
    return () => {
      delete page.dataset.lit
    }
  }, [pageRef, degraded, effectsEnabled])

  useHeadlineSelection(title, innerRef, selection, redraw)

  // Read the headline after fonts settle and when its layout changes;
  // the first placement leaves room for the bulb above the type.
  useEffect(() => {
    if (!effectsEnabled) return
    let alive = true
    const build = () => {
      if (!alive) return
      const inner = innerRef.current
      const lines = [lineOne.current, lineTwo.current, lineThree.current].filter((line) => line !== null)
      const previous = state.shadow.ink
      let mask: InkMask | null = null
      if (inner && lines.length === 3) {
        mask = buildInkMask(inner, lines, previous?.mask)
      }
      if (mask !== previous?.mask) {
        previous?.texture.dispose()
        state.shadow.ink = mask ? { mask, texture: maskTexture(mask), scale: Math.min(1, parseFloat(getComputedStyle(lines[0]!).fontSize) / 150) } : null
      }
      if ((!placed.current || !movedByUser.current) && lines.length === 3) {
        placed.current = true
        const line = lines[0].getBoundingClientRect()
        const card = masthead.current?.querySelector('.home-hero-viewport')?.getBoundingClientRect()
        const right = masthead.current?.getBoundingClientRect().right ?? line.right
        const desktop = window.innerWidth > 760
        const x = desktop && card ? card.left + card.width / 2 : right - LIGHT_MARGIN
        anchor.current = clampToViewport({ x, y: desktop ? line.top - 54 : 68 })
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
  }, [state, innerRef, redraw, effectsEnabled])

  // Read the raised and sunk elements into relief: on mount, after fonts,
  // once layout settles, and at once when an element changes its relief or
  // hides. Scrolling only re-frames it. Painting happens in a worker, so a
  // rebuild costs the main thread a measurement and a texture upload.
  useEffect(() => {
    const page = pageRef.current
    const inner = innerRef.current
    if (!page || !inner || !effectsEnabled) return
    let alive = true
    let timer = 0
    let requestId = 0
    let previousPlan = ''
    let lastLayout = ''
    let appliedPlan = ''
    const worker = createReliefWorker()
    state.shadow.layoutCurrent = () => appliedPlan !== '' && appliedPlan === JSON.stringify(measureRelief(inner, inner))
    const apply = (mask: Mask | null, signature = '') => {
      if (!alive) return
      if (!mask && signature && signature !== 'null') { reportReady('native'); return }
      appliedPlan = signature
      state.shadow.relief?.texture.dispose()
      state.shadow.relief = mask ? { mask, texture: maskTexture(mask) } : null
      redraw()
    }
    if (worker) {
      worker.onmessage = (event: MessageEvent<ReliefReply>) => {
        if (event.data.id === requestId) apply(event.data.mask, previousPlan)
      }
    }
    const build = () => {
      if (!alive) return
      const plan = measureRelief(inner, inner)
      if (!plan) {
        requestId++
        previousPlan = ''
        lastLayout = 'null'
        apply(null, 'null')
        return
      }
      const signature = JSON.stringify(plan)
      if (signature === previousPlan) return
      previousPlan = signature
      lastLayout = signature
      apply(null)
      if (worker) {
        const request: ReliefRequest = { id: ++requestId, plan }
        worker.postMessage(request)
      } else {
        apply(paintRelief(plan, domPainter), signature)
      }
    }
    const settle = () => {
      const layout = JSON.stringify(measureRelief(inner, inner))
      if (layout === lastLayout) return
      lastLayout = layout
      // Old coordinates are not a valid preview of a new layout. Invalidate
      // pending worker replies too, so one cannot restore a stale field (#50).
      requestId++
      previousPlan = ''
      apply(null)
      window.clearTimeout(timer)
      timer = window.setTimeout(build, RELIEF_SETTLE_MS)
    }
    build()
    void document.fonts.ready.then(build)
    const observer = new ResizeObserver(settle)
    observer.observe(inner)
    for (const element of inner.querySelectorAll('[data-relief]')) observer.observe(element)
    const attributes = new MutationObserver(build)
    attributes.observe(inner, { attributes: true, subtree: true, attributeFilter: ['data-relief', 'hidden'] })
    return () => {
      alive = false
      window.clearTimeout(timer)
      observer.disconnect()
      attributes.disconnect()
      worker?.terminate()
      state.shadow.layoutCurrent = () => false
    }
  }, [state, pageRef, innerRef, redraw, effectsEnabled])

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
    if (degraded || !effectsEnabled) return
    const page = pageRef.current
    if (reducedMotion) {
      state.stop()
      redraw()
      page?.addEventListener('scroll', redraw, { passive: true })
      return () => page?.removeEventListener('scroll', redraw)
    }
    state.start()
    return () => state.stop()
  }, [state, reducedMotion, degraded, redraw, pageRef, effectsEnabled])

  useHomeLightDrag({ fixture, dragging, anchor, driftEpoch, reducedMotion: reducedMotionRef, currentLight, redraw, setDragged: markLightMoved })

  return (
    <>
      <div ref={host} className="home-light-host" aria-hidden="true" data-degraded={degraded || undefined} />
      <div ref={bulbHost} className="home-light-scene" aria-hidden="true" data-degraded={degraded || undefined} />
      <button
        type="button"
        ref={fixture}
        className="home-light"
        hidden={!effectsEnabled}
        aria-label="Move the light. Use arrow keys to change its position."
        onKeyDown={event => {
          if (event.altKey || event.ctrlKey || event.metaKey) return
          const dx = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
          const dy = event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0
          if (dx === 0 && dy === 0) return
          event.preventDefault()
          const point = currentLight()
          anchor.current = clampToViewport({ x: point.x + dx, y: point.y + dy })
          driftEpoch.current = performance.now()
          markLightMoved()
          redraw()
        }}
        data-dragged={dragged || undefined}
        data-degraded={degraded || undefined}
        data-bulbless={bulbless || undefined}
      >
        <span className="home-light-mark" aria-hidden="true" />
        <span className="home-light-hint" aria-hidden="true">Drag the light</span>
      </button>
      <HomeMastheadContent mastheadRef={masthead} headingRef={title} lineRefs={[lineOne,lineTwo,lineThree]}
        lightHeight={lightHeight} onLightHeight={setLightHeight} degraded={degraded || !effectsEnabled}>
        {children}
      </HomeMastheadContent>
    </>
  )
}
