# docs/ — what is canon, and what is only evidence

Four documents are load-bearing. Code cites them by number
(`decisions.md #5`, `platform.md #9`), so their numbering is stable by
doctrine.

| doc | what it is |
|---|---|
| `decisions.md` | The ledger: numbered standing decisions, `#1`–. Entries are never renumbered and never rewritten; supersession is a dated **Amended** block in place. Changing a pinned number to make a test pass is a decision, and lands here. |
| `platform.md` | The platform, **as measured** — what Chrome's HTML-in-canvas actually does, one row per finding, each with the probe that established it. Browser evidence beats reasoning, including the reasoning in these documents; this file is where the evidence lives. Dated against a Chrome version — re-measure before trusting it across a major release. |
| `authoring.md` | What a Surface asks of anyone authoring content for it: the content root sizes itself, no opacity/transform on that root, no `mask-image` in the subtree, hover/active twins, and the rest. Every rule is a measured platform property, not a preference. |
| `focus.md` | The focus and spatial-navigation contract — the most-cited doc in the codebase. Its evidence rides beside the modules at `packages/react/src/lib/*.test.ts` (decisions.md #9). |

## spikes/

Dated measurements, kept for their numbers. **A spike is never a
plan** — several predate laws that ended up shaped differently, and
two carry that warning in their own headers. Read one for what was
measured, on which Chrome, on which date; do not mine one for a
roadmap. `design-language.html` is the exception in kind: a live
sticker sheet for the lab's visual language, meant to be opened in a
browser.
