# Review record: materials and lighting API proposal, revision after the second opinion

This record covers the revision that answers Fable 5.2's second-opinion review (/Users/petepetrash/Code/munari/.scratch/materials-api-fable-review.md, kept outside the repo).

## How the review ran

One Opus subagent reviewed the revision. It did not write the revision. It worked in three steps:

- acquisition: it read each probe's source against its raw output;
- transformation: it checked each table against the raw numbers;
- results: it checked each code claim against Munari, the materials-more lab, three 0.186.1 and R3F 9.8.1.

The raw output was in `.scratch/lights-probe` and `.scratch/presented-probe`, and both folders were deleted after the review. It raised 14 findings. All 14 were applied, and the reviewer then confirmed each fix. The confirmation pass raised findings 15 and 16, which were also fixed. The reviewer and the author are the same model, run as separate sessions.

## Findings

1. Scenes moved off `Surface.LitMaterial` would lose their own lights under a rig that lights finishes only. They now pass `lighting="none"`.
2. Each finish Surface costs its own node build, because nodes key on their own id. A third probe run confirmed this: three materials with their own uniforms built 3 times, and 3 again on a scene light toggle, with one pipeline.
3. Dividing the environment intensity by `lightGain` failed under `lighting="none"` and at a gain of 0, and the gain also scaled emission. The gain now scales light color inside the lighting model. Its behavior is marked unverified.
4. The escape-hatch example could not replace the normal, because the lab feeds one normal node to several terms. The hook now takes named inputs.
5. The presented probe's timing column was mislabeled. The first scene frame was not observed.
6. The live node moves between the page element and the source host. The doc described it as fixed.
7. The page behind the build-count table was not kept. It is now kept, and it was re-run with a frame wait. The counts matched.
8. A shared light handle with an omitted position disagreed across canvases, and `get` could not report it. The default is now relative to the viewport, `get` returns the resolved position, and `subscribe` calls its listener immediately.
9. The default key position had no reason. It now uses the lab's tuned 0.687 down, with the lab's reason.
10. The two-canvas example contradicted its text.
11. `surfaceSceneLookup.tsx` was missing from the rename list.
12. `WebGPURenderer` reports WebGL 2 context loss too.
13. The list of scenes with their own lights was incomplete.
14. Minor points: a mean of 4.47, the rim elevation's unit, velvet's environment raise and the `edge` default.
15. One sentence still said the probe used one plane.
16. One presented-probe read came during the transition. The doc had said every read came after it.

## Fable's claims that were declined or corrected

- Fable said removing `Surface.LitMaterial` without a deprecation alias would hurt users. Declined, because Munari has no users. The revision renames it outright.
- Fable said the softbox tables arrive by dynamic import, with nothing said about what draws first. The lab actually imports them statically (materialFinishesStudio.ts:39-43). The proposal plans a dynamic import, so the gap is real, and the revision makes the lift wait for the tables.
- Fable said Munari would write `--munari-body` on two wrappers it already owns. That holds with one detail: they are the page element and the source host, and nothing nests them, because `Surface.Root` renders no DOM.
- Fable listed four presented-state cases. The revision has five, adding the return to the page after renderer loss.
- Fable's list of scenes with their own lights was incomplete. Under a rig that lights finishes only, the gap does no harm.

The revision adopted Fable's other points:

- the finish on the Root;
- one source for the body color;
- the rig lighting finishes only;
- one number for the gain;
- fields grouped by layer;
- presets in the registry;
- the pointer light's lifecycle;
- the fix to the examples that set unlit text with no color;
- keeping the declarative light path for lights that change on a click.

<!-- review-gate
reviewed: naming-and-configuration.md sha256:4ce814d26cff86b07be0433312f413d0d9c9f2fa928a2f5d08c0a9d2ce7c0d87
reviewer: claude-opus-5-5 (a separate subagent that did not write the revision)
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

<!-- review-gate
reviewed: body-and-text.md sha256:2ce59d97143b8f485bc63f0d5f5e37f00e12b608bdaa70f5705951edbe5a4d9f
reviewer: claude-opus-5-5 (a separate subagent that did not write the revision)
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

<!-- review-gate
reviewed: lighting.md sha256:1b0f7e3d3385045c3f19ee6cf335e4d3adbb10b14934bbc85dec47bca8150762
reviewer: claude-opus-5-5 (a separate subagent that did not write the revision)
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

<!-- review-gate
reviewed: light-control.md sha256:bacd0adf49d734dfc2c840517b939efedc6bfaf002802e3307f3f07b2b04197e
reviewer: claude-opus-5-5 (a separate subagent that did not write the revision)
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

<!-- review-gate
reviewed: relationships.md sha256:069f75bb69bb3fe55ef52f4082da975f06dba98300bfb6ffa7df3d844f910bd1
reviewer: claude-opus-5-5 (a separate subagent that did not write the revision)
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

<!-- review-gate
reviewed: recommended-api.md sha256:19dcc2dd69badc6aa12ef55441aa99e62bfd46327d89daf55c1b56a0932b9d5a
reviewer: claude-opus-5-5 (a separate subagent that did not write the revision)
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
