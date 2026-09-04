---
name: munari
description: Build and review React interactions that render live DOM as physical matter in a Three/R3F scene with Munari. Use for Surface and SurfaceCanvas setup, page-to-canvas handoffs, custom materials, DOM-aligned scene objects, physical controls, and Munari lab or registry work.
---

# Munari

Use the smallest public Munari API that owns the renderer handoff. Keep the
DOM as the retained model. Let the scene change how it looks and moves.

## Start from the canonical sources

1. Establish the version and context. In a checkout, use
   `docs/agent-workflow.md` to select the task owner and smallest check; read
   `docs/system-model.md` when ownership or evidence is unclear.
2. Read `README.md` for package setup. Before writing captured markup, read
   `docs/authoring.md` from the same source revision.
3. Read the relevant registry entry before copying a lab technique. Historical
   proposals and compound sketches are not current API references.
4. Import from `@petepetrash/munari`, or from
   `@petepetrash/munari/advanced` when you need the kernel or `FrameSurface`.
   Do not reach into package source paths.

When working outside the repository, use the installed README, skill,
`index.d.ts`, and `advanced.d.ts`. The package does not ship the full
repository docs or registry. Obtain missing guidance from a matching release
or report the gap; do not substitute mutable GitHub `main`.

## Choose the Surface relationship

- Use one `<Surface>` for a piece of content, with `source` for React content
  or `adopt` for an element you already built.
- `renderIn` defaults to `'page'` and accepts `'page'`, `'canvas'`, `'both'`,
  or `'none'`. `page` and `canvas` require their corresponding declared
  presentations. `both` keeps page and mesh copies visible, with the page
  primary for keyboard and accessibility. `none` keeps the source available
  to another material without a visible presenter.
- `<Surface.DOM>` renders its part source when no children are provided.
  The captured source and the `<Surface.DOM>` page presentation are separate
  React instances; put shared state above the Surface. In separated wiring,
  `<Surface.DOM surface={handle}>` requires explicit children and can keep a
  stable native page copy outside the captured source tree. An adopted element
  needs an explicitly authored page presentation.
- `<Surface.Mesh>` is the scene presenter. Pass a custom `material` there and
  read its non-null `useSurfaceTexture()`. Outside that slot,
  `useSurfaceTextureOf(handle)` samples another source and can return `null`.
- Use `<Surface.Scene surface={handle}>` under the shared `<SurfaceCanvas>`
  for a custom scene subtree. Keep it always declared; it retains one
  Surface's children through preparation, reversal, return and cleanup. It
  cannot retain a caller-owned `<SurfaceCanvas>`; the caller owns that host.
- Use `<Surface.Part>` when one Surface has several sources that must transfer
  together or not at all. Use `<Surface.Anchor>` to stand a scene object on a
  named box inside the source.
- A basic Surface needs no identity hook. Use `useSurfaceHandle(name?)` or
  `createSurface(name?)` for separate React trees or external observers. A
  name is a diagnostic label, not a global lookup key.
- Use `Dial` for a package-owned physical control and `FocusScene` for
  keyboard and spatial navigation.
- Use `/advanced` only when a recipe or primitive needs the protocol law or a
  caller-owned canvas through `FrameSurface`.

## Build a visible Surface

- Import `@petepetrash/munari/style.css` once.
- Declare one shared `<SurfaceCanvas>`. Keep it mounted for as long as its
  Surfaces or scene resources need the renderer. An overlay host commonly uses
  `pointerMode="surfaces"`, `frameloop="demand"`, and fixed positioning.
- If an app uses multiple hosts, give each `<SurfaceCanvas>` a distinct `id`
  and pass the matching `canvas="…"` to each Surface. The caller owns each
  host's lifetime.
- Render `<Surface.DOM />` and `<Surface.Mesh />` as the two declared
  presentations. The source is declared once on `<Surface>`.
- Leave `<Surface.Mesh>` at its default `placement="match-dom"`: it stands
  where the page copy stands, at the page copy's size. Pass
  `placement="manual"` and your own `geometry` only when it belongs
  somewhere else.
- Give the captured content root explicit visible dimensions.
- Set `alpha="source"` when the content is translucent, and `pointerEvents`
  to `geometry`, `content`, or `none`.

## Build a sound handoff

- Drive an exclusive handoff with `renderIn="page"` or `renderIn="canvas"`.
  `renderIn="both"` is a Twin and `renderIn="none"` is source-only; neither
  is an implicit handoff.
- A canvas-only resident has no page handoff delay or protocol frame loop. It
  still needs presenter proof for readiness and actual presentation evidence.
- `useSurfaceState(handle?)` reads the nearest Surface or an explicit handle.
  Its `requested` value is the `renderIn` request; `presented` is the current
  `SurfacePresentation` (`page`, `canvas`, `both`, or `none`); `ready` reports
  presenter preparation; `supported` reports capture capability; and
  `isChanging` reports an active handoff.
- `onPresentationChange` reports the presentation hold. `onMotionComplete`
  reports a motion endpoint as a `SurfaceDestination` (`page` or `canvas`).
  `onReady` reports preparation. Keep these signals distinct. Do not add a
  public phase enum that equates preparation with completion.
- Scale scene motion with `useSurfaceProgress()` or `useSurfaceDriver(step, surface?)`.
  The callback comes first; omit the handle to use the nearest Surface identity.
  A `null` step restores the built-in timed motion.
  Set `timing.settleMs` longer than the slowest compositor-clocked transition
  on the presented content.
- The handle argument is optional for state, progress, and driver reads. With
  no handle, these read the nearest Surface identity across page and scene
  renderer trees.
- For a specialist draw path, `<Surface.Mesh presentation="manual">` keeps
  the mesh proxy and pointer relay while delegating final draw evidence. The
  advanced `surfaceManualPresenter` must register every declared part, call
  `prove()` after an eligible preparation draw, and call `present()` only after
  the actual final compositor draw. During a handoff, its `canvasPresents()`
  controls whether the external renderer may show those pixels.
- Never release on a frame count or timer. The page releases only after a
  proven color-writing presentation draw. There is no public `mounted`
  obligation or `onWebGLReleased` cleanup event; `Surface.Scene` owns the
  custom subtree lifetime.

## Degrade every gesture, not just the scene

Most browsers do not have the capture trial. `useSurfaceSupport()` returns a
hydration-safe boolean: false on the server and through hydration, then the
capture-capability answer. `supportsSurfaces()` is the imperative check for
events, effects, and diagnostics. It does not promise renderer or material
readiness.

- A page presentation remains native when capture is unsupported. An
  unsupported canvas request keeps `presented: 'page'` when a page fallback is
  declared; it starts no transfer or perpetual work claim.
- Branch inside the gesture, before setting state that only a canvas path can
  clear. Reuse the same commit function on the native fallback.
- A canvas-only Surface has no page fallback unless the application declares
  one. `renderIn="none"` is a valid source-only mode and does not imply
  `ready`.
- Exercise the no-flag browser path separately from the enhanced path.

## Preserve the capture rules

- Size the captured root from its own layout box.
- Do not animate the captured root's own `opacity` or `transform`.
- Do not use `mask-image` inside a captured subtree.
- Add `[data-hover]` and `[data-active]` twins for pointer styles.
- Keep focus and state changes paint-only. Do not change layout during a
  handoff.
- Keep scene attachments on the same successful paint generation as their
  texture.
- Keep the current renderer requirements accurate. `Surface.Mesh` is a public
  role name; renaming it does not establish WebGPU support.

## Keep the library lean

- Keep visual treatment, scene thresholds, shaders, lighting, and tuned
  constants local to a scene or registry recipe.
- Prefer one canonical example and link to it. Do not copy long examples into
  several documents.
- Use existing state owners for writes. Read-only diagnostics must not force
  protocol readiness or presentation.
- Retain a verified lesson in its owning contract, authoring rule, platform
  measurement, or recipe. Keep unbuilt work in the plan rather than a second
  current reference.

## Verify

Run the consumer's typecheck and production build. In this repository, also
run `npm test`, `npm run typecheck`, and `npm run lint`. Use the named browser
gate when the change affects paint, presentation, pointer relay, or a
handoff. `package.json` lists commands; `.github/workflows/ci.yml` selects CI
gates; `instruments/README.md` defines their scope.

Run GPU gates serially. Wait for observable state with a deadline, not a sleep
presented as readiness proof. Use `STRICT_CAPABILITY=1` when claiming the
enhanced path passed and check native fallback separately. Record pass,
failure, skip, and unmeasured scope without treating a zero exit code as
proof. Documentation-only edits need link, status, symbol, and example checks,
not unrelated GPU runs.
