// Hand finishes — Carrara stone and bare mirrored chrome in one real room.
//
// The law: the veins may change the stone's colour, but they never replace
// the PBR material that supplies environment reflections and real shadows.
// A flat shader can draw convincing marble and still make the hand feel
// pasted over the page because it does not take part in the room's light.
//
// The fault this prevents, 2026-08-30: an early shader-only sketch had a
// stronger vein pattern and no contact with the page. The silhouette read
// as an illustration. MeshPhysicalNodeMaterial keeps the sculpture in the
// room; its colour node only supplies continuous object-space veining.
//
// Ownership: this module owns stone appearance and the hand's tone map.
// Geometry and pointer pose stay with their own modules. Both finishes and
// the shadow pass carry the idle tap's bend, which marbleHandTapNodes.ts
// owns.

import { useEffect, useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import { MeshPhysicalNodeMaterial } from 'three/webgpu'
import {
  Fn,
  clamp,
  float,
  materialColor,
  mix,
  output,
  positionGeometry,
  sin,
  toneMapping,
  toneMappingExposure,
  transformNormalToView,
  uniform,
  varying,
  vec4,
} from 'three/tsl'
import type { MarbleHandTuning } from './marbleHandTuning'
import { createMarbleHandTapNodes, type MarbleHandTapUniforms } from './marbleHandTapNodes'

/**
 * A physical hand material carrying the tap bend and the scene's tone map.
 * SurfaceCanvas renders with NoToneMapping so HTML keeps its colours; the
 * hand applies the ACES curve itself, at the renderer's
 * `toneMappingExposure`, which MarbleLighting writes.
 */
function createHandMaterial(name: string, tap: MarbleHandTapUniforms): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial({ name })
  const bent = createMarbleHandTapNodes(tap)
  material.positionNode = bent.position
  material.normalNode = varying(transformNormalToView(bent.normal)).normalize()
  material.outputNode = toneMapping(THREE.ACESFilmicToneMapping, toneMappingExposure, output)
  return material
}

function useDisposed<T extends THREE.Material>(material: T): T {
  useEffect(() => () => material.dispose(), [material])
  return material
}

function CarraraMaterial({ tuning, tap }: { tuning: MarbleHandTuning; tap: MarbleHandTapUniforms }) {
  const veins = useMemo(() => ({
    color: uniform(new THREE.Color()),
    strength: uniform(1),
    scale: uniform(1),
  }), [])
  const material = useDisposed(useMemo(() => {
    const stone = createHandMaterial('marble-hand-carrara', tap)
    // Veins read the rest position, so the stone's pattern stays welded to
    // the rest pose and a tapping finger does not drag its marking along.
    const rest = varying(positionGeometry)
    stone.colorNode = Fn(() => {
      const p = rest.mul(veins.scale)
      const warp = sin(p.x.mul(0.031)).mul(1.65).add(sin(p.x.add(p.z.mul(2)).mul(0.013)).mul(2.2))
      const wide = sin(p.y.mul(0.092).add(warp))
      const fine = sin(p.y.mul(0.19).add(p.x.mul(0.027)).add(sin(p.z.mul(0.23))))
      const vein = float(1).sub(wide.abs()).max(0).pow(10).mul(0.48)
        .add(float(1).sub(fine.abs()).max(0).pow(22).mul(0.22))
      const cloud = sin(p.x.mul(0.018)).mul(sin(p.y.mul(0.027).add(p.z.mul(0.11)))).mul(0.035).add(0.965)
      const stoneColor = materialColor.mul(cloud)
      return vec4(mix(stoneColor, veins.color, clamp(vein.mul(veins.strength), 0, 0.54)), 1)
    })()
    return stone
  }, [tap, veins]))
  useLayoutEffect(() => {
    // The original shader used raw RGB literals. Keep that colour space so
    // the new default picker value preserves the reviewed stone treatment.
    veins.color.value.set(tuning.veinColor).convertLinearToSRGB()
    veins.strength.value = tuning.veinStrength
    veins.scale.value = tuning.veinScale
  }, [tuning.veinColor, tuning.veinStrength, tuning.veinScale, veins])

  return (
    <primitive
      object={material}
      attach="material"
      color={tuning.stoneColor}
      roughness={tuning.roughness}
      metalness={0}
      clearcoat={tuning.clearcoat}
      clearcoatRoughness={tuning.clearcoatRoughness}
      envMapIntensity={tuning.envMapIntensity}
      ior={tuning.ior}
      specularIntensity={tuning.specularIntensity}
    />
  )
}

function ChromeMaterial({ tuning, tap }: { tuning: MarbleHandTuning; tap: MarbleHandTapUniforms }) {
  const material = useDisposed(useMemo(() => createHandMaterial('marble-hand-mirrored-chrome', tap), [tap]))
  return (
    <primitive
      object={material}
      attach="material"
      color={tuning.chromeTint}
      metalness={1}
      roughness={tuning.chromeRoughness}
      clearcoat={0}
      envMapIntensity={tuning.chromeReflectionIntensity}
    />
  )
}

export function MarbleHandMaterial({ tuning, tap }: {
  tuning: MarbleHandTuning
  tap: MarbleHandTapUniforms
}) {
  // Distinct material components keep the Carrara colour node out of the
  // chrome material. Merely changing metalness would leave the stone's veins
  // and cloudy tint on chrome. The hand mesh, geometry and pointer pose persist.
  return tuning.materialMode === 'chrome'
    ? <ChromeMaterial tuning={tuning} tap={tap} />
    : <CarraraMaterial tuning={tuning} tap={tap} />
}
