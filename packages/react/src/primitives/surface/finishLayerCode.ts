// Finish layer code — the chunk each finish layer's shader code loads in,
// fetched the first time a finish on the page uses that layer.
//
// The law: a page downloads the shader code of the layers its finishes use,
// and no other. Each layer with nodes of its own is a module imported here
// and nowhere else, so the bundler gives it a chunk; every relief kind is
// one, since each compiles its own noise. Coat and anisotropy are three's
// own lobes, switched on by setting a node (finishNodes.ts), and have no
// code to defer. A material builds only once every chunk its layers name has
// loaded: until then SurfaceFinishMaterial.tsx holds the first compile, or
// keeps drawing the material it has.
//
// To add a layer: put its nodes in a module that imports only three and
// other layer modules, list it in LAYER_CHUNKS under the layer's name, name
// it in layerChunksOf, and read it in finishNodes.ts through chunkCode.
//
// Ownership: this module owns which layer code has loaded. finishNodes.ts
// reads it.

import { useEffect, useSyncExternalStore } from 'react'

import type { FinishLayers } from './finishUniforms'

const LAYER_CHUNKS = {
  film: () => import('./finishFilm'),
  sheen: () => import('./finishSheen'),
  scatter: () => import('./finishScatter'),
  crackle: () => import('./finishCrackle'),
  transmission: () => import('./finishTransmission'),
  'orange-peel': () => import('./finishReliefOrangePeel'),
  brushed: () => import('./finishReliefBrushed'),
  pile: () => import('./finishReliefPile'),
  glaze: () => import('./finishReliefGlaze'),
  crumple: () => import('./finishReliefCrumple'),
  fiber: () => import('./finishReliefFiber'),
  dots: () => import('./finishReliefDots'),
  honeycomb: () => import('./finishReliefHoneycomb'),
}

type LayerChunks = typeof LAYER_CHUNKS
type LayerChunk = keyof LayerChunks
type ChunkCode<Chunk extends LayerChunk> = Awaited<ReturnType<LayerChunks[Chunk]>>

/** The layer code loaded so far, by layer name. */
export type FinishLayerCode = { readonly [Chunk in LayerChunk]?: ChunkCode<Chunk> }

const loaded: { [Chunk in LayerChunk]?: ChunkCode<Chunk> } = {}
const requested = new Set<LayerChunk>()
const listeners = new Set<() => void>()
// One object per set of layers, so a material memoized on it holds.
const completeCode = new Map<string, FinishLayerCode>()

function load(chunk: LayerChunk): void {
  if (requested.has(chunk)) return
  requested.add(chunk)
  const request: Promise<ChunkCode<LayerChunk>> = LAYER_CHUNKS[chunk]()
  request.then(
    (code) => {
      Object.assign(loaded, { [chunk]: code })
      for (const listener of [...listeners]) listener()
    },
    (error) => {
      // The next finish to mount that uses this layer asks again.
      requested.delete(chunk)
      console.error(`[munari] the ${chunk} finish layer could not load, so finishes that use it keep their page look.`, error)
    },
  )
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function layerChunksOf(layers: FinishLayers): LayerChunk[] {
  const chunks: LayerChunk[] = []
  if (layers.film) chunks.push('film')
  if (layers.sheen) chunks.push('sheen')
  if (layers.scatter) chunks.push('scatter')
  if (layers.crackle) chunks.push('crackle')
  if (layers.transmission) chunks.push('transmission')
  if (layers.detail !== null) chunks.push(layers.detail)
  return chunks
}

/** The code `layers` compiles, or null until all of it has loaded. Loads what is missing. */
export function useFinishLayerCode(layers: FinishLayers | null): FinishLayerCode | null {
  const chunks = layers ? layerChunksOf(layers) : []
  const key = chunks.join(' ')
  useEffect(() => {
    for (const chunk of chunks) load(chunk)
  })
  const snapshot = () => {
    const cached = completeCode.get(key)
    if (cached) return cached
    if (!chunks.every((chunk) => loaded[chunk] !== undefined)) return null
    const code: FinishLayerCode = { ...loaded }
    completeCode.set(key, code)
    return code
  }
  return useSyncExternalStore(subscribe, snapshot, () => null)
}

/** A layer's loaded code; a layer built before its chunk landed is a bug in the caller. */
export function chunkCode<Code>(code: Code | undefined, layer: string): Code {
  if (code === undefined) throw new Error(`munari: the ${layer} finish layer was built before its code loaded.`)
  return code
}
