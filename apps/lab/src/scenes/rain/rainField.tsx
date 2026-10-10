// Rain field — the overlay canvas that turns rainLaw's world into pixels.
//
// The law: DOM owns geometry, the GPU owns water. This component never reads
// a class name or a piece of text; it reads getBoundingClientRect on a
// fixed selector list and hands rainLaw plain numbers. Everything it draws
// — where a bead sits, when it rolls, when it splashes — is rainLaw's
// answer to those numbers, not a decision made here.
//
// The renderer follows marble-hand's background discipline: a canvas made
// outside React, a manual resize/rAF loop, and dispose on unmount, which
// destroys the WebGPU device or loses the WebGL 2 context, so a remount
// never inherits a disposed one. The renderer starts asynchronously, so the
// loop, listeners and first draw are installed only once init resolves.
//
// Ownership: this component owns the canvas, the renderer, the instanced
// meshes and the fixed-dt loop. rainLaw owns the physics; the article
// element and its layout stay the page's.

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { DirectRenderPipeline, WebGPURenderer } from 'three/webgpu'
import { buildGlyphTerrain } from './rainGlyphMask'
import {
  createRainDropMaterial,
  createRainStreakMaterial,
  createRainStreakValues,
  createRainWaterMaterial,
  type RainStreakValues,
} from './rainNodes'
import {
  RAIN_SPLASH_LIFE_S,
  createRainWorld,
  makeRainRng,
  staticDew,
  staticDewWater,
  stepRainWorld,
  type GlyphTerrain,
  type Ledge,
  type RainDrop,
  type RainRng,
  type RainWorld,
} from './rainLaw'
import { RAIN_NO_SURFACE, type WaterField } from './rainWater'

// The headline is collision-tested against its own glyph terrain (see
// buildGlyphTerrain), not this flat box list — a per-column ink surface
// is what lets a drop fall between letters instead of landing on the h1's
// bounding box.
const RAIN_LEDGE_SELECTOR = '.rain-lede, .rain-card, .rain-tail'
// Shrinks each collision segment in from the element's true edges so a
// bead's visible radius never draws past the box it is pinned to.
const RAIN_LEDGE_INSET_PX = 2

// A column with less than this much standing water renders nothing — below
// it the quad would be a sub-pixel sliver that only adds draw calls.
const RAIN_WATER_RENDER_MIN_PX = 0.25
// Bounds the water instance buffer well above what any real headline's
// bowls hold at once (a handful of letters, a few dozen columns each) —
// One instance per wet column, and the headline alone spans ~1300 columns
// at this face size — at 256 the loop silently stopped rendering water
// past the first fifth of the headline (2026-09-01 capture).
const RAIN_WATER_MAX_INSTANCES = 2048
// Slightly wider than 1 column so adjacent wet columns' quads overlap
// instead of leaving a hairline gap at their shared edge.
const RAIN_WATER_COLUMN_WIDTH_PX = 1.6

// Device pixels, capped at 2 like marble-hand's field: the bead rim and
// specular dot are single-pixel detail that blurs below native resolution,
// and the eye stops resolving further gain above it.
const RAIN_PIXEL_RATIO_CAP = 2
const RAIN_MAX_INSTANCES = 400

const RAIN_STREAK_COUNT = 30
const RAIN_STREAK_ANGLE = 0.24
const RAIN_STREAK_LENGTH_PX = 70
const RAIN_STREAK_WIDTH_PX = 1.1

// A held tab or a debugger pause must not turn into one giant physics leap
// on return — cap the wall-clock step fed to the fixed-dt accumulator.
const RAIN_MAX_FRAME_DT = 0.1
const RAIN_STEP_DT = 1 / 60

function measureLedges(article: HTMLElement): Ledge[] {
  const ledges: Ledge[] = []
  for (const el of article.querySelectorAll(RAIN_LEDGE_SELECTOR)) {
    const rect = el.getBoundingClientRect()
    const x0 = rect.left + RAIN_LEDGE_INSET_PX
    const x1 = rect.right - RAIN_LEDGE_INSET_PX
    if (x1 <= x0) continue
    ledges.push({ x0, x1, y: rect.top })
  }
  return ledges
}

function measureH1Terrain(article: HTMLElement): GlyphTerrain | null {
  const h1 = article.querySelector('h1')
  return h1 ? buildGlyphTerrain(h1) : null
}

function fallingStretch(vy: number): number {
  // Visible streaking past a comfortable reading speed; capped so a drop
  // just off the roof never reads as a needle.
  return Math.min(1.9, 1 + Math.max(0, vy) / 650)
}

const DROP_MATRIX = new THREE.Matrix4()
const DROP_QUATERNION = new THREE.Quaternion()
const DROP_SCALE = new THREE.Vector3()
const DROP_POSITION = new THREE.Vector3()

function writeDropInstances(
  mesh: THREE.InstancedMesh,
  sitAttr: THREE.InstancedBufferAttribute,
  fadeAttr: THREE.InstancedBufferAttribute,
  drops: readonly RainDrop[],
): void {
  const count = Math.min(drops.length, RAIN_MAX_INSTANCES)
  for (let i = 0; i < count; i++) {
    const drop = drops[i]
    if (!drop) continue
    let diameter = drop.r * 2
    let scaleY = 1
    let sit = 0
    let fade = 1
    if (drop.kind === 'sitting') {
      sit = 1
      scaleY = 0.82
    } else if (drop.kind === 'falling') {
      scaleY = fallingStretch(drop.vy)
    } else {
      // Splash droplets shrink and fade together over their short life.
      fade = 1 - drop.age / RAIN_SPLASH_LIFE_S
      diameter *= fade
    }
    DROP_POSITION.set(drop.x, drop.y, 0)
    DROP_SCALE.set(diameter, diameter * scaleY, 1)
    DROP_MATRIX.compose(DROP_POSITION, DROP_QUATERNION, DROP_SCALE)
    mesh.setMatrixAt(i, DROP_MATRIX)
    sitAttr.setX(i, sit)
    fadeAttr.setX(i, Math.max(0, fade))
  }
  mesh.count = count
  mesh.instanceMatrix.needsUpdate = true
  sitAttr.needsUpdate = true
  fadeAttr.needsUpdate = true
}

const WATER_MATRIX = new THREE.Matrix4()
const WATER_QUATERNION = new THREE.Quaternion()
const WATER_SCALE = new THREE.Vector3()
const WATER_POSITION = new THREE.Vector3()

/** One quad per wet column: local y=+0.5 lands on the ink floor, y=-0.5 on the open surface. */
function writeWaterInstances(mesh: THREE.InstancedMesh, water: WaterField | null | undefined): void {
  if (!water) {
    mesh.count = 0
    return
  }
  const { terrain, depth } = water
  let count = 0
  for (let column = 0; column < depth.length && count < RAIN_WATER_MAX_INSTANCES; column++) {
    const d = depth[column]
    if (d < RAIN_WATER_RENDER_MIN_PX) continue
    const top = terrain.topInk[column]
    if (top === RAIN_NO_SURFACE) continue
    WATER_POSITION.set(terrain.left + column + 0.5, top - d / 2, 0)
    WATER_SCALE.set(RAIN_WATER_COLUMN_WIDTH_PX, d, 1)
    WATER_MATRIX.compose(WATER_POSITION, WATER_QUATERNION, WATER_SCALE)
    mesh.setMatrixAt(count, WATER_MATRIX)
    count++
  }
  mesh.count = count
  mesh.instanceMatrix.needsUpdate = true
}

interface FieldResources {
  renderer: WebGPURenderer
  pipeline: DirectRenderPipeline
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  dropMesh: THREE.InstancedMesh
  dropSit: THREE.InstancedBufferAttribute
  dropFade: THREE.InstancedBufferAttribute
  streakMesh: THREE.InstancedMesh
  streakValues: RainStreakValues
  waterMesh: THREE.InstancedMesh
}

function buildField(canvas: HTMLCanvasElement, rng: RainRng): FieldResources {
  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true, depth: false })
  renderer.setClearColor(0x000000, 0)
  // Converts each fragment as it lands on the canvas, so the beads blend in
  // the sRGB canvas as they did on WebGL (decisions.md #72).
  const pipeline = new DirectRenderPipeline(renderer)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1000, 1000)

  const dropGeometry = new THREE.PlaneGeometry(1, 1)
  const dropMesh = new THREE.InstancedMesh(dropGeometry, createRainDropMaterial(), RAIN_MAX_INSTANCES)
  dropMesh.frustumCulled = false
  dropMesh.count = 0
  dropMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  const dropSit = new THREE.InstancedBufferAttribute(new Float32Array(RAIN_MAX_INSTANCES), 1)
  const dropFade = new THREE.InstancedBufferAttribute(new Float32Array(RAIN_MAX_INSTANCES), 1)
  dropSit.setUsage(THREE.DynamicDrawUsage)
  dropFade.setUsage(THREE.DynamicDrawUsage)
  dropGeometry.setAttribute('aSit', dropSit)
  dropGeometry.setAttribute('aFade', dropFade)
  scene.add(dropMesh)

  const streakGeometry = new THREE.PlaneGeometry(1, 1)
  const streakValues = createRainStreakValues(RAIN_STREAK_ANGLE, RAIN_STREAK_LENGTH_PX, RAIN_STREAK_WIDTH_PX)
  const streakMesh = new THREE.InstancedMesh(streakGeometry, createRainStreakMaterial(streakValues), RAIN_STREAK_COUNT)
  streakMesh.frustumCulled = false
  const streakSeed = new Float32Array(RAIN_STREAK_COUNT * 3)
  for (let i = 0; i < RAIN_STREAK_COUNT; i++) {
    streakSeed[i * 3] = rng()
    streakSeed[i * 3 + 1] = rng()
    streakSeed[i * 3 + 2] = rng()
  }
  // Every streak's whole path is a function of this seed and the clock
  // uniform (see rainNodes.ts) — the identity instance matrix three
  // assigns at construction is correct forever and is never written again.
  streakGeometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(streakSeed, 3))
  scene.add(streakMesh)

  const waterGeometry = new THREE.PlaneGeometry(1, 1)
  const waterMesh = new THREE.InstancedMesh(waterGeometry, createRainWaterMaterial(), RAIN_WATER_MAX_INSTANCES)
  waterMesh.frustumCulled = false
  waterMesh.count = 0
  waterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(waterMesh)

  return { renderer, pipeline, scene, camera, dropMesh, dropSit, dropFade, streakMesh, streakValues, waterMesh }
}

interface FieldState {
  built: FieldResources | null
  ledges: Ledge[]
  h1Terrain: GlyphTerrain | null
  viewport: { width: number; height: number }
  world: RainWorld
  rng: RainRng
  reducedMotion: boolean
  draw: () => void
  start: () => void
  stop: () => void
}

function createFieldState(): FieldState {
  return {
    built: null,
    ledges: [],
    h1Terrain: null,
    viewport: { width: 1, height: 1 },
    world: createRainWorld(),
    rng: makeRainRng(0x5241a1),
    reducedMotion: false,
    draw: () => {},
    start: () => {},
    stop: () => {},
  }
}

// Rain while motion is allowed, a still dew otherwise.
function applyMotion(state: FieldState): void {
  if (state.reducedMotion) {
    state.stop()
    state.world = {
      drops: staticDew(state.ledges, state.rng),
      spawnDue: 0,
      h1Water: staticDewWater(state.h1Terrain, state.rng),
    }
    state.draw()
  } else {
    state.world = createRainWorld()
    state.start()
  }
}

export function RainField({ articleRef, reducedMotion }: {
  articleRef: React.RefObject<HTMLElement | null>
  reducedMotion: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const state = useMemo(createFieldState, [])
  const [degraded, setDegraded] = useState(false)

  useLayoutEffect(() => {
    const box = host.current
    if (!box) return
    const canvas = document.createElement('canvas')
    canvas.className = 'rain-field-canvas'
    box.append(canvas)

    let field: FieldResources
    try {
      field = buildField(canvas, state.rng)
    } catch {
      canvas.remove()
      setDegraded(true)
      return
    }

    let raf = 0
    let lastFrameTime = 0
    let accumulator = 0
    let streakClock = 0

    const remeasure = () => {
      const article = articleRef.current
      state.ledges = article ? measureLedges(article) : []
      state.h1Terrain = article ? measureH1Terrain(article) : null
      if (state.reducedMotion) {
        state.world = {
          drops: staticDew(state.ledges, state.rng),
          spawnDue: 0,
          h1Water: staticDewWater(state.h1Terrain, state.rng),
        }
        state.draw()
      }
    }

    const draw = () => {
      writeDropInstances(field.dropMesh, field.dropSit, field.dropFade, state.world.drops)
      writeWaterInstances(field.waterMesh, state.world.h1Water)
      field.streakValues.time.value = streakClock
      field.pipeline.render(field.scene, field.camera)
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = lastFrameTime ? Math.min(RAIN_MAX_FRAME_DT, (now - lastFrameTime) / 1000) : 0
      lastFrameTime = now
      streakClock += dt
      accumulator += dt
      while (accumulator >= RAIN_STEP_DT) {
        state.world = stepRainWorld(state.world, state.ledges, state.viewport, state.rng, state.h1Terrain)
        accumulator -= RAIN_STEP_DT
      }
      draw()
    }
    state.start = () => {
      if (raf) return
      lastFrameTime = 0
      raf = requestAnimationFrame(frame)
    }
    state.stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }

    const resize = () => {
      const width = Math.max(1, Math.round(window.innerWidth))
      const height = Math.max(1, Math.round(window.innerHeight))
      state.viewport = { width, height }
      field.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RAIN_PIXEL_RATIO_CAP))
      field.renderer.setSize(width, height, false)
      // top=0, bottom=height maps world y downward, matching
      // getBoundingClientRect — no flip needed anywhere else in the field.
      field.camera.left = 0
      field.camera.right = width
      field.camera.top = 0
      field.camera.bottom = height
      field.camera.updateProjectionMatrix()
      field.streakValues.viewport.value.set(width, height)
      remeasure()
      draw()
    }

    const resizeObserver = new ResizeObserver(remeasure)
    let cancelled = false
    // render() throws until init resolves, so nothing that draws is
    // reachable before then.
    const started = field.renderer.init()
    void started.then(
      () => {
        if (cancelled) return
        state.built = field
        state.draw = draw
        if (articleRef.current) resizeObserver.observe(articleRef.current)
        window.addEventListener('resize', resize)
        resize()
        // The motion effect already ran at mount, while nothing was built.
        applyMotion(state)
      },
      () => {
        if (cancelled) return
        canvas.remove()
        setDegraded(true)
      },
    )

    // The display face can still be swapping in when the first resize
    // runs, changing the h1's rendered glyph metrics without firing a
    // resize or a layout the ResizeObserver would catch — re-rasterize
    // once the font is actually the one being measured.
    document.fonts.ready
      .then(() => {
        if (!cancelled) remeasure()
      })
      .catch(() => {})

    return () => {
      cancelled = true
      state.stop()
      resizeObserver.disconnect()
      window.removeEventListener('resize', resize)
      state.built = null
      state.draw = () => {}
      state.start = () => {}
      state.stop = () => {}
      field.dropMesh.geometry.dispose()
      field.streakMesh.geometry.dispose()
      field.waterMesh.geometry.dispose()
      for (const mesh of [field.dropMesh, field.streakMesh, field.waterMesh]) {
        if (!Array.isArray(mesh.material)) mesh.material.dispose()
      }
      field.pipeline.dispose()
      // dispose() skips the backend while init is pending, so a renderer
      // unmounted mid-init would keep its device or context. After a failed
      // init, Three 0.186's dispose() leaves an unhandled rejection, so that
      // renderer is left as it is.
      const dispose = () => field.renderer.dispose()
      void started.then(dispose, () => {})
      canvas.remove()
    }
  }, [state, articleRef])

  useLayoutEffect(() => {
    state.reducedMotion = reducedMotion
    if (!state.built) return
    applyMotion(state)
    return () => state.stop()
  }, [state, reducedMotion])

  return <div ref={host} className="rain-field" data-fallback={degraded || undefined} />
}
