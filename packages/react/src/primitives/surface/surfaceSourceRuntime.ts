// The source runtime — one live DOM subtree, its texture, and the pipeline
// between them, with no React and no mesh in it.
//
// The law: a source has ONE texture and any number of presenters. That is
// the whole reason this is a separate object from the mesh it used to live
// inside. Logo's letters are several presentations of one part; Genie draws
// a window and its own shadow companion from the same capture; a Twin shows
// the page and the mesh together. Each of those used to mean a second
// `createDomTextureSource`, which meant a second parked canvas, a second
// paint budget, and two rasters that could disagree by a generation.
//
// The fault that produced the shared allocation ledger, traced at the GL
// boundary 2026-08-04: three allocates texture storage IMMUTABLY at first
// upload and `texSubImage2D`s forever after, so an upload into storage cut
// for a different size either lands in one corner (a shrink) or is rejected
// outright with GL_INVALID_VALUE (a grow). Neither raises. On screen it is
// a mesh that is present, visible, colour-writing, correctly placed, and
// drawing nothing. The ledger is seeded at BIRTH rather than at first
// upload, because the renderer can reach a texture marked `needsUpdate` and
// bake storage before any upload runs.
//
// Ownership: this object owns capture, texture format, upload timing, LOD
// resolution, and chrome measurement. It owns no scene node, no material,
// and no React state, so a presenter mounting or unmounting costs it
// nothing.

import * as THREE from 'three'
import {
  DEFAULT_TIERS,
  EMPTY_CHROME,
  MAX_TEXTURE_EDGE,
  chromeEquals,
  clampScale,
  clampTiers,
  createDomTextureSource,
  filterPolicy,
  maxTier,
  measureSurfaceChrome,
  seedTier,
  tiersInRange,
  uploadNeedsRealloc,
  type DomPaintReceipt,
  type DomTextureSource,
  type SurfaceChrome,
} from '@munari/core'

/** Texture density policy, shaped like r3f's `dpr`. */
export type SurfaceResolution =
  | 'auto'
  | 'max'
  | number
  | readonly [min: number, max: number]

/** Source CSS pixels. */
export type SurfaceSize = readonly [width: number, height: number]

/**
 * One part's live source, as every presenter of it sees it.
 *
 * Published to the HANDLE rather than to a React context, which is what
 * makes separated wiring work: a mesh in a scene tree holding only a handle
 * still finds the source a page tree declared, because the source announced
 * itself to the thing both trees hold.
 */
export interface SurfacePartPublication {
  readonly id: import('@munari/core').SurfacePartId
  readonly runtime: SurfaceSourceRuntime | null
  readonly size: SurfaceSize
  readonly captureRoot: HTMLElement | null
  readonly pageRoot: HTMLElement | null
}

export interface SurfaceSourceOptions {
  label?: string
  /** The element to capture. Either a container this runtime fills, or an
   *  adopted node the caller assembled. */
  content: HTMLElement
  size: SurfaceSize
  resolution: SurfaceResolution
  mirrorU: boolean
  paint: 'auto' | 'always'
  pixelRatio: number
  onError(error: Error): void
  onPainted?(receipt: DomPaintReceipt): void
  onChrome?(chrome: SurfaceChrome): void
  /** The authored content root whose radius and shadows describe the matter. */
  chromeElement?(): HTMLElement
}

export interface SurfaceSourceRuntime {
  readonly source: DomTextureSource
  readonly element: HTMLElement
  texture(): THREE.CanvasTexture | null
  chrome(): SurfaceChrome
  size(): SurfaceSize
  mirrorU(): boolean
  paintedSize(): readonly [number, number]
  /** The generation of the paint currently uploaded, or -1. */
  uploadedGeneration(): number
  /** Every completed paint, for anchor transactions. */
  currentPaint(): DomPaintReceipt | null
  subscribePaint(listener: (receipt: DomPaintReceipt) => void): () => void
  /**
   * A live mirror flip activates no paint, so it advances no generation and
   * fires no `subscribePaint`. Anchor scopes read it through this channel to
   * re-issue their committed receipt and wake the consumer.
   */
  subscribeMirrorU(listener: (mirrorU: boolean) => void): () => void
  setSize(size: SurfaceSize): void
  setResolution(resolution: SurfaceResolution): void
  setMirrorU(mirrorU: boolean): void
  setPaint(paint: 'auto' | 'always'): void
  /** One presenter's LOD demand. The runtime rasterizes for the greediest. */
  proposeTier(key: number, tier: number | null): void
  /** Advance capture one renderer frame. Returns true if anything changed. */
  frame(): boolean
  /** Has any paint succeeded and been marked for upload? */
  uploaded(): boolean
  dispose(): void
}

// GPU mipmaps sabotage text at reading range: trilinear blends in the
// box-filtered half-res mip whenever the footprint tips past 1:1. The tier
// ladder already IS the mip chain — CPU-side, distance-driven. Far tiers
// (≤0.5) keep mipmaps, because there a panel is small or oblique and
// anisotropy needs a chain to select from. A PINNED tier oversupplies at
// range by construction, so it always gets one.
function applyFilterPolicy(tex: THREE.Texture, tier: number, pinned: boolean) {
  const mips = pinned || tier <= 0.5
  if (tex.generateMipmaps !== mips) {
    tex.generateMipmaps = mips
    tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
    tex.needsUpdate = true
  }
}

// Horizontal flip, for geometries whose UVs run backwards under the camera.
// Wrapping has to become Repeat for a negative repeat to wrap into anything.
function applyMirror(tex: THREE.Texture, mirrorU: boolean) {
  tex.wrapS = mirrorU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  tex.repeat.x = mirrorU ? -1 : 1
}

/** Configure every source-format field before a DOM texture reaches a material. */
export function createDomSurfaceTexture(
  canvas: HTMLCanvasElement,
  tier: number,
  pinned: boolean,
  mirrorU: boolean,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // Premultiplied from birth (decisions.md #5). Setting this after renderer
  // exposure can let the first upload use a different alpha interpretation
  // from every later one.
  texture.premultiplyAlpha = true
  texture.anisotropy = 8
  applyFilterPolicy(texture, tier, pinned)
  applyMirror(texture, mirrorU)
  return texture
}

// Frames of an unmoving box before the backing store is cut exact. ~67ms at
// 120Hz — over before a landed card is read, long enough that a spring's
// last sub-pixel twitches don't each buy a re-cut.
const QUIET_FRAMES = 8

export function createSurfaceSourceRuntime(
  options: SurfaceSourceOptions,
): SurfaceSourceRuntime {
  let { size, resolution, mirrorU, paint } = options
  const { label, content, pixelRatio, onError, onPainted, onChrome, chromeElement } = options

  const ladderFor = (r: SurfaceResolution, w: number, h: number) => {
    const ladder = Array.isArray(r) ? tiersInRange(DEFAULT_TIERS, r[0], r[1]) : DEFAULT_TIERS
    return clampTiers(ladder, w, h)
  }

  // `'max'` and fixed numbers resolve to a single pinned scale; null means
  // dynamic. A number is clamped to the long-edge guard — with a warning,
  // because silently deviating from what the caller wrote is its own bug
  // and letting a 5000px canvas through is a worse one.
  const pinnedFor = (r: SurfaceResolution, w: number, h: number): number | null => {
    if (r === 'max') return maxTier(DEFAULT_TIERS, w, h)
    if (r === 'auto' || Array.isArray(r)) return null
    // SAFETY: the union's remaining arm. 'auto', 'max', and the range tuple
    // are all handled above, so what is left is the bare number.
    const authored = r as number
    const safe = clampScale(authored, w, h)
    if (safe !== authored) {
      console.warn(
        `[munari] Surface${label ? ` "${label}"` : ''}: resolution ${authored} exceeds ` +
          `the ${MAX_TEXTURE_EDGE}px long-edge texture guard at ${w}×${h} CSS px; ` +
          `clamped to ${safe}.`,
      )
    }
    return safe
  }

  let pinned = pinnedFor(resolution, size[0], size[1])

  const source = createDomTextureSource(content, size[0], size[1], {
    label,
    // Pinned resolution starts at its final scale; auto/range starts at
    // the ladder tier nearest the renderer's pixel ratio — density ≈ dpr is
    // the right prior for a mesh that has never been projected.
    scale: pinned ?? seedTier(ladderFor(resolution, size[0], size[1]), pixelRatio),
    onError,
  })

  let texture: THREE.CanvasTexture | null = createDomSurfaceTexture(
    source.canvas,
    source.scale(),
    pinned !== null,
    mirrorU,
  )

  // What the GL storage was allocated FOR. Seeded here, not at the first
  // upload, because the allocation is armed here — see the module preamble.
  let alloc: { width: number; height: number; mips: boolean } | null = {
    width: source.canvas.width,
    height: source.canvas.height,
    mips: filterPolicy(pinned !== null).mips,
  }

  let chrome: SurfaceChrome = EMPTY_CHROME
  let lastPaintCount = -1
  let extraUploads = 0
  let pendingUploadGeneration = -1
  let uploadedGeneration = -1
  let anyUpload = false
  const settle = { w: -1, h: -1, quiet: 0, settled: false }
  const proposals = new Map<number, number>()
  const mirrorListeners = new Set<(mirrorU: boolean) => void>()
  let disposed = false

  texture.onUpdate = () => {
    uploadedGeneration = pendingUploadGeneration
  }

  const unsubscribePaint = source.subscribePaint((receipt) => onPainted?.(receipt))

  const measureChrome = () => {
    if (!source.painted()) return
    const next = measureSurfaceChrome(chromeElement?.() ?? source.element)
    if (chromeEquals(chrome, next)) return
    chrome = next
    onChrome?.(next)
  }

  const upload = () => {
    if (!source.painted() || !texture) return
    // Compared HERE, against the canvas this upload is about, rather than
    // marked at the resize and deferred: a Surface whose size is measured
    // can resize every frame, and a mark re-armed every commit chases its
    // own tail — traced as one alloc followed by 120 rejected uploads.
    const store = { width: source.canvas.width, height: source.canvas.height }
    const mips = filterPolicy(pinned !== null).mips
    if (!alloc) {
      alloc = { ...store, mips }
    } else if (uploadNeedsRealloc(alloc, store) || alloc.mips !== mips) {
      texture.dispose()
      applyFilterPolicy(texture, source.scale(), pinned !== null)
      alloc = { ...store, mips }
    }
    pendingUploadGeneration = source.currentPaint()?.frame.generation ?? -1
    texture.needsUpdate = true
    anyUpload = true
  }

  const applyTier = () => {
    if (pinned !== null) {
      source.setScale(pinned)
      return
    }
    let best: number | null = null
    for (const tier of proposals.values()) {
      if (best === null || tier > best) best = tier
    }
    if (best !== null && best !== source.scale()) source.setScale(best)
  }

  return {
    source,
    element: source.element,
    texture: () => texture,
    chrome: () => chrome,
    size: () => size,
    mirrorU: () => mirrorU,
    paintedSize: () => source.paintedSize(),
    uploadedGeneration: () => uploadedGeneration,
    currentPaint: () => source.currentPaint(),
    subscribePaint: (listener) => source.subscribePaint(listener),
    subscribeMirrorU: (listener) => {
      mirrorListeners.add(listener)
      return () => {
        mirrorListeners.delete(listener)
      }
    },
    setSize(next) {
      if (next[0] === size[0] && next[1] === size[1]) return
      size = next
      const nextPinned = pinnedFor(resolution, size[0], size[1])
      // Before paint, for the same reason the host's declared size is: this
      // is the head of the capture pipeline (setSize → requestPaint →
      // onpaint → upload), and starting it a paint late costs a whole
      // generation. Measured on the knobs lab as a capture trailing the
      // live box by exactly one drag step, on every step of every drag.
      source.setSize(size[0], size[1])
      if (nextPinned !== pinned) {
        pinned = nextPinned
        applyTier()
      }
    },
    setResolution(next) {
      if (next === resolution) return
      resolution = next
      pinned = pinnedFor(resolution, size[0], size[1])
      applyTier()
      // Neither branch touches the texture: the upload path reallocates on
      // any disagreement with what the storage was allocated for, and the
      // mip decision is half of that pair — so a pin that lands on the SAME
      // tier still gets fresh storage. The repaint is what carries it
      // there; an idle Surface has no other reason to upload.
      source.repaint()
    },
    setMirrorU(next) {
      if (next === mirrorU) return
      mirrorU = next
      if (texture) {
        applyMirror(texture, mirrorU)
        texture.needsUpdate = true
      }
      // A flip advances no paint generation and fires no `subscribePaint`, so
      // this is the one channel a mirror change reaches anchor consumers by.
      for (const listener of mirrorListeners) listener(mirrorU)
    },
    setPaint(next) {
      paint = next
    },
    proposeTier(key, tier) {
      if (tier === null) proposals.delete(key)
      else proposals.set(key, tier)
      if (pinned === null) applyTier()
    },
    frame() {
      if (disposed || !texture) return false
      let work = false
      // The settle. While the box moves, the store is allowed to drift
      // inside the density band so the canvas keeps its pixels across every
      // resize; the moment it stops, that tolerance has served its purpose
      // and the store is cut exact. Motion is approximate, rest is exact.
      if (settle.w !== size[0] || settle.h !== size[1]) {
        settle.w = size[0]
        settle.h = size[1]
        settle.quiet = 0
        settle.settled = false
        work = true
      } else if (!settle.settled && ++settle.quiet >= QUIET_FRAMES) {
        settle.settled = true
        source.resettle()
        work = true
      } else if (!settle.settled) {
        work = true
      }

      const count = source.paintCount()
      if (paint === 'always') {
        source.repaint()
        upload()
        if (count !== lastPaintCount) measureChrome()
        lastPaintCount = count
        return true
      }
      // Upload-on-paint: the compositor already reports exactly when the
      // subtree's pixels changed, so idle sources cost nothing. One extra
      // upload after the counter stops covers the draw's deferred resolve
      // trailing the paint by up to a frame.
      if (count !== lastPaintCount) {
        lastPaintCount = count
        extraUploads = 1
        upload()
        measureChrome()
        work = true
      } else if (extraUploads > 0) {
        extraUploads -= 1
        upload()
        work = true
      }
      return work
    },
    uploaded: () => anyUpload,
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribePaint()
      mirrorListeners.clear()
      if (texture) {
        texture.onUpdate = null
        texture.dispose()
      }
      texture = null
      source.dispose()
    },
  }
}

/** The LOD ladder a runtime would use at this size, for a presenter's proposal. */
export function surfaceTierLadder(
  resolution: SurfaceResolution,
  width: number,
  height: number,
): readonly number[] {
  const ladder = Array.isArray(resolution)
    ? tiersInRange(DEFAULT_TIERS, resolution[0], resolution[1])
    : DEFAULT_TIERS
  return clampTiers(ladder, width, height)
}
