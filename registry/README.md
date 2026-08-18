# registry

Source you copy into your project. Nothing here goes to npm. Each
entry ships with its tuned constants and the tests that pin them.

- **glass/**: screen-space liquid-glass panels over live DOM. Two
  files to copy; its README explains them.
- **surface-anchors/**: track named DOM regions of a Surface in
  texture space, so WebGL objects can sit on DOM elements. One file;
  the knobs and genie scenes use it.
- **focus-orbit/**: the Workspace camera policy and cylindrical arc layout.
  Copy the three files together; the package still owns focus semantics.
- **flight-card/**: documentation only for now. The behavior lives in
  the flight scene and its laws in `packages/core`; extraction waits
  for a second consumer (decisions.md #10).

Registry code imports the library only through its published entries —
`@petepetrash/munari`, or `@petepetrash/munari/advanced` for the
renderer-agnostic core — the same rule as any outside project. If you
can't build a behavior here without patching the library, that is a
library bug.

Focus and spatial navigation still ship as exported API (decisions.md #9).
The focus-orbit recipe is only a camera and layout policy that consumes that
API; it does not duplicate focus semantics.

Each copyable file must stay byte-identical to its reference copy in
`apps/lab`; `tests/registry/*Pack.test.ts` fails if they differ. Edit
both copies in the same commit.
