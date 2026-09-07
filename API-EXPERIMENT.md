# API contract experiment

This document preserves the earlier experiment. Current usage is in the [README](README.md); the adopted design is summarized in [API revision 2](API-REVISION-2.md), which adds element
capture, authored capture content, and explicit mesh/part composition. The
original resolution below records the preceding experiment's evidence.

This isolated worktree is an experimental implementation based on `c9dc2f3`.
Its temporary exports were removed during the September 6 adoption; this earlier evidence is retained as history.
The production checkout has not been changed.

Read the [resolution and evidence](/private/tmp/munari-api-exploration-20260905/resolution.md).

## Run the real demo adapters

From this worktree, run:

```sh
node instruments/api-lab-server.mjs
```

The server prints its actual URL. Use its `?scene=controls&framed`,
`?scene=knobs&framed`, `?scene=veil&framed`, and
`?scene=marble-hand&framed` routes. Add `&delayScene` to Controls to exercise
delayed scene preparation.

Launch an isolated Chrome with `--enable-features=CanvasDrawElement` for
the enhanced path. Run a separate browser without that flag for fallback;
verify actual capability rather than assuming the flag is the only source.

The generic one-instance probe runs with:

```sh
node instruments/api-instance/server.mjs
```

Its `/surface.html` page exercises the implemented Surface with child-local
React state, uncontrolled inputs, contenteditable text, and radio buttons.

## Repeat browser checks

The `instruments/api-contracts` scripts use the isolated agent-browser session
`munari-api-proof`. Start that session with capable Chrome before running them.
Set `API_PROOF_URL` to the actual lab URL. `API_PROOF_OUTPUT` optionally selects
the evidence directory. Run the scripts serially:

```sh
python3 instruments/api-contracts/controls-check.py
python3 instruments/api-contracts/focus-check.py
python3 instruments/api-contracts/capture-check.py
```

The existing `gate:knobs-resize` and `gate:marble-hand` commands also verify
the adapted real demos. Use `STRICT_CAPABILITY=1` and keep GPU gates serial.

## Source locations

- `packages/react/src/primitives/Surface.tsx`: Surface, scene, capture,
  status, motion, and host contracts.
- `packages/react/src/primitives/Surface.test.ts`: SSR/hydration identity.
- `packages/react/src/primitives/surface/surfaceCanvasSpace.ts`: scoped
  capture coordinates for native input.
- `apps/lab/src/scenes/controls/Controls.tsx`: complete motion/status adapter.
- `apps/lab/src/scenes/knobs/Knobs.tsx`: complete resident mesh/material/anchor adapter.
- `apps/lab/src/scenes/marble-hand/marbleHandPageCapture.tsx`: capture-frame publication.
- `apps/lab/src/scenes/veil/Veil.tsx`: direct frame sampling in the scrolling canvas.

The worktree uses local dependency links, plus a local copy of the existing
DSEG package so Vite can serve its font files within the checkout. No dependency
versions or lockfiles changed.
