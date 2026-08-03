# anamorph

Live DOM as physical matter in WebGL.

An anamorphosis is an image projected in distortion that resolves true
from one designed vantage. Anamorph does that to the browser: the real
DOM — layout, focus, accessibility, text you can select — stays the
retained truth, and a custody protocol lets a WebGL scene carry its
pixels as matter. At the calibrated vantage (1 world unit = 1 CSS
pixel on the rest plane) the page resolves exactly; everywhere else it
is paper you can bend, throw, and crumple.

Built on Chrome's HTML-in-canvas origin trial, `three`, and
`@react-three/fiber`.

**Status: pre-release, under construction.** The kernel is landing one
custody layer at a time — each against a conformance suite distilled
from [three-ui](https://github.com/petekp/three-ui), the frozen
research archive (62 recorded decisions, 357 tests, a summer of
browser measurement) that this library is the product of.

Repo shape: `packages/core` (kernel), `packages/react` (the
`anamorph` package), `registry/` (copyable behaviors), `apps/lab`
(the lab), `instruments/` (probes and harnesses). See `CLAUDE.md` for
the working rules and `docs/decisions.md` for the ledger.
