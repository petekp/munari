// Bulb — the 3D object that is the overview's light: a warm frosted globe
// hanging from a cord that runs off the top of the viewport, with a dark
// socket between them and a glow rendered as light, not paint.
//
// The law: this module only builds and animates the model. It owns no
// renderer, camera, scene, or canvas — HomeMasthead.tsx drives all of those
// and repositions the group to the light's viewport position every frame.
// The globe's centre IS the light the shadow shader projects from, so the
// two can never disagree about where the light is.
//
// Fault: the first masthead drew the light as a CSS radial gradient. It
// read as clip art on a page whose whole claim is that HTML and 3D are one
// thing (Pete, 2026-09-05).
//
// Ownership: this module owns geometry, materials, the cord's sway, and the
// halo. HomeMasthead.tsx owns the scene, camera, environment map, and when
// update()/dispose() run.

import * as THREE from 'three'

/** The globe's radius, CSS px — the drag handle in home.css is sized from it. */
export const BULB_RADIUS = 30
const SOCKET_RADIUS = 11
const SOCKET_HEIGHT = 16
const CORD_RADIUS = 1.1
// Long enough to leave the top of any viewport from any position.
const CORD_LENGTH = 4000
const HALO_SIZE = 420

// The globe is a frosted shell over a bright core: the shell's rim darkens
// and catches the room, the core is what reads as the filament's glow.
const GLASS_COLOR = 0xfff1c8
const GLASS_EMISSIVE = 0xffb040
const GLASS_EMISSIVE_INTENSITY = 0.32
const GLASS_OPACITY = 0.72
const CORE_COLOR = 0xfff6dc
const CORE_RADIUS = BULB_RADIUS * 0.52
const SOCKET_COLOR = 0x1a1815
const CORD_COLOR = 0x14140f
const HALO_COLOR = 0xfff0b8
const HALO_OPACITY = 0.42

// The cord sways with the bulb's horizontal speed and settles like a
// damped pendulum: stiffness and damping per second, angle in radians.
const SWAY_PER_PX_PER_S = 0.00045
const SWAY_MAX = 0.35
const SWAY_STIFFNESS = 14
const SWAY_DAMPING = 5

export interface LightBulb {
  readonly group: THREE.Group
  /** Moves the bulb to `x, y` (world px, y up) and advances the sway by `dt` seconds. */
  update(x: number, y: number, dt: number, still: boolean): void
  dispose(): void
}

// The halo is painted per pixel with a dither: an 8-bit canvas gradient
// bands into visible rings once additive blending lays it over a flat wash.
function haloTexture(): THREE.DataTexture {
  const size = 256
  const data = new Uint8Array(size * size * 4)
  const half = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half
      const dy = (y + 0.5 - half) / half
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy))
      const falloff = Math.pow(1 - r, 2.6)
      const dither = (Math.random() - 0.5) * 1.5
      const value = Math.max(0, Math.min(255, Math.round(falloff * 255 + dither)))
      const i = (y * size + x) * 4
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = value
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

export function createLightBulb(): LightBulb {
  const group = new THREE.Group()
  // The hanging part pivots at the globe's centre, so the light source
  // stays put while the cord swings.
  const hanger = new THREE.Group()
  group.add(hanger)

  const coreMaterial = new THREE.MeshBasicMaterial({ color: CORE_COLOR })
  const core = new THREE.Mesh(new THREE.SphereGeometry(CORE_RADIUS, 32, 24), coreMaterial)
  group.add(core)

  const glass = new THREE.MeshPhysicalMaterial({
    color: GLASS_COLOR,
    emissive: GLASS_EMISSIVE,
    emissiveIntensity: GLASS_EMISSIVE_INTENSITY,
    roughness: 0.14,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.6,
    transparent: true,
    opacity: GLASS_OPACITY,
  })
  const globe = new THREE.Mesh(new THREE.SphereGeometry(BULB_RADIUS, 48, 32), glass)
  globe.renderOrder = 1
  group.add(globe)

  const metal = new THREE.MeshPhysicalMaterial({
    color: SOCKET_COLOR,
    roughness: 0.45,
    metalness: 0.85,
    envMapIntensity: 1.4,
  })
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(SOCKET_RADIUS * 0.8, SOCKET_RADIUS, SOCKET_HEIGHT, 32), metal)
  socket.position.y = BULB_RADIUS + SOCKET_HEIGHT / 2 - 5
  hanger.add(socket)
  const collar = new THREE.Mesh(new THREE.TorusGeometry(SOCKET_RADIUS * 0.82, 1.4, 12, 40), metal)
  collar.rotation.x = Math.PI / 2
  collar.position.y = BULB_RADIUS + SOCKET_HEIGHT - 5
  hanger.add(collar)

  const cordMaterial = new THREE.MeshStandardMaterial({ color: CORD_COLOR, roughness: 0.8, metalness: 0 })
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(CORD_RADIUS, CORD_RADIUS, CORD_LENGTH, 10), cordMaterial)
  cord.position.y = BULB_RADIUS + SOCKET_HEIGHT - 5 + CORD_LENGTH / 2
  hanger.add(cord)

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(),
    color: HALO_COLOR,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    opacity: HALO_OPACITY,
    toneMapped: false,
  }))
  halo.scale.setScalar(HALO_SIZE)
  halo.renderOrder = -1
  group.add(halo)

  // A point light inside the globe so the socket and collar are lit by the
  // bulb, not only by the room.
  const inner = new THREE.PointLight(GLASS_EMISSIVE, 2.2, BULB_RADIUS * 8, 1.6)
  group.add(inner)

  let lastX = Number.NaN
  let angle = 0
  let velocity = 0

  return {
    group,
    update(x, y, dt, still) {
      const speed = Number.isNaN(lastX) || dt <= 0 ? 0 : (x - lastX) / dt
      lastX = x
      group.position.set(x, y, 0)
      const target = still ? 0 : THREE.MathUtils.clamp(-speed * SWAY_PER_PX_PER_S, -SWAY_MAX, SWAY_MAX)
      const step = Math.min(dt, 1 / 30)
      velocity += (SWAY_STIFFNESS * (target - angle) - SWAY_DAMPING * velocity) * step
      angle += velocity * step
      hanger.rotation.z = angle
    },
    dispose() {
      core.geometry.dispose()
      coreMaterial.dispose()
      globe.geometry.dispose()
      glass.dispose()
      socket.geometry.dispose()
      collar.geometry.dispose()
      metal.dispose()
      cord.geometry.dispose()
      cordMaterial.dispose()
      halo.material.map?.dispose()
      halo.material.dispose()
    },
  }
}

// A perspective camera at (w/2, h/2, D) looking down -Z maps the z=0 plane
// 1:1 onto CSS px, so the globe renders exactly at the light's position
// while the socket and cord above it lean with real perspective near the
// viewport's edges.
const CAMERA_DISTANCE = 1600

export function fitBulbCamera(camera: THREE.PerspectiveCamera, width: number, height: number) {
  camera.aspect = width / height
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(height / (2 * CAMERA_DISTANCE)))
  camera.near = 1
  camera.far = CAMERA_DISTANCE * 3
  camera.position.set(width / 2, height / 2, CAMERA_DISTANCE)
  camera.up.set(0, 1, 0)
  camera.lookAt(width / 2, height / 2, 0)
  camera.updateProjectionMatrix()
}
