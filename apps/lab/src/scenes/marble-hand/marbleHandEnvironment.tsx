// Marble-hand environment — the native page supplies the reflected room.
//
// The law: HTML remains the only visible page. A full-page capture appears
// only in a private reflection scene, never as a page presenter. The native
// colour fields still supply room bounce and the four page lights.
//
// The fault, 2026-08-30: lighting the old page-sized mesh changed the page
// itself. This environment reads layout only at DOM change boundaries and
// captures the full page from the moving hand at a separate update rate. The
// initial field-only reflection omitted all headings and labels; those now
// come from the browser's actual paint through a source-only Surface.
//
// The second fault, 2026-08-31: the page's colour now comes from a canvas,
// and cloneNode gives a blank one, so the capture carries transparent pixels
// where the field used to be. This scene draws that field itself, from the
// same GLSL and the same published second as the page canvas, on a plane
// directly behind the captured page.
//
// Ownership: native DOM owns text, input and paint. This module owns the
// room model, private cube target, PMREM target, the reflected copy of the
// background field, and swatch lights. Surface owns the borrowed full-page
// texture, including its type and other content.

import { useEffect, useLayoutEffect, useMemo, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  marbleEnvironmentRays,
  nextMarbleReflectionTime,
  paintMarbleEnvironment,
  type MarblePageField,
} from './marbleHandEnvironmentLaw'
import { marbleBackgroundClock } from './marbleHandBackgroundClock'
import { createMarbleBackgroundMaterial, setMarbleBackgroundFrame } from './marbleHandBackgroundShaders'
import type { MarbleHandThemeId } from './marbleHandThemes'
import type { MarbleHandTuning } from './marbleHandTuning'
import type { MarblePageCaptureState } from './marbleHandPageCapture'

// Knobs' 256×128 room resolves broad material reflections.
// The flat 128×80 raster remains CPU-backed and never becomes a GPU texture.
const ENV_WIDTH = 256
const ENV_HEIGHT = 128
const FLAT_WIDTH = 128
const FLAT_HEIGHT = 80
// A 256px cube face preserves heading strokes on polished Chrome. Knobs'
// smaller colour-field map remains sufficient for the room's soft bounce.
const REFLECTION_FACE_SIZE = 256
const ROOM_RADIUS = 10000
const FIELDS = '.mh-themes, .mh-theme-button, .mh-theme-preview'
const BOUNDARIES = ['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'pointercancel', 'focusin', 'focusout']

interface PaintField {
  x: number
  y: number
  width: number
  height: number
  color: string
  borders: readonly { width: number; color: string }[]
  inset: { width: number; color: string } | null
  swatch: string | null
}

interface EnvironmentState {
  flat: CanvasRenderingContext2D
  env: CanvasRenderingContext2D
  field: MarblePageField
  image: ImageData
  rays: Float32Array
  texture: THREE.CanvasTexture | null
  pmrem: THREE.PMREMGenerator | null
  target: THREE.WebGLRenderTarget | null
  weights: number[]
  revision: number
  signature: number
  bakes: number
  modelKey: string
  bakeKey: string
  lastBake: number
  nextBake: number
  bakeFps: number
  reflectionScene: THREE.Scene
  cube: THREE.WebGLCubeRenderTarget
  camera: THREE.CubeCamera
  pageMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  roomMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  backgroundMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  backgroundMaterials: Map<MarbleHandThemeId, THREE.ShaderMaterial>
  backgroundTime: number
}

function context(width: number, height: number, cpu = false): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const result = canvas.getContext('2d', { willReadFrequently: cpu })
  if (!result) throw new Error('The marble environment needs a 2D canvas.')
  return result
}

function measureField(element: HTMLElement, viewport: DOMRect, swatch: string | null): PaintField {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const shadowColor = style.boxShadow.match(/rgba?\([^)]+\)/)?.[0]
  const shadowNumbers = style.boxShadow.replace(shadowColor ?? '', '').match(/-?[\d.]+px/g)?.map(parseFloat)
  const inset = style.boxShadow.includes('inset') && shadowColor && shadowNumbers?.length === 4 &&
    shadowNumbers[0] === 0 && shadowNumbers[1] === 0 && shadowNumbers[2] === 0 && shadowNumbers[3] > 0
    ? { color: shadowColor, width: shadowNumbers[3] }
    : null
  return {
    x: rect.left - viewport.left,
    y: rect.top - viewport.top,
    width: rect.width,
    height: rect.height,
    color: style.backgroundColor,
    borders: [
      { width: parseFloat(style.borderTopWidth), color: style.borderTopColor },
      { width: parseFloat(style.borderRightWidth), color: style.borderRightColor },
      { width: parseFloat(style.borderBottomWidth), color: style.borderBottomColor },
      { width: parseFloat(style.borderLeftWidth), color: style.borderLeftColor },
    ],
    inset,
    swatch,
  }
}

function paintField(ctx: CanvasRenderingContext2D, field: PaintField) {
  const { x, y, width, height } = field
  ctx.fillStyle = field.color
  ctx.fillRect(x, y, width, height)
  const strips = [
    [x, y, width, field.borders[0].width],
    [x + width - field.borders[1].width, y, field.borders[1].width, height],
    [x, y + height - field.borders[2].width, width, field.borders[2].width],
    [x, y, field.borders[3].width, height],
  ]
  strips.forEach((strip, index) => {
    ctx.fillStyle = field.borders[index].color
    ctx.fillRect(strip[0], strip[1], strip[2], strip[3])
  })
  if (field.inset) {
    const edge = field.inset.width
    ctx.fillStyle = field.inset.color
    ctx.fillRect(x, y, width, edge)
    ctx.fillRect(x, y + height - edge, width, edge)
    ctx.fillRect(x, y, edge, height)
    ctx.fillRect(x + width - edge, y, edge, height)
  }
}

function backgroundMaterialFor(state: EnvironmentState, theme: MarbleHandThemeId): THREE.ShaderMaterial {
  const existing = state.backgroundMaterials.get(theme)
  if (existing) return existing
  const created = createMarbleBackgroundMaterial(theme)
  state.backgroundMaterials.set(theme, created)
  return created
}

export function MarbleHandEnvironment({ page, origin, tuning, capture, theme }: {
  page: RefObject<HTMLElement | null>
  origin: THREE.Vector3
  tuning: MarbleHandTuning
  capture: MarblePageCaptureState
  theme: MarbleHandThemeId
}) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const lights = useMemo(() => Array.from({ length: 4 }, () => new THREE.PointLight(0xffffff, 0, 0, 2)), [])
  const state = useMemo<EnvironmentState>(() => {
    const env = context(ENV_WIDTH, ENV_HEIGHT)
    const reflectionScene = new THREE.Scene()
    const cube = new THREE.WebGLCubeRenderTarget(REFLECTION_FACE_SIZE, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    })
    const camera = new THREE.CubeCamera(1, ROOM_RADIUS * 2, cube)
    const pageMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      toneMapped: false,
      premultipliedAlpha: true,
    }))
    pageMesh.name = 'marble-hand-reflection-page'
    pageMesh.visible = false
    // The capture is transparent where the page's canvas stood, so the page
    // has to blend rather than paint the field out.
    pageMesh.material.transparent = true
    pageMesh.renderOrder = 2
    const backgroundMaterial = createMarbleBackgroundMaterial('waves')
    const backgroundMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backgroundMaterial)
    backgroundMesh.name = 'marble-hand-reflection-background'
    backgroundMesh.visible = false
    // Coincident with the page plane, so the field shows no parallax against
    // the type it sits behind. Order decides which wins, not depth.
    backgroundMesh.renderOrder = 1
    const roomMesh = new THREE.Mesh(new THREE.SphereGeometry(ROOM_RADIUS, 32, 16), new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      toneMapped: false,
      depthWrite: false,
    }))
    roomMesh.name = 'marble-hand-reflection-room'
    roomMesh.renderOrder = 0
    reflectionScene.add(roomMesh, backgroundMesh, pageMesh)
    const field: MarblePageField = {
      pixels: new Uint8ClampedArray(FLAT_WIDTH * FLAT_HEIGHT * 4),
      width: FLAT_WIDTH,
      height: FLAT_HEIGHT,
      viewportWidth: 0,
      viewportHeight: 0,
    }
    return {
      flat: context(FLAT_WIDTH, FLAT_HEIGHT, true), env, field,
      image: env.createImageData(ENV_WIDTH, ENV_HEIGHT),
      rays: marbleEnvironmentRays(ENV_WIDTH, ENV_HEIGHT),
      texture: null, pmrem: null, target: null,
      weights: [0, 0, 0, 0], revision: 0, signature: 0, bakes: 0,
      modelKey: '', bakeKey: '', lastBake: -Infinity, nextBake: -Infinity, bakeFps: 0,
      reflectionScene, cube, camera, pageMesh, roomMesh, backgroundMesh,
      backgroundMaterials: new Map([['waves', backgroundMaterial]]),
      backgroundTime: 0,
    }
  }, [])

  useEffect(() => {
    const previous = scene.environment
    const previousIntensity = scene.environmentIntensity
    state.texture = new THREE.CanvasTexture(state.env.canvas)
    state.texture.mapping = THREE.EquirectangularReflectionMapping
    state.texture.colorSpace = THREE.SRGBColorSpace
    state.roomMesh.material.map = state.texture
    state.roomMesh.material.needsUpdate = true
    state.pmrem = new THREE.PMREMGenerator(gl)
    state.pmrem.compileCubemapShader()
    // Restored render targets have no pixels even when the DOM and hand
    // are still. Force a fresh source upload and PMREM bake in that case.
    const restore = () => {
      state.bakeKey = ''
      state.lastBake = -Infinity
      state.nextBake = -Infinity
      if (state.texture) state.texture.needsUpdate = true
    }
    restore()
    gl.domElement.addEventListener('webglcontextrestored', restore)
    // Taking the value as it is published, rather than reading the clock in
    // useFrame, keeps the reflected field on the page canvas's exact second
    // however the two render loops happen to be ordered within a frame.
    const stopClock = marbleBackgroundClock.subscribe((seconds) => {
      state.backgroundTime = seconds
      scene.userData.marbleBackgroundTime = seconds
    })
    return () => {
      stopClock()
      gl.domElement.removeEventListener('webglcontextrestored', restore)
      if (scene.environment === state.target?.texture) {
        scene.environment = previous
        scene.environmentIntensity = previousIntensity
      }
      state.target?.dispose()
      state.pmrem?.dispose()
      state.texture?.dispose()
      state.target = null
      state.pmrem = null
      state.texture = null
      state.cube.dispose()
      state.pageMesh.geometry.dispose()
      state.pageMesh.material.dispose()
      state.backgroundMesh.geometry.dispose()
      for (const material of state.backgroundMaterials.values()) material.dispose()
      state.backgroundMaterials.clear()
      state.roomMesh.geometry.dispose()
      state.roomMesh.material.dispose()
      for (const light of lights) light.dispose()
    }
  }, [gl, scene, state, lights])

  useEffect(() => {
    state.backgroundMesh.material = backgroundMaterialFor(state, theme)
    // The page's own theme attribute already moves state.revision, but the
    // reflected field must not wait on that to change programs.
    state.bakeKey = ''
  }, [state, theme])

  // The returned cleanup owns both observers, listener loops and the queued
  // measure frame. fonts.ready cannot be cancelled; `alive` prevents its
  // late resolution from scheduling new work after that cleanup has run.
  useLayoutEffect(() => {
    const root = page.current
    if (!root) return
    let raf = 0
    let alive = true
    const watched = new Set<HTMLElement>()
    const schedule = () => { if (!raf && alive) raf = requestAnimationFrame(measure) }
    const resize = new ResizeObserver(schedule)
    const measure = () => {
      raf = 0
      const viewport = gl.domElement.getBoundingClientRect()
      if (viewport.width <= 0 || viewport.height <= 0) return
      const elements = [root, ...root.querySelectorAll<HTMLElement>(FIELDS)]
      const currentElements = new Set(elements)
      for (const element of elements) {
        if (!watched.has(element)) { watched.add(element); resize.observe(element) }
      }
      for (const element of watched) {
        if (!currentElements.has(element)) { resize.unobserve(element); watched.delete(element) }
      }
      const fields = elements.map((element) => measureField(element, viewport,
        element.matches('.mh-theme-preview') ? element.closest('[data-theme-option]')?.getAttribute('data-theme-option') ?? null : null))
      const key = JSON.stringify([viewport.width, viewport.height, fields])
      if (key === state.modelKey) return
      state.modelKey = key
      const { flat, field } = state
      flat.setTransform(1, 0, 0, 1, 0, 0)
      flat.clearRect(0, 0, FLAT_WIDTH, FLAT_HEIGHT)
      flat.setTransform(FLAT_WIDTH / viewport.width, 0, 0, FLAT_HEIGHT / viewport.height, 0, 0)
      for (const item of fields) paintField(flat, item)
      // This canvas never feeds a texture, so this small colour read stays
      // on the CPU. The GPU-bound equirect canvas is never read back.
      field.pixels = flat.getImageData(0, 0, FLAT_WIDTH, FLAT_HEIGHT).data
      field.viewportWidth = viewport.width
      field.viewportHeight = viewport.height
      let signature = 2166136261
      for (const value of field.pixels) signature = Math.imul(signature ^ value, 16777619)
      state.signature = signature >>> 0
      const swatches = fields.filter((item) => item.swatch !== null).slice(0, 4)
      const visibleArea = (item: PaintField) =>
        Math.max(0, Math.min(viewport.width, item.x + item.width) - Math.max(0, item.x)) *
        Math.max(0, Math.min(viewport.height, item.y + item.height) - Math.max(0, item.y))
      const totalArea = swatches.reduce((sum, item) => sum + visibleArea(item), 0)
      lights.forEach((light, index) => {
        const item = swatches[index]
        state.weights[index] = 0
        if (!item || totalArea <= 0 || visibleArea(item) <= 0) return
        const x = item.x + item.width / 2
        const y = item.y + item.height / 2
        const sampleX = (Math.max(0, item.x) + Math.min(viewport.width, item.x + item.width)) / 2
        const sampleY = (Math.max(0, item.y) + Math.min(viewport.height, item.y + item.height)) / 2
        const column = Math.min(FLAT_WIDTH - 1, Math.floor(sampleX / viewport.width * FLAT_WIDTH))
        const row = Math.min(FLAT_HEIGHT - 1, Math.floor(sampleY / viewport.height * FLAT_HEIGHT))
        const pixel = (row * FLAT_WIDTH + column) * 4
        const r = field.pixels[pixel] / 255
        const g = field.pixels[pixel + 1] / 255
        const b = field.pixels[pixel + 2] / 255
        light.name = `marble-hand-page-light-${item.swatch}`
        light.position.set(x - viewport.width / 2, viewport.height / 2 - y, 0)
        light.color.setRGB(r, g, b, THREE.SRGBColorSpace)
        state.weights[index] = visibleArea(item) / totalArea *
          (0.2126 * r + 0.7152 * g + 0.0722 * b)
      })
      state.revision++
    }
    const mutation = new MutationObserver(schedule)
    mutation.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'style', 'data-selected', 'data-theme', 'data-theme-option', 'aria-pressed'] })
    for (const event of BOUNDARIES) root.addEventListener(event, schedule, true)
    window.addEventListener('resize', schedule, { passive: true })
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    document.fonts?.addEventListener('loadingdone', schedule)
    void document.fonts?.ready.then(schedule)
    measure()
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      resize.disconnect()
      mutation.disconnect()
      for (const event of BOUNDARIES) root.removeEventListener(event, schedule, true)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      document.fonts?.removeEventListener('loadingdone', schedule)
    }
  }, [page, gl, state, lights])

  useFrame(() => {
    lights.forEach((light, index) => { light.intensity = tuning.pageLightIntensity * state.weights[index] })
    if (!state.pmrem || !state.texture || state.revision === 0) return
    // Three uses the scene's intensity for an inherited environment map,
    // not material.envMapIntensity. On 2026-08-30, mirror values 0 and 3
    // produced identical pixels. Apply the active finish before the bake
    // limit: changing its strength needs no new capture or reflection map.
    scene.environmentIntensity = tuning.materialMode === 'chrome'
      ? tuning.chromeReflectionIntensity
      : tuning.envMapIntensity
    const now = performance.now()
    if (state.bakeFps !== tuning.reflectionFps) {
      state.bakeFps = tuning.reflectionFps
      state.nextBake = state.lastBake + 1000 / tuning.reflectionFps
    }
    if (now < state.nextBake) return
    // Eight-pixel lateral cells and four-pixel depth cells keep a resting
    // hand quiet while tracking changes below this coarse reflection map.
    // The DOM stops changing once the field moved into a canvas, so the
    // background's second is what tells a still page it still has to bake.
    // Quantising it to the bake interval keeps a held clock from baking.
    const beat = Math.round(state.backgroundTime * tuning.reflectionFps)
    const key = `${state.revision}|${capture.ready}:${capture.revision}:${capture.width}x${capture.height}|${Math.round(origin.x / 8)},${Math.round(origin.y / 8)},${Math.round(origin.z / 4)}|${tuning.roomBounce}|${theme}:${beat}`
    if (key === state.bakeKey) return
    // Only the room is approximated. The page's headings, glyphs, images,
    // backgrounds and borders come from the full captured texture below.
    paintMarbleEnvironment(state.field, origin, tuning.roomBounce, state.rays, state.image.data, false)
    state.env.putImageData(state.image, 0, 0)
    state.texture.needsUpdate = true
    const fullPage = capture.ready && capture.texture !== null
    state.pageMesh.visible = fullPage
    if (state.pageMesh.material.map !== capture.texture) {
      state.pageMesh.material.map = capture.texture
      state.pageMesh.material.needsUpdate = true
    }
    state.pageMesh.scale.set(capture.width || 1, capture.height || 1, 1)
    // Without HTML-in-canvas there is no capture to size against, and the
    // measured viewport is the same rectangle the page canvas fills.
    const fieldWidth = capture.width || state.field.viewportWidth
    const fieldHeight = capture.height || state.field.viewportHeight
    state.backgroundMesh.visible = fieldWidth > 0 && fieldHeight > 0
    state.backgroundMesh.scale.set(fieldWidth || 1, fieldHeight || 1, 1)
    setMarbleBackgroundFrame(state.backgroundMesh.material, state.backgroundTime, fieldWidth, fieldHeight)
    state.camera.position.copy(origin)
    // The private scene is never mounted in the page overlay. Its plane
    // cannot replace, cover, or receive input meant for the native HTML.
    state.camera.update(gl, state.reflectionScene)
    state.target = state.pmrem.fromCubemap(state.cube.texture, state.target ?? undefined)
    state.target.texture.name = 'marble-hand-page-environment'
    state.target.texture.userData.captureKind = fullPage ? 'full-page' : 'room-only'
    state.target.texture.userData.captureRevision = capture.revision
    state.target.texture.userData.sourceRevision = capture.sourceRevision
    state.target.texture.userData.sourceSignature = `${capture.sourceRevision}:${capture.revision}`
    state.target.texture.userData.sourceWidth = capture.width
    state.target.texture.userData.sourceHeight = capture.height
    state.target.texture.userData.backgroundTheme = theme
    state.target.texture.userData.backgroundTime = state.backgroundTime
    state.target.texture.userData.generation = ++state.bakes
    scene.environment = state.target.texture
    state.bakeKey = key
    state.lastBake = now
    state.nextBake = nextMarbleReflectionTime(now, state.nextBake, tuning.reflectionFps)
  })

  return <group>{lights.map((light) => <primitive key={light.uuid} object={light} />)}</group>
}
