// Finish loader — the finish code (node graph, lights, environment bakes),
// fetched when the first finish on a page mounts, and the provider that gives
// each SurfaceCanvas its rig once it has.
//
// The law: a page whose Surfaces wear no finish downloads none of the finish
// code. Imported eagerly, finishes put the surface entry about 7 kB gzip over
// its payload budget (instruments/payload, CI run 45931452698, 2026-11-26).
// A finish waiting for this code holds its Surface's first compile, as it
// holds for its bake (SurfaceFinishMaterial.tsx), so the card keeps its page
// look until the code, the bake and the compile are all ready.
//
// The finish code imports nothing of the canvas: this module reads the
// capture, the mesh's slot, the frames and the rig, and hands them over
// (FinishSources). Under Vite 8, a lazy module importing a canvas module
// split the page's eager bundle into several chunks, whose gzip cost more
// than the deferred code saved (instruments/payload, m2, 2026-11-26).
//
// Ownership: this module owns when the finish code loads, which rig a
// canvas's finishes read, and what a finish is handed. The rig itself is
// finishRig.tsx, the material SurfaceFinishMaterial.tsx, and each layer's
// code finishLayerCode.ts.

import { createContext, use, useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useThree } from '@react-three/fiber'
import { WebGPURenderer } from 'three/webgpu'

import type { FinishRig } from './finishRig'
import type { FinishSources } from './SurfaceFinishMaterial'
import { useSurfaceTextureFor } from './surfaceContext'
import type { SurfaceFinish } from './surfaceFinish'
import { SurfaceFrameContext } from './surfaceFrame'
import { isSurfaceLight, type SurfaceLighting } from './surfaceLight'
import { getSurfaceLitTexture } from './surfaceLitTexture'
import { useMaterialSlot } from './surfaceMaterials'

// ── the finish code ────────────────────────────────────────────────────

type FinishCode = typeof import('./SurfaceFinishMaterial') & typeof import('./finishRig')

let finishCode: FinishCode | null = null
let request: Promise<void> | null = null
const listeners = new Set<() => void>()

/** Start loading the finish code, once per page. */
export function loadFinishCode(): void {
  request ??= Promise.all([import('./SurfaceFinishMaterial'), import('./finishRig')]).then(
    ([material, rig]) => {
      finishCode = { ...material, ...rig }
      for (const listener of [...listeners]) listener()
    },
    (error) => {
      // The next finish to mount asks again.
      request = null
      console.error('[munari] the finish code could not load, so Surfaces with a finish keep their page look.', error)
    },
  )
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function useFinishCode(): FinishCode | null {
  return useSyncExternalStore(subscribe, () => finishCode, () => null)
}

function HoldCompile() {
  const { hold } = useMaterialSlot('A finish')
  useLayoutEffect(() => hold(), [hold])
  return null
}

/** What the finish code reads for the Surface.Mesh this runs in. */
export function useFinishSources(caller: string): FinishSources {
  const capture = useSurfaceTextureFor(caller)
  const slot = useMaterialSlot(caller)
  const frames = use(SurfaceFrameContext)
  const invalidate = useThree((state) => state.invalidate)
  const { rig, loading } = useFinishRig()
  // Imported straight from /advanced, the finish material still waits for
  // the canvas's rig, which is built once the finish code has loaded.
  useEffect(loadFinishCode, [])
  const litTexture = useMemo(() => getSurfaceLitTexture(capture), [capture])
  useLayoutEffect(() => litTexture.acquire(), [litTexture])
  // Before each draw, after raster sizing: the raw view follows the capture.
  useLayoutEffect(() => slot.beforeDraw(litTexture.sync), [slot, litTexture])
  return { slot, litTexture, frames, rig, loading, invalidate }
}

interface FinishMaterialProps {
  readonly code: FinishCode
  readonly finish: SurfaceFinish | undefined
}

function FinishMaterial({ code, finish }: FinishMaterialProps) {
  const sources = useFinishSources('A finish')
  const material = code.useFinishMaterial(sources, finish ? { finish } : {})
  return material ? <primitive object={material} attach="material" /> : null
}

/**
 * The finish material, `finish` or the Surface's, for the Surface.Mesh this
 * runs in. It loads the finish code on first mount and holds the mesh's
 * compile until it arrives.
 */
export function DeferredFinishMaterial({ finish }: { readonly finish?: SurfaceFinish }) {
  const code = useFinishCode()
  useEffect(loadFinishCode, [])
  return code ? <FinishMaterial code={code} finish={finish} /> : <HoldCompile />
}

// ── the canvas's rig ───────────────────────────────────────────────────

export interface FinishRigSlot {
  /** Null outside a SurfaceCanvas, under `lighting="none"`, and without WebGPU. */
  readonly rig: FinishRig | null
  /** The canvas lights its finishes, and the finish code has not arrived. */
  readonly loading: boolean
}

const UNLIT: FinishRigSlot = { rig: null, loading: false }
const FinishRigContext = createContext<FinishRigSlot>(UNLIT)

export function useFinishRig(): FinishRigSlot {
  return use(FinishRigContext)
}

/** Provides the canvas's rig to the finishes under it. */
export function FinishRigProvider({ lighting, children }: { readonly lighting: SurfaceLighting; readonly children: ReactNode }) {
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const code = useFinishCode()
  const studioLit = lighting !== 'none'
  const lightsFinishes = studioLit && gl instanceof WebGPURenderer
  // One rig per renderer: changing `lighting` writes values into it, so an
  // inline `lighting={{…}}` keeps the baked environments across renders.
  const created = useMemo(
    () => (code && studioLit && gl instanceof WebGPURenderer ? code.createFinishRig(gl, invalidate) : null),
    [code, gl, invalidate, studioLit],
  )
  useEffect(() => () => created?.dispose(), [created])
  if (created && code && lighting !== 'none') created.configure(code.studioLightingOf(lighting))
  const key = lighting === 'none' || lighting === 'studio' ? undefined : lighting.key
  const handle = key && isSurfaceLight(key) ? key : null
  useEffect(() => created?.connect(), [created, handle])
  // A new `lighting` value draws a frame under it.
  useEffect(() => {
    if (created) invalidate()
  })
  const rig = created?.rig ?? null
  const loading = lightsFinishes && !code
  const slot = useMemo<FinishRigSlot>(() => ({ rig, loading }), [rig, loading])
  return <FinishRigContext value={slot}>{children}</FinishRigContext>
}
