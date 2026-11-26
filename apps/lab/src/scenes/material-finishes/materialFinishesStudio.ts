// Studio light rigs — the environment and lights the finishes are judged
// under, placed in viewport CSS terms over the matched cards.
//
// The law: a card facing the camera reflects what is behind the viewer, in
// a cone set by the perspective. With the camera about 965 CSS px from the
// cards at 1440×900, the cards' mirror directions span about ±9° in
// elevation and ±29° in azimuth around the view axis, so that cone is what
// the environment has to fill. three's RoomEnvironment puts its darker
// floor in the lower half of the cone, which darkened every glossy card's
// lower edge (2026-11-24 review). The built studio is one tone on every
// wall, with a broad soft panel overhead and a fill panel behind the viewer
// that covers the whole cone, so every card face reflects one even tone.
// A look can swap that fill for one that brightens toward its top, which
// a gloss shows as a falloff from each card's top edge to its bottom.
// The studio has no narrow strips. Inside the cone they laid bright bars
// under the outer cards' text. Outside it, a rounded edge turns its normal
// about 10° per CSS px, so a 9° strip reflected as a band under one device
// pixel wide and aliased: luminance along the product card's left rim
// jumped by 43 per pixel on lacquer and 24 on the glaze, against 0 on every
// other rim (m2 probe, 2026-11-25).
//
// A point light's mirror image on a coat at roughness 0.02 is a dot, and
// the first build's lacquer read as a dot over a broad wash. The softbox
// key is a RectAreaLight, whose image on a coat is its rectangle; three
// evaluates it for the base and the coat but not for sheen
// (PhysicalLightingModel.directRectArea at r186), so sheen takes its light
// from the rim and the environment. Charlie sheen peaks where the half
// vector leans far from the normal, which an overhead light seen from the
// front never gives: the rim light grazes the cards from the upper left at
// `rimElevation` degrees.
//
// Ownership: this module owns the rig's objects, the studio environment
// scene and their placement. MaterialFinishes mounts the lights the rig
// uses; each card's material places them before it draws.

import * as THREE from 'three'
import { RectAreaLightNode } from 'three/webgpu'
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js'
import type { SurfaceRenderFrame } from '@petepetrash/munari'
import { studio, type EnvironmentKind, type LightRig } from './materialFinishesTuning'

RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init())

export interface StudioLights {
  readonly point: THREE.PointLight
  readonly softbox: THREE.RectAreaLight
  readonly rim: THREE.DirectionalLight
}

export function createStudioLights(): StudioLights {
  return {
    point: new THREE.PointLight('#fffaf2', 0, 0, 2),
    softbox: new THREE.RectAreaLight('#fffaf2', 0, 1, 1),
    rim: new THREE.DirectionalLight('#fff4e6', 0),
  }
}

/** Which of the rig's lights are in the scene. */
export function lightsOf(rig: LightRig, lights: StudioLights): readonly THREE.Light[] {
  switch (rig) {
    case 'room':
      return [lights.point]
    case 'softbox':
      return [lights.softbox, lights.rim]
    case 'studio-point':
      return [lights.point, lights.rim]
  }
}

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

const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _forward = new THREE.Vector3()
const _toMesh = new THREE.Vector3()
const _cameraPosition = new THREE.Vector3()
const _key = new THREE.Vector3()
const _below = new THREE.Vector3()

/**
 * Stand the key over a viewport point, `studio.lightHeight` CSS px in front
 * of the plane the matched cards stand on, and aim the rim. A point key's
 * power scales with the squared height and a softbox's luminance with its
 * form factor, so the irradiance under the key is `lightPower` at any
 * world scale.
 */
export function placeStudioLights(lights: StudioLights, frame: SurfaceRenderFrame): void {
  // SAFETY: SurfaceCanvas creates a PerspectiveCamera unless `orthographic` is requested, and this scene does not request it.
  const camera = frame.camera as THREE.PerspectiveCamera
  const rect = frame.canvas.getBoundingClientRect()
  if (rect.height <= 0) return
  camera.matrixWorld.extractBasis(_right, _up, _forward)
  _forward.negate()
  camera.getWorldPosition(_cameraPosition)
  frame.mesh.getWorldPosition(_toMesh).sub(_cameraPosition)
  const depth = _toMesh.dot(_forward)
  const worldPerCss = (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / rect.height
  const x = (studio.lightX * window.innerWidth - rect.left - rect.width / 2) * worldPerCss
  const y = (rect.height / 2 - (studio.lightY * window.innerHeight - rect.top)) * worldPerCss
  const height = studio.lightHeight * worldPerCss
  _key
    .copy(_cameraPosition)
    .addScaledVector(_forward, depth - height)
    .addScaledVector(_right, x)
    .addScaledVector(_up, y)

  lights.point.position.copy(_key)
  lights.point.intensity = studio.lightPower * height * height

  const width = Math.max(studio.softboxWidth, 1) * worldPerCss
  const tall = Math.max(studio.softboxHeight, 1) * worldPerCss
  lights.softbox.position.copy(_key)
  lights.softbox.width = width
  lights.softbox.height = tall
  lights.softbox.up.copy(_up)
  lights.softbox.lookAt(_below.copy(_key).addScaledVector(_forward, height))
  lights.softbox.intensity = softboxLuminance(studio.lightPower, width, tall, height)

  // A directional light shines from its position toward its target, which
  // stays at the world origin.
  const elevation = THREE.MathUtils.degToRad(studio.rimElevation)
  const across = Math.cos(elevation) * Math.SQRT1_2
  lights.rim.position
    .set(0, 0, 0)
    .addScaledVector(_right, -across)
    .addScaledVector(_up, across)
    .addScaledVector(_forward, -Math.sin(elevation))
  lights.rim.intensity = studio.rimPower
  // The renderer read world matrices before this draw began.
  lights.point.updateMatrixWorld()
  lights.softbox.updateMatrixWorld()
  lights.rim.updateMatrixWorld()
}

// ── environment ────────────────────────────────────────────────────────

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

function panel(radiance: number, width: number, height: number, position: readonly [number, number, number]): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  material.color.setScalar(radiance)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
  mesh.position.set(...position)
  mesh.lookAt(0, 0, 0)
  return mesh
}

export interface StudioScene {
  readonly scene: THREE.Scene
  dispose(): void
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

/**
 * The studio as a scene to bake with PMREMGenerator.fromScene. World +z is
 * toward the viewer, which is where SurfaceCanvas's camera looks from.
 */
export function createStudioScene(environment: EnvironmentKind): StudioScene {
  const scene = new THREE.Scene()
  const wallMaterial = new THREE.MeshBasicMaterial({ side: THREE.BackSide })
  wallMaterial.color.setScalar(WALL)
  const room = new THREE.Mesh(new THREE.BoxGeometry(16, 12, 16), wallMaterial)
  scene.add(room)
  // Overhead, a broad panel for the cards' top edges and the fill.
  const overhead = panel(OVERHEAD, 10, 10, [0, 5.9, 0])
  // Behind the viewer, ±35° by ±16° around the view axis.
  const behind = environment === 'gradient' ? gradientPanel() : panel(BEHIND, 10, 4, [0, 0, 7])
  scene.add(overhead, behind)
  return {
    scene,
    dispose() {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          if (object.material instanceof THREE.Material) object.material.dispose()
        }
      })
    },
  }
}
