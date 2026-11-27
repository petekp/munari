// Surface body color — `--munari-body`, the finish's color on the page copy
// and `transparent` in the capture.
//
// The law: a finish with a color paints the body in the scene, so content
// that styles its background with `var(--munari-body, …)` shows the color on
// the page and the lit body in the scene. The capture root holds
// `transparent` and the page element holds the color, so the content
// inherits the right one from whichever element holds the live node.
//
// Ownership: Surface.HTML calls the hook; the finish is the Root's
// (surfaceFinish.ts), and the source runtime repaints the capture.

import { use, useLayoutEffect, useMemo, type CSSProperties } from 'react'
import { SurfaceFinishContext } from './surfaceFinish'
import type { SurfaceSourceRuntime } from './surfaceSourceRuntime'

export type CustomProperties = { [property: `--${string}`]: string | number | undefined }
type PageStyle = Omit<CSSProperties, 'visibility' | 'pointerEvents' | 'display'> & CustomProperties

/**
 * A finish with a color paints the body in the scene, so the capture's body
 * is transparent and the page copy's is the color. The content inherits
 * `--munari-body` from whichever element holds it, so the value follows the
 * live node through every handoff. The page element's value renders on the
 * server. Returns the page element's style.
 */
export function useBodyColor(pageStyle: PageStyle | undefined, captureRoot: HTMLElement | null, runtime: SurfaceSourceRuntime | null) {
  const bodyColor = use(SurfaceFinishContext)?.color ?? null
  const paintsBody = bodyColor !== null
  useLayoutEffect(() => {
    if (!captureRoot) return
    const held = captureRoot.style.getPropertyValue('--munari-body') !== ''
    if (held === paintsBody) return
    if (paintsBody) captureRoot.style.setProperty('--munari-body', 'transparent')
    else captureRoot.style.removeProperty('--munari-body')
    runtime?.source.repaint()
  }, [captureRoot, paintsBody, runtime])
  return useMemo(() => (bodyColor === null ? pageStyle : { ...pageStyle, '--munari-body': bodyColor }), [pageStyle, bodyColor])
}
