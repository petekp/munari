// Finish rig — the key, rim and environments a SurfaceCanvas lights its
// finishes with, shared by every finish on the canvas.
//
// The law: three's WebGPU renderer reads a light's uniforms once per frame,
// so every finish on a canvas is lit by the same lights at the same values
// (measured 2026-11-26: on one shared set of lights, cards whose rigs
// differed all drew under the rig that placed the lights last). A finish
// that wants more or less light scales them in its own shader
// (finishLightingModel.ts). The lights stay out of the scene and reach only
// finish materials through `material.lightsNode`, so the scene's own
// materials and lights are untouched.
//
// The studio was tuned in viewport CSS terms over match-dom cards: the key
// stands `z` CSS px in front of the plane the mesh stands on, and its power
// scales with the squared height (a point key) or its form factor (a
// softbox), so the irradiance under it holds at any world scale. Every
// match-dom mesh stands at the same depth, so every finish places the
// lights at the same values; a finish on a mesh at another depth moves them
// for every finish drawn after it in that frame (unmeasured).
//
// A card facing the camera reflects what is behind the viewer, in a cone
// set by the perspective: at 1440×900 the mirror directions span about ±9°
// in elevation and ±29° in azimuth. The studio environment is one tone on
// every wall, with a broad panel overhead and a fill panel behind the viewer
// covering that cone; the gradient kind brightens that fill toward its top.
// It has no narrow strips: a rounded edge turns its normal about 10° per CSS
// px, so a 9° strip reflected as a band under one device pixel wide and
// aliased (m2 probe, 2026-11-25).
//
// The costs a finish pays before its first frame live here: one PMREM bake
// per environment kind the canvas uses, after the renderer initializes, and
// for a softbox key, three's LTC tables, loaded on first use.
//
// Ownership: this module owns the light objects, the environment bakes and
// their placement. It loads with the finish code, and finishLoader.tsx gives
// each canvas its rig. SurfaceFinishMaterial asks for what its finish needs
// and places the lights before it draws.

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { PMREMGenerator, RectAreaLightNode, WebGPURenderer, type LightsNode } from 'three/webgpu'
import { lights as lightsNodeOf } from 'three/tsl'

import type { KeySheenUniforms } from './finishKeyLight'
import type { FinishValues } from './surfaceFinish'
import { attachSurfaceLight, isSurfaceLight, KEY_HEIGHT_PX, KEY_REST_Y, type KeyLight, type SurfaceLight, type SurfaceLighting } from './surfaceLight'
import type { SurfaceRenderFrame } from './surfaceFrame'

// ── studio values ──────────────────────────────────────────────────────

// The irradiance under the studio key, the rim's, and the environment's
// intensity, at which the 17 finish presets were tuned on m2 (2026-11-24 to
// 11-26) and which brightness 1 names. By eye, unmeasured.
const STUDIO_KEY_POWER = 1.55
const STUDIO_RIM_POWER = 1.2
const STUDIO_ENVIRONMENT = 1.35
// Charlie sheen peaks where the half vector leans far from the normal, which
// an overhead key seen from the front gives only at the rounded edges, so
// the rim grazes the cards from the upper left this many degrees above the
// page. By eye, unmeasured.
const STUDIO_RIM_ELEVATION = 15
// A PMREM blur this small keeps the panels' edges, which a coat at roughness
// 0.02 reflects. By eye, unmeasured.
const STUDIO_BLUR = 0.01
const KEY_COLOR = '#fffaf2'
const RIM_COLOR = '#fff4e6'

// Linear radiance. The walls set the fill under the key; the panels are
// what glossy and metal cards reflect. The behind-viewer fill is a trade:
// brighter keeps dark ink legible on aluminum, darker keeps lacquer deep.
// By eye, unmeasured.
const WALL = 0.22
const OVERHEAD = 1.2
const BEHIND = 0.6
// The gradient fill runs from FLOOR to SKY across the cards' mirror cone,
// ±9° in elevation, which at the panel's 7 units is about ±1.1 units. A
// coat reflects 4% of it, so the sky has to be several times the even fill
// for the falloff to show on a dark lacquer. By eye, unmeasured.
const GRADIENT_FLOOR = 0.12
const GRADIENT_SKY = 2.6
const GRADIENT_SPAN = 1.2

export type EnvironmentKind = FinishValues['environment']
export type KeyKind = 'point' | 'softbox'

// ── environment ────────────────────────────────────────────────────────

function panel(radiance: number, width: number, height: number, position: readonly [number, number, number]): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  material.color.setScalar(radiance)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
  mesh.position.set(...position)
  mesh.lookAt(0, 0, 0)
  return mesh
}

function gradientPanel(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(10, 4, 1, 24)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  for (let index = 0; index < position.count; index++) {
    const t = THREE.MathUtils.smoothstep(position.getY(index), -GRADIENT_SPAN, GRADIENT_SPAN)
    colors.fill(THREE.MathUtils.lerp(GRADIENT_FLOOR, GRADIENT_SKY, t), index * 3, index * 3 + 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: true }))
  mesh.position.set(0, 0, 7)
  mesh.lookAt(0, 0, 0)
  return mesh
}

/** The studio as a scene to bake. World +z is toward the viewer, where SurfaceCanvas's camera looks from. */
function studioScene(kind: EnvironmentKind): THREE.Scene {
  const scene = new THREE.Scene()
  const wallMaterial = new THREE.MeshBasicMaterial({ side: THREE.BackSide })
  wallMaterial.color.setScalar(WALL)
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(16, 12, 16), wallMaterial))
  // Overhead, a broad panel for the cards' top edges and the fill.
  scene.add(panel(OVERHEAD, 10, 10, [0, 5.9, 0]))
  // Behind the viewer, ±35° by ±16° around the view axis.
  scene.add(kind === 'gradient' ? gradientPanel() : panel(BEHIND, 10, 4, [0, 0, 7]))
  return scene
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    if (object.material instanceof THREE.Material) object.material.dispose()
  })
}

// three's RectAreaLight needs its LTC tables, 2 × 64² float texels, before a
// softbox key compiles. Loaded once per page, on the first softbox key.
// A load that fails leaves the key a point light rather than holding a
// finish that waits for it.
let ltcLoad: Promise<void> | null = null
let ltcLoaded = false
let ltcFailed = false
function loadLtc(): Promise<void> {
  ltcLoad ??= import('three/examples/jsm/lights/RectAreaLightTexturesLib.js').then(
    ({ RectAreaLightTexturesLib }) => {
      RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init())
      ltcLoaded = true
    },
    (error) => {
      ltcFailed = true
      console.error('[munari] the softbox key could not load its LTC tables, so it lights as a point key.', error)
    },
  )
  return ltcLoad
}

// ── the rig ────────────────────────────────────────────────────────────

interface StudioLighting {
  readonly key: SurfaceLight | KeyLight
  readonly rim: { readonly brightness: number; readonly elevation: number } | null
  readonly environmentIntensity: number
}

export function studioLightingOf(lighting: Exclude<SurfaceLighting, 'none'>): StudioLighting {
  if (lighting === 'studio') return { key: {}, rim: { brightness: 1, elevation: STUDIO_RIM_ELEVATION }, environmentIntensity: 1 }
  const rim = lighting.rim === false ? null : { brightness: lighting.rim?.brightness ?? 1, elevation: lighting.rim?.elevation ?? STUDIO_RIM_ELEVATION }
  return { key: lighting.key ?? {}, rim, environmentIntensity: lighting.environmentIntensity ?? 1 }
}

function keyOf(key: SurfaceLight | KeyLight): KeyLight {
  if (!isSurfaceLight(key)) return key
  const { x, y, z, brightness, size } = key.get()
  return { x: x ?? undefined, y: y ?? undefined, z, brightness, size: size ?? undefined }
}

const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _forward = new THREE.Vector3()
const _toMesh = new THREE.Vector3()
const _cameraPosition = new THREE.Vector3()
const _key = new THREE.Vector3()
const _below = new THREE.Vector3()

/**
 * Luminance that gives irradiance `power` straight under the center of a
 * `width` × `height` rectangle `distance` away: four times the corner form
 * factor of a parallel rectangle, times π.
 */
function softboxLuminance(power: number, width: number, height: number, distance: number): number {
  const x = width / 2 / distance
  const y = height / 2 / distance
  const sx = Math.sqrt(1 + x * x)
  const sy = Math.sqrt(1 + y * y)
  const cornerFormFactor = ((x / sx) * Math.atan(y / sx) + (y / sy) * Math.atan(x / sy)) / (2 * Math.PI)
  return power / (Math.PI * 4 * cornerFormFactor)
}

/** What a finish material reads from its canvas's rig. */
export interface FinishRig {
  /** The key's kind now; a change rebuilds every finish on the canvas. */
  keyKind(): KeyKind
  /** The lights a finish material on this canvas is lit by. */
  lightsNode(kind: KeyKind): LightsNode
  /** The baked environment, or null until it is. */
  environment(kind: EnvironmentKind): THREE.Texture | null
  environmentIntensity(): number
  /** Start the bake this finish needs, and the softbox tables when the key is one. */
  prepare(environment: EnvironmentKind): void
  /** Whether a finish reflecting `environment` can compile under the current key. */
  ready(environment: EnvironmentKind): boolean
  /** Called when a bake or load lands or the key's kind changes. */
  subscribe(listener: () => void): () => void
  /** Place the lights over `frame`'s mesh and write the key's own uniforms for its sheen and scatter. */
  place(frame: SurfaceRenderFrame, key: KeySheenUniforms): void
}

export function createFinishRig(renderer: WebGPURenderer, invalidate: () => void) {
  let lighting: StudioLighting = studioLightingOf('studio')
  let detach: (() => void) | null = null
  const point = new THREE.PointLight(KEY_COLOR, 0, 0, 2)
  const softbox = new THREE.RectAreaLight(KEY_COLOR, 0, 1, 1)
  const rim = new THREE.DirectionalLight(RIM_COLOR, 0)
  const nodes = {
    point: lightsNodeOf([point, rim]),
    softbox: lightsNodeOf([softbox, rim]),
  } satisfies Record<KeyKind, LightsNode>
  // Null after a bake that failed: the finish draws without an environment.
  const environments = new Map<EnvironmentKind, THREE.Texture | null>()
  const bakes = new Map<EnvironmentKind, THREE.RenderTarget | null>()
  const listeners = new Set<() => void>()
  // Bumped by dispose, so a bake that lands after it is dropped, and a
  // rig whose effects run again (Strict Mode, <Activity>) bakes afresh.
  let generation = 0
  const changed = () => {
    for (const listener of [...listeners]) listener()
    invalidate()
  }
  const wantsSoftbox = () => Boolean(keyOf(lighting.key).size) && !ltcFailed
  // The kind the finishes compile with: a softbox only once its tables are in.
  const keyKind = (): KeyKind => (wantsSoftbox() && ltcLoaded ? 'softbox' : 'point')
  let lastKind = keyKind()
  const loadSoftbox = () => {
    if (!wantsSoftbox() || ltcLoaded) return
    const born = generation
    void loadLtc().then(() => born === generation && changed())
  }

  const bake = (kind: EnvironmentKind) => {
    if (bakes.has(kind)) return
    bakes.set(kind, null)
    const born = generation
    renderer
      .init()
      .then(() => {
        if (born !== generation) return
        const generator = new PMREMGenerator(renderer)
        const scene = studioScene(kind)
        const target = generator.fromScene(scene, STUDIO_BLUR)
        disposeScene(scene)
        generator.dispose()
        bakes.set(kind, target)
        environments.set(kind, target.texture)
        changed()
      })
      .catch((error) => {
        if (born !== generation) return
        console.error('[munari] a finish environment could not be baked, so finishes draw without it.', error)
        environments.set(kind, null)
        changed()
      })
  }

  const rig: FinishRig = {
    keyKind,
    lightsNode: (kind) => nodes[kind],
    environment: (kind) => environments.get(kind) ?? null,
    environmentIntensity: () => STUDIO_ENVIRONMENT * lighting.environmentIntensity,
    prepare(environment) {
      bake(environment)
      loadSoftbox()
    },
    ready: (environment) => environments.has(environment) && (!wantsSoftbox() || ltcLoaded),
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    place(frame, uniforms) {
      // SAFETY: SurfaceCanvas creates a PerspectiveCamera unless the scene
      // asks for an orthographic one; isPerspectiveCamera checks it below.
      const camera = frame.camera as THREE.PerspectiveCamera
      const rect = frame.canvas.getBoundingClientRect()
      if (rect.height <= 0 || !camera.isPerspectiveCamera) return
      const key = keyOf(lighting.key)
      camera.matrixWorld.extractBasis(_right, _up, _forward)
      _forward.negate()
      camera.getWorldPosition(_cameraPosition)
      frame.mesh.getWorldPosition(_toMesh).sub(_cameraPosition)
      const depth = _toMesh.dot(_forward)
      const worldPerCss = (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / rect.height
      const keyX = key.x ?? window.innerWidth / 2
      const keyY = key.y ?? window.innerHeight * KEY_REST_Y
      const x = (keyX - rect.left - rect.width / 2) * worldPerCss
      const y = (rect.height / 2 - (keyY - rect.top)) * worldPerCss
      const height = (key.z ?? KEY_HEIGHT_PX) * worldPerCss
      const power = STUDIO_KEY_POWER * (key.brightness ?? 1)
      _key.copy(_cameraPosition).addScaledVector(_forward, depth - height).addScaledVector(_right, x).addScaledVector(_up, y)

      point.position.copy(_key)
      point.intensity = power * height * height
      const kind = keyKind()
      if (key.size) {
        const width = Math.max(key.size[0], 1) * worldPerCss
        const tall = Math.max(key.size[1], 1) * worldPerCss
        softbox.position.copy(_key)
        softbox.width = width
        softbox.height = tall
        softbox.up.copy(_up)
        softbox.lookAt(_below.copy(_key).addScaledVector(_forward, height))
        softbox.intensity = softboxLuminance(power, width, tall, height)
      }

      // A directional light shines from its position toward its target,
      // which stays at the world origin.
      const elevation = THREE.MathUtils.degToRad(lighting.rim?.elevation ?? STUDIO_RIM_ELEVATION)
      const across = Math.cos(elevation) * Math.SQRT1_2
      rim.position.set(0, 0, 0).addScaledVector(_right, -across).addScaledVector(_up, across).addScaledVector(_forward, -Math.sin(elevation))
      rim.intensity = lighting.rim ? STUDIO_RIM_POWER * lighting.rim.brightness : 0
      // The renderer read world matrices before this draw began.
      point.updateMatrixWorld()
      softbox.updateMatrixWorld()
      rim.updateMatrixWorld()

      uniforms.position.value.copy(_key).applyMatrix4(camera.matrixWorldInverse)
      // three gives a point key its sheen itself; only a softbox's is emitted.
      uniforms.radiantIntensity.value.copy(softbox.color).multiplyScalar(kind === 'softbox' ? point.intensity : 0)
      uniforms.intensity.value.copy(point.color).multiplyScalar(point.intensity)
      if (kind !== lastKind) {
        lastKind = kind
        queueMicrotask(changed)
      }
    },
  }

  // Every move redraws a demand canvas; a change of kind also tells the
  // finishes to rebuild.
  const keyMoved = () => {
    loadSoftbox()
    const kind = keyKind()
    if (kind === lastKind) return invalidate()
    lastKind = kind
    changed()
  }
  return {
    rig,
    /**
     * Take the canvas's current `lighting`: a value write, which keeps the
     * baked environments. Written during render, so the finishes rendering
     * after it read the same key; `connect` runs the effects.
     */
    configure(next: StudioLighting) {
      lighting = next
    },
    connect() {
      const handle = isSurfaceLight(lighting.key) ? lighting.key : null
      detach = handle ? attachSurfaceLight(handle, keyMoved) : null
      keyMoved()
      return () => {
        detach?.()
        detach = null
      }
    },
    dispose() {
      generation += 1
      detach?.()
      detach = null
      for (const target of bakes.values()) target?.dispose()
      bakes.clear()
      environments.clear()
      listeners.clear()
    },
  }
}

/** Re-render when the rig's readiness or key kind changes. */
export interface FinishRigState {
  readonly ready: boolean
  readonly keyKind: KeyKind
}

export function useFinishRigState(rig: FinishRig | null, environment: EnvironmentKind): FinishRigState {
  const subscribe = useMemo(() => rig?.subscribe ?? (() => () => {}), [rig])
  const keyKind = useSyncExternalStore<KeyKind>(subscribe, () => rig?.keyKind() ?? 'point', () => 'point')
  const ready = useSyncExternalStore(subscribe, () => rig?.ready(environment) ?? true, () => false)
  useEffect(() => rig?.prepare(environment), [rig, environment])
  return { ready, keyKind }
}
