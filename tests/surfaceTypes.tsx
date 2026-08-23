// Compile-only public API checks. Root TypeScript includes this file; Vitest
// does not need to run it because the expected failures are the contract.
import type { ComponentProps } from 'react'
import {
  createSurface,
  Surface,
  useSurface,
  type SurfaceContentProps,
  type SurfaceDOMProps,
  type SurfaceProps,
  type SurfaceHandle,
} from '@petepetrash/munari'
import {
  FrameSurface,
  type FrameSource,
  type PresentationRequirement,
} from '@petepetrash/munari/advanced'

declare const frame: FrameSource
declare const presentation: PresentationRequirement
declare const handle: SurfaceHandle
declare const detached: HTMLElement
const geometry = <planeGeometry args={[1, 1]} />

;<Surface
  name="check"
  source={<div />}
  view="webgl"
  timing={{ settleMs: 300 }}
  size={[10, 10]}
  onReady={() => {}}
  onChrome={(chrome) => void chrome.radii}
  onPresentedViewChange={(view) => void view}
>
  <Surface.DOM className="page" />
  <Surface.WebGL placement="match-dom" pointerEvents="content">
    {geometry}
  </Surface.WebGL>
</Surface>
;<Surface surface={handle} adopt={detached} canvas="lab" paint="always" />
;<Surface source={<div />}>
  <Surface.Part name="film" source={<div />} />
  <Surface.Anchor name="dock" offset={0.01} />
</Surface>
;<FrameSurface
  frame={frame}
  width={10}
  height={10}
  onFrameDrawn={(receipt) => void receipt.frame.generation}
  presentation={presentation}
  onPresented={(receipt) => void receipt.presentationRevision}
>
  {geometry}
</FrameSurface>

// @ts-expect-error A Surface has one pixel source, never DOM and frames together.
;<Surface source={<div />} frame={frame} />
// @ts-expect-error The removed lift API is not a Surface prop.
;<Surface source={<div />} onFirstPresented={() => {}} />
// @ts-expect-error Markup is captured through `source`/`adopt`, never a string.
;<Surface html="<b>x</b>" />
// @ts-expect-error A presentation lives on `<Surface.WebGL>`, not the root.
;<Surface source={<div />} material="none" />
// @ts-expect-error FrameSurface owns the renderer fence callbacks.
;<FrameSurface frame={frame} onBeforeRender={() => {}}>{geometry}</FrameSurface>

// ── the prop unions ──────────────────────────────────────────────
// A Surface has ONE content declaration and ONE identity. Both were flat
// optionals until 2026-08-17, so `source` and `adopt` together compiled —
// two answers to "what is the page copy" and no rule picking between them.

// @ts-expect-error `source` renders a copy and `adopt` moves the element: never both.
;<Surface source={<div />} adopt={detached} />
// @ts-expect-error Content options describe a source, so they need one.
;<Surface size={[10, 10]} />
// @ts-expect-error Same, through `adopt`'s absence rather than `source`'s.
;<Surface resolution={2} />
// @ts-expect-error An identity is the handle or the name, not both.
;<Surface surface={handle} name="check" source={<div />} />

// Positives, one per branch of each union.
;<Surface source={<div />} size={[10, 10]} mirrorU />
;<Surface adopt={detached} paint="always" />
;<Surface name="empty" view="webgl" />
;<Surface surface={handle} source={<div />} />

// ── identity-only creation ───────────────────────────────────────
// View, timing and callbacks are `<Surface>`'s. A handle that also took
// them let one Surface be driven from two declarations.
void createSurface()
void createSurface('check')
// A bare name is the whole signature, so there is no field to smuggle a
// view, a timing or a callback through. These were `@ts-expect-error`s on
// an options object; the string makes them arity and type errors instead.
// @ts-expect-error `createSurface` takes the name itself, not an options bag.
void createSurface({ name: 'check' })
// @ts-expect-error The view belongs to the root that presents the handle.
void createSurface('check', { view: 'webgl' })
// @ts-expect-error Timing likewise.
void createSurface('check', { timing: { settleMs: 0 } })
// @ts-expect-error And the callbacks with it.
void createSurface('check', { onReady: () => {} })

function IdentityOnly() {
  const own: SurfaceHandle = useSurface('check')
  // @ts-expect-error `useSurface` takes the same bare name.
  useSurface({ name: 'check', onPresentedViewChange: () => {} })
  return <Surface surface={own} source={<div />} />
}
void IdentityOnly

// A content declaration can be built ahead of the element and spread in,
// which is what a scene swapping `source` for `adopt` does.
declare const spread: SurfaceContentProps
;<Surface name="spread" {...spread} />

const root: SurfaceProps = { source: <div /> }
const inferred: ComponentProps<typeof Surface> = root
const page: SurfaceDOMProps = { className: 'page' }
void inferred
void page
