# Browser gate recording spike

Status: complete. The experiment supports extracting a shared recording module.
Production instruments are unchanged.

The restore and pose gates judge Genie handoffs from recorded Chrome images.
A disposable prototype shared acquisition, acknowledgement draining, bounded
decoding, and page-frame identity. Each gate retained its visual judgment,
observation interval, fault controls, and attempt limits. The existing coverage
law remained unchanged.

The module removed recording coordination from both callers. It retained browser
handles for the decoder, reference pixels, and scorer state across batches.
Full pixel arrays stayed in Chrome. This gives recording fixes one owner while
preserving the gates' distinct visual contracts.

## Evidence

Measured at this revision:

```text
1a201fd307be0f2447f548c8318248e06dfec47f
Chrome 154.0.8037.97 on macOS
Headless, 1100 × 800, DPR 1
```

Both gates asserted the actual capture engine. There were no capability skips.

| Prototype gate | Engines | Cases | Result |
| --- | --- | ---: | --- |
| Restore, JPEG | HTML-in-canvas and snapDOM | 4 | Flash detected; healthy restore passed |
| Restore, PNG | HTML-in-canvas and snapDOM | 4 | Flash detected; healthy restore passed |
| Pose, PNG | HTML-in-canvas and snapDOM | 8 | Current pose passed; stale, blank, and later-blank controls rejected |

Every case passed on its first recording attempt. The existing gates also passed
the initial twelve-case baseline. All five gate commands exited zero.

The prototype acknowledged all 1,032 received gate images, with no pending
acknowledgements or protocol errors. It decoded 920 images selected for scoring.
Restore excludes earlier docked images except its final reference.

| Measurement | Restore | Pose |
| --- | ---: | ---: |
| Frames per decode batch, maximum | 8 | 8 |
| Batches per recording | 10 | 5 |
| Encoded batch payload, measured maximum | 3.36 MB | 0.85 MB |

A separate seventeen-check probe exited zero. Replaying an actual recording with
batch sizes one and eight produced identical rows. Removing every image of an
interior page frame, or removing an interval endpoint, produced an incomplete
recording error. Corrupting an encoded clock strip or PNG produced a terminal
instrument error. Known PNG and JPEG images decoded the expected clock values.

Actual stale pixels still failed after an interior frame or the tail was removed.
They also failed before an attached endpoint error could trigger a retry. A real
Chrome recording with an unreachable endpoint returned its captured frames and
an incomplete-observation error. Repeated recording drained acknowledgements;
its counters remained unchanged after disposal.

## Implications and limits

Keep acquisition and decoding together. Keep visual judgments and retry budgets
with each gate. Preserve partial recordings on a deadline so known visual faults
are judged before missing coverage. Keep the pure coverage checks and rendered
fault controls as distinct evidence.

The prototype requires a self-contained browser scorer factory for Puppeteer
serialization. That interface is experimental. Production work should assess its
caller cost before adopting it. The prototype adds code overall; its benefit is
concentrated recording knowledge, not fewer lines.

These measurements cover local Chrome and the existing quadrato fixtures. They
do not establish hosted-runner reliability, natural-motion continuity, changes
between page frames, or direct listener removal. The lifecycle probe observed
acknowledgement draining and stable counters; listener removal was inspected in
code.

The experiment stayed within its twenty-five-minute budget. Disposable code was
removed from the checkout after recording these findings. An archived prototype,
raw recordings, command logs, and the measured summary remain in the temporary
evidence directory. The prototype is not a production implementation.

[Measured summary](/private/tmp/munari-recording-spike-20261002/summary.json) ·
[Archived prototype](/private/tmp/munari-recording-spike-20261002/recording-prototype.tar.gz)
