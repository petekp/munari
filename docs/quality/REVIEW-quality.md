# Review of the quality levels proposal

Reviewer: Fable 5.2 (`claude-fable-5-2`), effort high, read-only, on
2026-11-26, in two passes. Author: Opus 5.5. The reviewer read
the [quality levels proposal](README.md) and its parts, the probe in `instruments/quality/`, the raw
records in `.scratch/quality-data/` (not committed), the library and lab
code at `a2b6320` and `cdf9501`, R3F 9.8.1, three 0.186.1, drei 10.7.7,
decision #44 and `docs/sharpness.md`, and every cited public source.

The first pass recomputed every table cell from the raw records with no
differences, and resolved every code reference. It found that two
recommendations did not hold. A default cap of 2 broke decision #44,
including on zoomed DPR-2 laptops. Turning MSAA off had been tested only on
flat cards, where it cannot matter. The author ran two more measurements
on m2: pixel differences at device scale 3, and MSAA on tilted cards. Then
the proposal was redesigned. Each level is now a fraction of the native
ratio, `high` stays native, and MSAA stays on. The second pass checked the
revision, recomputed the new numbers with no differences, and found six
remaining problems.

| # | Pass | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | 1 | blocker | A default cap of 2 revised decision #44 without saying so, softened zoomed DPR-2 screens, and had no measured visual cost | Fixed. `high` is native. The cap of 2 is option Q1-B, with device-scale-3 pixel data and the zoom cost |
| 2 | 1 | major | With one field, the levels were aliases for `dpr` ranges. R3F's own `[1, 2]` default and the simpler alternative went unnamed | Fixed. Levels are fractions of the native ratio, which `dpr` cannot express. The alternative and R3F's default are stated |
| 3 | 1 | major | "Surfaces look the same without MSAA" rested on flat cards. Two lab claims were false | Fixed. Tilted cards measured (MSAA changes 0.34–0.35% of pixels along the silhouette). Q5 now keeps MSAA. Lab claims corrected |
| 4 | 1 | major | Cost tracks total pixels, and the bench is fill-bound | Fixed. A pixel budget is option Q2-D, and the fill-bound bench is a stated limit |
| 5 | 1 | major | Runtime level changes and the `PerformanceMonitor` recipe were untested | Accepted. No run changed a level live. The doc says so, and it withholds the recipe until one run confirms it |
| 6 | 1 | major | Memory savings came from one page, and the direction of the omissions was unstated | Fixed. Both pages are reported, and the doc says the omissions understate the ratio's saving |
| 7 | 1 | minor | Most of "presented" is dev-server load, and the GPU-lag pattern was misdescribed | Fixed. Bake-to-presented medians added. The lag pattern is reported as unexplained |
| 8 | 1 | minor | Six precedent citations were wrong or overstated | Fixed. Unreal, Babylon, Unity, model-viewer and `powerPreference` are corrected, and the spacesvr citation is removed |
| 9 | 1 | minor | Four numbers in prose did not match the records | Fixed |
| 10 | 1 | minor | The inventory left out anisotropic filtering, shadows, the depth buffer and the softbox key's shading cost | Fixed. Rows added. The inventory no longer claims to be complete |
| 11 | 1 | minor | The probe cited a decision absent on this branch, carried an unused bench, and ran settings in a fixed order | Fixed. Citation and bench removed. Order is a stated limit |
| 12 | 2 | major | The recipe's `flipflops` and `onFallback` would send a fast device to `low` | Fixed. Both are removed, and the doc explains why |
| 13 | 2 | major | The floor of 1 was justified by a reason that also applies to every level, and its effect below ratio 2 was missing | Fixed. The floor is stated as a convention. Rows for 1.25 and 1.5 are added, and "no effect at DPR 1" is a cost in Q2 |
| 14 | 2 | minor | A numeric `dpr` replaces the ratio, so it disables `quality`. "Hard cap" overstated a range | Fixed. The rule for a numeric `dpr` is stated, and the cap wording is corrected |
| 15 | 2 | minor | Q2-D was dismissed as a duplicate of `dpr`, which cannot bound pixel count | Fixed. D is rejected on need |
| 16 | 2 | minor | Capture density at ratios between tiers, and pixels for the proposed levels at device scale 3, are unverified | Accepted. Both are stated as unverified in the proposal |
| 17 | 2 | minor | A precedent sentence contradicted the Unity bullet. The tilt edge was a judgment by eye, and plain Surfaces were not tilted | Fixed |

After the review, the repo's commit hook required splitting the single
document at its top-level headings into the files this record names. The
text is unchanged apart from headings, which moved up one level, and links
between the parts.

The reviewer could not check the m2 runs themselves, the crops by eye,
the finish layer module sizes (no local build), or whether Dawn allocates
MSAA buffers in full on Apple GPUs. The doc marks the last as unverified.

<!-- review-gate
reviewed: README.md sha256:ba679f8fa576ae9b77928b80910deda8af75dfbb947f70c217f354c92aefee02
reviewed: costs.md sha256:4efcdd4c101073e22fc0d98b7438766a67fa8f19044d3414d5cccd79cf2573eb
reviewed: measurements.md sha256:fe7436a459c3907cda0904e0e4fcae5fa1d54af8ff2539c089aeca50c6fe0ee7
reviewed: precedent.md sha256:b05a9b24f434c6bdb035eefefbee10271529cd0a61742a35782a58d7ee53e0cb
reviewed: proposal.md sha256:cb2246ef656b9f89c43af369e4383e16e10296ec287bad69ef73f2e64b6d4956
reviewed: decisions.md sha256:a5c03311f8f9b12e830d5c7b4e18d07a09d5dd2ba7065df42092c07e786ce980
reviewer: claude-fable-5-2
covers: acquisition, transformation, results
finding 1: fixed
finding 2: fixed
finding 3: fixed
finding 4: fixed
finding 5: accepted no run changed a level live; the doc states it and withholds the recipe until one run confirms it
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
finding 16: accepted capture density between tiers and level pixels at scale 3 are stated as unverified
finding 17: fixed
-->
