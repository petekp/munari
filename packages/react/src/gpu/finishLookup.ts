// Lazy SurfaceFinish dispatcher — routes `finish` props onto dynamically loaded
// compiled MaterialManifests (`finishOpaque`, `finishLayered`, `finishTransmissive`)
// with zero runtime TypeGPU or Three.js dependencies.
//
// The law: uniform edits pack directly into `@group(1)` with dirty-checking so
// static frames write zero buffers (`decisions.md #79`); variant switches keep the
// active pipeline drawing until the replacement finishes compiling asynchronously.
//
// Ownership: `@petepetrash/munari/gpu`.

import {
  resolveFinish,
  type FinishValues,
  type SurfaceDetailKind,
  type SurfaceFinish,
} from '../primitives/surface/surfaceFinish'
import { createManifestMaterial, type ManifestMaterial, type MaterialManifest } from './manifest'
import type { Mat4 } from './math'
import type { GpuMaterial, GpuRenderer } from './webgpu'

type Tuple4 = readonly [number, number, number, number]

export interface FinishManifestUniforms {
  readonly bodyColor: Tuple4
  readonly rimColor: Tuple4
  readonly sheenColor: Tuple4
  readonly pbr: Tuple4
  readonly coat: Tuple4
  readonly anisoFilm: Tuple4
  readonly filmParams: Tuple4
  readonly detail: Tuple4
  readonly crackleLight: Tuple4
  readonly sheenTrans: Tuple4
}

export type FinishManifestKind = 'opaque' | 'layered' | 'transmissive'

export interface GpuFinishHandle extends GpuMaterial {
  readonly updateFinish: (finish: SurfaceFinish) => void
}

const DETAIL_ID = {
  'orange-peel': 1,
  brushed: 2,
  pile: 3,
  glaze: 4,
  crumple: 5,
  fiber: 6,
  dots: 7,
  honeycomb: 8,
} as const satisfies Record<SurfaceDetailKind, number>

function hexToLinearRgb(hex: string | null): readonly [number, number, number] {
  if (!hex) return [1, 1, 1]
  const raw = hex.startsWith('#') ? hex.slice(1).trim() : hex.trim()
  if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return [1, 1, 1]
  const hex6 =
    raw.length === 3 ? raw.replace(/(.)/g, '$1$1') : raw.length === 8 ? raw.slice(0, 6) : raw
  const num = Number.parseInt(hex6, 16)
  const eotf = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return [eotf(((num >> 16) & 255) / 255), eotf(((num >> 8) & 255) / 255), eotf((num & 255) / 255)]
}

/** Resolves which compiled manifest kind a finish needs. */
export function selectFinishManifestKind(resolved: FinishValues): FinishManifestKind {
  if (resolved.transmission && resolved.transmission.amount > 0) return 'transmissive'
  if (
    resolved.film ||
    resolved.crackle ||
    resolved.detail?.kind === 'crumple' ||
    resolved.detail?.kind === 'fiber'
  ) {
    return 'layered'
  }
  return 'opaque'
}

function packSurfaceColors(resolved: FinishValues) {
  const body = hexToLinearRgb(resolved.color)
  const rim = hexToLinearRgb(resolved.edge.rimColor)
  const sheen = resolved.sheen
  const sheenRgb = hexToLinearRgb(sheen ? sheen.color : '#ffffff')
  return {
    bodyColor: [body[0], body[1], body[2], resolved.color !== null ? 1 : 0] as const,
    rimColor: [rim[0], rim[1], rim[2], resolved.edge.rimColor !== null ? 1 : 0] as const,
    sheenColor: [sheenRgb[0], sheenRgb[1], sheenRgb[2], sheen ? sheen.amount : 0] as const,
  }
}

const DEFAULT_COAT = { amount: 0, roughness: 0.1 } as const
const DEFAULT_ANISO = { amount: 0, rotation: 0 } as const
const DEFAULT_FILM = { amount: 0, ior: 1.4, thickness: 380, variation: 0.3, scale: 120 } as const
const DEFAULT_TRANS = { amount: 0, thickness: 0, dispersion: 0 } as const

function packOpticalUniforms(resolved: FinishValues) {
  const coat = resolved.coat ?? DEFAULT_COAT
  const aniso = resolved.anisotropy ?? DEFAULT_ANISO
  const film = resolved.film ?? DEFAULT_FILM
  const trans = resolved.transmission ?? DEFAULT_TRANS
  const scatter = resolved.scatter
  const sheen = resolved.sheen
  return {
    pbr: [resolved.roughness, resolved.metalness, resolved.ior, resolved.specularIntensity] as const,
    coat: [coat.amount, coat.roughness, resolved.edge.width, resolved.text === 'lit' ? 1 : 0] as const,
    anisoFilm: [aniso.amount, aniso.rotation, film.amount, film.ior] as const,
    filmParams: [film.thickness, film.variation, film.scale, scatter ? scatter.amount : 0] as const,
    sheenTrans: [sheen ? sheen.roughness : 0.35, trans.amount, trans.thickness, trans.dispersion] as const,
  }
}

/** Packs resolved `SurfaceFinish` values into the 160 B `FinishUniforms` struct layout. */
export function packFinishUniforms(resolved: FinishValues): FinishManifestUniforms {
  const { detail, crackle } = resolved
  return {
    ...packSurfaceColors(resolved),
    ...packOpticalUniforms(resolved),
    detail: [detail ? DETAIL_ID[detail.kind] : 0, detail?.scale ?? 24, detail?.depth ?? 0.01, crackle?.amount ?? 0],
    crackleLight: [crackle?.scale ?? 40, resolved.emissiveIntensity, resolved.environment === 'gradient' ? 1 : 0, resolved.lightGain],
  }
}

const UNIFORM_KEYS = [
  'bodyColor', 'rimColor', 'sheenColor', 'pbr', 'coat',
  'anisoFilm', 'filmParams', 'detail', 'crackleLight', 'sheenTrans',
] as const satisfies readonly (keyof FinishManifestUniforms)[]

function uniformsEqual(a: FinishManifestUniforms | null, b: FinishManifestUniforms): boolean {
  if (!a) return false
  for (const k of UNIFORM_KEYS) {
    const va = a[k]
    const vb = b[k]
    if (va[0] !== vb[0] || va[1] !== vb[1] || va[2] !== vb[2] || va[3] !== vb[3]) return false
  }
  return true
}

function loadFinishManifest(kind: FinishManifestKind): Promise<MaterialManifest<FinishManifestUniforms>> {
  if (kind === 'transmissive') {
    return import('./finishes/finishTransmissive.gen').then((m) => m.finishTransmissiveManifest)
  }
  if (kind === 'layered') {
    return import('./finishes/finishLayered.gen').then((m) => m.finishLayeredManifest)
  }
  return import('./finishes/finishOpaque.gen').then((m) => m.finishOpaqueManifest)
}

/** Creates a dynamic `GpuFinishHandle` backed by lazily compiled finish manifests. */
export function createGpuFinishMaterial(
  renderer: GpuRenderer,
  initialFinish: SurfaceFinish,
  onVariantReady?: () => void,
): GpuFinishHandle {
  let disposed = false
  let active: ManifestMaterial<FinishManifestUniforms> | null = null
  let pending: ManifestMaterial<FinishManifestUniforms> | null = null
  let activeKey = ''
  let targetKey = ''
  let latestUniforms = packFinishUniforms(resolveFinish(initialFinish))
  let uploadedUniforms: FinishManifestUniforms | null = null

  const startVariant = (kind: FinishManifestKind, doubleSided: boolean, key: string): Promise<void> => {
    targetKey = key
    let nextMat: ManifestMaterial<FinishManifestUniforms> | null = null
    return loadFinishManifest(kind)
      .then(async (baseManifest) => {
        if (disposed || targetKey !== key) return
        const manifest: MaterialManifest<FinishManifestUniforms> = {
          ...baseManifest,
          cullMode: doubleSided ? 'none' : 'back',
        }
        nextMat = createManifestMaterial(renderer, manifest)
        nextMat.setUniforms(latestUniforms)
        pending = nextMat
        await nextMat.ready
        if (disposed || targetKey !== key) {
          nextMat.dispose()
          if (pending === nextMat) pending = null
          return
        }
        const prev = active
        active = nextMat
        activeKey = key
        if (pending === nextMat) pending = null
        nextMat.setUniforms(latestUniforms)
        uploadedUniforms = latestUniforms
        prev?.dispose()
        onVariantReady?.()
      })
      .catch((err) => {
        if (nextMat) nextMat.dispose()
        if (pending === nextMat) pending = null
        if (!disposed && targetKey === key) throw err
      })
  }

  const initResolved = resolveFinish(initialFinish)
  const initKind = selectFinishManifestKind(initResolved)
  const initDouble = initResolved.side === 'double'
  const ready = startVariant(initKind, initDouble, `${initKind}|${String(initDouble)}`)

  return {
    ready,
    isReady: () => Boolean(active?.isReady()),
    usesDynamicFrameOffset: true,
    get needsBackdrop() {
      return Boolean(active?.needsBackdrop)
    },
    writeCustomUniforms() {},
    updateFrameUniforms(_m: Mat4, _w: Mat4) {},
    updateFinish(finish: SurfaceFinish) {
      if (disposed) return
      const nextResolved = resolveFinish(finish)
      const nextKind = selectFinishManifestKind(nextResolved)
      const nextDouble = nextResolved.side === 'double'
      const nextKey = `${nextKind}|${String(nextDouble)}`
      const nextUniforms = packFinishUniforms(nextResolved)
      latestUniforms = nextUniforms
      if (nextKey === activeKey) {
        // Cancel any in-flight switch back to activeKey before syncing uniforms.
        targetKey = nextKey
      } else if (nextKey !== targetKey) {
        void startVariant(nextKind, nextDouble, nextKey).catch(() => {})
        return
      }
      if (active && nextKey === activeKey && !uniformsEqual(uploadedUniforms, nextUniforms)) {
        active.setUniforms(nextUniforms)
        uploadedUniforms = nextUniforms
      }
    },
    ensureBindGroup: (view, sampler) => active?.ensureBindGroup(view, sampler) ?? null,
    extraBindGroups: () => active?.extraBindGroups?.() ?? [],
    pipelineFor: (colorWrite) => active?.pipelineFor(colorWrite) ?? null,
    dispose() {
      disposed = true
      active?.dispose()
      pending?.dispose()
      active = null
      pending = null
    },
  }
}
