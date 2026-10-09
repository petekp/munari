// The poster background — a second renderer's canvas living inside the page.
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
import { DirectRenderPipeline, WebGPURenderer } from 'three/webgpu'
import {
  MARBLE_BACKGROUND_REDUCED_TIME,
  marbleBackgroundClock,
} from './marbleHandBackgroundClock'
import { createMarbleBackgroundMaterial, setMarbleBackgroundFrame, type MarbleBackgroundMaterial } from './marbleHandBackgroundNodes'
import type { MarbleHandThemeId } from './marbleHandThemes'
import type { MarbleHandTuning } from './marbleHandTuning'
import { useRendererReplacement } from '../../lib/rendererReplacement'
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

// Device pixels, capped at 2: the tide's filaments and single-pixel
// glitter resolve at native resolution, and below it the whole field
// blurs. Above 2 the eye stops resolving the gain but the fill cost keeps
// growing.
const FIELD_PIXEL_RATIO = 2
// A 64px square read back from the middle of the canvas. Wide enough that
// every theme moves something inside it within one frame, small enough that
// the copy it forces stays cheap.
const HASH_SPAN = 64

interface FieldState {
  /** Set only once the renderer's init has resolved. */
  renderer: WebGPURenderer | null
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  mesh: THREE.Mesh<THREE.PlaneGeometry, MarbleBackgroundMaterial>
  materials: Map<MarbleHandThemeId, MarbleBackgroundMaterial>
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
  // material also serves the page-sized plane in the reflection scene.
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

function materialFor(state: FieldState, theme: MarbleHandThemeId): MarbleBackgroundMaterial {
  const existing = state.materials.get(theme)
  if (existing) return existing
  const created = createMarbleBackgroundMaterial(theme)
  state.materials.set(theme, created)
  return created
}

// A 2D canvas copy of the field's centre. drawImage reads the frame a draw
// just submitted only within the same task, on WebGPU and WebGL 2 alike,
// so the hash must follow its draw directly.
let hashCanvas: CanvasRenderingContext2D | null = null

function hashFrame(canvas: HTMLCanvasElement): number {
  const span = Math.min(HASH_SPAN, canvas.width, canvas.height)
  if (span <= 0) return 0
  if (!hashCanvas) {
    const copy = document.createElement('canvas')
    copy.width = HASH_SPAN
    copy.height = HASH_SPAN
    hashCanvas = copy.getContext('2d', { willReadFrequently: true })
    if (!hashCanvas) throw new Error('The marble field hash needs a 2D canvas.')
  }
  const x = Math.floor((canvas.width - span) / 2)
  const y = Math.floor((canvas.height - span) / 2)
  hashCanvas.clearRect(0, 0, HASH_SPAN, HASH_SPAN)
  hashCanvas.drawImage(canvas, x, y, span, span, 0, 0, span, span)
  const pixels = hashCanvas.getImageData(0, 0, span, span).data
  let hash = 2166136261
  for (let index = 0; index < span * span * 4; index += 3) {
    hash = Math.imul(hash ^ pixels[index], 16777619)
  }
  return hash >>> 0
}

function applyMotion(state: FieldState, motion: boolean, reducedMotion: boolean): (() => void) | undefined {
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
}

export function MarbleHandBackground({ theme, motion, reducedMotion, tuning }: {
  theme: MarbleHandThemeId
  motion: boolean
  reducedMotion: boolean
  tuning: MarbleHandTuning
}) {
  const host = useRef<HTMLDivElement>(null)
  const state = useMemo(createFieldState, [])
  const [degraded, setDegraded] = useState(false)
  const { generation, lost } = useRendererReplacement()
  // The renderer starts asynchronously and must compile the theme selected
  // when it is ready, not the default one, or an arrival on any other theme
  // pays for two.
  const selected = useRef(theme)
  selected.current = theme
  // The draw closure lives inside the mount effect; the ref keeps it on
  // the latest panel values without re-mounting the renderer.
  const tuningRef = useRef(tuning)
  tuningRef.current = tuning
  // The motion effect runs at mount, before the renderer is ready, so the
  // ready handler applies whatever motion holds by then.
  const motionRef = useRef({ motion, reducedMotion })
  motionRef.current = { motion, reducedMotion }

  useLayoutEffect(() => {
    const box = host.current
    if (!box) return
    // React must not own this canvas. A remount reuses its DOM node, and a
    // second getContext on a canvas that already holds one is not a second
    // context — the renderer would inherit the disposed one's state.
    const canvas = document.createElement('canvas')
    canvas.className = 'mh-field'
    box.append(canvas)
    const renderer = new WebGPURenderer({ canvas, antialias: false, alpha: false, depth: false })
    // Converts each fragment as it lands on the canvas, the conversion the
    // field's output assumes (decisions.md #72).
    const pipeline = new DirectRenderPipeline(renderer)
    let cancelled = false

    let raf = 0
    const draw = () => {
      const time = marbleBackgroundClock.now()
      setMarbleBackgroundFrame(state.mesh.material, time, state.width, state.height, tuningRef.current)
      pipeline.render(state.scene, state.camera)
      state.handle.time = time
      state.handle.draws += 1
    }
    const frame = () => {
      raf = requestAnimationFrame(frame)
      marbleBackgroundClock.sample()
      draw()
      state.handle.frames += 1
    }
    const start = () => {
      if (raf || state.handle.contextLost) return
      state.handle.running = true
      frame()
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
      state.handle.running = false
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

    // render() throws until init resolves, so nothing that draws is
    // reachable before then.
    const started = renderer.init()
    void started.then(
      () => {
        if (cancelled) return
        state.renderer = renderer
        state.handle.contextLost = false
        setDegraded(false)
        // A fresh canvas is 300×150 whatever the last one measured, so the
        // size this state remembers cannot be allowed to skip the first resize.
        state.width = 0
        state.height = 0
        state.handle.theme = selected.current
        state.mesh.material = materialFor(state, selected.current)
        renderer.setClearColor(0x000000, 1)
        state.draw = draw
        state.start = start
        state.stop = stop
        // A composited frame's buffer is gone by the time an instrument can
        // ask for it. Redraw, then read back the buffer that draw just made.
        state.handle.sampleHash = () => {
          draw()
          return hashFrame(canvas)
        }
        // A lost device must leave the page intact: the loop stops and the
        // CSS gradient takes the poster back until a replacement starts
        // (rendererReplacement.ts).
        const report = renderer.onDeviceLost
        renderer.onDeviceLost = (info) => {
          report.call(renderer, info)
          if (cancelled) return
          state.handle.contextLost = true
          setDegraded(true)
          state.stop()
          lost(generation)
        }
        observer.observe(box)
        resize()
        window.__marbleBackground = state.handle
        applyMotion(state, motionRef.current.motion, motionRef.current.reducedMotion)
      },
      () => {
        // Neither WebGPU nor WebGL 2 in the page. The CSS gradient below is
        // the poster.
        if (cancelled) return
        canvas.remove()
        setDegraded(true)
      },
    )

    return () => {
      cancelled = true
      state.stop()
      observer.disconnect()
      if (window.__marbleBackground === state.handle) window.__marbleBackground = undefined
      state.draw = () => {}
      state.start = () => {}
      state.stop = () => {}
      state.handle.sampleHash = () => 0
      for (const material of state.materials.values()) material.dispose()
      state.materials.clear()
      state.renderer = null
      pipeline.dispose()
      // dispose() skips the backend while init is pending, so a renderer
      // unmounted mid-init would keep its device or context. After a failed
      // init, Three 0.186's dispose() leaves an unhandled rejection, so that
      // renderer is left as it is.
      const dispose = () => renderer.dispose()
      void started.then(dispose, () => {})
      canvas.remove()
    }
  }, [state, generation, lost])

  // A paused or reduced-motion field still has to show a slider's change.
  useEffect(() => {
    if (state.renderer) state.draw()
  }, [state, tuning])

  useEffect(() => {
    state.handle.theme = theme
    if (!state.renderer) return
    state.mesh.material = materialFor(state, theme)
    state.draw()
  }, [state, theme])

  useEffect(() => {
    if (!state.renderer) return
    return applyMotion(state, motion, reducedMotion)
  }, [state, motion, reducedMotion])

  return <div ref={host} className="mh-background" data-visualization={theme} data-fallback={degraded || undefined} />
}
