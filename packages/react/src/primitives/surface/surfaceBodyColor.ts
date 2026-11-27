// Surface body color — `--munari-body`, the finish's color on the page copy
// and `transparent` in the capture, with the finish's page look beside it.
//
// The law: a finish with a color paints the body in the scene, so content
// that styles its background with `var(--munari-body, …)` shows the color on
// the page and the lit body in the scene. The page element holds the color.
// A finish's `pageLook` stands in for its lighting on the page while the
// scene prepares, as `--munari-body-image` and `--munari-body-shadow`; the
// capture holds `none` for both, so the lit scene is the same with or
// without one.
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
import { SurfaceFinishContext, type FinishValues } from './surfaceFinish'
import type { SurfaceSourceRuntime } from './surfaceSourceRuntime'

export type CustomProperties = { [property: `--${string}`]: string | number | undefined }
type PageStyle = Omit<CSSProperties, 'visibility' | 'pointerEvents' | 'display'> & CustomProperties

interface BodyProperties {
  readonly '--munari-body': string
  readonly '--munari-body-image': string
  readonly '--munari-body-shadow': string
}

interface Body {
  readonly color: string | null
  readonly look: FinishValues['pageLook']
}

/** The body's custom properties on the page, or in the capture; '' leaves one unset. */
function bodyProperties({ color, look }: Body, onPage: boolean): BodyProperties {
  if (color === null) return { '--munari-body': '', '--munari-body-image': '', '--munari-body-shadow': '' }
  if (!onPage) return { '--munari-body': 'transparent', '--munari-body-image': look ? 'none' : '', '--munari-body-shadow': look ? 'none' : '' }
  return { '--munari-body': color, '--munari-body-image': look?.image ?? '', '--munari-body-shadow': look?.shadow ?? '' }
}

function writeCaptureBody(captureRoot: HTMLElement, body: Body, shownAsPage: boolean, runtime: SurfaceSourceRuntime | null): void {
  let changed = false
  for (const [property, next] of Object.entries(bodyProperties(body, shownAsPage))) {
    if (captureRoot.style.getPropertyValue(property) === next) continue
    changed = true
    if (next === '') captureRoot.style.removeProperty(property)
    else captureRoot.style.setProperty(property, next)
  }
  if (changed) runtime?.source.repaint()
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
  const finish = use(SurfaceFinishContext)
  const color = finish?.color ?? null
  const look = finish?.pageLook ?? null
  const body = useMemo<Body>(() => ({ color, look }), [color, look])
  const shownAsPage = useRef(false)
  useLayoutEffect(() => {
    if (captureRoot) writeCaptureBody(captureRoot, body, shownAsPage.current, runtime)
  }, [captureRoot, body, runtime])
  const asPage = useCallback(
    (shown: boolean) => {
      shownAsPage.current = shown
      if (captureRoot) writeCaptureBody(captureRoot, body, shown, runtime)
    },
    [captureRoot, body, runtime],
  )
  const style = useMemo(() => {
    if (body.color === null) return pageStyle
    const onPage = Object.fromEntries(Object.entries(bodyProperties(body, true)).filter(([, value]) => value !== ''))
    return { ...pageStyle, ...onPage }
  }, [pageStyle, body])
  return { style, asPage }
}
