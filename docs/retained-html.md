# Retained HTML and capture sources


`Surface.HTML` retains one live instance. Page-owned preparation leaves that
instance on the page and captures a copy of it, so what you see during a lift is
your own element. It borrows the instance only when a copy would lose something
the eye can check — a caret inside the content, or a selection across it. Then it
shows the source bitmap through the native input rig, and an inert clone reserves
layout (decisions.md #42, #63). Keep content-root dimensions
honest; changing page parents uses a page target rather than remounting the content.
Position-only slot changes are observed separately from capture and handoff work.

`SceneSurface` has no page presentation. `useElementCapture` leaves its original
element native and copies visual state, rebuilding the copy by the same rule a
snapDOM Surface captures by: the user's input on the element and its answer,
layout, stylesheets, fonts and transition ends, `refresh()`, and every mutation
only when `live`. `CaptureContent` owns separately authored capture content. Captures reject unsupported media/custom elements unless excluded,
and attached/removed sources clear stale frames. Source textures are borrowed by
consumers and disposed only by their owner.

Numeric authored dimensions must be positive and finite. An unmeasured native
element waits for layout rather than being treated as invalid authored data.
Companions use `useSurfaceBeforeRender` after frame pose writers; the callback may
run for several cameras/targets in one animation frame. It updates companions,
not the simulation clock. Canvas-relative placement follows the renderer
canvas's live client rectangle, including inset, scroll and supported positive
scale.
