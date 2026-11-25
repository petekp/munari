// <Surface.Anchor> — a scene object placed at a named box in the source.
//
// The law: an anchor's children exist only while a COMPLETE anchor set is
// true of the generation drawn on this geometry. Nothing renders from a
// half-collected set and nothing renders from a set that describes pixels
// which are not on the mesh, because either one places hardware where the
// content is about to be rather than where it is.
//
// The scene group that places those children, and the geometry sampling
// that puts it there, live in SurfaceAnchorGroup.tsx so a page that declares an
// anchor loads no three code before a canvas mounts.
//
// Ownership: this component owns its key's subscription. It owns no receipt,
// no paint, no texture, and no transform: SurfaceAnchorGroup places the group.

import { createContext, use, useEffect, useMemo, useState } from 'react'
import type { SourceUvRect } from '@munari/core'
import { useSurfaceAnchorContext } from './surfaceAnchorScope'
import { useSurfacePart } from './surfaceContext'
import { SceneAnchorGroup } from './surfaceSceneLookup'

export interface SurfaceAnchorProps {
  /** The `data-munari-anchor` value this stands on. */
  name: string
  /** Lifted off the surface along its normal, in local units. */
  offset?: number
  children?: React.ReactNode
}

/** What an anchored child needs to size itself against its box. */
export interface SurfaceAnchorBox {
  /** The anchor's captured CSS size — physical, and stable under resize. */
  readonly cssWidth: number
  readonly cssHeight: number
  /**
   * Where the box sits in the painted texture. Its spans, `uMax - uMin` and
   * `vMax - vMin`, are the box's size on the default 1×1 plane; other
   * geometry converts them itself. A child that samples the live capture at
   * its own box — an emitter standing over an LED readout — reads the rect.
   */
  readonly uv: SourceUvRect
}

export const SurfaceAnchorBoxContext = createContext<SurfaceAnchorBox | null>(null)

/**
 * The box this anchor stands on. `cssWidth`/`cssHeight` are the captured CSS
 * dimensions — physical, so a control keeps its real size when the panel it
 * is on resizes — and `uv` is the box in the painted texture, whose spans
 * size geometry built on the default 1×1 plane.
 */
export function useSurfaceAnchorBox(): SurfaceAnchorBox | null {
  return use(SurfaceAnchorBoxContext)
}

export function SurfaceAnchor({ name, offset = 0, children }: SurfaceAnchorProps) {
  const scope = useSurfaceAnchorContext('Surface.Anchor')
  useSurfacePart('Surface.Anchor')
  useEffect(() => scope.require(name), [scope, name])

  const [box, setBox] = useState(() => scope.box(name))
  useEffect(() => {
    const read = () => {
      const next = scope.box(name)
      setBox(current => sameRect(current, next) ? current : next)
    }
    read()
    return scope.subscribe(read)
  }, [scope, name])

  const placed = useMemo(() => {
    if (!box) return null
    return { u: (box.uMin + box.uMax) / 2, v: (box.vMin + box.vMax) / 2 }
  }, [box])

  if (!box || !placed) return null
  return (
    <SceneAnchorGroup
      u={placed.u}
      v={placed.v}
      offset={offset}
      rect={box}
    >
      {children}
    </SceneAnchorGroup>
  )
}

/**
 * Every listed anchor at once, or null while any of them is missing.
 *
 * The same transaction `<Surface.Anchor>` reads, for the consumer that
 * cannot be one group per box: a single geometry cut around several boxes,
 * or a page-side scroller that has to know where a control landed. Null is
 * "the set is not complete for the pixels on this mesh", not "no anchors".
 */
export function useSurfaceAnchorRects(
  names: readonly string[],
): Readonly<Record<string, SourceUvRect>> | null {
  const scope = useSurfaceAnchorContext('useSurfaceAnchorRects')
  // Keyed by content, not identity: a caller building the list inline hands
  // a new array every render, and requiring on identity would drop and
  // re-declare every key in the set on each one — which invalidates the
  // committed transaction and withholds the objects placed from it.
  const key = names.join('\u0000')
  const keys = useMemo(() => (key === '' ? [] : key.split('\u0000')), [key])

  useEffect(() => {
    const releases = keys.map((name) => scope.require(name))
    return () => {
      for (const release of releases) release()
    }
  }, [scope, keys])

  const [rects, setRects] = useState<Readonly<Record<string, SourceUvRect>> | null>(null)
  useEffect(() => {
    const read = () => {
      const next: Record<string, SourceUvRect> = {}
      for (const name of keys) {
        const box = scope.box(name)
        if (!box) {
          setRects(null)
          return
        }
        next[name] = box
      }
      setRects((current) => (sameRects(current, next) ? current : next))
    }
    read()
    return scope.subscribe(read)
  }, [scope, keys])
  return rects
}

/** Value equality, so a re-collected but unmoved set costs no render. */
function sameRects(
  a: Readonly<Record<string, SourceUvRect>> | null,
  b: Readonly<Record<string, SourceUvRect>>,
): boolean {
  if (!a) return false
  const keys = Object.keys(b)
  if (Object.keys(a).length !== keys.length) return false
  for (const key of keys) {
    const left = a[key]
    const right = b[key]
    if (!left || !right) return false
    if (!sameRect(left, right)) return false
  }
  return true
}

function sameRect(a: SourceUvRect | null, b: SourceUvRect | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.uMin === b.uMin && a.uMax === b.uMax &&
    a.vMin === b.vMin && a.vMax === b.vMax &&
    a.cssWidth === b.cssWidth && a.cssHeight === b.cssHeight
}
