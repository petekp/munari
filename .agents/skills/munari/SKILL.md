---
name: munari
description: Build and review React interactions that render live DOM as physical matter in WebGL with Munari. Use for Surface or SurfaceApp setup, page-to-WebGL lifts, custom materials, DOM-aligned WebGL objects, physical controls, and Munari lab or registry work.
---

# Munari

Use the smallest public Munari API that owns the renderer handoff. Keep the DOM as the retained model. Let WebGL change how it looks and moves.

## Start from the canonical sources

1. Read `README.md` for the supported package setup and first Surface.
2. Read `docs/authoring.md` before writing captured markup.
3. Read the relevant registry entry before copying a lab technique.
4. Import only from `@petepetrash/munari`. Do not reach into package source paths.

When working outside the repository, use the README and skill shipped with the installed package version. Do not assume that an online example matches the installed version.

## Choose the path

- Use `SurfaceApp` for interactive React content.
- Use `Surface` for trusted static markup or an existing unparented element.
- Use `useLift` and `LiftDriver` when content crosses between the page and WebGL.
- Use `material="none"` with `useSurfaceTexture` for a custom material.
- Use the `surface-anchors` registry recipe to align WebGL objects with named DOM regions.
- Use `createStyleChannel` for CSS state that must enter a scene.
- Use `Dial` for a package-owned physical control.
- Use `FocusScene` for keyboard and spatial navigation.
- Use kernel exports only when a new recipe or primitive needs the protocol law itself.

## Build a visible Surface

- Import `@petepetrash/munari/style.css` once.
- Check `detectHtmlInCanvas().drawElementImage` and keep ordinary DOM when it is false.
- Give every `Surface` or `SurfaceApp` a geometry child, usually `<planeGeometry />`.
- Light the default standard material, or set `emissiveIntensity={1}` for an unlit first result.
- Give the Canvas and the captured content root explicit visible dimensions.
- Treat `width` and `height` as DOM texture pixels. Size the Three geometry separately.
- Treat the `html` string as trusted markup. Use `SurfaceApp` for application content.

`SurfaceApp` creates a second React root. Pass required values through `content`; outer React context does not cross into it.

## Build a sound lift

- Create one `useLift({ presenters, timing })` at the page/scene boundary.
- Keep the canvas-side presenters mounted while `lift.glMounted` is true.
- Composite it only while `lift.glHolds` is true.
- Keep page pixels visible only while `lift.pageHolds` is true.
- Mount one `LiftDriver` inside the governed Canvas.
- Connect each incoming `Surface.onFirstPresented` to `lift.present(key)`.
- Never release on `onFirstUpload`, a frame count, or a timer.
- Drive mesh-side movement with `progress()`, `range()`, or `curve()`.
- Use `request(true)` and `request(false)` for both directions. Let the protocol reverse an active crossing.

## Preserve the capture rules

- Size the captured root from its own layout box.
- Do not animate the captured root's own `opacity` or `transform`.
- Do not use `mask-image` inside a captured subtree.
- Add `[data-hover]` and `[data-active]` twins for pointer styles.
- Keep focus and state changes paint-only. Do not change layout during a handoff.
- Keep WebGL attachments on the same successful paint generation as their texture.

## Keep the library lean

- Keep visual treatment, scene thresholds, shaders, lighting, and tuned constants local to a scene or registry recipe.
- Add a binding API only after two real consumers need the same coordination rule.
- Prefer one canonical example and link to it. Do not copy long examples into several documents.

## Verify

Run the consumer's typecheck and production build. In this repository, also run `npm test`, `npm run typecheck`, and `npm run lint`. Use the named browser gate when the change affects paint, presentation, pointer relay, or a handoff.
