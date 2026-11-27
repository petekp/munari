# Review of docs/idle-render.md

<!-- review-gate
reviewed: idle-render.md sha256:c5ea7264ac17a1af5593e89879adbaf85fd418f81d216de487cc036163c00c08
reviewer: claude-sonnet-5-5
covers: acquisition, transformation, results
finding 1: fixed
finding 2: fixed
finding 3: fixed
finding 4: fixed
finding 5: fixed
finding 6: fixed
finding 7: fixed
finding 8: accepted: no run without timestamp queries was made; the doc states the overhead and its direction as a limit
finding 9: fixed
finding 10: fixed
finding 11: fixed
finding 12: fixed
finding 13: fixed
finding 14: fixed
finding 15: fixed
-->

One subagent (Sonnet 5.5) that did not write the doc reviewed it read-only, in four passes. The last pass confirmed that trimming the doc under the repo's 5,000-token file limit dropped nothing a finding relied on. It read the probe code, the raw results in `.scratch/results/` and the package, registry and lab code. It recomputed the medians and ranges from the JSON. It found no frame source missing from the package table.

Every cell of the cost and fixture tables matched the JSON. The lab-scene half of the first draft did not hold up.

| # | Severity | Finding | Change |
| --- | --- | --- | --- |
| 1 | blocker | "The other seven unset scenes need no change" was untested. Candidates and Selection depend on `"always"` and say so in comments (`Candidates.tsx:16-18`, `Selection.tsx:405-407`); the sweep never triggered their animations. | Fixed. Both are listed as stalling, and every unset lab file is pinned to `"always"` in the migration. |
| 2 | major | Crystal drew 86 frames in the idle window, not 0–8, and fails to compile in every mode. The activity counts are per window, not per second. | Fixed. Crystal is marked as failing to compile; counts are per window of about 2.3 s. |
| 3 | major | FinishDemo sets `"demand"` through `finishDemoRecipe.ts:79`, so it is not an unset scene. | Fixed. |
| 4 | major | Making `useCarriedMotion` request frames would draw Logo every frame; the MarbleHand `"always"` choice was unjustified. | Fixed. The cost is stated, and MarbleHand is pinned to keep today's behavior, with pointer-driven invalidation noted as a cheaper later option. |
| 5 | major | Headline ranges used the forced-`"always"` column instead of today's, left out Optics, and ignored run noise of up to 24%. | Fixed. The table shows today's rows; the noise is stated. |
| 6 | major | The bench calls `getCurrentTexture` twice per frame, so "120 frames/s" was really 60. | Fixed. Frames are counted from GPU passes; the double call is explained. |
| 7 | major | Idle costs were attributed to the placement watcher, KnobsArt and the wordmark beyond what the profiles show. | Fixed. Only profiled shares are attributed; the wordmark figure is corrected to 220 ms/s. |
| 8 | minor | Every row ran with timestamp queries on, which adds work. | Accepted as a stated limit with its direction. |
| 9 | minor | The default belongs in the outer prop destructuring (`SurfaceCanvas.tsx:499`), not at `:280`. | Fixed. |
| 10 | minor | Under a `"demand"` default, each work-claim edge would restart R3F's clock. | Fixed. Added as a package gap and a migration step, marked inferred from code. |
| 11 | minor | The second draft counted seven unset files; `CandidateCopy.tsx` only holds a snippet string. | Fixed. Six files. |
| 12 | minor | The opening said three package fixes while the decision said four. | Fixed. |
| 13 | minor | The 120 Hz display claim had no source in this run. | Fixed. Marked as not checked in this run. |
| 14 | minor | KnobsArt was described as regenerating every frame without reading its loop. | Fixed from `KnobsArt.tsx:26-75`. |
| 15 | minor | The glint consequence was stated as a result of the default change, though Knobs stays `"always"`. | Fixed. Reworded as a hazard of converting Knobs. |
