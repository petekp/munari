# munari — working rules

munari makes the live DOM available as physical matter in WebGL
(Chrome HTML-in-canvas). One sentence of theory governs everything:
**this is a handoff protocol between two renderers that both believe
they own the pixels.** Idle is the compositor's hold; flight is an
excursion out of it; the handoff rules are the transfer protocol. When
a change is hard to place, ask whose hands the pixels are in at that
moment.

## Shape

- `packages/core` (`@munari/core`) — the kernel: holds and handoffs,
  provenance, arbitration, pure laws. **Zero runtime dependencies**,
  never published independently. The DOM stays the retained model —
  core coordinates, it does not own content.
- `packages/react` (`@petepetrash/munari`) — the thinnest binding, and the one
  package that will ever be published. `three` +
  `@react-three/fiber` are **peer** dependencies. We are three-first;
  renderer abstraction is banned (decisions.md #1).
- `registry/` — copyable behaviors (shadcn model, nothing published):
  tuned constants and perceptual-floor tests travel with the code.
- `apps/lab` — a consumer. Imports **only** the published entries
  `@petepetrash/munari` (curated) and `@petepetrash/munari/advanced`
  (the whole kernel, plus `FrameSurface`), exactly as an outside
  project would. When a scene wants something unexported, export it —
  don't reach around.
- `instruments/` — browser probes and CI gates, committed and
  reviewed like kernel code. A measurement that exists only as prose
  has to be re-derived by whoever needs it next, so every probe is a
  runnable script.
- `tools/oxlint/anti-slop/` — the local lint rules `npm run lint`
  enforces as hard errors.

`tests/boundary.test.ts` enforces every seam above. Each area's README
carries its local rules; `docs/README.md` indexes what is canon.

## Conformance

The kernel's behavior is defined by `tests/conformance/`, one
directory per layer: **mapping → paint (pixels) → pointer (relay) →
transfer (handoff) → chrome (measurement) → physics**. The suites are
the specification — describe/it names, comments, and pinned numbers
are all load-bearing. A law ships with the contract that pins it, and
changing a law means changing its contract in the same commit. Eight
suites are named for the law they pin, not for a module — the
conformance README maps each to its module.

## Where tests live (four homes, only four)

- **core** → `tests/conformance/<layer>/`. Never beside the module — a
  test placed in `packages/core/src` fails the boundary test, and the
  fix is to move the test, not widen the allowlist.
- **react** → beside the module (`foo.ts` + `foo.test.ts`).
- **lab scenes** → beside the module, inside that scene's folder under
  `apps/lab/src/scenes/`.
- **registry** → `tests/registry/`, the byte-welds that keep vendorable
  copies identical to the lab reference. A welded file changes in both
  places in the same commit, or the weld test fails.

`tests/surfaceTypes.tsx` is the odd one: a compile-only API check, run
by no test runner, wired invisibly through the root tsconfig include.

## Comments are load-bearing

- A module opens with a `//` preamble: the thing named in a noun
  phrase with an em-dash gloss, then the law, then the fault that
  produced it — dated, with the measured numbers — then the ownership
  split. The preamble sits above the imports.
- Constants carry *why this number*, citing `decisions.md #N` or
  `platform.md #N`. A number nobody can cite gets approximated by the
  next reader.
- The comment budget goes to the exact shape of bug this kernel is
  prone to: invisible in review, expensive to notice, found only by
  debugging. Never narrate location, mechanics the code already shows,
  or the change you just made.
- Long files use `// ── section name ─────` rules.
- Any non-const `as` assertion needs a `SAFETY:` comment saying why it
  holds (lint-enforced).
- In conformance suites the comments ARE the contract (decisions.md
  #2): adjusting a pinned number to make a test pass is a decision and
  needs a ledger entry.

## Naming

- PascalCase for React components, camelCase for TS modules,
  kebab-case for directories in `tools/`, `instruments/`, `registry/`.
- A lab scene is a folder under `apps/lab/src/scenes/` holding
  `SceneName.tsx` (the entry), `sceneName.css`, and prefixed modules
  whose suffix says their kind: `*Law.ts` pure laws, `*Shaders.ts`
  GLSL strings, `*Tweaks.tsx` tuning panels, `*Tuning.ts` tuned value
  bags, plain mechanism nouns otherwise. Prefixes stay on filenames
  inside the folder so every module name is unique repo-wide.
- "Knobs" is the name of a scene. Tuned value bags are `*Tuning`.

## Standing decisions (do not re-litigate; docs/decisions.md)

- **Premultiplied alpha, library-wide** (decisions.md #5): every
  DOM-sourced texture uploads premultiplied and every material
  consuming one blends premultiplied.
- **Perceptual floors are named peers of the theorems:** a mechanism
  isn't shipped until a budget pinned to real hand speeds says a human
  can see and feel it.
- **Browser evidence beats reasoning.** Numbers from a probe outrank
  any argument, including the ones in these documents. What the
  platform actually does, and how it was measured, is `docs/platform.md`;
  what that obliges anyone authoring content for a Surface is
  `docs/authoring.md` (content root sizes itself, no opacity/transform on
  that root, no `mask-image` in the subtree, hover/active twins).

## Verifying changes

`npm test` (vitest), `npm run typecheck` (four tsc programs: root,
`apps/lab`, `registry`, `tools`), and `npm run lint` (oxlint with the
anti-slop rules — its README explains what each rule rejects and what
to write instead). CI runs all three on every push, plus seven browser
gates: `gate:idle-zero` (mounted quiescent Surfaces cost 0 paints/s),
`gate:frame-surface`, `gate:shaders`, `gate:dom-surface-demand`,
`gate:lifting-pointer`, `gate:genie-film-reorder`, and `gate:degraded`
(every lab gesture in a browser with NO origin trial — the one path no
capability-enabled gate can see). Seven more run locally on demand:
`gate:genie-duplicate`, `gate:genie-film`, `gate:genie-film-context`,
`gate:genie-shadow`, `gate:fisheye-pointer`, `gate:slider-drag`,
`gate:refraction-arriving`.
`instruments/README.md` says what each one checks.

`npm run build` produces the publishable package under
`packages/react/dist` — the kernel bundled in, `three`/`@react-three/fiber`/
`react` left external as peers — and `npm publish packages/react/dist`
ships it. The workspace package itself stays `private`, so the source
tree can keep pointing `exports` at `src/` (which is what lets the lab
consume both entries with no alias, and what makes a missing export fail
the build) while a stray publish at the root can't ship raw source.

## Traps

- The published name is `@petepetrash/munari` and it lives in
  `packages/react`; the `@munari/*` scope is internal and private.
  `npm run build -w @petepetrash/munari` builds `packages/react`.
- `registry/` is not a workspace — it typechecks through its own
  tsconfig (a deliberately different dialect; its comment says why).
- `docs/spikes/` are dated measurements, never plans. Amendments in
  `decisions.md` cite files that have since been deleted — that is
  history, not instruction.
- `.claude/` is gitignored: nothing placed there reaches another
  clone. Tracked agent guidance is this file and the per-area READMEs.
