// Surface body color — `--munari-body`, the finish's color on the page copy
// and `transparent` in the capture.
//
// The law: a finish with a color paints the body in the scene, so content
// that styles its background with `var(--munari-body, …)` shows the color on
// the page and the lit body in the scene. The page element holds the color.
// The capture root holds `transparent`, except while the page still holds
// and the capture root stands in the page copy's place, as it does for a
// focused field ahead of a crossing: then it is on screen as the page and
// holds the color, and the crossing switches it and owes a paint. Measured
// on m2 (2026-11-26, native path): with `transparent` there, a lift with a
// focused field showed the page behind the card for 4 frames.
//
// Ownership: Surface.HTML calls the hook and says when the capture root is
// shown as the page; the finish is the Root's (surfaceFinish.ts), and the
// source runtime repaints the capture.

import { use, useCallback, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { SurfaceFinishContext } from './surfaceFinish'
import type { SurfaceSourceRuntime } from './surfaceSourceRuntime'

export type CustomProperties = { [property: `--${string}`]: string | number | undefined }
type PageStyle = Omit<CSSProperties, 'visibility' | 'pointerEvents' | 'display'> & CustomProperties

function writeCaptureBody(captureRoot: HTMLElement, bodyColor: string | null, shownAsPage: boolean, runtime: SurfaceSourceRuntime | null): void {
  const next = bodyColor === null ? '' : shownAsPage ? bodyColor : 'transparent'
  if (captureRoot.style.getPropertyValue('--munari-body') === next) return
  if (next === '') captureRoot.style.removeProperty('--munari-body')
  else captureRoot.style.setProperty('--munari-body', next)
  runtime?.source.repaint()
}

export interface BodyColor {
  /** The page element's style, with the finish's color. It renders on the server. */
  readonly style: PageStyle | undefined
  /** Say whether the capture root stands in the page copy's place. */
  readonly asPage: (shown: boolean) => void
}

/**
 * The content inherits `--munari-body` from whichever element holds it, so
 * the value follows the live node through every handoff.
 */
export function useBodyColor(pageStyle: PageStyle | undefined, captureRoot: HTMLElement | null, runtime: SurfaceSourceRuntime | null): BodyColor {
  const bodyColor = use(SurfaceFinishContext)?.color ?? null
  const shownAsPage = useRef(false)
  useLayoutEffect(() => {
    if (captureRoot) writeCaptureBody(captureRoot, bodyColor, shownAsPage.current, runtime)
  }, [captureRoot, bodyColor, runtime])
  const asPage = useCallback(
    (shown: boolean) => {
      shownAsPage.current = shown
      if (captureRoot) writeCaptureBody(captureRoot, bodyColor, shown, runtime)
    },
    [captureRoot, bodyColor, runtime],
  )
  const style = useMemo(() => (bodyColor === null ? pageStyle : { ...pageStyle, '--munari-body': bodyColor }), [pageStyle, bodyColor])
  return { style, asPage }
}
