# Review record: softbox download size

This record covers `docs/softbox-size.md`.

## How the review ran

One Opus subagent reviewed the write-up. It had not run the measurements or
written the doc. It read the probe sources, the prototype code, and three
0.186.1. Then it recomputed every number in the doc from the raw output copied
from m2: `results.json`, `timing.json`, `size.log`, `ltcTables.log`,
`pixels.log`, and both payload logs. Those copies live in the worktree's
ignored `.scratch/softbox-logs`.

The reviewer found no mismatched numbers. It raised 13 findings: one unsupported
attribution, and the rest wording and context. All 13 were fixed, and the reviewer
confirmed each fix. Its confirmation pass raised one more wording problem. The
reviewer supplied the corrected sentence, which was applied, and confirmed the
final text. The reviewer and the author are the same model, run as separate
sessions.

## Findings

1. The doc credited most of the prototype's 1,285 B to the representative shader without measuring the split. It now gives the 1.20 kB loader module and says the split was not measured.
2. The bundle cost left out the deferred bytes (+48,076) and that the base commit is already over the surface budget. Both are stated now.
3. Sizes and the network estimate used gzip only. Brotli figures are in the table, the intro (44%) and the estimate.
4. The limit called the float16 device case unmeasured, but the committed 64 × 64 tables equal three's half-float tables bit for bit. The reviewer and the author each checked all 24,576 values independently.
5. The representative row said 0 B. Its shader code ships in the entry chunk, and the row says so now.
6. The doc said "under 5/255"; the measured maximum is 5. It says "at most 5/255" now.
7. The intro named only metal and foil for the 32 × 32 tables. Lacquer, polymer and ceramic are named now.
8. "Visibly" was not measured. The intro states the threshold instead.
9. The doc called LTC_Evaluate exact and misdescribed the specular point. Both are corrected.
10. The probe waits for three identical screenshots, not two. Fixed in the doc and in the pixels.mjs comment.
11. The timing order is fixed per run, three's tables first. It is a stated limit now.
12. The pixel run does not check directly that the representative path ran. It is a stated limit, with the indirect evidence.
13. The 32 × 32 fit's 640% relative error was missing. Added.
14. Two later wording edits were reviewed: one word ("aluminum") and the brotli wording in the method list. The reviewer corrected the method-list sentence, and it was applied verbatim.

## What the reviewer checked and found sound

- Every cell of the results table and every number in the bullet lists against `results.json`.
- Timing medians and percentile ranges against `timing.json`, n = 20 per source.
- Chunk sizes against `size.log` and the payload gate's deferred bytes.
- The branch's `three` option draws as main does. The `softbox` parameter applies before the first table load.
- The probe waits for the decode mark before capturing, and the key moved the cards on every load.
- The lighting model reads only the six stored channels. The encoder and decoder agree on layout.

## What stays unchecked

- The card rectangles were measured once, on the first preset.
- The 404 on the first load was not identified.
- The base payload log records no commit hash. It came from `git checkout 608c147 -- packages/react` on m2.

<!-- review-gate
reviewed: softbox-size.md sha256:a6fc1bb874a70461b0d0fdfc93906bb90ab310c5de0368e6dfe19c33781b0cc2
reviewer: claude-opus-5-5 (independent subagent, separate session)
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
-->
