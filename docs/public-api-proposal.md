# Public API proposal (historical)

> **HISTORICAL DESIGN RECORD.** The Revision 3 cutover landed on 2026-08-18,
> but this proposal contains intermediate signatures, rejected choices and
> acceptance targets. It is not an API reference or an active implementation
> plan. Do not copy its code as current usage. Start with the
> [consumer guide](../README.md), [operating guide](agent-workflow.md), and
> [current exported types](../packages/react/src/index.ts).

## Current-contract corrections (2026-08-31)

The body below remains design history. In the current implementation:

- `useSurface(name?)` and `createSurface(name?)` create identity only.
  `Surface` owns `view`, `timing` and callbacks, including with explicit handles.
- React content enters through `source`; an existing element enters through
  `adopt`. The root does not have the proposed `capture` prop.
- `Surface.Part` and `Surface.Anchor` use `name`, not the historical `id` prop.
- `useLift`, `LiftDriver` and `commitRendererReleaseFrame` are retired.
  Use the current view helper and controlled declaration.
- `onReady` can follow a write-free eligible draw. Readiness does not by
  itself prove presentation. A source-only Surface can remain unready by design.
- The proposed `SurfaceDiagnostic` below is not shipped. Current `paintStats()`
  supplies source labels and paint counters, not a joined Surface graph.

The [system model](system-model.md) explains these distinctions. New
agent-facing work lives only in [the current delivery plan](agent-system-plan.md).

## Original Revision 3 proposal

Munari should center one noun: a **Surface** is DOM content with one or more
presentations. It may reside in WebGL, appear in DOM and WebGL together, or
hand presentation between them.

The API uses one set of components in three wiring styles:

1. DOM-side compound for page elements and aligned WebGL effects.
2. Canvas-side compound for resident scene matter.
3. Separated wiring for content whose DOM and WebGL presentations belong in
   different trees.

Separated wiring is the substrate. Each compound form creates the same handle
and moves one presentation through a registered host.

## Model

| Term | Meaning |
|---|---|
| Surface | One logical piece of DOM content, or a group of related parts. |
| Source | The live DOM subtree that supplies layout, pixels, state, focus, and input. |
| DOM presentation | The source as normal page content. |
| WebGL presentation | The source texture and its scene objects. |
| Resident Surface | A source with a WebGL presentation and no page presentation. |
| Twin Surface | DOM and WebGL presentations shown together without a handoff. |
| Renderer hold | The renderer whose pixels Munari presents for an exclusive Surface. |
| Handoff | The guarded change from one renderer hold to the other. |
| Progress | Effect motion from DOM identity at `0` to the WebGL state at `1`. |
| Part | One named source and presenter set inside an atomic multi-part Surface. |
| Surface Canvas | A shared R3F renderer and DOM source host. |

```text
Surface
├── live DOM source
├── optional DOM presentation
├── one or more WebGL presentations
├── optional handoff policy
└── optional focus and control membership

SurfaceCanvas
├── shared renderer
├── shared source host
├── many resident Surfaces
└── many independent handoff handles
```

## Three wiring styles

### DOM-side compound

Use this form for a page element whose WebGL presentation matches its page
box. The DOM presentation stays in the React DOM tree. The WebGL presentation
registers with a `SurfaceCanvas` and uses `match-dom` placement.

```tsx
<Surface source={<Button />} view={view}>
  <Surface.DOM />
  <Surface.WebGL material={<GoldMaterial />} />
</Surface>
```

The root creates its handle. `Surface.WebGL` registers with the only Canvas
host, or with the host named by the root's `canvas` prop. The tunneled WebGL
form supports `placement="match-dom"` only. Manual scene placement produces a
development error with a link to the Canvas-side or separated form.

### Canvas-side compound

Use this form for resident scene matter. The WebGL presentation renders at its
native JSX position. The source registers outward with the DOM-side host.

```tsx
<group rotation={rigRotation}>
  <Surface source={<Panel />} size={[640, 480]}>
    <Surface.WebGL />
  </Surface>
</group>
```

This form is resident-only. `view` and `Surface.DOM` produce development errors
because the R3F tree has no page slot. Authored `size` remains available when
no page presentation can supply it.

### Separated wiring

Use this form when the page and scene have independent structure. A handle
connects the declarations without tunneling either presentation.

```tsx
const card = useSurface('card')

<Surface
  surface={card}
  view={view}
  source={<Card onGrab={startDrag} />}
  capture={<Card />}
>
  <Surface.DOM />
</Surface>

<SurfaceCanvas>
  <FlightRig>
    <Surface.WebGL surface={card} />
  </FlightRig>
</SurfaceCanvas>
```

The handle carries source registration, renderer hold, progress, evidence, and
cleanup between the trees. `Surface.WebGL` remains ordinary scene-graph matter
under user-owned groups, physics, focus, and render order.

## Presentation inference

| Declared presentations | `view` | Result |
|---|---|---|
| WebGL only | absent | Resident Surface |
| DOM and WebGL | absent | Twin Surface |
| DOM and WebGL | present | Exclusive handoff |
| DOM only | absent | Page presentation or separated source waiting for WebGL |

Munari reports invalid composition in development:

- `view` without both presentation types;
- `Surface.DOM` inside a Canvas-side compound;
- manual placement on an inward-tunneled WebGL presentation;
- duplicate DOM presentations or part IDs;
- missing WebGL parts during an attempted handoff;
- an unclaimed separated source after the registration window;
- several Canvas hosts without an explicit association.

## Normal package entry

```ts
import {
  Surface,
  SurfaceCanvas,
  useSurface,
  useSurfaceTexture,
  useSurfaceProgress,
  useSurfaceInstance,
  supportsDOMSurfaces,
  useSupportsDOMSurfaces,
  FocusScene,
  FocusGroup,
  Dial,
} from '@petepetrash/munari'

import '@petepetrash/munari/style.css'
```

The supported focus hooks and public types remain available. `FocusOrbitRig`
and `arcLayout` remain candidates for registry recipes because they express
camera and layout policy.

## `Surface`

`Surface` declares the source, creates or binds identity, and provides context
to its compound parts.

```ts
export type SurfaceView = 'dom' | 'webgl'
export type SurfacePartId = string | number
export type SurfaceCanvasId = string
export type SurfaceSize = readonly [width: number, height: number]

export interface SurfaceTiming {
  /** Time for the caller's DOM-side motion to stop. Default: 450. */
  settleMs?: number

  /** Time for the built-in progress driver to move between 0 and 1. Default: 600. */
  durationMs?: number
}

type ReactSurfaceSource = {
  source: React.ReactElement
  adopt?: never
  capture?: React.ReactElement
}

type AdoptedSurfaceSource = {
  adopt: HTMLElement
  source?: never
  capture?: never
  size: SurfaceSize
}

type MultiPartSurfaceSource = {
  /** Source content belongs to child Surface.Part declarations. */
  source?: never
  adopt?: never
  capture?: never
}

type AutomaticSurfaceIdentity = {
  surface?: never
  view?: SurfaceView
  timing?: SurfaceTiming
  onPresentedViewChange?: (view: SurfaceView) => void
  onMotionComplete?: (view: SurfaceView) => void
}

type ExplicitSurfaceIdentity = {
  surface: SurfaceHandle
  view?: never
  timing?: never
  onPresentedViewChange?: never
  onMotionComplete?: never
}

export type SurfaceProps =
  (ReactSurfaceSource | AdoptedSurfaceSource | MultiPartSurfaceSource) &
  (AutomaticSurfaceIdentity | ExplicitSurfaceIdentity) & {
    size?: SurfaceSize
    canvas?: SurfaceCanvasId
    name?: string
    /** Capture uploads follow compositor paints, or run every frame. */
    paint?: 'auto' | 'always'
    children?: React.ReactNode
    /** Fires after all WebGL presenters complete their first eligible draw. */
    onReady?: () => void
    onFocusWithinChange?: (focused: boolean) => void
    onError?: (error: Error) => void
  }

export function Surface(props: SurfaceProps): React.ReactElement | null
```

`source` accepts React content. `adopt` states that Munari takes ownership of
a detached element. Munari rejects an adopted element that still has a parent.
A source-free root must contain at least one `Surface.Part`; Munari reports an
empty root in development.

The capture host uses `data-munari-source-host`, starts transparent, and takes
its final size from Munari alone. It never exists without its content and never
captures the real pointer.

`paint="auto"` requests uploads from the compositor's paint signal and preserves
idle-zero behavior. `paint="always"` requests an upload every renderer frame for
sources such as embedded media that change without a usable paint signal. The
second form spends continuous paint and upload budget.

## `Surface.DOM`

`Surface.DOM` presents the root's source as page content.

```ts
export interface SurfaceDOMProps {
  ref?: React.Ref<HTMLElement>
}

export function SurfaceDOM(
  props: SurfaceDOMProps,
): React.ReactElement
```

The source owns element type, event handlers, classes, IDs, and ARIA.
`Surface.DOM` owns presentation visibility, accessibility, measurement, focus
movement, and the page layout placeholder.

### Capture instances

A portal-copy capture creates two component instances. Local state,
uncontrolled form values, effects, and literal IDs can diverge or duplicate.
State that must cross a handoff belongs above `Surface`. Authors use `useId()`
or another scoped ID source. Source components can inspect their role:

```ts
export type SurfaceInstance = 'page' | 'source'
export function useSurfaceInstance(): SurfaceInstance
```

Munari also stamps the instance root:

```html
data-munari-instance="page"
data-munari-instance="source"
```

A source can use this signal to suppress analytics, autofocus, or subscriptions
in its captured copy. Divergent `capture` trees need a stable focus-key contract
or forfeit automatic focus movement.

Munari exposes one accessible instance at a time:

| Presentation state | Accessible instance |
|---|---|
| Resident WebGL | Captured DOM source |
| Twin | Visible page DOM |
| DOM hold | Visible page DOM |
| WebGL hold | Captured DOM source |
| Warming | Current holder only |

Munari switches `inert` and `aria-hidden` between instances while preserving the
active focus path. Browser and assistive-technology probes must verify the exact
tree behavior before this contract freezes.

A successful `moveBefore()` probe may remove duplicate instances for
non-divergent exclusive Surfaces without changing the API. Twin Surfaces still
need two presentations, so the instance-role and accessibility rules remain.

## `Surface.WebGL`

Outside a Canvas, `Surface.WebGL` registers with a host. Inside a Canvas, it
renders at its native scene-graph position.

```ts
export type SurfaceResolution =
  | 'auto'
  | 'max'
  | number
  | readonly [min: number, max: number]

export type SurfaceRadius =
  | 'auto'
  | number
  | readonly [number, number, number, number]

export interface SurfaceWebGLProps
  extends Omit<
    ThreeElements['mesh'],
    | 'children'
    | 'geometry'
    | 'material'
    | 'visible'
    | 'raycast'
    | 'ref'
    | 'onBeforeRender'
    | 'onAfterRender'
  > {
  surface?: SurfaceHandle
  part?: SurfacePartId
  placement?: 'match-dom' | 'manual'
  geometry?: React.ReactElement
  material?: React.ReactElement
  children?: React.ReactNode
  resolution?: SurfaceResolution
  radius?: SurfaceRadius
  alpha?: 'opaque' | 'source'
  pointerEvents?: 'geometry' | 'content' | 'none'
  mirrorU?: boolean
  ref?: React.Ref<THREE.Mesh>
}

export function SurfaceWebGL(
  props: SurfaceWebGLProps,
): React.ReactElement | null
```

The defaults are a unit plane, a color-preserving unlit material, source
radius, opaque presentation, and geometry pointer events. Placement defaults
to DOM matching when tunneled inward and manual when declared in Canvas.

`size` describes source CSS pixels. Under `placement="manual"`, the default
plane remains one world unit square; callers set geometry or scale. Under
`placement="match-dom"`, Munari computes the world transform that matches the
DOM box.

Passing a material element replaces the built-in material. Munari must supply
stable texture binding, a premultiplied blend preset, and a non-null texture
story so custom materials do not repeat the current UUID-key and blend ritual.

Refs merge. Munari's relay handlers and caller handlers run in a defined order.
`pointerEvents` controls DOM routing. Handler shadowing does not decide input
behavior.

`Surface.WebGL` registers as a composite inside `FocusGroup`. `Dial` registers
as a leaf in the same focus tree.

Pointer modes carry these semantics:

| Value | Behavior |
|---|---|
| `geometry` | The mesh bounds accept ray hits. |
| `content` | Rays hit only where the captured DOM accepts pointer input; clear regions pass through. |
| `none` | The Surface does not participate in raycasting. |

Children of a tunneled `Surface.WebGL` travel with its R3F subtree. They can use
providers above `SurfaceCanvas`; they cannot assume access to providers mounted
inside a different Canvas branch unless the context-bridge prototype proves it.

### Lit material

The unlit material remains the default. Munari also supplies one first-party
lit material for DOM matter placed in a lit scene:

```ts
export interface SurfaceLitMaterialProps {
  roughness?: number
  metalness?: number
  emissiveIntensity?: number
  side?: THREE.Side
  alpha?: 'opaque' | 'source'
}

export function SurfaceLitMaterial(
  props: SurfaceLitMaterialProps,
): React.ReactElement
```

```tsx
<Surface.WebGL
  material={
    <Surface.LitMaterial
      roughness={0.4}
      metalness={0.2}
      emissiveIntensity={0.8}
    />
  }
/>
```

The component binds the Surface texture and applies Munari's premultiplied
alpha contract. Custom materials remain available for other shading models.

## `Surface.Part`

`Surface.Part` declares one source and presenter set inside an atomic handoff.

```ts
export interface SurfacePartProps {
  id: SurfacePartId
  source: React.ReactElement
  capture?: React.ReactElement
  size?: SurfaceSize
  paint?: 'auto' | 'always'
  children: React.ReactNode
}
```

Each part needs one matching WebGL presenter before DOM can release. Several
WebGL presentations may use one part. Duplicate IDs are errors, missing parts
keep DOM visible, and reorderable parts use stable application IDs. The handle
transfers all parts together.

## `Surface.Anchor`

Knobs and Genie prove the anchor contract. The function remains the low-level
primitive. A compound child removes receipt plumbing from scene code.

```ts
export interface SurfaceAnchorProps {
  id: string
  children: React.ReactNode
}
```

`Surface.Anchor` reads the latest completed paint, matches the texture
generation currently drawn, and withholds its child until a complete matching
anchor set exists. It uses normalized, unmirrored source coordinates and
rejects duplicate or incomplete sets as one transaction.

An anchor inherits the nearest `Surface.WebGL` part. Its `id` stays a string
because it maps to the DOM `data-munari-anchor` attribute. `Surface.Anchor`
must appear inside one `Surface.WebGL` presentation.

The advanced entry keeps `collectSurfaceAnchors()` and receipt types for custom
attachment systems.

## `useSurface`

`useSurface` creates explicit identity for separated wiring.

```ts
export interface UseSurfaceOptions {
  name?: string
  view?: SurfaceView
  timing?: SurfaceTiming
  onPresentedViewChange?: (view: SurfaceView) => void
  onMotionComplete?: (view: SurfaceView) => void
  onError?: (error: Error) => void
}

export interface SurfaceProgress {
  get(): number
  between(start: number, end: number): number
  pulse(start: number, end: number): number
}

export interface SurfaceHandle {
  readonly progress: SurfaceProgress
}

export function useSurface(options?: UseSurfaceOptions): SurfaceHandle
```

Changing `view` during a handoff reverses it without skipping evidence or
identity rules.

Option semantics are explicit:

| Option | Update rule |
|---|---|
| `name` | Read at handle creation. |
| `view` | Controlled on each render. |
| `timing` | Controlled on each render; active motion reads the current values. |
| callbacks | The latest callback runs without resetting the handle. |
| returned handle | Stable for the component lifetime. |

Automatic compound props follow the same controlled and latest-callback rules.

`createSurface()` remains an open question. No current scene requires a factory
outside React once Canvas-side compounds exist. A factory must prove disposal,
controlled option updates, Strict Mode, and data-store ownership first.

## `SurfaceCanvas`

`SurfaceCanvas` wraps R3F Canvas, hosts DOM sources, and coordinates registered
Surfaces.

```ts
export type SurfaceCanvasStyle = Omit<
  React.CSSProperties,
  'opacity' | 'visibility' | 'pointerEvents'
>

export interface SurfaceCanvasProps
  extends Omit<CanvasProps, 'children' | 'fallback' | 'style'> {
  id?: SurfaceCanvasId
  children?: React.ReactNode
  style?: SurfaceCanvasStyle
  /** Canvas-level fallback for renderer creation or loss. */
  fallback?: React.ReactNode
}
```

`SurfaceCanvas` remains an open superset of R3F Canvas. It accepts arbitrary
scene children, caller-owned camera and renderer options, controls, lights,
physics, and post-processing.

It owns renderer scheduling, the DOM source host, both registration directions,
context-loss fallback, demand invalidation, shared pointer integration,
per-Surface evidence, and safe cleanup. One host needs no ID. A DOM-side
compound names its host when several canvases exist.

On `webglcontextlost`, the host hides invalid pixels, returns affected handoffs
to DOM, clears stale evidence, and reports the failure.

The caller's `frameloop` value describes idle behavior. Munari may promote the
renderer while a source paints, a Surface warms, motion runs, or a presenter
releases. It restores the caller's mode when that work ends. Munari reserves
Canvas visibility, pointer gating, context-loss handling, and active scheduling.

Canvas-side source content can read providers above `SurfaceCanvas`. It cannot
assume access to providers mounted inside the R3F scene. The outward-source
prototype must either bridge selected contexts or document this boundary with a
development diagnostic.

## Shared-Canvas warm-up law

Several handoffs may share one composited Canvas. Canvas opacity cannot hide
one warming Surface while other Surface pixels stay visible.

```text
mount source and WebGL group
  ↓
paint and upload source
  ↓
draw warming group with no color, depth, or stencil writes
  ↓
first eligible color-writing default-framebuffer draw
  ↓
transfer renderer hold inside the post-draw callback
  ↓
browser composites the frame
```

The write-free draw may warm texture and shader state. It disables color,
depth, and stencil writes so invisible matter cannot punch holes in visible
scene objects. It does not count as presentation evidence. The first eligible
color-writing draw proves the incoming presentation and causes Munari to
release the DOM presentation before browser composition.

Companion effects follow the same color-write gate. Translucent shadows and
layers need a browser gate because visible overlap changes their pixels.
Callbacks may trigger sound or scene state. They never perform visibility
changes required for correctness.

## Custom material hooks

```ts
export function useSurfaceTexture(): THREE.Texture
export function useSurfaceProgress(): SurfaceProgress
```

Munari mounts custom materials after a configured texture exists, so
`useSurfaceTexture()` does not return `null` in this context.

## Motion and renderer hold

An exclusive Surface has three independent facts:

```text
requested view      application intent
presented view      renderer that holds the pixels
effect progress     visual excursion from 0 to 1
```

The normal API supplies a timed driver. The advanced API can replace it while
keeping Munari's evidence and renderer hold law.

```ts
export interface SurfaceDriver {
  frame(context: {
    phase: 'page' | 'lifting' | 'gl' | 'landing'
    dtMs: number
  }): number
}

export function useSurfaceDriver(
  surface: SurfaceHandle,
  driver: SurfaceDriver,
): void

export interface SurfaceState {
  targetView: SurfaceView
  presentedView: SurfaceView
  ready: boolean
  isChanging: boolean
  isWebGLMounted: boolean
  supported: boolean
}

export function useSurfaceState(surface: SurfaceHandle): SurfaceState
```

Progress stays `0` through `page` and `lifting`. Landing cannot return the
renderer hold to DOM until the driver reports `0`.

Advanced observations remain distinct:

```ts
onPresentedViewChange?: (view: SurfaceView) => void
onMotionComplete?: (view: SurfaceView) => void
onWebGLReleased?: () => void
```

`onPresentedViewChange` and `onMotionComplete` belong to `useSurface` options
and automatic compound props. `onWebGLReleased` belongs to the advanced
lifecycle layer because it reports renderer teardown rather than presentation.

On entry, WebGL takes the hold before motion leaves zero. On return, motion
reaches zero before DOM takes the hold. Consumers cannot assume one event order
for both directions.

Flight should use a physics driver instead of a one-millisecond timer. Genie's
velocity catch-up stays in its driver. Munari keeps renderer release ordering.
`useLift` and `LiftDriver` remain public until both scenes migrate and pass
their gates. (Both are gone. The lab's replacement was folded back into the
package as `useSurfaceView` on 2026-08-23 — see the migration table.)

## Progressive fallback

**Shipped 2026-08-23.** Both helpers are live on the package root; the
consumer guide is the README's "When the trial is absent", and the agent
guidance is in `.agents/skills/munari/SKILL.md`. The rest of this section
is the design as built.

```ts
export function supportsDOMSurfaces(): boolean
export function useSupportsDOMSurfaces(): boolean
```

The synchronous function returns `false` during server rendering. Applications
must not branch on it during hydrated render. The hook returns `false` for the
server and first client render, then updates after mount.

The components keep DOM visible without either helper. Unsupported DOM-backed
WebGL presenters do not mount, `presentedView` remains `dom`, and failed WebGL
requests report an error. Capture and context-loss failures restore the DOM
hold.

Resident Surfaces have no page presenter to restore. Applications provide an
alternate scene or DOM experience at the scene boundary:

```tsx
function Workspace() {
  const supported = useSupportsDOMSurfaces()
  return supported ? <WorkspaceScene /> : <WorkspaceDOMFallback />
}
```

`SurfaceCanvas.fallback` covers renderer creation and context loss. The
scene-level support branch covers a browser that can render WebGL but cannot
capture DOM.

`Surface.onReady` reports resident readiness after every registered WebGL
presenter completes its first eligible color-writing draw. Multi-part Surfaces
become ready after all parts qualify. Source replacement starts a new readiness
lifetime.

## Focus and physical controls

`FocusScene`, `FocusGroup`, `Dial`, and supported focus hooks remain package
API. `Surface.WebGL` registers as a composite member. `Dial` registers as a
leaf with a real ARIA proxy. This supports Munari's original WebGL-controls-
driving-DOM use case.

Automatic composite registration is documented behavior. The context seam can
remain internal until a third-party WebGL control proves a public hook.

`Surface.onFocusWithinChange` reports focus entering or leaving the active DOM
instance. Advanced `onCaptureRoot` access replaces current `onSource` and
`onHost` callbacks for code that must inspect or instrument the parked source.

## Frame-backed presentation

Frame input keeps an advanced component because publish, upload, draw, and
presentation evidence are distinct events.

```ts
export interface FrameSurfaceProps {
  source: FrameSource
  size?: SurfaceSize
  geometry?: React.ReactElement
  material?: React.ReactElement
  children?: React.ReactNode
  pointerEvents?: 'geometry' | 'none'
  onFrameDrawn?: (receipt: FrameDrawReceipt) => void
  presentation?: PresentationRequirement
  onPresented?: (receipt: PresentationReceipt) => void
}
```

Genie's film composite keeps this source and evidence separate from its outer
DOM-captured window chrome.

## Advanced entry

```ts
import { /* lower-level tools */ } from '@petepetrash/munari/advanced'
```

| Area | Exports |
|---|---|
| Handoff and motion | `useSurfaceState`, `useSurfaceDriver`, `SurfaceDriver`, lifecycle events, temporary `useLift` and `LiftDriver` |
| Frame evidence | `FrameSurface`, `createCanvasFrameSource`, frame types, presentation types, `commitRendererReleaseFrame` |
| Capture and materials | `collectSurfaceAnchors`, anchor and paint receipts, chrome hooks and types, radius GLSL, capture callbacks |
| Provenance and mapping | `isRelayedEvent`, camera and plane mapping, `pixelGridSnap` |
| Diagnostics | `paintStats`, detailed capability detection, `UnsupportedPlatformError` |

Diagnostics expose structured identity:

```ts
interface SurfaceDiagnostic {
  surfaceName?: string
  part?: SurfacePartId
  paints: number
  errors: number
  scale: number
}
```

## Fleet guidance

Idle sources should cost zero paints after their content settles. Continuous
painting remains a per-source cost. An earlier target-machine probe sustained
roughly 64 to 96 concurrently painting sources, but that load harness has not
been migrated and the number needs remeasurement.

Authors should avoid a Surface per label or particle in large plots. Group
static content into fewer DOM sources, keep resident fleets idle, and reserve
`paint="always"` for sources that require frame-by-frame uploads.

## Compact lab sketches

The earlier exploration lives in `docs/compound-api-sketches.md`. It records
the alternatives and review trail. The corrected shapes below serve as the
acceptance targets.

### Gold Button

```tsx
<Surface
  source={<button onClick={() => setView('webgl')}>Make it gold</button>}
  view={view}
  onMotionComplete={(view) => {
    if (view === 'webgl') returnForFiveSecondsThen(setView, 'dom')
  }}
>
  <Surface.DOM />
  <Surface.WebGL material={<GoldMaterial />} />
</Surface>
```

### Workspace

```tsx
<SurfaceCanvas>
  <FocusScene>
    <OrbitControls />
    {panels.map((panel) => (
      <FocusGroup key={panel.id} id={panel.id}>
        <group position={panel.position}>
          <Surface
            source={<Panel panel={panel} />}
            size={[panel.width, panel.height]}
          >
            <Surface.WebGL />
          </Surface>
          {panel.dial && <Dial onDetent={panel.setValue} />}
        </group>
      </FocusGroup>
    ))}
  </FocusScene>
</SurfaceCanvas>
```

### Veil

```tsx
<Surface source={<VeilSheet />} canvas="veil">
  <Surface.DOM />
  <Surface.WebGL material={<VeilMaterial />} pointerEvents="none" />
</Surface>

<SurfaceCanvas id="veil" />
```

### Knobs

```tsx
<SurfaceCanvas>
  <FocusScene>
    <FocusGroup id="knobs">
      <Surface source={<KnobBoard />} size={[width, height]}>
        <Surface.WebGL>
          {controls.map((control) => (
            <Surface.Anchor key={control.id} id={control.anchor}>
              <Dial {...control} />
            </Surface.Anchor>
          ))}
        </Surface.WebGL>
      </Surface>
    </FocusGroup>
  </FocusScene>
</SurfaceCanvas>
```

### Logo

```tsx
const logo = useSurface('logo')

<Surface surface={logo} view={view} timing={{ settleMs: SETTLE_MS }}>
  {letters.map((letter) => (
    <Surface.Part
      key={letter.id}
      id={letter.id}
      source={<PageLetter letter={letter} />}
      capture={<TwinLetter letter={letter} />}
    >
      <Surface.DOM />
    </Surface.Part>
  ))}
</Surface>

<SurfaceCanvas>
  <group>
    {letters.map((letter) => (
      <Surface.WebGL
        key={letter.id}
        surface={logo}
        part={letter.id}
        position={letter.position}
        material={<LetterMaterial />}
      />
    ))}
  </group>
</SurfaceCanvas>
```

### Genie

```tsx
const surface = useSurface('genie-window')
useSurfaceDriver(surface, pourDriver)

<Surface
  surface={surface}
  view={view}
  timing={{ settleMs: 0 }}
  source={<WindowBody />}
  capture={<AirborneBody />}
>
  <Surface.DOM />
</Surface>

<SurfaceCanvas>
  <group renderOrder={stack} position={windowPosition}>
    <WindowShadow />
    <Surface.WebGL
      surface={surface}
      geometry={<WarpGeometry />}
      material={<WindowMaterial />}
    />
    {film && (
      <FrameSurface source={film.frames} presentation={film.requirement} />
    )}
  </group>
</SurfaceCanvas>
```

### Explode

```tsx
<SurfaceCanvas>
  <group rotation={assemblyRotation}>
    {plates.map((plate) => (
      <group key={plate.id} position={plate.position}>
        <Surface adopt={plate.node} size={[plate.width, plate.height]}>
          <Surface.WebGL alpha="source" />
        </Surface>
        <LeaderLine plate={plate} />
      </group>
    ))}
  </group>
</SurfaceCanvas>
```

## Migration map

| Current API | Revision 3 |
|---|---|
| `SurfaceApp` resident content | Canvas-side `<Surface source><Surface.WebGL /></Surface>` |
| Current mesh `Surface` | `Surface.WebGL` |
| Static `Surface html` | React `source` with `dangerouslySetInnerHTML` |
| Adopted `Surface html={element}` | `<Surface adopt={element}>` |
| `Surface frame` | Advanced `FrameSurface source` |
| `useLift` (old) | `useSurfaceView` — handle, `view`, `show(view)`, and a `mounted` the protocol releases. Shipped 2026-08-23. |
| `LiftDriver` | Internal host driver |
| `presenters` and `present()` | `Surface.Part` registration |
| `pageHolds`, `glHolds`, `glMounted` | Surface and host presentation ownership |
| `progress()` | `useSurfaceProgress().get()` or `surface.progress.get()` |
| `range(from, distance)` | `progress.between(start, end)` |
| `curve(from, distance)` | `progress.pulse(start, end)` |
| `material="none"` | `material={<CustomMaterial />}` |
| built-in standard material props | `material={<Surface.LitMaterial ... />}` |
| `paint="always"` | `paint="always"` on the source `Surface` |
| `hitTest="plane"` | `pointerEvents="geometry"` |
| `raycast={() => {}}` | `pointerEvents="none"` |
| `width` and `height` | `size`, or measured DOM presentation |
| `onFirstPresented` | Internal presentation evidence |
| `onHost` | Advanced `onCaptureRoot` |
| `onSource` | Advanced `onCaptureRoot` |
| `onChrome` | Advanced `useSurfaceChrome()` |
| `onFocusWithin` | `onFocusWithinChange` or supported focus events |
| `detectHtmlInCanvas().drawElementImage` | `useSupportsDOMSurfaces()` in render; `supportsDOMSurfaces()` for events and diagnostics (shipped) |

The migration guide must state that `Surface` changes meaning. The current name
means a mesh inside Canvas. Revision 3 uses it for the renderer-independent
content declaration. The release should include a codemod or lint-assisted
migration for the mechanical `Surface` to `Surface.WebGL` rename.

## Package boundary

`decisions.md #6` says the React binding re-exports the kernel whole. Revision
3 needs an amendment:

> Conformance tests define the guarantees inside core. Consumer evidence
> defines what the published package promises.

The boundary test can continue to block imports from private core paths. The
package root becomes curated, the advanced entry owns supported lower-level
contracts, and the registry keeps scene policy and copyable effects.

## Proof required before API freeze

### Capture strategy

1. Compare portal copies with a state-preserving `moveBefore()` container.
2. Test inputs, focus, selection, IDs, effects, iframes, media, divergent
   capture trees, and accessibility-tree switching.

### Substrate

3. Build separated source and WebGL registration without a JSX tunnel.
4. Prove source replacement, unmount, reversal, readiness, and Strict Mode
   cleanup.
5. Prove several handles in one Canvas and several canvases on one page.

### DOM-side compound

6. Prove inward WebGL registration and default host selection.
7. Prove `match-dom` placement under scroll, resize, transformed parents,
   camera types, and fractional layout.

### Canvas-side compound

8. Race outward source strategies: plain portal registration, tunneled
   content, and nested root with a context bridge.
9. Measure provider reach, update latency, first-content ordering, and Strict
   Mode at Workspace scale.

### Renderer law

10. Prove per-Surface framebuffer-write-free warm-up in a shared Canvas.
11. Prove the first color-writing draw transfers the hold with no blank,
    duplicate, or alpha-change frame.
12. Prove context loss restores DOM and clears stale evidence.
13. Prove delayed renderer cleanup does not disturb the return frame.

### Materials, anchors, and input

14. Prove stable custom-material texture binding without UUID remounts.
15. Prove premultiplied blending and transparent source-host defaults.
16. Prove `Surface.Anchor` matches the drawn paint generation.
17. Prove merged refs and ordered caller and library pointer handlers.
18. Prove relayed event provenance through React and window listeners.
19. Prove `paint="always"` updates embedded media and stops on teardown.
20. Prove unlit and first-party lit materials preserve source alpha and color.

### Budgets

Each prototype records endpoint placement error, handoff frame faults, warm-up
time, idle paints, Workspace-scale update latency, duplicate-source cost, and
leaked renderer, source, listener, focus, and anchor registrations. Capture
probes also record accessibility-tree duplicates, readiness latency, and the
cost of continuous media uploads.

## Implementation order

1. Run the capture-strategy and accessibility probe.
2. Build and test separated wiring.
3. Add the shared host and per-Surface warm-up law.
4. Add the Canvas-side compound; migrate Workspace and Explode.
5. Add the DOM-side compound; migrate Gold Button and Veil.
6. Add `Surface.Part`; migrate Logo.
7. Add the external driver seam; migrate Flight and Genie.
8. Add `Surface.Anchor`; migrate Knobs and Genie anchors.
9. Migrate frame presentation and remaining labs.
10. Curate package entries, amend decision #6, and update README, authoring
    guidance, skill, and `llms.txt`.
11. Ship the codemod, remove temporary legacy exports, and publish the next
    package version.
