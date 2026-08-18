# docs

Code comments cite these documents by entry number (`decisions.md #5`,
`platform.md #9`), so numbering never changes.

| file | what it is |
|---|---|
| `decisions.md` | Numbered design decisions. An entry keeps its number and text forever; a change gets a dated "Amended" note under the original. |
| `platform.md` | Measured behavior of Chrome's HTML-in-canvas: one finding per row, with the probe that produced it and the Chrome version. Re-check after a major Chrome release. |
| `authoring.md` | Rules for HTML that a Surface will draw: the content root sizes itself, no opacity or transform on that root, no `mask-image` in the subtree, hover/active styles written as attribute selectors. Each rule comes from a measured platform behavior. |
| `focus.md` | Keyboard focus and spatial navigation. `packages/react` implements it, with tests beside those modules. |
| `public-api-proposal.md` | Revision 3 proposal centered on compound `Surface` presentations, shared `SurfaceCanvas`, and explicit handles for separated DOM and R3F trees. |

## spikes/

One-off measurement write-ups, kept for their numbers. Each records
the measurement, the Chrome version, and the date. They are not plans;
some predate designs that later changed shape. `design-language.html`
is a visual reference sheet for the lab; open it in a browser.
