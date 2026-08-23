// What a Surface hands its compound children, in two layers.
//
// The ROOT layer is identity: the store, the host, the wiring style, and
// the part ledger. The PART layer is one source: its runtime, its measured
// box, and the presenter bookkeeping. They are separate contexts because a
// multi-part Surface has one root and several parts, and a presenter needs
// to name exactly one of them.
//
// The wiring style is decided once, at the root, by where the root was
// declared — `canvas` when an R3F host is above it, `page` otherwise — and
// every composition diagnostic reads it. It is not a prop: a caller who
// could set it could claim a page slot that does not exist, and the fault
// would surface as a DOM presentation that silently never appears.

import { createContext, use, useCallback, useMemo, useSyncExternalStore } from 'react'
import type * as THREE from 'three'
import type { SurfaceChrome, SurfacePartId } from '@munari/core'
import { surfaceStoreOf } from './surfaceHandle'
import type { SurfaceStore, SurfaceHandle } from './surfaceHandle'
import type { SurfaceHost } from './surfaceHostRegistry'
import type { SurfaceSourceRuntime, SurfaceSize } from './surfaceSourceRuntime'

/** Where the root was declared — which decides what it may contain. */
export type SurfaceWiring = 'page' | 'canvas'

/** Which copy of a source tree a component instance is rendering in. */
export type SurfaceInstance = 'page' | 'source'

export interface SurfaceRootValue {
  readonly store: SurfaceStore
  readonly handle: SurfaceHandle
  readonly host: SurfaceHost | null
  readonly canvas: string | undefined
  readonly name: string | undefined
  /**
   * This root's own identity among every root on the page, minted at mount
   * and stable for its lifetime.
   *
   * Every cross-tree registration is keyed by it. The name cannot be: it is
   * optional, so two unnamed Surfaces declared in one Canvas would publish
   * their sources under the same key and the registry — which replaces by
   * key — would keep one of them and drop the other's content on the floor.
   */
  readonly instanceId: string
  readonly wiring: SurfaceWiring
  /** True when the root carries `view` — an exclusive handoff, not a Twin. */
  readonly exclusive: boolean
  /** Declare a part id in the expected set; the return forgets it. */
  expectPart(id: SurfacePartId): () => void
  /** A WebGL presenter arrived for a part; the return unregisters it. */
  registerPartPresenter(id: SurfacePartId): () => void
  /** The measured page box for a part, from its DOM presentation. */
  reportMeasuredSize(id: SurfacePartId, size: SurfaceSize | null): void
  measuredSize(id: SurfacePartId): SurfaceSize | null
  /** Every live part runtime, for readiness and anchor reads. */
  partRuntime(id: SurfacePartId): SurfaceSourceRuntime | null
}

export interface SurfacePartValue {
  readonly id: SurfacePartId
  readonly runtime: SurfaceSourceRuntime | null
  readonly size: SurfaceSize
  /** The container the source content is rendered into, once it exists. */
  readonly captureRoot: HTMLElement | null
  /** The live page-side element, when a DOM presentation is mounted. */
  readonly pageRoot: HTMLElement | null
  setPageRoot(el: HTMLElement | null): void
  /** The page box a DOM presentation measured, when `size` is unauthored. */
  setMeasuredSize(size: SurfaceSize | null): void
}

/**
 * The part id a single-source Surface uses when the caller names none.
 *
 * A real id rather than `undefined`: the readiness ledger, the anchor map,
 * and the part publication are all keyed by part, and giving the common
 * case a name means those three have one code path instead of two.
 */
export const DEFAULT_PART: SurfacePartId = 'default'

/**
 * What a material mounted in a presenter's material slot needs from it.
 *
 * The uniform objects are the PRESENTER's, shared by reference: a radius
 * change is a value write into these, so a material that splices the mask
 * must wire the same objects rather than allocate its own — a private copy
 * compiles fine and then never moves.
 */
export interface SurfaceMaterialValue {
  readonly radii: { value: THREE.Vector4 }
  readonly size: { value: THREE.Vector2 }
  /** True when the presenter was asked to honor the capture's alpha. */
  readonly transparent: boolean
}

export const SurfaceMaterialContext = createContext<SurfaceMaterialValue | null>(null)

export const SurfaceRootContext = createContext<SurfaceRootValue | null>(null)
export const SurfacePartContext = createContext<SurfacePartValue | null>(null)
export const SurfaceInstanceContext = createContext<SurfaceInstance>('page')

/**
 * True inside the copy of a page-declared presentation that the host is
 * rendering in the Canvas.
 *
 * The same element runs in both trees: once in the page, where it registers
 * and renders nothing, and once inside the Canvas, where it draws. Without
 * this flag the Canvas-side copy would read `wiring === 'page'` from the
 * bridged root context and register itself again, forever.
 */
export const SurfaceTunnelContext = createContext(false)

export function useSurfaceRoot(component: string): SurfaceRootValue {
  const root = use(SurfaceRootContext)
  if (!root) {
    throw new Error(
      `munari: <${component}> must be rendered inside a <Surface>. It reads the ` +
        'source and identity its parent declares, so there is nothing for it to ' +
        'present on its own.',
    )
  }
  return root
}

export function useSurfacePart(component: string): SurfacePartValue {
  const part = use(SurfacePartContext)
  if (!part) {
    throw new Error(
      `munari: <${component}> found no source. A <Surface> without \`source\` or ` +
        '`adopt` holds its content in <Surface.Part> children — put this inside one.',
    )
  }
  return part
}

/**
 * Which copy of a source tree this component is rendering in.
 *
 * A portal-copy capture creates TWO instances of the source component. Local
 * state, uncontrolled form values, effects, and literal element IDs can
 * therefore diverge or duplicate. A source reads this to suppress the half
 * of its behavior that must happen once — analytics, autofocus, a
 * subscription — in the copy that is only there to be rasterized.
 */
export function useSurfaceInstance(): SurfaceInstance {
  return use(SurfaceInstanceContext)
}

/**
 * The Surface texture, for a custom material.
 *
 * Never null in that position: `Surface.WebGL` mounts a custom material
 * only after a configured texture exists, so the material's first render
 * already samples real pixels rather than binding null and waiting for a
 * re-render that a memoized material may never take.
 */
export function useSurfaceTexture(): THREE.Texture {
  const part = useSurfacePart('useSurfaceTexture')
  const texture = part.runtime?.texture()
  if (!texture) {
    throw new Error(
      'munari: useSurfaceTexture() found no texture. It is only valid inside a ' +
        'material passed to <Surface.WebGL material={…}>, which Munari mounts ' +
        'after the texture exists.',
    )
  }
  return texture
}

/**
 * ANOTHER Surface's texture, named by handle rather than by position.
 *
 * The law `useSurfaceTexture` implies — a material reaches the Surface it
 * is mounted in — is a statement about the material slot, not about the
 * runtime. A source rasterizes, uploads, and versions its texture with ZERO
 * presenters registered: no crossing, no mesh, no DOM presentation, nothing
 * composited anywhere (decisions.md #36). Measured 2026-08-22
 * (docs/spikes/cross-surface-sampling.md):
 * a Surface declared `<Surface surface={h} source={…} />` and presented
 * nowhere held `texture.version` climbing 175 → 318 over 1.2s, under
 * `frameloop="demand"` as well as `"always"`, while a static control held
 * exactly still. That is what lets one material mix two live captures —
 * the second view is matter the page never shows.
 *
 * Null, unlike `useSurfaceTexture`, and the difference is load-bearing. In
 * the material slot the texture is guaranteed because Munari mounts the
 * material after it exists; a handle names content whose source may mount
 * later, never, or in another tree entirely. A material binds `null` and
 * rebinds when this answers — so sample it behind a `has` flag rather than
 * deferring the material's own mount, which a memoized material may never
 * take back.
 */
export function useSurfaceTextureOf(
  handle: SurfaceHandle,
  part: SurfacePartId = DEFAULT_PART,
): THREE.Texture | null {
  const store = surfaceStoreOf(handle)
  const subscribe = useMemo(() => store.subscribeParts.bind(store), [store])
  // The runtime keeps ONE texture for its whole life and re-cuts storage
  // into it, so this reference is stable across every upload and every LOD
  // re-raster. `useSyncExternalStore` compares snapshots by reference: an
  // answer allocated per read would re-render every subscriber forever.
  const snapshot = useMemo(
    () => () => store.part(part)?.runtime?.texture() ?? null,
    [store, part],
  )
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * The container Munari renders this part's source content into.
 *
 * Null until the source exists. A scene that has to write on the captured
 * DOM directly — a CSS custom property the content sizes itself from, a
 * class that lasts one gesture — reaches it here rather than through a
 * query for the parked element.
 */
export function useSurfaceSourceRoot(): HTMLElement | null {
  return useSurfacePart('useSurfaceSourceRoot').captureRoot
}

/** What a child can learn about the skin it is drawn on. */
export interface SurfaceChromeState {
  chrome: SurfaceChrome | null
  width: number
  height: number
}

/**
 * The measured DOM chrome (corner radii, outer box-shadow layers) and the
 * CSS box it was measured in. Null chrome means no measurement has landed
 * yet, not "no chrome" — an outer shadow paints OUTSIDE the layout box, so
 * the rasterizer never captures it and a scene that wants it renders it.
 */
export function useSurfaceChrome(): SurfaceChromeState {
  const part = useSurfacePart('useSurfaceChrome')
  return {
    chrome: part.runtime?.chrome() ?? null,
    width: part.size[0],
    height: part.size[1],
  }
}

/**
 * A stable GETTER for the box the last COMPLETED paint actually rasterized,
 * which during a resize trails the box the Surface currently measures.
 *
 * Deliberately not React state: a paint landing must not re-render the tree
 * to report it, and a frame-loop consumer wants the freshest answer at the
 * moment it samples. A material blending its own raster against something
 * live reads this to know whether the two are even the same generation.
 */
export function useSurfacePaintedSize(): () => readonly [number, number] {
  const part = useSurfacePart('useSurfacePaintedSize')
  const runtime = part.runtime
  return useCallback(() => runtime?.paintedSize() ?? [0, 0], [runtime])
}

let nextInstanceSeq = 0

/** A fresh root instance id. One per `<Surface>` declaration, ever. */
export function nextSurfaceInstanceId(): string {
  return `surface-${nextInstanceSeq++}`
}

/**
 * The registry key for one part's source.
 *
 * Instance first, part second, and the name nowhere: the registry replaces
 * by key, so any two live Surfaces sharing a key means one of them loses
 * its content on the next commit.
 */
export function sourceContentKey(instanceId: string, part: SurfacePartId): string {
  return `${instanceId}:${String(part)}`
}
