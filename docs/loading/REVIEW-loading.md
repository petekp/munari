# Review of the loading proposal

Reviewer: Fable 5.2 (`claude-fable-5-2`), effort high, read-only, on
2026-11-26. Author: Opus 5.5. The reviewer read the probe code, the raw
records in `.scratch/loading-data/` (not committed), the lab and library
code at `f844db5`, three 0.186.1, the finish API proposal and every cited
public source.

The reviewer recomputed all 24 rows of the main table from the raw
records with no differences. Every inventory code reference resolved. All
18 cited pages with a quote or a named test were fetched, and every quote
matched. There were no blockers. Each finding and what changed:

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | major | Bench's cause named only the environment map. Three of four card shaders also use anisotropy, clearcoat or sheen. The stand-ins are cloned before the before-draw callback runs, not before the bake | Fixed in measurements, README fix 1, inventory and the finish API section |
| 2 | major | Light does not use `SurfaceCanvas`, so it cannot be evidence for one adapter request or for D4 | Fixed. Light is described as running three renderers. D4 and fix 4 use Knobs |
| 3 | major | "No freeze" left out the bake's blocking builds (267–350 ms gaps) and the mipmap prebuild | Fixed. Both are in the Bench timeline and a new fix 2. The 1.6 s estimate is dropped |
| 4 | major | snapDOM also waits for the capture-memory adapter request, so Knobs' late snapDOM capture is explained | Fixed in measurements and inventory. The open question is removed |
| 5 | minor | The estimate used promise latency of smaller stand-in shaders | Fixed. The README says the fixed timing is unmeasured and names both effects |
| 6 | minor | "Freezes the whole page" was shown only as missing animation frames | Fixed. The docs say "stops frames" and list the limit |
| 7 | minor | Light's renderers and slow requests were miscounted | Fixed |
| 8 | minor | snapDOM counts were Bench's, and the decode figure is summed waits | Fixed |
| 9 | minor | Filmstrip times use the shell's clock, and the iframe offset was wrong | Fixed. Tables are labelled and the offset is 95–157 ms cold, 45–96 ms warm |
| 10 | minor | Six numbers did not match the records | Fixed, using the reviewer's recomputed values |
| 11 | minor | The longest gap is unstable at three loads | Fixed. The summaries lead with the total |
| 12 | minor | The port and flags in the method differed from the probe | Fixed. The matrix used port 5192, the only loopback server, serving the same build as the second preview. All flags are listed |
| 13 | minor | The inventory missed Light's renderers and worker, two snapDOM steps and the logo's scene | Fixed. Rows added, and the inventory no longer claims to be complete |
| 14 | minor | "Accepted finish API", loading-spec's planned #76, the #76 citation for later materials, and a missing review link | Fixed. The review link now resolves |
| 15 | minor | Whether the 4.11 s Light load fell back was checkable | Fixed. It stayed enhanced with about 40 ms to spare |
| 16 | minor | Not every precedent has a bound, and the disk cache contents on Metal are unverified | Fixed |

The reviewer also listed limits the docs did not state: recorder
overhead, unrecorded input and shell frames, and queueing inside async and
adapter times. All three are now in the measurements' limits. Assumptions
the reviewer could not check, and which remain open: the recorder's
effect on timing, per-renderer attribution of builds, whether the machine
was otherwise idle, and headed-browser behavior.

<!-- review-gate
reviewed: README.md sha256:70727efe8cc6b4cfa9232017eb4cee7e1769fa9165e730391c01c5545721bbdf
reviewed: inventory.md sha256:e493e7a731222b32dce6668d2a059b5917a96a88ac4b62bd2e1a28226cc97c57
reviewed: measurements.md sha256:a1ca1ba300087a3282357a2f488f433c30126f01b6d343c6c70a3f356a25ed41
reviewed: browser-precedents.md sha256:c59fa08473c449377d5d74b6b6dd923cec110fbf7b102215c6bcc18c8d8fe08c
reviewed: decisions.md sha256:858d7efe90024552875b8329697860cf3baa0fd4c0ce1d244ec202e82085216a
reviewer: claude-fable-5-2
covers: acquisition, transformation, results
finding 1: fixed
finding 2: fixed
finding 3: fixed
finding 4: fixed
finding 5: fixed
finding 6: fixed
finding 7: fixed
finding 8: fixed
finding 9: fixed
finding 10: fixed
finding 11: fixed
finding 12: fixed
finding 13: fixed
finding 14: fixed
finding 15: fixed
finding 16: fixed
-->
