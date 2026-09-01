---
name: munari
description: Build and review React interactions that render live DOM as physical matter in WebGL with Munari. Use for Surface and SurfaceCanvas setup, page-to-WebGL handoffs, custom materials, DOM-aligned WebGL objects, physical controls, and Munari lab or registry work.
---

# Munari

Use the smallest public Munari API that owns the renderer handoff. Keep the DOM as the retained model. Let WebGL change how it looks and moves.

## Start from the canonical sources

1. Establish the version and context. In a checkout, use `docs/agent-workflow.md` to select the task owner and smallest check; read `docs/system-model.md` only when ownership or evidence is unclear.
2. Read `README.md` for supported package setup. Before writing captured markup, read `docs/authoring.md` from the same source revision.
3. Read the relevant registry entry before copying a lab technique. Historical proposals and compound sketches are not current API references.
4. Import from `@petepetrash/munari`, or from `@petepetrash/munari/advanced` when you need the renderer-agnostic core or `FrameSurface`. Do not reach into package source paths.

When working outside the repository, use the installed README, skill, `index.d.ts`, and `advanced.d.ts`. The current package does not ship the full repository docs or registry. Obtain missing guidance from a proven matching release revision or report the gap; do not substitute mutable GitHub `main`. The package-guidance stage in `docs/agent-system-plan.md` is proposed, not shipped.

## Choose the path

- Use one `<Surface>` for a piece of content, with `source` for React content or `adopt` for an element you already built.
- Set `view` when the handoff is exclusive. With page and WebGL presentations, omit it for a Twin. A source-only Surface has no presenter and can supply another material's texture without becoming ready.
- Use `<Surface.Part>` when one Surface has several sources that must transfer together or not at all.
- Use `<Surface.Anchor>` to stand a scene object on a named box inside the source.
- Pass your own `material` to `<Surface.WebGL>` and read its non-null `useSurfaceTexture()`. Outside that slot, `useSurfaceTextureOf(handle)` samples another source and can return `null`.
- Use `useSurface`, `useSurfaceProgress`, or `useSurfaceDriver` to scale scene motion by the crossing.
- Use `Dial` for a package-owned physical control.
- Use `FocusScene` for keyboard and spatial navigation.
- Use `@petepetrash/munari/advanced` only when a recipe or primitive needs the protocol law itself, or wears a canvas you render yourself (`FrameSurface`).

## Build a visible Surface

- Import `@petepetrash/munari/style.css` once.
- Content that changes hands and changes back uses `useSurfaceView('name')`. It returns the handle, the `view` for `<Surface>`, `show(view)` to ask with, and `mounted` — keep the WebGL side in the tree for exactly as long as that is true. Do not unmount on the view change; the protocol holds its presenter through the reclaim linger, and cutting early leaves one frame where neither side draws. `show('webgl')` is refused where the trial is absent, so `view` never names a renderer that cannot arrive.
- Call `useSupportsDOMSurfaces()` and render ordinary DOM when it is false. Do not read the capability directly during render — that breaks hydration. `supportsDOMSurfaces()` is the same question for events, effects and diagnostics; `detectHtmlInCanvas()` reports both trial entry points and is for diagnostics only.
- Mount one `<SurfaceCanvas>`. Name it with `id` and point Surfaces at it with `canvas` once there is more than one.
- Render the page copy inside `<Surface.DOM>` and the mesh inside `<Surface.WebGL>`.
- Leave `<Surface.WebGL>` at its default `placement="match-dom"`: it stands where the page copy stands, at the page copy's size. Pass `placement="manual"` and your own `geometry` only when the mesh belongs somewhere else.
- Give the captured content root explicit visible dimensions.
- Set `alpha="source"` when the content is translucent, and `pointerEvents` to `geometry`, `content`, or `none`.

`source` and `<Surface.DOM>` are separate React renders of the same component. Hold any state they share above the Surface, or the two copies disagree.

## Build a sound handoff

- Drive it with `view`: `'webgl'` lifts, `'dom'` lands. Reverse it at any time; the protocol handles a reversal mid-crossing.
- Never release on a frame count or a timer. The Surface releases the page copy on a proven color-writing draw.
- Keep the signals distinct: `onReady` can follow a write-free eligible draw; `onPresentedViewChange` reports the exclusive hold; `onMotionComplete` reports motion, not resource release. Retain the WebGL side according to `mounted`.
- Scale mesh-side movement by `useSurfaceProgress()` or a `useSurfaceDriver` step.
- Set `timing.settleMs` to outlast the slowest compositor-clocked transition the content runs on its presented pixels.

## Degrade every gesture, not just the scene

Most browsers do not have the trial. Content degrades on its own: the page copy keeps rendering, `presentedView` stays `'dom'`, and munari reports the reason through `onError`. Gestures do not degrade on their own, and this is the failure this library is most prone to.

- A pointer handler that sets scene state and then asks for `'webgl'` strands the scene when no renderer can arrive. No further input can leave that state, and nothing throws.
- Branch inside the gesture, not only at the scene root: `if (!supported) return <the plain DOM version>`.
- Derive "is this lifted" from `useSurfaceState(handle)` instead of keeping a second copy in scene state. Munari never claims a hold it cannot take, so derived state cannot strand; a duplicated boolean can.
- Reuse the scene's own commit functions on the degraded path so both paths end in one place. Do not write a second version of the outcome.
- Exercise the degraded path in a browser without `--enable-features=CanvasDrawElement` before calling the work done.

## Preserve the capture rules

- Size the captured root from its own layout box.
- Do not animate the captured root's own `opacity` or `transform`.
- Do not use `mask-image` inside a captured subtree.
- Add `[data-hover]` and `[data-active]` twins for pointer styles.
- Keep focus and state changes paint-only. Do not change layout during a handoff.
- Keep WebGL attachments on the same successful paint generation as their texture.

## Keep the library lean

- Keep visual treatment, scene thresholds, shaders, lighting, and tuned constants local to a scene or registry recipe.
- Prefer one canonical example and link to it. Do not copy long examples into several documents.
- Use existing state owners for writes. Read-only diagnostics must not force protocol readiness or presentation. Scene tuning declares its units and whether an edit updates live, rebuilds, recaptures, or replays.
- Retain a verified lesson in its owning contract, authoring rule, platform measurement, or recipe. Keep unbuilt work in the plan rather than a second current reference.

## Verify

Run the consumer's typecheck and production build. In this repository, also run `npm test`, `npm run typecheck`, and `npm run lint`. Use the named browser gate when the change affects paint, presentation, pointer relay, or a handoff. `package.json` lists commands; `.github/workflows/ci.yml` selects CI gates; `instruments/README.md` defines their scope.

Run GPU gates serially. Wait for observable state with a deadline, not a sleep presented as readiness proof. Use `STRICT_CAPABILITY=1` when claiming the enhanced path passed and check native fallback separately. Record pass, failure, skip, and unmeasured scope without treating a zero exit code as proof. Documentation-only edits need link, status, symbol and example checks, not unrelated GPU runs.
