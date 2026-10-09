// Lantern — the 3D object standing on the page: a lit base, bulging glass
// globe, vented dome cap, arched handle, and a flickering flame, built from
// three.js primitives so the lamp scene's fixture reads as a real object set
// down on the page instead of a flat icon riding above it.
//
// The law: this module only builds and animates the model. It owns no
// renderer, camera, scene, or canvas — Lamp.tsx drives all of those and
// repositions this group's root to the lamp's anchor point every frame. It
// also owns no environment map or tone mapping — Lamp.tsx's PMREMGenerator
// output is what makes the MeshPhysicalNodeMaterials below read as metal and
// glass rather than flat color, and lampNodes.ts applies their tone mapping;
// this module only sets envMapIntensity.
//
// Ownership: this module owns the lantern's geometry, materials, flame
// light, and flicker animation. Lamp.tsx owns the scene, camera, environment
// map, and when update()/dispose() run. lampNodes.ts owns the flame's
// material. lampNodes.ts imports LANTERN_FLAME_HEIGHT so the 2D shadow
// shader's light height can never disagree with where the flame actually
// sits in this model.

import * as THREE from 'three'
import { MeshPhysicalNodeMaterial } from 'three/webgpu'
import { applyLanternToneMapping, createLampFlameMaterial } from './lampNodes'

// The flame's local height once the model is stood upright (see
// createLampLantern's rotation below) — also the "H" the 2D shadow shader
// projects shadows with. lampNodes.ts imports this rather than
// duplicating the number, so the projected shadow and the rendered flame
// can't drift apart. Mid-globe: the globe spans CHAMBER_BASE_Y to
// CHAMBER_BASE_Y + GLOBE_HEIGHT, and the flame sits at its vertical center
// (2026-09-01, silhouette rebuild).
const CHAMBER_BASE_Y = 18
const GLOBE_HEIGHT = 52
export const LANTERN_FLAME_HEIGHT = CHAMBER_BASE_Y + GLOBE_HEIGHT / 2
// Tallest point (the handle's peak) and widest point (the flared foot),
// both CSS px — Lamp.tsx sizes the invisible drag hitbox from these.
// Recomputed below from the connected handle's own arc radius (round 5) —
// see HANDLE_ARC_RADIUS and domeBaseY.
export const LANTERN_TOTAL_HEIGHT = 97
export const LANTERN_MAX_RADIUS = 34

// Blackened steel, varied slightly per part below so the cap, foot,
// mullions, and handle don't read as one flat shader (round 5: "PBR level
// graphics"). Glass and vent keep their own single tints — a globe or a
// vent slit has no adjacent part of the same material to disambiguate from.
const CAP_METAL_COLOR = 0x1c1a17
const FOOT_METAL_COLOR = 0x1f1c18
const MULLION_METAL_COLOR = 0x1a1815
const HANDLE_METAL_COLOR = 0x201d19
const METAL_METALNESS = 0.85
const METAL_ROUGHNESS = 0.4
const VENT_COLOR = 0x0a0806
const GLASS_COLOR = 0x2a2016
// Opacity, not transmission: there is nothing behind this canvas for a
// transmissive material to refract, since the page composites underneath
// it (round 5 instruction, explicit — transmission was tried and read as a
// black hole punched through the page).
const GLASS_OPACITY = 0.15
const GLASS_ENV_INTENSITY = 1.5
// The glass's own emissive channel, tinted to match the flame light below
// and driven by the same flicker signal in update() — this is the
// "physically-motivated warmth" replacing the deleted radial-gradient glow
// sprite (round 5: "kill the halo... no screen-space gradient discs").
const GLASS_EMISSIVE = 0xff9a3c
const GLASS_EMISSIVE_BASE = 0.35

// Camera looks straight down world Z; standing the model upright along Z
// alone (see the +90deg rotation below) puts a viewer dead-on above it with
// no visible side profile anywhere near viewport center. This second
// rotation tips the model's height axis toward +Y (up-screen) instead,
// composing with the +90deg into a fixed ~22deg-from-vertical view — full
// side profile (foot, chamber, mullions, dome) plus a bit of top-down on
// the cap, the way a standing object reads when photographed from slightly
// above (2026-09-01).
const LANTERN_TILT_DEG = 68

const MULLION_COUNT = 4
const VENT_COUNT = 3

// Foot-to-dome stack, each stage's radius matching the next stage's so the
// silhouette narrows or bulges continuously rather than stepping. A 116px,
// 3.4:1 stick-shaped chamber read as "odd," not a lantern (Pete, round 4,
// 2026-09-01) — rebuilt squat: the glass is a bulging barrel roughly as
// tall as it is wide, not a tube.
const FOOT_HEIGHT = 10
const FOOT_TOP_RADIUS = 22
const FOOT_BOTTOM_RADIUS = 34
const RISER_HEIGHT = 8
// Globe profile: a barrel, narrow at both the neck and the rim, bulging out
// to its belly at the vertical center. LatheGeometry revolves a hand-drawn
// radius curve rather than a plain cylinder, so the glass itself bulges
// instead of the taper being faked by the metalwork around it.
const GLOBE_EDGE_RADIUS = 15
const GLOBE_BELLY_RADIUS = 26
const GLOBE_PROFILE_SEGMENTS = 12
const GLOBE_RADIAL_SEGMENTS = 24
// Gallery rings seat the glass into the metalwork at both ends instead of
// letting it butt directly against the riser/rim (round 5: "seat the glass
// into a gallery ring at top and bottom"). RIM_RADIUS below doubles as the
// top gallery; this is the bottom one, sized the same way — a hair wider
// than the glass edge it collars.
const GALLERY_RADIUS = GLOBE_EDGE_RADIUS + 1.5
const GALLERY_HEIGHT = 4
const RIM_HEIGHT = 6
const RIM_RADIUS = 16
const DOME_RADIUS = 19
// Dome height and its stepped-ridge profile (see buildDomeProfile) replace
// the previous smooth hemisphere — "give the cap 2-3 stacked lathe ridges
// so it reads as a vented hood rather than a smooth dome" (round 5).
const DOME_HEIGHT = 16
// Lugs stand this far proud of the dome's own equator radius (DOME_RADIUS)
// so the handle's tube has clearance to arc past the metal instead of
// clipping through it — and the handle's own arc radius is built to match
// exactly (see HANDLE_ARC_RADIUS), which is what guarantees its endpoints
// land inside the lugs rather than merely near them (round 5: "the handle
// isn't even connected").
const CAP_LUG_OFFSET = 2
// A cube edge comfortably bigger than HANDLE_TUBE_RADIUS*2, so the tube's
// curve endpoint — centered exactly on the lug — sits embedded inside the
// lug's own volume rather than just touching its face.
const CAP_LUG_SIZE = 4.5
const HANDLE_ARC_RADIUS = DOME_RADIUS + CAP_LUG_OFFSET
const HANDLE_TUBE_RADIUS = 1.6
const HANDLE_ARC_SEGMENTS = 12

// Small burner cone inside the globe, under the flame — the piece of
// hardware a real oil lamp's flame actually sits on (round 5). Its apex
// lands exactly on LANTERN_FLAME_HEIGHT (the flame quad's own anchor), the
// same way the handle's endpoints land exactly on the lugs — a built-in
// guarantee against the gap Pete's round-6 screenshot showed between the
// flame and the cone tip, rather than two numbers tuned to look close.
const BURNER_RADIUS = 7
const BURNER_BASE_Y = CHAMBER_BASE_Y + 4
const BURNER_HEIGHT = LANTERN_FLAME_HEIGHT - BURNER_BASE_Y

// Mullions trace the same radius curve as the glass, offset outward by a
// constant — straight boxes through a bulged globe poke through the glass
// at the belly and float clear of it at the neck and rim (round 4 report).
const MULLION_OFFSET = 0.6
const MULLION_TUBE_RADIUS = 1.3
const MULLION_CURVE_SEGMENTS = 8
const MULLION_TUBULAR_SEGMENTS = 16

// Flame quad: sized in the same CSS-px-equivalent units as the rest of the
// model, anchored at its bottom-center (see the geometry translate below)
// so mesh.position marks the wick, not the visual center.
const FLAME_QUAD_WIDTH = 22
const FLAME_QUAD_HEIGHT = 34
// Warm point-light color at the flame — Pete's requested ~#ff9a3c (round
// 5); the glass's own emissive tint above matches it so the two warmth
// sources (light spilling on nearby metal, and the glass itself) agree.
const FLAME_LIGHT_COLOR = 0xff9a3c

// Flicker: three incommensurate sine frequencies (not a single one) so the
// wobble doesn't read as a metronome — a real flame gutters unevenly, not
// on a beat. One scalar off this signal, flickerIntensity, drives the
// flame's own brightness, the flame point light, the glass's emissive
// warmth, and — via Lamp.tsx — the page's light pool, so all of them
// breathe together rather than pulsing out of phase with each other (round
// 4/5, 2026-09-01). The flame shader (below) runs the same three-frequency
// mix internally for the tip's sway and height, at different phases so the
// lean, the stretch, and this brightness wobble don't lock in step.
const FLICKER_FREQ_1_HZ = 1.7
const FLICKER_FREQ_2_HZ = 2.9
const FLICKER_FREQ_3_HZ = 0.4
const FLICKER_WEIGHT_1 = 0.5
const FLICKER_WEIGHT_2 = 0.3
const FLICKER_WEIGHT_3 = 0.2
const FLICKER_BRIGHTNESS_PHASE_SEC = 0.81
const FROZEN_TIME_SEC = 0

// Raised from 1.4 so the flame still reads through the tinted glass chamber
// now that the tilted view shows the chamber's side rather than looking
// straight down through its open top (2026-09-01).
const FLAME_BASE_INTENSITY = 1.8

function flickerSignal(timeSec: number, phaseSec: number): number {
  const t = timeSec + phaseSec
  return (
    Math.sin(t * Math.PI * 2 * FLICKER_FREQ_1_HZ) * FLICKER_WEIGHT_1 +
    Math.sin(t * Math.PI * 2 * FLICKER_FREQ_2_HZ) * FLICKER_WEIGHT_2 +
    Math.sin(t * Math.PI * 2 * FLICKER_FREQ_3_HZ) * FLICKER_WEIGHT_3
  )
}

// Radius of the glass globe at t=0 (neck) through t=1 (rim), peaking at the
// belly at t=0.5. Shared by the globe's own LatheGeometry profile and by
// each mullion's curve, so a mullion can never sit inside or outside the
// glass surface it's meant to trace (round 4).
function globeRadiusAt(t: number): number {
  const bulge = Math.sin(THREE.MathUtils.clamp(t, 0, 1) * Math.PI)
  return THREE.MathUtils.lerp(GLOBE_EDGE_RADIUS, GLOBE_BELLY_RADIUS, bulge)
}

function buildGlobeProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = []
  for (let i = 0; i <= GLOBE_PROFILE_SEGMENTS; i++) {
    const t = i / GLOBE_PROFILE_SEGMENTS
    points.push(new THREE.Vector2(globeRadiusAt(t), t * GLOBE_HEIGHT))
  }
  return points
}

function buildMullionCurve(angleRad: number): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= MULLION_CURVE_SEGMENTS; i++) {
    const t = i / MULLION_CURVE_SEGMENTS
    const r = globeRadiusAt(t) + MULLION_OFFSET
    points.push(new THREE.Vector3(Math.cos(angleRad) * r, CHAMBER_BASE_Y + t * GLOBE_HEIGHT, Math.sin(angleRad) * r))
  }
  return new THREE.CatmullRomCurve3(points)
}

// A lathe profile with two inward steps (RIM_RADIUS -> DOME_RADIUS, then
// two shoulders stepping back in) rather than one continuous curve — each
// step reads as a ridge/lip in the rendered silhouette, so the cap looks
// like a stack of vented bands instead of a single smooth dome (round 5).
// Points share a y only across a step's own short riser; y otherwise
// increases monotonically the way LatheGeometry expects.
function buildDomeProfile(): THREE.Vector2[] {
  return [
    new THREE.Vector2(RIM_RADIUS, 0),
    new THREE.Vector2(DOME_RADIUS, 2),
    new THREE.Vector2(DOME_RADIUS, 5),
    new THREE.Vector2(DOME_RADIUS - 3, 5.6),
    new THREE.Vector2(DOME_RADIUS - 3, 9),
    new THREE.Vector2(DOME_RADIUS - 6, 9.6),
    new THREE.Vector2(DOME_RADIUS - 6, 13),
    new THREE.Vector2(1.5, DOME_HEIGHT),
  ]
}

// Both endpoints land exactly on the two lugs' own centers (see
// CAP_LUG_OFFSET/HANDLE_ARC_RADIUS above) — the guarantee that the handle
// visibly connects, rather than approximately meeting them.
function buildHandleCurve(domeBaseY: number): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= HANDLE_ARC_SEGMENTS; i++) {
    const theta = (i / HANDLE_ARC_SEGMENTS) * Math.PI
    points.push(
      new THREE.Vector3(
        Math.cos(theta) * HANDLE_ARC_RADIUS,
        domeBaseY + Math.sin(theta) * HANDLE_ARC_RADIUS,
        0,
      ),
    )
  }
  return new THREE.CatmullRomCurve3(points)
}

// The tuning fields this module actually reads, picked out of the full
// LampTuning bag by Lamp.tsx each frame (lampTuning.ts owns the values and
// their ranges; this module only owns what each does to the model).
export interface LanternTuning {
  readonly flameScale: number
  readonly flickerRate: number
  readonly flickerAmplitude: number
  readonly coreBrightness: number
  readonly lampHeight: number
}

export interface LampLantern {
  readonly group: THREE.Group
  /** Advances the flame flicker; a frozen, static flame when reduced motion is on. */
  update(elapsedMs: number, reducedMotion: boolean, tuning: LanternTuning): void
  /** World position of the flame, for projecting the 2D shadow shader's light to where the flame actually renders. */
  getFlameWorldPosition(target: THREE.Vector3): THREE.Vector3
  /** World position of the handle's peak — the model's tallest point — for deriving drag margins from a real projection. */
  getTopWorldPosition(target: THREE.Vector3): THREE.Vector3
  /** Current flicker scalar (0.9–1.1), for driving the page shader's light pool at a smaller, text-safe amplitude. */
  getFlickerIntensity(): number
  dispose(): void
}

export function createLampLantern(): LampLantern {
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []

  const capMaterial = new MeshPhysicalNodeMaterial({
    color: CAP_METAL_COLOR,
    metalness: METAL_METALNESS,
    roughness: METAL_ROUGHNESS,
  })
  const footMaterial = new MeshPhysicalNodeMaterial({
    color: FOOT_METAL_COLOR,
    metalness: METAL_METALNESS - 0.03,
    roughness: METAL_ROUGHNESS + 0.08,
  })
  const mullionMaterial = new MeshPhysicalNodeMaterial({
    color: MULLION_METAL_COLOR,
    metalness: METAL_METALNESS + 0.02,
    roughness: METAL_ROUGHNESS - 0.1,
  })
  const handleMaterial = new MeshPhysicalNodeMaterial({
    color: HANDLE_METAL_COLOR,
    metalness: METAL_METALNESS,
    roughness: METAL_ROUGHNESS - 0.15,
  })
  const ventMaterial = new MeshPhysicalNodeMaterial({ color: VENT_COLOR, metalness: 0.4, roughness: 0.75 })
  const glass = new MeshPhysicalNodeMaterial({
    color: GLASS_COLOR,
    transparent: true,
    opacity: GLASS_OPACITY,
    roughness: 0.1,
    metalness: 0,
    envMapIntensity: GLASS_ENV_INTENSITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    emissive: GLASS_EMISSIVE,
    emissiveIntensity: 0,
  })
  materials.push(capMaterial, footMaterial, mullionMaterial, handleMaterial, ventMaterial, glass)
  for (const material of [capMaterial, footMaterial, mullionMaterial, handleMaterial, ventMaterial, glass]) {
    applyLanternToneMapping(material)
  }

  // Built Y-up, three.js's natural primitive orientation; the whole thing
  // is stood upright at the end by rotating the model group.
  const model = new THREE.Group()

  const footGeo = new THREE.CylinderGeometry(FOOT_TOP_RADIUS, FOOT_BOTTOM_RADIUS, FOOT_HEIGHT, 24)
  const riserGeo = new THREE.CylinderGeometry(GLOBE_EDGE_RADIUS, FOOT_TOP_RADIUS, RISER_HEIGHT, 24)
  geometries.push(footGeo, riserGeo)
  const foot = new THREE.Mesh(footGeo, footMaterial)
  foot.position.y = FOOT_HEIGHT / 2
  const riser = new THREE.Mesh(riserGeo, footMaterial)
  riser.position.y = FOOT_HEIGHT + RISER_HEIGHT / 2
  model.add(foot, riser)

  // Bulging barrel, not a tube: LatheGeometry revolves globeRadiusAt's
  // curve, open at both ends (radius > 0 at t=0 and t=1) the way the old
  // cylinder's openEnded:true left the flame visible through the top.
  const globeGeo = new THREE.LatheGeometry(buildGlobeProfile(), GLOBE_RADIAL_SEGMENTS)
  geometries.push(globeGeo)
  const globe = new THREE.Mesh(globeGeo, glass)
  globe.position.y = CHAMBER_BASE_Y
  model.add(globe)

  // Bottom gallery ring: collars the glass at the neck the same way the
  // rim (below) collars it at the top, instead of the glass butting
  // straight against the riser (round 5).
  const bottomGalleryGeo = new THREE.CylinderGeometry(GALLERY_RADIUS, GALLERY_RADIUS, GALLERY_HEIGHT, 20)
  geometries.push(bottomGalleryGeo)
  const bottomGallery = new THREE.Mesh(bottomGalleryGeo, capMaterial)
  bottomGallery.position.y = CHAMBER_BASE_Y
  model.add(bottomGallery)

  // Burner cone: the hardware the flame actually sits on inside the globe,
  // between the neck and the flame's own height (round 5).
  const burnerGeo = new THREE.ConeGeometry(BURNER_RADIUS, BURNER_HEIGHT, 16)
  geometries.push(burnerGeo)
  const burner = new THREE.Mesh(burnerGeo, footMaterial)
  burner.position.y = BURNER_BASE_Y + BURNER_HEIGHT / 2
  model.add(burner)

  for (let i = 0; i < MULLION_COUNT; i++) {
    const angle = (i / MULLION_COUNT) * Math.PI * 2
    const curve = buildMullionCurve(angle)
    const mullionGeo = new THREE.TubeGeometry(curve, MULLION_TUBULAR_SEGMENTS, MULLION_TUBE_RADIUS, 6, false)
    geometries.push(mullionGeo)
    model.add(new THREE.Mesh(mullionGeo, mullionMaterial))
  }

  // Top gallery ring: radius exceeds the globe's own top radius so the
  // glass visibly seats into it rather than butting flush against a
  // same-radius collar.
  const rimBaseY = CHAMBER_BASE_Y + GLOBE_HEIGHT
  const rimGeo = new THREE.CylinderGeometry(RIM_RADIUS, RIM_RADIUS, RIM_HEIGHT, 20)
  geometries.push(rimGeo)
  const rim = new THREE.Mesh(rimGeo, capMaterial)
  rim.position.y = rimBaseY + RIM_HEIGHT / 2
  model.add(rim)

  // Stepped-ridge hood (see buildDomeProfile) instead of a smooth
  // hemisphere — the profile's own two inward steps read as ridges once
  // lit (round 5).
  const domeBaseY = rimBaseY + RIM_HEIGHT
  const domeGeo = new THREE.LatheGeometry(buildDomeProfile(), 24)
  geometries.push(domeGeo)
  const dome = new THREE.Mesh(domeGeo, capMaterial)
  dome.position.y = domeBaseY
  model.add(dome)

  const ventGeo = new THREE.BoxGeometry(2, 11, 1)
  geometries.push(ventGeo)
  for (let i = 0; i < VENT_COUNT; i++) {
    const angle = (i / VENT_COUNT) * Math.PI * 2
    const slit = new THREE.Mesh(ventGeo, ventMaterial)
    slit.position.set(Math.cos(angle) * (DOME_RADIUS - 3), domeBaseY + 7, Math.sin(angle) * (DOME_RADIUS - 3))
    slit.rotation.y = -angle
    slit.rotation.x = -0.35
    model.add(slit)
  }

  // Two lug ears at the dome's equator, opposite each other in the
  // handle's own arc plane — small bosses the bail handle plugs into
  // (round 5: "the handle isn't even connected").
  const lugGeo = new THREE.BoxGeometry(CAP_LUG_SIZE, CAP_LUG_SIZE, CAP_LUG_SIZE)
  geometries.push(lugGeo)
  for (const side of [-1, 1]) {
    const lug = new THREE.Mesh(lugGeo, capMaterial)
    lug.position.set(side * HANDLE_ARC_RADIUS, domeBaseY, 0)
    model.add(lug)
  }

  // Bail handle: a TubeGeometry arc, not a torus — building it from
  // explicit points (see buildHandleCurve) is what lets its two endpoints
  // land exactly on the lugs' own centers above, rather than approximately
  // near them.
  const handleGeo = new THREE.TubeGeometry(buildHandleCurve(domeBaseY), HANDLE_ARC_SEGMENTS, HANDLE_TUBE_RADIUS, 8, false)
  geometries.push(handleGeo)
  model.add(new THREE.Mesh(handleGeo, handleMaterial))

  const flameGeo = new THREE.PlaneGeometry(FLAME_QUAD_WIDTH, FLAME_QUAD_HEIGHT)
  // Shifts local y from [-h/2, h/2] to [0, h] so mesh.position marks the
  // wick (the quad's bottom edge), not its vertical center.
  flameGeo.translate(0, FLAME_QUAD_HEIGHT / 2, 0)
  geometries.push(flameGeo)
  const flame = createLampFlameMaterial()
  materials.push(flame.material)
  const flameMesh = new THREE.Mesh(flameGeo, flame.material)
  flameMesh.position.y = LANTERN_FLAME_HEIGHT
  // The flame's vertex stage rebuilds this quad in the camera's own basis every
  // frame, so its object-space bounding volume (what frustumCulled tests
  // against) doesn't describe where it actually draws.
  flameMesh.frustumCulled = false
  model.add(flameMesh)

  const flameLight = new THREE.PointLight(FLAME_LIGHT_COLOR, FLAME_BASE_INTENSITY, 220, 2)
  flameLight.position.y = LANTERN_FLAME_HEIGHT
  model.add(flameLight)

  // Invisible marker at the model's tallest point (the handle's peak, see
  // LANTERN_TOTAL_HEIGHT), added purely so Lamp.tsx can project a real
  // world point to derive drag margins instead of guessing a pixel budget.
  const topMarker = new THREE.Object3D()
  topMarker.position.y = LANTERN_TOTAL_HEIGHT
  model.add(topMarker)

  const group = new THREE.Group()
  // Rotating +90 deg about X maps local +Y onto world +Z, standing the
  // lantern upright off the page plane instead of lying it flat across it.
  model.rotation.x = Math.PI / 2
  group.add(model)
  // See LANTERN_TILT_DEG above: composes with model's own +90deg into a
  // fixed ~22deg-from-vertical view.
  group.rotation.x = -THREE.MathUtils.degToRad(LANTERN_TILT_DEG)

  let flickerIntensity = 1

  function getFlameWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    return flameMesh.getWorldPosition(target)
  }

  function getTopWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    return topMarker.getWorldPosition(target)
  }

  function getFlickerIntensity(): number {
    return flickerIntensity
  }

  function update(elapsedMs: number, reducedMotion: boolean, tuning: LanternTuning) {
    // flickerRate scales the clock itself (not just the signal it drives),
    // so the flame shader's own sway/stretch — which runs the same
    // three-frequency mix off its time value — speeds up and slows down together
    // with this brightness wobble instead of drifting out of phase with it.
    const timeSec = reducedMotion ? FROZEN_TIME_SEC : (elapsedMs / 1000) * tuning.flickerRate
    flickerIntensity = reducedMotion
      ? 1
      : 1 + flickerSignal(timeSec, FLICKER_BRIGHTNESS_PHASE_SEC) * tuning.flickerAmplitude

    flame.time.value = timeSec
    flame.flicker.value = flickerIntensity
    flame.coreBrightness.value = tuning.coreBrightness
    flameMesh.scale.setScalar(tuning.flameScale)
    // Anchored at the wick (see the geometry translate above), so scaling
    // and repositioning both leave the flame's base sitting wherever the
    // burner cone's own apex is built to meet it (see BURNER_HEIGHT).
    flameMesh.position.y = tuning.lampHeight
    flameLight.position.y = tuning.lampHeight

    flameLight.intensity = FLAME_BASE_INTENSITY * flickerIntensity
    // The glass's own warmth, physically motivated (an emissive material
    // channel) rather than a screen-space sprite — see GLASS_EMISSIVE above.
    glass.emissiveIntensity = GLASS_EMISSIVE_BASE * flickerIntensity
  }

  function dispose() {
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
  }

  return { group, update, getFlameWorldPosition, getTopWorldPosition, getFlickerIntensity, dispose }
}
