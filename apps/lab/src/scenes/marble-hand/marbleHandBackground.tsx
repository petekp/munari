// The poster background — a second WebGL canvas living inside the page.
//
// The law: the field is drawn, not animated. Nothing here writes to the DOM
// per frame, so a quiescent page still costs the reflection capture zero
// repaints while the colour keeps moving.
//
// The fault, 2026-08-31: the earlier SVG poster animated forty marked nodes,
// and every one of them had to have its CSS clock re-seeded in the reflection
// copy after each re-clone. A node that lost its mark drifted silently, and
// nothing in the page could show it. One shader and one published second
// replaced the whole mechanism.
//
// Ownership: this component owns the canvas element, its renderer, the rAF
// loop and the clock's running state. The environment owns the reflection
// copy of the same material. Native HTML above this canvas owns all type.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  MARBLE_BACKGROUND_REDUCED_TIME,
  marbleBackgroundClock,
} from './marbleHandBackgroundClock'
import { createMarbleBackgroundMaterial, setMarbleBackgroundFrame } from './marbleHandBackgroundShaders'
import type { MarbleHandThemeId } from './marbleHandThemes'
import './marbleHandBackground.css'

/** The gate's read-only view of the field: what is drawn, and from when. */
export interface MarbleBackgroundProbe {
  theme: MarbleHandThemeId
  /** Frames the rAF loop drew. Stops dead while the clock is held. */
  frames: number
  /** Every frame drawn, the loop's and the ones a resize or theme forced. */
  draws: number
  /** The published second the last drawn frame used. */
  time: number
  running: boolean
  contextLost: boolean
  /** Draw off the loop and hash it; counts as a draw, never as a frame. */
  sampleHash: () => number
}

// Beyond 1.5 the field costs more than it shows: it is a soft colour wash
// behind 288px type, not an edge the eye can resolve at device pixels.
const FIELD_PIXEL_RATIO = 1.5
// A 64px square read back from the middle of the canvas. Wide enough that
// every theme moves something inside it within one frame, small enough that
// the pipeline flush it forces stays under a millisecond.
const HASH_SPAN = 64

interface FieldState {
  renderer: THREE.WebGLRenderer | null
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  materials: Map<MarbleHandThemeId, THREE.ShaderMaterial>
  pixels: Uint8Array
  width: number
  height: number
  handle: MarbleBackgroundProbe
  draw: () => void
  start: () => void
  stop: () => void
}

function createFieldState(): FieldState {
  const scene = new THREE.Scene()
  // The quad spans the whole clip volume, so this camera never moves and one
  // vertex program also serves the page-sized plane in the reflection scene.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), createMarbleBackgroundMaterial('waves'))
  mesh.frustumCulled = false
  scene.add(mesh)
  return {
    renderer: null,
    scene,
    camera,
    mesh,
    materials: new Map([['waves', mesh.material]]),
    pixels: new Uint8Array(HASH_SPAN * HASH_SPAN * 4),
    width: 0,
    height: 0,
    handle: {
      theme: 'waves',
      frames: 0,
      draws: 0,
      time: 0,
      running: false,
      contextLost: false,
      sampleHash: () => 0,
    },
    draw: () => {},
    start: () => {},
    stop: () => {},
  }
}

function materialFor(state: FieldState, theme: MarbleHandThemeId): THREE.ShaderMaterial {
  const existing = state.materials.get(theme)
  if (existing) return existing
  const created = createMarbleBackgroundMaterial(theme)
  state.materials.set(theme, created)
  return created
}

function hashFrame(renderer: THREE.WebGLRenderer, pixels: Uint8Array): number {
  const context = renderer.getContext()
  const span = Math.min(HASH_SPAN, context.drawingBufferWidth, context.drawingBufferHeight)
  if (span <= 0) return 0
  const x = Math.floor((context.drawingBufferWidth - span) / 2)
  const y = Math.floor((context.drawingBufferHeight - span) / 2)
  context.readPixels(x, y, span, span, context.RGBA, context.UNSIGNED_BYTE, pixels)
  let hash = 2166136261
  for (let index = 0; index < span * span * 4; index += 3) {
    hash = Math.imul(hash ^ pixels[index], 16777619)
  }
  return hash >>> 0
}

export function MarbleHandBackground({ theme, motion, reducedMotion }: {
  theme: MarbleHandThemeId
  motion: boolean
  reducedMotion: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const state = useMemo(createFieldState, [])
  const [degraded, setDegraded] = useState(false)
  // The mount effect must compile the selected theme's program, not the
  // default one, or an arrival on any other theme pays for two.
  const selected = useRef(theme)
  selected.current = theme

  useLayoutEffect(() => {
    const box = host.current
    if (!box) return
    // React must not own this canvas. A remount reuses its DOM node, and a
    // second getContext on a canvas that already holds one is not a second
    // context — the renderer would inherit the disposed one's state.
    const canvas = document.createElement('canvas')
    canvas.className = 'mh-field'
    box.append(canvas)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false })
    } catch {
      // No WebGL in the page at all. The CSS gradient below is the poster.
      canvas.remove()
      setDegraded(true)
      return
    }
    state.renderer = renderer
    // A fresh canvas is 300×150 whatever the last one measured, so the size
    // this state remembers cannot be allowed to skip the first resize.
    state.width = 0
    state.height = 0
    state.handle.theme = selected.current
    state.mesh.material = materialFor(state, selected.current)
    renderer.setClearColor(0x000000, 1)

    let raf = 0
    const draw = () => {
      const time = marbleBackgroundClock.now()
      setMarbleBackgroundFrame(state.mesh.material, time, state.width, state.height)
      renderer.render(state.scene, state.camera)
      state.handle.time = time
      state.handle.draws += 1
    }
    const frame = () => {
      raf = requestAnimationFrame(frame)
      marbleBackgroundClock.sample()
      draw()
      state.handle.frames += 1
    }
    state.draw = draw
    state.start = () => {
      if (raf || state.handle.contextLost) return
      state.handle.running = true
      frame()
    }
    state.stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
      state.handle.running = false
    }
    // A composited frame's buffer is gone by the time an instrument can ask
    // for it. Redraw, then read back the buffer that draw just made.
    state.handle.sampleHash = () => {
      draw()
      return hashFrame(renderer, state.pixels)
    }

    const resize = () => {
      const rect = box.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      if (width === state.width && height === state.height) return
      state.width = width
      state.height = height
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, FIELD_PIXEL_RATIO))
      renderer.setSize(width, height, false)
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(box)
    resize()

    // A lost context must leave the page intact: the loop stops and the CSS
    // gradient takes the poster back until the browser restores the context.
    const lost = (event: Event) => {
      event.preventDefault()
      state.handle.contextLost = true
      setDegraded(true)
      state.stop()
    }
    const restored = () => {
      state.handle.contextLost = false
      setDegraded(false)
      state.width = 0
      resize()
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    window.__marbleBackground = state.handle

    return () => {
      state.stop()
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
      if (window.__marbleBackground === state.handle) window.__marbleBackground = undefined
      state.draw = () => {}
      state.start = () => {}
      state.stop = () => {}
      state.handle.sampleHash = () => 0
      for (const material of state.materials.values()) material.dispose()
      state.materials.clear()
      state.renderer = null
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [state])

  useEffect(() => {
    state.handle.theme = theme
    if (!state.renderer) return
    state.mesh.material = materialFor(state, theme)
    state.draw()
  }, [state, theme])

  useEffect(() => {
    if (!state.renderer) return
    if (reducedMotion) {
      // One still, at a second where no field sits on its t = 0 symmetry.
      marbleBackgroundClock.freezeAt(MARBLE_BACKGROUND_REDUCED_TIME)
      state.stop()
      state.draw()
      return
    }
    if (!motion) {
      marbleBackgroundClock.pause()
      state.stop()
      state.draw()
      return
    }
    marbleBackgroundClock.resume()
    state.start()
    return () => state.stop()
  }, [state, motion, reducedMotion])

  return <div ref={host} className="mh-background" data-visualization={theme} data-fallback={degraded || undefined} />
}
