# Browser gate recording implementation plan

Status: implemented and locally verified against current `main`. Publication
is authorized; hosted acceptance remains pending the resulting GitHub Actions
run.

Build one recording module for the Genie restore and pose flash gates. It will
own Chrome recording, acknowledgement draining, image decoding, page-frame
identity, and resource cleanup. Each gate will retain its scene actions, visual
judgments, observation interval, controls, and retry limits.

The goal is locality: a recording fix should have one implementation. The
interface should give both callers leverage over a complete recording without
making them manage Chrome protocol or browser handles.

This plan follows the [completed spike](spikes/2026-10-02-browser-gate-recording.md).
The spike established local feasibility for both capture engines and formats.
It did not establish full-default or hosted reliability, direct listener removal,
or browser-handle release on every exceptional exit.

The inspected revision is:

```text
1a201fd307be0f2447f548c8318248e06dfec47f
```

Recheck the implementation and working tree before starting. Preserve the
unrelated performance audit and any concurrent work.

## Design and contracts

**Choose a recorder plus a bounded scorer.** Restore repeats recordings on one
page. Pose creates a page per attempt. A recorder can support both lifetimes while
leaving their existing scenario code imperative. A combined action-and-judge
facade would add callbacks and acceptance policies around that code. The two
current callers do not require that extra interface.

Use a fresh Chrome DevTools Protocol session for each recording cycle. The
recorder keeps its page and clock across restore attempts. Closing each protocol
stream gives late frames a clear owner. This improves on the spike's reused
session, and needs separate verification.

**Scope and ownership.**

| Owner | Responsibility |
| --- | --- |
| New recording module | Protocol session, listener, recording lifecycle, acknowledgements, frame ordering, decoding, bounded batches, browser handles, diagnostics |
| Existing coverage module | Pixel clock encoding and decoding, pure page-frame coverage law, typed incomplete-coverage error |
| Restore gate | Minimize and restore actions, desk reference, changed-pixel judgment, flash versus arrival, native-ride checks, control and attempt policy |
| Pose gate | Fixed reference pose, real mouse input, draw marker, geometry comparison, pixel mismatch, presentation interval, control and attempt policy |
| Gate runner | Page and browser lifetime, existing output artifacts, deadline, process exit status |

Chrome is the only transport adapter. PNG and JPEG are real decoding variations.
Keep their implementation behind the recording seam. Add no transport port,
backend registry, dependency, or general gate framework.

The extraction covers these two gates and their recording helper. Package
exports, kernel and binding behavior, scene behavior, browser launch flags,
existing command names, and CI membership remain outside this change. A workflow,
runner, deployment, or release-tool change requires separate explicit approval.

**Files.**

| File | Planned change |
| --- | --- |
| `tsconfig.json` | Enable exact TypeScript import extensions for the typed Node helper; approval required before changing shared compiler policy |
| `instruments/screencastRecording.ts` | New typed recording module and browser scorer implementation |
| `instruments/screencastCoverage.ts` | Preserve coverage law and clock pixels; add an owned browser clock scope for cleanup |
| `instruments/genie-drain/restore-flash.mjs` | Replace local collection, acknowledgement, sorting, decoding, and batch coordination |
| `instruments/genie-drain/pose-flash.mjs` | Replace local collection, acknowledgement, sorting, decoding, and clock recovery |
| `instruments/screencastRecordingCheck.mjs` | Directly runnable real-Chrome checks of the measurement module |
| `instruments/screencastCoverage.test.ts` | Retain existing coverage-law checks |
| `instruments/README.md` | Document recorder checks and the two migrated gate contracts |
| `docs/decisions.md` | Add measured implementation evidence to decision #2 without changing its limits |
| This plan | Record stage status and acceptance evidence during implementation |

TypeScript brings the helper into the existing root typecheck. Node requires the
helper to import its TypeScript dependency with an exact `.ts` extension. The
current root checker rejects that spelling. A local compiler check reproduced
this restriction.

The recommended prerequisite is `allowImportingTsExtensions: true` in the root
configuration, which already uses `noEmit`. This changes accepted import spellings
across that program. Obtain explicit approval for this shared compiler change
before applying it. An unchecked JavaScript helper loses the intended typechecking;
a loader, build step, or compatibility module adds unnecessary process. No
package-script or workflow changes are needed.

**Instrument interface.** The names below are internal instrument names, not
published package exports.

```ts
const recorder = await createScreencastRecorder(page, captureOptions)
let failure: { error: unknown } | null = null

try {
  await recorder.start()
  await runExistingGateScenario()
  const collectionEnd = await page.evaluate(() => performance.timeOrigin + performance.now())
  const capture = await recorder.stop({ through: collectionEnd, timeoutMs: 5000 })
  const scored = await scoreScreencast(page, capture, {
    reference,
    selectedIndices,
    context,
    createScorer,
  })
  assertExistingGateContract(scored)
} catch (error) {
  failure = { error }
} finally {
  try {
    await recorder.dispose()
  } catch (cleanupError) {
    if (failure === null) {
      failure = {
        error: new AggregateError(
          [cleanupError],
          `Cleanup failed: ${String(cleanupError)}`,
          { cause: cleanupError },
        ),
      }
    } else {
      const primaryError = failure.error
      failure = {
        error: new AggregateError(
          [primaryError, cleanupError],
          `${String(primaryError)}; cleanup failed: ${String(cleanupError)}`,
          { cause: primaryError },
        ),
      }
    }
  }
}

if (failure !== null) throw failure.error
```

A **recording** is the ordered set of encoded Chrome images collected for one
attempt. A **page frame** is the page's numbered animation-frame update, recovered
from the clock strip in each image. An **observation interval** is the time range
for which a gate requires complete recorded evidence.

| Value | Required contents and meaning |
| --- | --- |
| Capture | Encoding, immutable frames, collection-end observation, protocol diagnostics |
| Frame | Stable original index, finite epoch-millisecond timestamp, encoded image |
| Collection end | Requested timestamp, whether an image reached it, and any timeout; it describes acquisition, not a visual verdict |
| Scored recording | One row per selected image, scene summary, decode diagnostics |
| Scored row | Original index, timestamp, recovered page-frame ID or null, and a separate scene value |
| Scene value | Gate metrics, or null before pose presentation starts; null never removes coverage identity |

Store encoding with the capture. Do not require a separate format argument that
can contradict it. Keep reference selection explicit: a restore reference names
an original recorded frame; a pose reference supplies its independently captured
PNG. Restore may select its final pre-press reference and subsequent images for
scoring. Pose uses the default selection of all images. Selection preserves
original indices for artifact lookup; reject duplicated or unknown selections.

Return explicit result objects. Do not attach errors or diagnostics to arrays.
Separate module metadata from scene values so a scorer cannot overwrite time,
index, or page-frame identity. Keep runtime validation of external protocol data
at ingestion; use the installed Puppeteer and protocol types.

**Browser scorer contract.** Replace the spike's separate preparation callback
and zero-argument scoring factory with one self-contained browser factory:

```ts
type CreateScorer<Context, Metrics, Summary> = (
  referenceImage: DecodedImage | null,
  context: Context,
) => {
  inspect(image: DecodedImage, frame: RecordedFrameMetadata): Metrics | null
  summarize(): Summary
}
```

`DecodedImage` contains a browser-local 2D context and image dimensions.
`RecordedFrameMetadata` contains the original index, timestamp, and recovered page
frame. Metrics and summary values must be compact serializable data.

The module decodes the reference once, creates the scorer once, and retains both
through all batches. The factory receives context once. It must contain the code
it needs because Puppeteer executes it in Chrome. It cannot close over Node
variables. The helper owns the browser handles and releases them in `finally`.

Keep full pixel arrays, reference pixels, maps, and presentation state in Chrome.
Return compact scene metrics to Node. Use browser handles rather than source-string
evaluation or new scorer globals. The fixed batch limit remains eight images,
matching the existing restore mechanism and spike. Do not expose a tuning option
solely for tests. Record actual batch sizes and encoded payload bytes.

This bounds decode messages, not total recording memory. Preserve recorded images
for verdicts and artifacts. Keep the existing gate deadline. Do not introduce a
ring buffer that silently drops evidence or invent a memory threshold without a
measurement that requires one.

**Lifecycle.** The recorder has idle, recording, stopping, and disposed states.

1. Construction establishes one clock scope for the page.
2. Start creates a fresh protocol session and listener, then starts recording.
3. Stop continues accepting and acknowledging delivered images through the stop
   response. It drains pending acknowledgements before removing the listener and
   detaching the session.
4. Stop returns an immutable capture. The next cycle gets fresh frame storage and
   indices; it cannot mutate the previous result.
5. Disposal is idempotent. During stopping it joins the pending stop rather than
   issuing another command. It settles endpoint waiters, releases owned resources,
   and leaves no scheduled recorder work.

Construction must undo a partial clock installation itself, because no recorder
has yet been returned to the caller. A rejected start must remove its listener,
detach its newly allocated session, and return the recorder to idle while
preserving the initiating error. Cleanup failure is terminal and makes the
recorder unusable.

Starting during a recording or stopping, stopping while idle, and using a disposed
recorder are terminal misuse errors. Concurrent recording on the same page is not
supported by the two current callers.

Extend the existing clock installer to return a browser-local scope with `read`
and idempotent `dispose`. Preserve its strip positions, encoding, checksum, and
current read hook. Disposal cancels its animation-frame callback and animation,
removes its marker and strip, and removes only the hook it owns. Existing direct
installer callers can ignore the returned scope and retain their page lifetime.
The two migrated gates stop installing the clock themselves. The recorder owns
one clock for its page and removes only that scope. Conflicting clock ownership
is an instrument setup error. No sharing mode, reference counting, or page-wide
registry is required by these callers.

A navigation or destroyed execution context during recording is a terminal
instrument failure. Use the caller sketch's error ordering throughout recorder
rollback and gate teardown:

| Failures observed | Required result |
| --- | --- |
| Scenario, scorer, or assessment fails; cleanup succeeds | Rethrow the original value unchanged |
| Primary work and cleanup both fail | Throw an `AggregateError` with the primary value first and retained as its cause; include both failures in the message |
| Only cleanup fails | Throw a terminal `AggregateError` retaining the cleanup value as its cause |
| No failure | Continue with the assessed result |

Track presence separately from the thrown value so even `throw undefined` is
preserved. Cleanup errors must never replace the primary failure. They also must
never enable a retry: even an incomplete-recording primary failure becomes
terminal when cleanup fails. The aggregate message must retain both descriptions
through the gates' existing string-based error reporting.

Apply this policy to recorder construction, failed starts, scoring-handle release,
recorder disposal, and page/browser teardown. Bound waits with the existing gate
deadline and protocol timeout; do not leave acknowledgement or endpoint promises
pending.

**Verdicts and deadlines.**

| Observation | Required handling |
| --- | --- |
| Observed mismatch against the case's expected pixels or control behavior, wrong geometry, unexpected native ride, or page error | Terminal gate failure, including when other evidence is missing |
| First pose presentation exists but no later distinct known draw marker is recorded | Typed incomplete observation, after checking the observed images against the case's expectations |
| Missing page frame or required interval endpoint | Typed incomplete coverage; caller may retry within its current limit |
| Malformed image, invalid timestamp order, unreadable required clock, backward required clock, or protocol failure | Terminal instrument failure |
| No image reaches an optional extra collection tail before its deadline | Return partial frames and diagnostic timeout; judge the required interval independently |
| Restore control flash is recorded in partial evidence | May establish sensitivity under the existing control rule |
| Restore control flash is absent with complete evidence | Terminal control failure |

Score existing evidence before evaluating retry eligibility. Keep the current
coverage function as the law for required intervals. An unreadable clock outside
an interval must not acquire a stronger claim than the current law gives it.

The required restore interval is press through final arrival. A scored restore
that never arrives remains a terminal missing-arrival failure. Coverage retries
apply to missing images at known interval bounds, not to that visual outcome.

The required pose interval starts at its first recorded presentation and ends at
the later of 80 milliseconds or its second recorded draw. The second draw must
appear in a later recorded image with a known marker distinct from the first
presentation's marker. It may have color writing disabled: the later-blank control
needs that suppressed-write evidence.

If no second distinct marker is recorded, the interval is incomplete. An 80 ms
sequence showing only the first marker cannot pass, even with consecutive page
frames and correct pixels. Remove the current zero fallback for a missing second
draw. A draw listed only in scene metadata does not satisfy recorded evidence.

Judge observed images against the case's expectations before classifying missing
second-draw evidence. Stale and blank controls intentionally differ from the
native reference. For the later-blank control, check the first image and each
observed image's correspondence with its suppressed-write marker first. When no
second marker exists, defer only the assertion requiring a captured later
suppressed write. Once a second marker exists, that control assertion remains
mandatory; failure is terminal.

After the case judgments pass, assess the known mandatory first 80 ms with the
existing page-frame coverage law. Do this before classifying an absent second
marker. When that minimum interval is recorded, an unreadable or backward required
clock remains a terminal instrument error. Preserve the coverage law's existing
error ordering when its bounds are missing, and its limits outside the interval.

A complete first 80 ms still does not establish a complete pose observation. If
its second marker is absent, report typed incomplete observation and use only the
existing retry limit. A recorded case mismatch or required-clock error cannot
become a retry because the second marker is absent. When the second marker exists,
require coverage through the later of 80 ms or that recorded draw.

Waiting for a newer image at the end of an extra collection tail cannot invalidate
an already complete required interval.

## Implementation sequence

**Stage 1: establish the baseline and ownership.**

Confirm the checkout, revision, dirty files, and implementation branch. Read the
current gate contracts before copying any spike code. The archived prototype is
an experiment reference. Build the production module against current sources.

Confirm approval for the shared compiler prerequisite. Do not apply it while that
approval is pending. Baseline recording and other unaffected preparation can
continue.

Capture full-default baseline results for pose and JPEG restore, plus reduced PNG
restore compatibility. Log each command and its own exit status. Establish the
actual engine and discovered case count. Use those same settings for post-change
comparison. Preserve existing tolerances and attempt limits.

Stage exit: the baseline is recorded, any pre-existing failure is identified, the
planned file scope matches the current sources, and the compiler prerequisite is
approved.

**Stage 2: implement the owned recorder and scorer.**

Apply the approved compiler option and verify native loading plus the existing
typecheck. Implement typed capture and scored-result values. Add fresh-session acquisition,
frame validation, acknowledgement tracking, partial capture results, and explicit
cleanup. Add the owned clock scope. Implement browser-local decoding and scorer
state across fixed-size batches.

Keep the coverage law in its current module. Avoid duplicate helpers, compatibility
aliases, public exports for test access, and fixture-specific fault flags. Every
new operation must serve restore or pose. Comments explain resource ownership,
serialization constraints, or failure ordering that code alone cannot show.

Stage exit: real-Chrome module checks prove ordinary acquisition, bounded decoding,
partial evidence, repeated cycles, and cleanup. The factory is simpler than the
spike's two-callback contract and the gates no longer need browser-handle knowledge.

**Stage 3: migrate restore.**

Replace its persistent anonymous frame listener and per-trial raw-array reset.
Use recorder cycles for the existing control and healthy attempts. Replace the
batch loop and repeated reference decoding with one scorer factory. Preserve the
desk crop, RGB delta threshold, changed-pixel threshold, arrival order, native-ride
measurements, and existing result reporting.

Remove the post-stop sleep. Keep existing scene preparation and observation waits;
this extraction is not permission to retune them. Keep flash-control acceptance
and healthy-round retry accounting explicit in the caller. Close the recorder
before closing its page on success and failure.

Stage exit: full-default JPEG restore and reduced PNG compatibility pass on both
engines, including the real one-page-frame flash controls.

**Stage 4: migrate pose.**

Replace per-attempt collection and its unbounded decode payload with the shared
module. Keep the native reference pixels, draw-ID lookup, and presentation-start
state in one scorer closure across batches. Return native ink and sample area in
the scene summary instead of repeating them on every row.

Preserve first-draw identity, every-image scoring after presentation, fixed native
pose, five-point placement, bidirectional pixel mismatch, and all four controls.
Continue judging blank and page-held images after presentation begins. Preserve
original indices for first/last scene artifacts. Keep retries and page errors in
the existing attempt loop.

Replace the missing-second zero fallback with the required recorded-marker check.
Keep the per-image later-blank judgments before incomplete classification; require
its captured suppressed-write evidence once a second marker exists. Preserve the
existing coverage-law assessment of the first 80 ms before reporting a missing
second marker. Preserve all pixel and geometry budgets. Record this enforcement of the existing second-draw
requirement in decision #2 and the instrument guide.

Stage exit: all sixteen default cases are discovered and pass with unchanged
thresholds and controls. Disposable checks through the actual assessment prove
that a first-marker-only recording stays unverified, observed mismatches fail,
and a captured suppressed-write second marker remains eligible control evidence.

**Stage 5: consolidate evidence and documentation.**

Remove superseded acquisition, acknowledgement, decoding, sorting, and batch code
from both gates. Check the deletion test: those responsibilities now have one owner.
Do not retain a second selectable implementation. Preserve gate-specific scoring.

Document lifecycle, reference ownership, interval coverage, collection-tail
semantics, diagnostics, and the direct recorder check in the instrument guide.
Amend decision #2 with dated measurements and the runnable checks that produced
them. Keep its existing visual limits and coverage law. Update the operating guide
only if the task-to-check route changes. Keep the spike as historical evidence.

Stage exit: required local checks pass and the focused hosted gates pass on the
exact implementation commit. Record broader hosted results and remaining limits
in this plan. An external failure leaves the affected acceptance claim open.

## Verification and completion

**Test ownership.** Retain the existing coverage suite. It already protects gaps,
missing endpoints, timestamp order, unreadable clocks, and backward clocks. Do not
replay those numeric laws in a second suite. Add fast tests only for a distinct
pure contract introduced by the implementation. Do not invent test-only exports.

The recorder checks below are retained contracts of a shared measurement module.
Its existing coverage suite cannot exercise decoding or resource lifetime.

The new recorder check uses real Chrome and lives under `instruments/`. Invoke it
directly during local acceptance. Do not put browser launches into the fast Vitest
suite or add CI membership without separate approval.

| Durable recorder check | Future failure caught | Independent evidence |
| --- | --- | --- |
| Multiple decode batches | Images omitted, repeated, or reordered | Known encoded image identities and exact original index sequence across at least three batches |
| Reference and scorer lifetime | Reference decoded differently or presentation state reset at each batch | Known reference pixels and a continuing observable sequence |
| PNG and JPEG clock decoding | Codec or scaling corrupts frame identity | Independently encoded strips with known IDs and color samples |
| Partial capture on deadline | Stop discards evidence before judgment | Actual Chrome capture with an unreachable endpoint retains images and a timeout |
| Acknowledgement draining | Stop leaves protocol work pending | Actual receipt and acknowledgement accounting agree and pending acknowledgements are zero after stop and disposal |
| Protocol interruption | A closed session becomes a retry or leaves resources behind | Destroy an actual owned session or page during capture; observe a terminal failure and cleanup |
| Construction and start failure | Partially installed clock or allocated session survives rejection | Failed construction rolls back its clock; failed start removes its session, listener, and waiters while the valid recorder keeps its clock until disposal. Preserve the initiating error |
| Repeated cycles and late delivery | Previous recording enters the next attempt | Distinct rendered identities, fresh actual sessions, immutable earlier captures; record whether late delivery was observed |
| Listener cleanup | Closed session hides a retained callback | Forwarding observer retains the real session; its actual listener count returns to baseline while the page stays open |
| Primary failure plus cleanup failure | Disposal hides a scenario/scorer failure or makes a cleanup failure retryable | Execute the actual gate error path for primary-only, cleanup-only, and combined failures; preserve primary cause and error order, include both descriptions, and reject retries for cleanup failures |
| Browser-handle cleanup | Reference or scorer leaks on success or exception | Keep the page and owning execution context alive; real remote object IDs are usable before disposal and rejected afterward, or prove equivalent release with a real heap query. Cover success, malformed decode, factory failure, and scorer failure |
| Clock cleanup | Marker animation or callback survives disposal | Actual marker removal, cancelled owned animation, removed owned hook, and a replacement recorder that can install a fresh clock |
| Extra tail timeout | Complete required evidence is rejected for an unrelated tail | A recording whose required interval is complete but whose later collection target is unreachable |

Forwarding observers may retain actual sessions and handles. They must not replace
Chrome behavior, synthesize screencast events, or manufacture pixel evidence.
Stable counters alone do not prove listener removal. Closing the page alone does
not prove handle cleanup. Puppeteer's local disposed flag also cannot prove that
Chrome released the remote object. Require the real release oracle above. A test
that never observes a late frame does not prove late-delivery behavior.

Gate verdict priority is disposable integration acceptance in this extraction,
not a new retained assessment module. Each gate's actual validation path must
judge a mismatch against the case's expectations combined with removed interval
frames or a collection-tail timeout. Add these disposable pose checks through its
actual assessment path:

| Recording presented to the assessment | Required result |
| --- | --- |
| Correct images, consecutive page frames through 80 ms, first draw marker only | Unverified; cannot count as a passing attempt |
| An observed case mismatch with no second marker | Terminal failure before incomplete classification |
| Correct first-marker-only images and recorded first-80-ms bounds, with an unreadable or backward clock inside that interval | Terminal instrument failure before missing-second retry eligibility |
| Healthy first image and later captured suppressed-write marker with correct later-blank metrics and full coverage | The later-blank control passes; a non-writing second marker counts |
| Only the first healthy image of a later-blank control, with no second marker | Unverified; absence of later-control evidence alone cannot establish a mismatch |

These check the actual verdict logic. Metadata counterexamples establish that
logic; the real rendered controls remain the pixel evidence.

Use existing rendered faults as acceptance controls. Temporary transforms can
drop delivered images or corrupt encoded clocks for a disposable combined-fault
check. Exercise the gate's actual assessment path, not a separately written
assert-then-coverage sequence. Add no permanent dropout switch. Retain a new test
only when its observable failure is material and existing coverage cannot catch
it; document that reason before staging.

**Local acceptance matrix.** Run browser checks serially.

| Check | Required cases and conditions |
| --- | --- |
| Shared recorder | Real acquisition, both codecs, multiple batches, partial endpoints, repeated cycles, exceptional cleanup, and clock ownership |
| Pose defaults | Two engines × circle and square × current, stale, blank, and later-blank; sixteen cases, up to three attempts per case |
| Restore JPEG defaults | Both engines, one-frame control, three fully covered healthy restores per engine within nine healthy attempts |
| Restore PNG compatibility | Both engines, one-frame control and one fully covered healthy restore per engine; label as format verification |
| Native fallback | Existing degraded gate launches without the trial flag; verify it separately |
| Hosted execution | Existing checks and browser-gates jobs on the exact implementation commit |

Preserve these existing settings:

| Contract | Value |
| --- | --- |
| Viewport | 1100 × 800, DPR 1 |
| Restore changed-pixel delta | More than 30 summed RGB levels |
| Restore shown threshold | More than 50 percent of sampled pixels |
| Default restore encoding | JPEG, quality 100 |
| Pose pixel comparison | Bidirectional one-device-pixel neighborhood; at most 1 percent above 40 summed RGB levels |
| Pose geometry | At most 0.25 CSS pixels across five projected points |
| First pose framebuffer | Held for 40 milliseconds |
| Pose observation | At least 80 milliseconds and through the second recorded draw |
| Restore control attempts | At most three per engine |
| Gate deadline | Existing 300-second ceiling |

Commands come from the current package and direct instrument entry:

```sh
npx vitest run instruments/screencastCoverage.test.ts
node instruments/screencastRecordingCheck.mjs
STRICT_CAPABILITY=1 npm run gate:genie-restore-flash
STRICT_CAPABILITY=1 npm run gate:genie-pose-flash
STRICT_CAPABILITY=1 RESTORE_CAPTURE_FORMAT=png ROUNDS=1 npm run gate:genie-restore-flash
npm run gate:degraded
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

The approved root compiler option must pass these same checks; do not weaken
types or lint rules to accommodate browser serialization.

Add any justified adjacent fast checks to the focused command. Send long-command
output to separate logs and inspect each command's own exit status. Record actual
engines, cases, attempts, received and acknowledged frames, scored images, batch
sizes, payload bytes, interval coverage, and cleanup observations. Reuse results
only while source, settings, and the tested claim still match.

**Completion criteria.**

- Both callers use the same acquisition and decoding implementation.
- Their thresholds, control sensitivity, required intervals, and attempt budgets
  retain their existing meaning.
- A pose attempt cannot pass without its second distinct known marker appearing
  in a recorded image. Suppressed-write markers count. Observed case mismatches and
  required-clock errors in the known minimum interval fail before missing-second
  evidence can trigger a retry.
- Partial recordings preserve defects, and extra tail deadlines do not override
  complete required evidence.
- Primary errors survive cleanup failures with both descriptions reported. Any
  cleanup failure is terminal, including alongside an incomplete observation.
- Real checks establish acknowledgement draining, session isolation, listener
  removal, owned clock cleanup, and browser-handle release on ordinary and
  exceptional exits.
- The full local matrix and required broader checks pass. Skips remain unverified.
- Focused hosted gates pass on the exact implementation commit. Inspect broader
  jobs and identify any unrelated failure. Claim full hosted success only after
  those jobs pass; report local success separately.
- Temporary fault transforms and scratch files are removed after findings are
  retained. Documentation names current behavior and its measurement limits.

If a hosted check fails, investigate the first missing proof. Repair only faults
caused by this extraction within its file scope. Do not change thresholds, retry
limits, browser flags, or infrastructure to obtain a green result. An unrelated
failure remains a separate issue with its evidence recorded.

Deliver the implementation as one focused change containing the helper, both
migrations, owning checks, and measured documentation. The stages above are
verification checkpoints, not separate overlapping implementations. Publishing,
merging, or changing CI is separate work that requires its own authorization.


**Acceptance record.**

The implementation uses the two shared exports described above. The approved
compiler option is applied. Both gates keep their original scene controls and
budgets. Their exception paths retain original primary values across nested
cleanup. The pose gate requires a recorded second marker and keeps minimum-interval
clock errors ahead of missing-second retry classification.

| Evidence | Observed result |
| --- | --- |
| Original full pose baseline | Sixteen cases passed |
| Original JPEG restore baseline | Both controls and three verified rounds per engine passed |
| Original PNG restore baseline | Both controls and one verified round per engine passed |
| Shared real-Chrome recorder check | Nineteen measurements passed; late acknowledgement failures, actual remote release rejection, and post-allocation rollback included |
| Migrated full pose | Sixteen cases passed on the first attempt |
| Migrated JPEG restore | Both controls and three verified rounds per engine passed |
| Migrated PNG restore | Both controls and one verified round per engine passed |
| Native fallback | Gestures in five scenes passed without the trial flag |
| Existing direct clock-installer call | Real Chrome call and read hook remained compatible |
| Disposable actual-assessment checks | Sixty-two metadata/error cases passed; this is not pixel proof |
| Fast suite on integrated main | 1,399 tests in 123 files passed |
| Typecheck, lint, package build | Passed |
| Hosted execution | Pending the GitHub Actions run after the main push |

Active disposal collects acknowledgement failures reported while the stopped
stream drains. The real-Chrome check verifies that rejection is terminal and
reported once, both before disposal and after Chrome confirms stop. Session,
listener, pending-work, and clock cleanup pass in both cases. The added check
failed before the correction and passed afterward.

Local flag-backed results remain separate from the public demo's origin-trial
status.

No late recording images appeared in the recorder check. Fresh-session isolation
and immutable captures passed, but late-delivery behavior remains unverified.
Temporary baseline copies were removed. The disposable metadata checker and raw
local measurements are outside the repository.
