# Open PR resolution

Status: complete, 2026-10-05.

Resolve the five open PRs against current `main`. Keep each revision in its
existing PR. Preserve the unrelated local performance audit.

| PR | Change | Acceptance |
| --- | --- | --- |
| #101 | Describe preparation borrowing for focused content or intersecting selection. | Wording agrees with `sourceNeedsLiveNode` and decision #63. |
| #102 | Retain the proposed lift-time motion description. | Wording agrees with motion holding and presentation evidence. |
| #103 | Remove the retired ease-flat recommendation and the added historical parenthesis. | Original measurements remain unchanged. |
| #104 | Close as obsolete. | Confirm `5be3183` already removed the only changed file. |
| #105 | Remove `springSettled`; retain the two settling tests with direct position and velocity limits. | Existing settling budgets remain enforced, including deliberate slow-spring faults. |

Refresh each retained branch from `main`. Review its complete remaining diff
before pushing. Update stale titles and descriptions to match the final change.
Keep review comments private unless publishing them is separately authorized.

For documentation changes, verify claims, references, and unchanged measurements.
For #105, run its focused suite, the required broader checks, and disposable
tuning faults. Do not retain the fault variants.

Obtain successful CI for each reviewed PR head before merging. Merge one PR at
a time, inspect the resulting `main` changes, and verify the final combined CI.
Remove the temporary worktrees when their changes are safely merged.

## Results

- #104 closed. Commit `5be3183` already removed its only changed file.
- #102 merged as `2cb1411` after all three CI jobs passed.
- #101 revised and merged as `84c7756` after all three CI jobs passed.
- #103 revised and merged as `e6087e9` after all three CI jobs passed.
- #105 retains both settling tests and removes the unused helper. Source and
  independent review passed. All 33 focused tests, typecheck, lint, and build
  passed. Each deliberate slow-spring fault failed its intended test. Full local
  runs encountered unrelated timeouts under heavy load; the affected tests passed
  separately. All three hosted CI jobs passed on the reviewed revision. Merged
  as `70fd423` on October 5.
- The final main tree exactly matches the reviewed PR #105 tree, including the
  three documentation merges. [Final main CI](https://github.com/petekp/munari/actions/runs/37337868524)
  passed on `70fd423`.
- No open PRs remain. The four temporary worktrees were removed. Unrelated
  changes in the original checkout were preserved.
