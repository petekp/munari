// <Surface.Part> — one source of a Surface that has several.
//
// The law: a multi-part Surface transfers ALL of its parts or none. Every
// part registers a presenter into one readiness ledger, so the page is
// released only once every part has proven a drawn frame, and a part whose
// source has not painted holds the whole handoff.
//
// The fault, 2026-08-16: the Logo's letters were seven Surfaces. Each one
// crossed as soon as its own pixels were ready, so the word came apart —
// four letters in WebGL and three still on the page, for as long as the
// slowest raster took. One Surface with seven parts cannot do that, and
// that is the only reason parts exist rather than a list of Surfaces.
//
// Ownership: this component owns one part's declaration and its source
// host. It owns no readiness — the root's ledger does — and no presenter.

import { useEffect } from 'react'
import type { SurfaceChrome, SurfacePartId } from '@munari/core'
import { useSurfaceRoot } from './surfaceContext'
import { SurfaceSourceHost } from './surfaceSourceHost'
import type { SurfaceResolution, SurfaceSize } from './surfaceSourceRuntime'

export interface SurfacePartProps {
  /** This part's id, unique within the Surface. */
  name: SurfacePartId
  /** React content to render into a Munari-owned container. */
  source?: React.ReactNode
  /** A detached element Munari takes ownership of instead. */
  adopt?: HTMLElement
  /** Authored source size. Without one the DOM presentation measures it. */
  size?: SurfaceSize
  resolution?: SurfaceResolution
  mirrorU?: boolean
  paint?: 'auto' | 'always'
  onFocusWithinChange?: (focused: boolean) => void
  onChrome?: (chrome: SurfaceChrome) => void
  chromeElement?: () => HTMLElement
  pageContent?: () => HTMLElement | null
  children?: React.ReactNode
}

/** Live declarations per Surface, for the duplicate-name diagnostic. */
const declared = new WeakMap<object, Map<SurfacePartId, number>>()

export function SurfacePart({ name, children, ...rest }: SurfacePartProps) {
  const root = useSurfaceRoot('Surface.Part')

  // A duplicate name is silent otherwise: the second declaration replaces
  // the first's publication, so one part's content simply stops appearing
  // and the readiness ledger still counts both presenters — a handoff that
  // waits forever on a source nobody can see.
  //
  // Checked in a microtask, not inline: Strict Mode and any ordinary
  // remount run the new registration before the old cleanup, so a live
  // count of two is the normal state for one part for part of a commit.
  const store = root.store
  useEffect(() => {
    let map = declared.get(store)
    if (!map) {
      map = new Map()
      declared.set(store, map)
    }
    const live = map
    live.set(name, (live.get(name) ?? 0) + 1)
    queueMicrotask(() => {
      if ((live.get(name) ?? 0) > 1) {
        store.reportError(
          new Error(
            `Surface${store.name ? ` "${store.name}"` : ''} has two parts named ` +
              `"${String(name)}". Part names address a source — give each one its own.`,
          ),
        )
      }
    })
    return () => {
      const remaining = (live.get(name) ?? 1) - 1
      if (remaining <= 0) live.delete(name)
      else live.set(name, remaining)
    }
  }, [store, name])

  return (
    <SurfaceSourceHost root={root} id={name} {...rest}>
      {children}
    </SurfaceSourceHost>
  )
}
