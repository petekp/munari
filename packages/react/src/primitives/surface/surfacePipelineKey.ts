// Pipeline keys — what makes three build an object a new pipeline, as one
// string per object, material and scene.
//
// The law: two draws share a pipeline exactly when three would key them the
// same, so a held look is reused only under an equal key and a build is
// shared only by equal keys (decisions.md #80). The faults these keys follow
// are in surfaceCompile.ts's preamble.
//
// Ownership: arithmetic on three's state only; nothing here builds or holds.

import * as THREE from 'three'
import { flagsKey, type Drawable } from './surfaceCompileBuild'

// three 0.186 keys a material's pipeline by its own properties, each number
// reduced to zero or not except `side`, each texture by its mapping
// (RenderObject.getMaterialCacheKey), and rebuilds on `version`. These are the
// properties it skips.
const UNKEYED = /^(is[A-Z]|_)|^(visible|version|uuid|name|opacity|userData)$/

/** A material property's value as three reads it: a texture, a number, an object, or another primitive. */
type MaterialValue = THREE.Texture | THREE.Color | THREE.Vector2 | THREE.Euler | number | string | boolean | null | undefined

function valueKey(property: string, value: MaterialValue): string {
  if (value === null || value === undefined) return '-,'
  if (value instanceof THREE.Texture) return `{${value.mapping}${value.magFilter}${value.minFilter}${value.wrapS}${value.wrapT}${'wrapR' in value ? value.wrapR : ''}},`
  if (Number.isFinite(value)) return (property === 'side' ? String(value) : value !== 0 ? '1' : '0') + ','
  if (Object(value) === value) return '{},'
  return String(value) + ','
}

const geometryKeys = new WeakMap<THREE.BufferGeometry, { readonly attributes: number; readonly key: string }>()
function geometryKey(geometry: THREE.BufferGeometry): string {
  const names = Object.keys(geometry.attributes)
  const cached = geometryKeys.get(geometry)
  if (cached?.attributes === names.length) return cached.key
  let key = geometry.index ? 'i' : ''
  for (const name of names.sort()) {
    const attribute = geometry.getAttribute(name)
    key += name + attribute.itemSize + (attribute.normalized ? 'n' : '') + ','
  }
  key += Object.keys(geometry.morphAttributes).length
  geometryKeys.set(geometry, { attributes: names.length, key })
  return key
}

// The material part of the key, by material and version: three rechecks
// its key only when the version moves (RenderObjects.get). The write flags,
// side and blending reach the pipeline without a version bump, so they are
// read at every draw.
const materialKeys = new WeakMap<THREE.Material, { readonly version: number; readonly key: string }>()
function materialKey(material: THREE.Material): string {
  const cached = materialKeys.get(material)
  if (cached?.version === material.version) return cached.key
  let key = material.customProgramCacheKey()
  for (const [property, value] of Object.entries(material)) if (!UNKEYED.test(property) && !LIVE.has(property)) key += valueKey(property, value)
  materialKeys.set(material, { version: material.version, key })
  return key
}
const LIVE = new Set(['colorWrite', 'depthWrite', 'stencilWrite', 'side', 'transparent', 'blending', 'depthTest', 'alphaToCoverage', 'premultipliedAlpha'])

/**
 * What would make three build a new pipeline for `object`: its material and
 * that material's version, the properties three keys, the geometry's layout,
 * and the scene's environment, fog and lights. A version bump can change the
 * shader, so it starts a build even when it changes nothing; that build hits
 * three's cache and lands in a frame or two. A presenter's write flags are
 * left out: its look builds every variant it draws with.
 */
export function pipelineKey(object: Drawable, scene: string, presenter: boolean): string {
  return object.material.uuid + object.material.version + sharedKey(object, object.material, scene, presenter)
}

/**
 * The part of an object's pipeline key that three shares between objects:
 * two objects with equal shared keys use one node build and one pipeline.
 * An instanced mesh keys its build by its own uuid, so it shares nothing.
 */
export function sharedKey(object: THREE.Object3D, material: THREE.Material, scene: string, presenter: boolean): string {
  let key = materialKey(material) + material.side + material.transparent + material.blending + material.depthTest + material.alphaToCoverage + material.premultipliedAlpha
  if (!presenter) key += flagsKey(material)
  if ('geometry' in object && object.geometry instanceof THREE.BufferGeometry) key += '|' + geometryKey(object.geometry)
  if (object instanceof THREE.SkinnedMesh) key += 's' + object.skeleton.bones.length
  if (object instanceof THREE.InstancedMesh) key += 'n' + object.uuid
  if (object instanceof THREE.Mesh) key += object.morphTargetInfluences?.length ?? 0
  return key + (object.receiveShadow ? 'r' : '') + (object.castShadow ? 'c' : '') + '|' + scene
}

export function sceneKey(scene: THREE.Scene, lights: readonly THREE.Light[], shadows: boolean): string {
  let key = (scene.environment?.uuid ?? '-') + (scene.fog ? scene.fog.constructor.name : '-') + (shadows ? 's' : '')
  for (const light of lights) key += ' ' + light.id + (light.castShadow ? 's' : '')
  return key
}
