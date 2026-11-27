// Finish uniforms — the values a finish writes before each draw, and the
// layers that decide which shader it compiles.
//
// The law: a value change is a uniform or property write and never a
// rebuild; only a change of layers needs a new material, because three
// compiles a lobe only while its node is set (finishNodes.ts). An absent
// layer writes the amount that turns it off, so a material that still holds
// the layer draws nothing for it.
//
// Ownership: this module owns the uniforms and the writes; finishNodes.ts
// owns the graph that reads them.

import * as THREE from 'three'
import type { UniformNode } from 'three/webgpu'
import { uniform } from 'three/tsl'

import { createKeySheenUniforms, type KeySheenUniforms } from './finishKeyLight'
import type { FinishPhysicalMaterial } from './finishLightingModel'
import type { FinishValues, SurfaceDetailKind } from './surfaceFinish'

// Film defaults when a finish has none: KHR_materials_iridescence's IOR
// 1.3 and 400 nm thickest film (docs/materials-research-catalog.md §1).
const FILM_IOR = 1.3
const FILM_THICKNESS_NM = 400
const FILM_SCALE_PX = 200
const CRACKLE_SCALE_PX = 40

/** The uniforms a finish's values are written into before each draw. */
export interface FinishUniforms {
  /** Body color, linear light; THREE.Color decodes the hex on write. */
  readonly body: UniformNode<'color', THREE.Color>
  /** Body color at the rim, linear light. */
  readonly rimColor: UniformNode<'color', THREE.Color>
  readonly edgeWidth: UniformNode<'float', number>
  readonly detailScale: UniformNode<'float', number>
  readonly detailDepth: UniformNode<'float', number>
  readonly crackle: UniformNode<'float', number>
  readonly crackleScale: UniformNode<'float', number>
  readonly film: UniformNode<'float', number>
  readonly filmIor: UniformNode<'float', number>
  readonly filmThickness: UniformNode<'float', number>
  readonly filmVariation: UniformNode<'float', number>
  readonly filmScale: UniformNode<'float', number>
  readonly scatter: UniformNode<'float', number>
  readonly emission: UniformNode<'float', number>
  /** 1 to shift the body toward `rimColor` over the edge, 0 to keep the body's own color. */
  readonly rimShift: UniformNode<'float', number>
  readonly key: KeySheenUniforms
}

export function createFinishUniforms(): FinishUniforms {
  return {
    body: uniform(new THREE.Color()),
    rimColor: uniform(new THREE.Color()),
    edgeWidth: uniform(0),
    detailScale: uniform(1),
    detailDepth: uniform(0),
    crackle: uniform(0),
    crackleScale: uniform(CRACKLE_SCALE_PX),
    film: uniform(0),
    filmIor: uniform(FILM_IOR),
    filmThickness: uniform(FILM_THICKNESS_NM),
    filmVariation: uniform(0),
    filmScale: uniform(FILM_SCALE_PX),
    scatter: uniform(0),
    emission: uniform(0),
    rimShift: uniform(1),
    key: createKeySheenUniforms(),
  }
}

/** What a finish compiles. Two finishes with equal layers share one shader shape. */
export interface FinishLayers {
  /** `body`: the material paints the body color; `capture`: the capture is the body. */
  readonly body: 'lit-text' | 'unlit-text' | 'capture'
  readonly detail: SurfaceDetailKind | null
  readonly coat: boolean
  readonly sheen: boolean
  readonly anisotropy: boolean
  readonly crackle: boolean
  readonly film: boolean
  readonly scatter: boolean
  /** `camera`: the mesh shares the camera's rotation, so the card's frame is view space; `mesh`: rotate by the mesh's model-view. */
  readonly frame: 'camera' | 'mesh'
}

export function finishLayersOf(finish: FinishValues, facesCamera: boolean): FinishLayers {
  return {
    frame: facesCamera ? 'camera' : 'mesh',
    body: finish.color === null ? 'capture' : finish.text === 'lit' ? 'lit-text' : 'unlit-text',
    detail: finish.detail?.kind ?? null,
    coat: finish.coat !== null,
    sheen: finish.sheen !== null,
    anisotropy: finish.anisotropy !== null,
    crackle: finish.crackle !== null,
    film: finish.film !== null,
    scatter: finish.scatter !== null,
  }
}

export function sameFinishLayers(a: FinishLayers, b: FinishLayers): boolean {
  return (
    a.body === b.body &&
    a.detail === b.detail &&
    a.coat === b.coat &&
    a.sheen === b.sheen &&
    a.anisotropy === b.anisotropy &&
    a.crackle === b.crackle &&
    a.film === b.film &&
    a.scatter === b.scatter &&
    a.frame === b.frame
  )
}

/** Write a finish's values. Every write is a uniform or property update; layers changing need a new material. */
export function writeFinish(material: FinishPhysicalMaterial, uniforms: FinishUniforms, finish: FinishValues): void {
  writeLobes(material, finish)
  writeShape(uniforms, finish)
  if (finish.color !== null) uniforms.body.value.set(finish.color)
  // A capture body has no one color to fall back to at the rim, so its rim
  // keeps the capture unless the finish names a rim color.
  const rimColor = finish.edge.rimColor ?? finish.color
  uniforms.rimShift.value = rimColor === null ? 0 : 1
  if (rimColor !== null) uniforms.rimColor.value.set(rimColor)
  uniforms.emission.value = finish.emissiveIntensity
  material.lightGain.value = finish.lightGain
  const side = finish.side === 'double' ? THREE.DoubleSide : THREE.FrontSide
  if (material.side !== side) {
    material.side = side
    material.needsUpdate = true
  }
}

/** three's own lobes. An absent layer writes the amount that turns it off. */
function writeLobes(material: FinishPhysicalMaterial, { coat, sheen, anisotropy, ...finish }: FinishValues): void {
  material.roughness = finish.roughness
  material.metalness = finish.metalness
  material.ior = finish.ior
  material.specularIntensity = finish.specularIntensity
  material.clearcoat = coat?.amount ?? 0
  material.clearcoatRoughness = coat?.roughness ?? 0
  material.sheen = sheen?.amount ?? 0
  material.sheenColor.set(sheen?.color ?? '#000000')
  material.sheenRoughness = sheen?.roughness ?? 1
  material.anisotropy = anisotropy?.amount ?? 0
  material.anisotropyRotation = anisotropy?.rotation ?? 0
  // The material applies the film itself, for every light.
  material.iridescence = 0
}

function writeFilm(uniforms: FinishUniforms, film: FinishValues['film']): void {
  uniforms.film.value = film?.amount ?? 0
  uniforms.filmIor.value = film?.ior ?? FILM_IOR
  uniforms.filmThickness.value = film?.thickness ?? FILM_THICKNESS_NM
  uniforms.filmVariation.value = film?.variation ?? 0
  uniforms.filmScale.value = Math.max(film?.scale ?? FILM_SCALE_PX, 1)
}

/** The film, relief, crackle and scatter that this module's nodes draw. */
function writeShape(uniforms: FinishUniforms, { film, crackle, detail, edge, scatter }: FinishValues): void {
  writeFilm(uniforms, film)
  uniforms.scatter.value = scatter?.amount ?? 0
  uniforms.edgeWidth.value = edge.width
  uniforms.detailScale.value = Math.max(detail?.scale ?? 1, 0.25)
  uniforms.detailDepth.value = detail?.depth ?? 0
  uniforms.crackle.value = crackle?.amount ?? 0
  uniforms.crackleScale.value = Math.max(crackle?.scale ?? CRACKLE_SCALE_PX, 4)
}
