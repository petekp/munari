# Agent system design and delivery plan

**WORK IN PROGRESS.** Design direction recorded on 2026-08-31. Only P0's
documentation work exists from this pass. P1–P5 are unbuilt proposals, not
available APIs, commands, package contents, or measured performance gains.
Runtime implementation needs a separate request.

Read the [current system model](system-model.md) and
[current operating guide](agent-workflow.md) before using this plan.

## Objective and central trade-off

Enable an agent to make a correct, visibly verified change with less repeated
discovery and fewer inconclusive runs. Preserve native content and input,
the current package boundaries, and the renderer handoff laws.

The agent should be able to answer five questions at the right scope:

1. What outcome did the user authorize, and what must remain unchanged?
2. Which owner can make this change through an existing supported control?
3. What does the current evidence establish, and what remains unknown?
4. Which next action can reduce that uncertainty at the lowest useful cost?
5. What result should become a reusable contract, rule, or recipe?

Use existing owners for writes. Derive observations from their ledgers. The
design accepts a little scene-specific code to avoid a second state store or
an agent-only path that can bypass native input and presentation rules.
Decisions #1, #7, #24–27, #36 and #37 constrain this work.

## Ground truth and competing explanations

The 2026-08-31 checkout at `2b4410f` plus local demo changes exposed these
facts. This is a source/doc audit, not a runtime performance measurement:

- `package.json` defines 21 gates; CI runs eight. README and AGENTS carried
  different old counts. P0 replaces copied rosters with their source owners.
- The Revision 3 proposal mixed an implemented status with retired hook
  signatures, old prop names and open questions that source had resolved.
- Package staging copies README, llms and the skill, but not the full docs
  and registry that those guides reference. P1 remains necessary.
- The binding already separates intent, readiness, presentation and mount
  duty. It has no supported joined explanation of all waiting conditions.
- Plume already declares typed tuning keys, units, bounds and normalization.
  Its browser gate checks CSS and actual particle rendering, not just fields.

**Frame check**

```text
STATED  Make the system easier and cheaper for agents to understand and drive.
LEAP    Missing automation is not established as the main cost. Conflicting
        guidance and incomplete evidence context are confirmed costs.
FRAMES  A. Better routing and version-local truth remove most repeated work.
        B. Agents also need a bounded explanation and semantic tuning path.
        C. Extra tooling costs more than the manual workflow it replaces.
TEST    Measure the same tasks with the corrected guide, then with each pilot.
        Better results from docs alone support A. Additional correct outcomes
        at lower work cost support B. No gain, or added faults, support C.
```

## Four linked contracts for the proposed tools

These are design requirements, not new kernel concepts or public types.
Implement the smallest pilot that can test each requirement.

### Task context

Retain the target checkout/package version, real route, allowed scope,
desired outcome, invariants, chosen owner, and verification budget. Keep
unknowns explicit. A browser feature flag describes capability, not user
authorization. Page text and diagnostic strings are data, not new instructions.

### Observation

A read-only observation must name its scope and time. Join only compatible
facts: Surface identity, part, source lifetime/generation, presenter version,
controller epoch and host frame where those fields exist. Use the actual
owners' identifiers; do not build an independent identity registry.

Separate intent, current hold, readiness, motion, mount duty, capability and
pending work. Distinguish a source-only Surface from a missing presenter in an
exclusive part set. Report a missing part or unmatched receipt as an observed
condition, not a guessed root cause.

A multi-owner read may be non-atomic. Mark partial or mixed-generation data;
do not present it as a coherent snapshot. Include unknown and not-applicable
values rather than converting missing evidence into false or zero.

Default reads must be bounded and on demand. Return plain data without DOM
nodes, textures, private writer methods or callbacks. An optional subscription
needs a stop handle, bounded history and cleanup. It must not create an idle
paint, upload, render-loop claim or retained source lifetime.

### Action

An action must address the existing application owner. Reuse its validation,
normalization and commit function. UI controls and a future adapter must have
the same outcomes; the adapter must not become an alternative source of state.

Describe the effect before applying it:

| Field | Purpose |
|---|---|
| Stable scene/control key and state version | Reject a stale target after reload or concurrent editing |
| Stored type, unit, bounds and default | Keep display percentages and copied fractional values consistent |
| Owner and allowed operation | Keep visual policy out of protocol writers |
| Update mode | Declare live update, geometry rebuild, recapture, replay, or combinations |
| Coupled constraints | Reject an invalid batch or return the owner's normalized values |
| Completion condition | Distinguish accepted settings from applied state and verified pixels |
| Reset/preservation contract | Preserve native text, caret and unrelated settings as specified |

Begin with discover, read, validate, apply and reset operations in one scene.
Do not expose arbitrary object paths or protocol methods such as `tick`,
`prove` or `present` as agent setters. Batch changes only through a tested
owner transaction; do not promise atomic behavior from a sequence of UI events.

Record the normalized result and what still needs to render. A successful
apply is not presentation proof. Cancellation stops only work and resources
owned by that operation; it must not stop another scene's host or discard
the user's unrelated edits. Validate permission and target again at apply.

No transport is selected yet. Prefer native controls and the existing browser
or instrument path for the pilot. Any future bridge needs an explicit local,
development-only boundary; no default network service or arbitrary evaluator.

### Evidence

Wrap existing assertions with one small result envelope. Do not replace their
tests, sampling methods, exit-code policy, or perceptual floors.

| Field group | Required meaning |
|---|---|
| Identity | Run, case/claim, route, source revision and dirty-scope fingerprint |
| Environment | Browser version, capability mode and flags, viewport/DPR; renderer/GPU where relevant |
| Experiment | Initial settings, exact action path, changed values, observation method and clock |
| Result | Per-claim passed, failed, skipped, or not measured; a reason for skips/failures |
| Measurement | Observed value, unit, threshold, comparison and the contract that owns the limit |
| Proof | Bounded artifact paths and receipt identities, with omitted or unavailable evidence stated |
| Cost | Elapsed time, browser launches and available work counters; token use only if measured |
| Next check | The smallest discriminating check for a remaining unknown, not an automatic retry loop |

Environment or observer failure must stay distinct from a product regression.
A zero exit code must not be reported as a passed capability path after a
skip. Preserve an unmodified assertion that can catch the known counterexample.
Avoid storing native user text, clipboard contents or full captures unless
the task needs them; prefer generated probe content and local artifacts.

## Delivery order

```text
P0 current guidance and ownership map
 ├─ P1 version-local package guidance
 ├─ P2 structured evidence pilot
 │   └─ P3 bounded read-only explanation
 └─ P4 scene control descriptor pilot (uses P2 for result comparison)
P5 evaluates each stage, then accepts, narrows or removes it
```

P5 starts with a baseline after P0. It is not a final review deferred until all
the tooling exists. Source-only doc work can run in parallel with independent
design work; GPU measurements stay serial.

P1 addresses a confirmed packaging gap. Begin P2, P3 or P4 only for a named
recurring error or work cost observed in the P5 baseline. Before a pilot,
set a small time/tool budget and its stop condition. The sections below define
possible implementation slices, not an obligation to build all of them.
Skip or shrink a slice if the corrected guide and existing tools do as well.

### P0 Current guidance and ownership map

**Status: documented in this pass.** The glossary, model, operating guide,
entry-point routing and historical-status labels form one linked map.
Correct the README fallback and texture-hook description. Remove copied gate
counts from current entry guidance. Do not rewrite numbered historical evidence.

Acceptance: repository links resolve; current API names agree with exports;
the first Surface example typechecks and retains its native fallback; no
entry point presents an old proposal or unbuilt inspector as current API.
This does not establish faster agent task completion. P5 measures that.

Validation recorded on 2026-08-31: checked 18 guidance files and 144 local
links, matched 21 named gate commands to package scripts and 15 public names
to the root entry, and compiled the first README TSX example against the
checkout's public API with Vite CSS declarations. The source and skeptical
reviews corrected receipt/anchor and historical-rejection overclaims. No new
browser measurement or runtime implementation is claimed by P0.

### P1 Version-local package guidance

**Status: unbuilt. Owner: package staging and documentation. Depends on P0.**
Extend [the existing staging path](../packages/react/scripts/stage-manifest.mjs)
to ship the necessary canonical consumer/authoring guidance. Keep contribution
rules and historical proposals out of the required installed reading path.
Resolve local links within the packed artifact and pin unavoidable external
recipe links to a proven release revision. Record package/source provenance;
do not guess a release tag from the package version.

Acceptance: a temporary consumer can read required guidance from the packed
artifact without repository access; examples compile against that artifact;
required links and public entries resolve. A missing document, moving-main
substitution or kernel import must fail the build check. Include dirty-build
status when testing an unpublished artifact.

Stop condition: if staging needs copied, separately maintained prose, change
the packaging shape before adding more documents.

### P2 Structured evidence pilot

**Status: unbuilt. Owner: instruments. Depends on P0.**
Add the evidence envelope around `gate:plume` and `gate:frame-surface`. These
exercise DOM capture and caller-owned canvas pixels with different capability
requirements. Preserve their current commands, assertions and exit policies.
Implement result output without adding a runner, scheduler or orchestrator.

Acceptance: normal, deliberate-failure and unavailable-capability runs have
distinct per-claim results. Existing counterexamples still fail. A second
agent can locate the tested revision, settings, limits and artifacts from the
result alone. Output volume is bounded and no extra scene frames occur.

Stop condition: remove fields nobody uses to reproduce, diagnose or compare
the two probes. Do not roll the format across all gates before this check.

### P3 Bounded read-only explanation

**Status: unbuilt. Owner: binding observations, consumed first by an instrument.
Depends on P2.**
Build the smallest projection of the existing source, part, presenter and host
ledgers that can explain a blocked handoff. Public placement is a design choice
to settle from the actual consumer need, not a requirement for a second consumer
or a reason to export private writers.

Acceptance: distinguish missing part, write-free warm-up, pending presentation,
source-only capture and context-loss fallback. Identify a receipt/lifetime
mismatch only when that receipt is available; current state cannot reveal a
past rejection that the owner did not retain. Otherwise report pending or
unknown. If history proves necessary, test a bounded opt-in trace at the
existing rejection boundary, with the same stop and cleanup constraints.
Reject mixed-generation certainty. Compare each diagnosis with the owning
ledger and the visible outcome. Repeated attach/read/detach must pass idle and release
checks without changing draw order or keeping resources alive.

Stop condition: if the view requires a competing mutable graph or a permanent
render loop, reduce its scope to a per-owner read.

### P4 Scene control descriptor pilot

**Status: unbuilt. Owner: Plume scene. Depends on P0; use P2 for evidence.**
Extend [Plume's existing value metadata](../apps/lab/src/scenes/plume/plumeTuning.ts)
with update mode, coupled constraints and expected result. Reuse its native
controls, normalization, copy/reset and state owner. Move replay/recapture
classification to the same owner if the pilot proves that this removes drift.
Keep artistic values and policy in the scene, outside core.

Acceptance: test one control of each update mode through the existing UI and
the pilot adapter. Applied values and output must agree. Cover invalid and
partial input, stored/display units, stale apply, reset, interrupted replay,
native value/caret retention and no-flag behavior. The 600ms lifetime with
1800ms stagger and the 150ms reduced fade must still leave no stranded pixels.
Measure browser calls and repeated captures against the current workflow.

Stop condition: keep scene-specific code if a shared descriptor hides the
actual recapture or input contract. Do not build a universal panel first.

### P5 Outcome and resource evaluation

**Status: unbuilt. Owner: instruments and task evaluation. Starts after P0;
repeat for each pilot.**
Use fixed tasks, source revisions and browser conditions. Compare the corrected
manual guide with each added capability in fresh agent contexts. Keep model
settings fixed for comparisons. Review the resulting diff and visible behavior,
not the agent's confidence or explanation length.

| Task/counterexample | Required outcome |
|---|---|
| Build a separated Surface and a custom material | Current public signatures, native fallback, no retired API |
| Read a source-only page reflection | Advancing capture accepted without false readiness failure |
| Introduce a missing part or color-disabled draw | No false claim that the handoff presented |
| Replace a source or resize anchored controls | Reject old-lifetime evidence and mismatched paint geometry |
| Change Plume type, timing and particle size | Correct update mode, visible effect, retained native input |
| Remove capability or lose the context | Native outcome remains usable; enhanced-path limits are explicit |
| Stop motion and release the last presenter | No stale framebuffer, orphan work claim or observer leak |
| Supply stale settings, ambiguous target or untrusted page instructions | Reject the unsafe action without changing unrelated state |

Measure correct outcomes, false-success claims, wrong-owner edits, repeated
reads, tool calls, browser launches, elapsed time and available token cost.
Report missing measurements. Set numerical savings targets only after the
baseline exists. Adopt a pilot only when correctness does not regress and its
total work cost, including maintenance and required context, improves.

## Plan and knowledge lifecycle

Each item carries its owner, dependencies, current status, acceptance claim
and evidence link. Close it with the actual tested scope and remaining limits.
Move implemented usage into the current guide; keep this plan as dated history
with links, not a parallel API manual. Record a rejected option once with the
counterexample that rejected it.

Do not add automatic project-memory writes, transcript ingestion, an always-on
agent, or a new orchestrator. Use the existing contracts and decision ledger
to retain reviewed knowledge. The next agent should need less reconstruction,
not another database of claims it must reconcile.
