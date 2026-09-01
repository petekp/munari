// Hand finishes — Carrara stone and bare mirrored chrome in one real room.
//
// The law: the veins may change the stone's colour, but they never replace
// the PBR material that supplies environment reflections and real shadows.
// A flat shader can draw convincing marble and still make the hand feel
// pasted over the page because it does not take part in the room's light.
//
// The fault this prevents, 2026-08-30: an early shader-only sketch had a
// stronger vein pattern and no contact with the page. The silhouette read
// as an illustration. MeshPhysicalMaterial keeps the sculpture in the room;
// the small compile patch only supplies continuous object-space veining.
//
// Ownership: this module owns stone appearance. Geometry and pointer pose
// stay with their own modules. Both finishes and the shadow pass carry the
// idle tap's vertex patch, which marbleHandTapShaders.ts owns.

import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { MarbleHandTuning } from './marbleHandTuning'
import {
  MARBLE_HAND_TAP_PROGRAM_KEY,
  addMarbleHandTap,
  type MarbleHandTapUniforms,
} from './marbleHandTapShaders'

const CARRARA_KEY = () => `munari-marble-hand-carrara-v2-${MARBLE_HAND_TAP_PROGRAM_KEY}`
const CHROME_KEY = () => `munari-marble-hand-chrome-${MARBLE_HAND_TAP_PROGRAM_KEY}`
const DEPTH_KEY = () => `munari-marble-hand-depth-${MARBLE_HAND_TAP_PROGRAM_KEY}`

function addCarraraVeins(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vMarbleHandPosition;')
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vMarbleHandPosition = position;',
    )

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vMarbleHandPosition;
uniform vec3 uMarbleHandVeinColor;
uniform float uMarbleHandVeinStrength;
uniform float uMarbleHandVeinScale;`)
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
  vec3 mhp = vMarbleHandPosition * uMarbleHandVeinScale;
  float mhWarp = sin(mhp.x * 0.031) * 1.65 + sin((mhp.x + mhp.z * 2.0) * 0.013) * 2.2;
  float mhWide = sin(mhp.y * 0.092 + mhWarp);
  float mhFine = sin(mhp.y * 0.19 + mhp.x * 0.027 + sin(mhp.z * 0.23));
  float mhVein = pow(max(0.0, 1.0 - abs(mhWide)), 10.0) * 0.48;
  mhVein += pow(max(0.0, 1.0 - abs(mhFine)), 22.0) * 0.22;
  float mhCloud = 0.965 + 0.035 * sin(mhp.x * 0.018) * sin(mhp.y * 0.027 + mhp.z * 0.11);
  diffuseColor.rgb *= mhCloud;
  diffuseColor.rgb = mix(diffuseColor.rgb, uMarbleHandVeinColor, clamp(mhVein * uMarbleHandVeinStrength, 0.0, 0.54));`,
    )
}

/**
 * The hand's shadow caster. Three's default depth material has no idea the
 * fingers move, so a tapping hand would drop a still shadow without this.
 */
export function useMarbleHandDepthMaterial(tap: MarbleHandTapUniforms): THREE.MeshDepthMaterial {
  const material = useMemo(() => {
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
    depth.name = 'marble-hand-tap-depth'
    depth.onBeforeCompile = (shader) => addMarbleHandTap(shader, tap)
    depth.customProgramCacheKey = DEPTH_KEY
    return depth
  }, [tap])
  useEffect(() => () => material.dispose(), [material])
  return material
}

function CarraraMaterial({ tuning, tap }: { tuning: MarbleHandTuning; tap: MarbleHandTapUniforms }) {
  // The compiled shader owns these same uniform cells. Passing a fresh
  // uniforms bag through JSX can leave the live program reading old cells.
  const uniforms = useMemo(() => ({
    uMarbleHandVeinColor: { value: new THREE.Color() },
    uMarbleHandVeinStrength: { value: 1 },
    uMarbleHandVeinScale: { value: 1 },
  }), [])
  useLayoutEffect(() => {
    // The original shader used raw RGB literals. Keep that colour space so
    // the new default picker value preserves the reviewed stone treatment.
    uniforms.uMarbleHandVeinColor.value.set(tuning.veinColor).convertLinearToSRGB()
    uniforms.uMarbleHandVeinStrength.value = tuning.veinStrength
    uniforms.uMarbleHandVeinScale.value = tuning.veinScale
  }, [tuning.veinColor, tuning.veinStrength, tuning.veinScale, uniforms])
  const compile = useCallback((shader: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms)
    // Veins first: it reads `position`, so the stone's pattern stays welded
    // to the rest pose and a tapping finger does not drag its marking along.
    addCarraraVeins(shader)
    addMarbleHandTap(shader, tap)
  }, [tap, uniforms])

  return (
    <meshPhysicalMaterial
      name="marble-hand-carrara"
      color={tuning.stoneColor}
      roughness={tuning.roughness}
      metalness={0}
      clearcoat={tuning.clearcoat}
      clearcoatRoughness={tuning.clearcoatRoughness}
      envMapIntensity={tuning.envMapIntensity}
      ior={tuning.ior}
      specularIntensity={tuning.specularIntensity}
      onBeforeCompile={compile}
      customProgramCacheKey={CARRARA_KEY}
    />
  )
}

function ChromeMaterial({ tuning, tap }: { tuning: MarbleHandTuning; tap: MarbleHandTapUniforms }) {
  const compile = useCallback((shader: THREE.WebGLProgramParametersWithUniforms) => {
    addMarbleHandTap(shader, tap)
  }, [tap])
  return (
    <meshPhysicalMaterial
      name="marble-hand-mirrored-chrome"
      color={tuning.chromeTint}
      metalness={1}
      roughness={tuning.chromeRoughness}
      clearcoat={0}
      envMapIntensity={tuning.chromeReflectionIntensity}
      onBeforeCompile={compile}
      customProgramCacheKey={CHROME_KEY}
    />
  )
}

export function MarbleHandMaterial({ tuning, tap }: {
  tuning: MarbleHandTuning
  tap: MarbleHandTapUniforms
}) {
  // Distinct material components remove the Carrara compile patch entirely.
  // Merely changing metalness would leave the stone's veins and cloudy tint
  // in the chrome program. The hand mesh, geometry and pointer pose persist.
  return tuning.materialMode === 'chrome'
    ? <ChromeMaterial tuning={tuning} tap={tap} />
    : <CarraraMaterial tuning={tuning} tap={tap} />
}
