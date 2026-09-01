// Gravity poetry — a paragraph that loses words to the page below.
//
// The law: press a word and it leaves the flow it sat in — the paragraph
// reflows natively, on the browser's own layout clock — and a rigid body
// carrying its exact pixels rides the pointer until release, then falls
// into a WebGL pile on the floor of the viewport. Click a fallen word and
// the trade reverses: the body is gone, the span is back, and the
// paragraph reflows around it again.
//
// Ownership: the DOM owns the poem, its layout, and every reflow a removed
// word causes. The overlay canvas owns only the pixels of words already
// gone from that flow — it never draws a word still sitting in the text.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  boundsFromViewport,
  clampToBounds,
  hitTestBody,
  settleInstant,
  spawnBody,
  stepWorld,
  type GravityBody,
  type GravityBounds,
} from './gravityLaw'
import './gravity.css'

const POEM =
  'Hope is the thing with feathers That perches in the soul, ' +
  'And sings the tune without the words, And never stops at all, ' +
  'And sweetest in the gale is heard; And sore must be the storm ' +
  'That could abash the little bird That kept so many warm.'
const WORDS = POEM.split(' ')

// Device pixels for the word canvas: sharp glyphs without paying for a
// texture larger than any screen will show at these font sizes.
const TEXTURE_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 2)
const CANVAS_PIXEL_RATIO = 2
// A flick faster than this reads as a throw, not a nudge — clamped so a
// fast mouse move can't launch a word off the top of the screen.
const MAX_LAUNCH_SPEED = 1400 // px/s
const SPAWN_TORQUE = 2.5 // rad/s, half-range of the random spin on release

const HIDDEN_STYLE: React.CSSProperties = { display: 'none' }

interface WordMesh {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  readonly material: THREE.MeshBasicMaterial
  readonly texture: THREE.CanvasTexture
}

interface GravityState {
  renderer: THREE.WebGLRenderer | null
  readonly scene: THREE.Scene
  readonly camera: THREE.OrthographicCamera
  bodies: GravityBody[]
  readonly meshes: Map<number, WordMesh>
  bounds: GravityBounds
  raf: number
  lastTime: number
  draw: () => void
  wake: () => void
}

function createGravityState(): GravityState {
  return {
    renderer: null,
    scene: new THREE.Scene(),
    camera: new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1),
    bodies: [],
    meshes: new Map(),
    bounds: boundsFromViewport(1, 1),
    raf: 0,
    lastTime: 0,
    draw: () => {},
    wake: () => {},
  }
}

/** Paints one word's live style onto an offscreen canvas at device
 *  resolution, so the fallen twin reads exactly like the word that left. */
function paintWord(span: HTMLSpanElement) {
  const rect = span.getBoundingClientRect()
  const style = getComputedStyle(span)
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * TEXTURE_PIXEL_RATIO)
  canvas.height = Math.ceil(height * TEXTURE_PIXEL_RATIO)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.scale(TEXTURE_PIXEL_RATIO, TEXTURE_PIXEL_RATIO)
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    ctx.fillStyle = style.color
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(span.textContent ?? '', 0, height / 2)
  }
  return { canvas, rect }
}

function makeWordMesh(canvas: HTMLCanvasElement, width: number, height: number): WordMesh {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // Premultiplied alpha, library-wide (decisions.md #5): the canvas paints
  // straight alpha, this flag multiplies it into rgb on upload, and the
  // material below blends on that same assumption.
  texture.premultiplyAlpha = true
  // The CSS-mapped camera mirrors Y; with default flipY the word lands
  // upside down.
  texture.flipY = false
  texture.needsUpdate = true
  const material = new THREE.MeshBasicMaterial({
    // The CSS-mapped camera (top 0, bottom height) mirrors Y, which reverses
    // on-screen winding — with front-face culling every quad vanishes.
    side: THREE.DoubleSide,
    map: texture,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
  return { mesh, material, texture }
}

function disposeWordMesh(word: WordMesh): void {
  word.mesh.geometry.dispose()
  word.material.dispose()
  word.texture.dispose()
}

function clampLaunchSpeed(value: number): number {
  return Math.max(-MAX_LAUNCH_SPEED, Math.min(MAX_LAUNCH_SPEED, value))
}

/** Local copy of the same reduced-motion hook every scene keeps beside
 *  itself — see plume/Plume.tsx for the twin. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    const change = () => setReduced(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  return reduced
}

export function GravityApp() {
  const hostRef = useRef<HTMLDivElement>(null)
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])
  const state = useMemo(createGravityState, [])
  const [removed, setRemoved] = useState<ReadonlySet<number>>(new Set())

  const reducedMotion = useReducedMotion()
  const reducedMotionRef = useRef(reducedMotion)
  reducedMotionRef.current = reducedMotion

  // The gesture that just pulled a word also dispatches a native 'click'
  // right after this component hides its span — without this guard that
  // click immediately re-hits the just-spawned body and puts the word
  // straight back, which is untestable-by-eye but happens on every pull.
  const justPulledRef = useRef<number | null>(null)
  const pointerRef = useRef({ x: 0, y: 0, vx: 0, vy: 0, t: 0 })
  // The word currently riding the pointer: its body id and the grab point's
  // offset from the body centre, so the word doesn't snap to the cursor.
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null)

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const p = pointerRef.current
      const now = performance.now()
      const dt = (now - p.t) / 1000
      if (dt > 0 && dt < 0.2) {
        const vx = (event.clientX - p.x) / dt
        const vy = (event.clientY - p.y) / dt
        p.vx = p.vx * 0.7 + vx * 0.3
        p.vy = p.vy * 0.7 + vy * 0.3
      }
      p.x = event.clientX
      p.y = event.clientY
      p.t = now

      const drag = dragRef.current
      if (drag) {
        const body = state.bodies.find((candidate) => candidate.id === drag.id)
        if (body) {
          body.x = event.clientX - drag.dx
          body.y = event.clientY - drag.dy
          // Velocity rides along so collisions mid-drag push with the
          // pointer's momentum, and release inherits it for free.
          body.vx = p.vx
          body.vy = p.vy
        }
      }
    }
    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      const body = state.bodies.find((candidate) => candidate.id === drag.id)
      if (body) {
        body.held = false
        body.vx = clampLaunchSpeed(body.vx)
        body.vy = clampLaunchSpeed(body.vy)
        body.angularVelocity = (Math.random() - 0.5) * SPAWN_TORQUE
        state.wake()
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [state])

  // ── the overlay: a full-viewport canvas, owned outside React exactly
  // like marble-hand's background field — React never touches this node. ──
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const canvas = document.createElement('canvas')
    canvas.className = 'gv-canvas'
    host.append(canvas)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, depth: false })
    } catch {
      canvas.remove()
      return
    }
    renderer.setClearColor(0x000000, 0)
    state.renderer = renderer

    const draw = () => {
      renderer.render(state.scene, state.camera)
    }
    const loop = () => {
      const now = performance.now()
      const dt = (now - state.lastTime) / 1000
      state.lastTime = now
      if (!reducedMotionRef.current) stepWorld(state.bodies, state.bounds, dt)
      for (const body of state.bodies) {
        const word = state.meshes.get(body.id)
        if (!word) continue
        word.mesh.position.set(body.x, body.y, 0)
        word.mesh.rotation.z = body.angle
      }
      draw()
      state.raf = state.bodies.some((body) => !body.asleep) ? requestAnimationFrame(loop) : 0
    }
    state.draw = draw
    state.wake = () => {
      if (state.raf) return
      state.lastTime = performance.now()
      state.raf = requestAnimationFrame(loop)
    }

    const resize = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, CANVAS_PIXEL_RATIO))
      renderer.setSize(width, height, false)
      state.camera.right = width
      state.camera.bottom = height
      state.camera.updateProjectionMatrix()
      state.bounds = boundsFromViewport(width, height)
      clampToBounds(state.bodies, state.bounds)
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const lost = (event: Event) => {
      event.preventDefault()
      cancelAnimationFrame(state.raf)
      state.raf = 0
    }
    const restored = () => {
      resize()
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)

    return () => {
      cancelAnimationFrame(state.raf)
      state.raf = 0
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
      state.draw = () => {}
      state.wake = () => {}
      for (const word of state.meshes.values()) disposeWordMesh(word)
      state.meshes.clear()
      state.bodies = []
      state.renderer = null
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [state])

  // ── click a fallen word to put it back ──────────────────────────────
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const skip = justPulledRef.current
      justPulledRef.current = null
      for (const body of state.bodies) {
        if (body.id === skip || !body.asleep) continue
        if (!hitTestBody(body, event.clientX, event.clientY)) continue
        event.preventDefault()
        event.stopPropagation()
        const word = state.meshes.get(body.id)
        if (word) {
          state.scene.remove(word.mesh)
          disposeWordMesh(word)
          state.meshes.delete(body.id)
        }
        state.bodies = state.bodies.filter((candidate) => candidate.id !== body.id)
        state.draw()
        setRemoved((prev) => {
          const next = new Set(prev)
          next.delete(body.id)
          return next
        })
        return
      }
    }
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [state])

  const handlePull = (index: number, event: React.MouseEvent) => {
    if (!state.renderer || removed.has(index)) return
    const span = wordRefs.current[index]
    if (!span) return
    const { canvas, rect } = paintWord(span)
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)
    const word = makeWordMesh(canvas, width, height)
    state.scene.add(word.mesh)
    state.meshes.set(index, word)

    const body = spawnBody(index, { x: rect.left, y: rect.top, w: width, h: height }, { vx: 0, vy: 0 }, 0)
    if (reducedMotionRef.current) {
      settleInstant(body, state.bounds, state.bodies)
    } else {
      // The word doesn't drop yet — it rides the pointer until mouseup.
      body.held = true
      dragRef.current = { id: index, dx: event.clientX - body.x, dy: event.clientY - body.y }
      event.preventDefault()
    }
    state.bodies.push(body)
    word.mesh.position.set(body.x, body.y, 0)
    word.mesh.rotation.z = body.angle
    state.draw()
    if (!reducedMotionRef.current) state.wake()

    justPulledRef.current = index
    setRemoved((prev) => {
      const next = new Set(prev)
      next.add(index)
      return next
    })
  }

  return (
    <div className="gv-page">
      <p className="gv-poem">
        {WORDS.map((word, index) => (
          <Fragment key={index}>
            {index > 0 ? ' ' : null}
            <span
              ref={(el) => {
                wordRefs.current[index] = el
              }}
              className="gv-word"
              style={removed.has(index) ? HIDDEN_STYLE : undefined}
              onMouseDown={(event) => handlePull(index, event)}
            >
              {word}
            </span>
          </Fragment>
        ))}
      </p>
      <p className="gv-hint">Drag a word out and drop it. Click a fallen word to put it back.</p>
      <div ref={hostRef} className="gv-overlay" />
    </div>
  )
}
