# registry

Copyable scene behavior and implementation notes. Nothing here is published
to npm. Each entry states which files to copy and which tests pin its behavior.

- **glass/**: a screen-space glass compositor and its shader. Copy the two
  files listed in its README.
- **focus-orbit/**: Workspace camera policy and cylindrical layout. Copy all
  three files; Munari's public focus API still owns focus semantics.
- **finishes/**: seventeen tuned finishes for `Surface.Root`'s `finish`,
  with a suggested text color for each. Copy `finishes.ts`.
- **flight-card/**: implementation notes for the Flight scene. A standalone
  copyable component has not been extracted. Its physics and tests live beside
  the scene under `apps/lab/src/scenes/flight`.

Registry code imports `@petepetrash/munari` or `/advanced`, plus the declared
React/Three peers. `/advanced` exposes supported lower-level renderer and
evidence mechanisms; it is not a renderer abstraction.

For DOM-aligned attachments, use `Surface.Anchor` or `useSurfaceAnchorRects`.
The `/advanced` entry also exports `collectSurfaceAnchors` and
`anchorReceiptMatchesDrawn` for manual paint-receipt work. Their canonical
implementation is in the core mapping layer, covered by its conformance tests.
The former registry duplicate has been removed.

Copyable glass, focus-orbit and finishes files stay byte-identical to their lab
references. `tests/registry/*Pack.test.ts` enforces this; edit both copies in
the same change. `registry/tsconfig.json` checks the files in the consumer
compiler configuration.
