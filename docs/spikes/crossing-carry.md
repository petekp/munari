# The carry check fails, and mostly not for the reason it says (2026-08-15)

`npm run gate:crossing` fails repeatably on committed code. This is what
it is actually measuring.

## Symptom

Five sequential runs, every one failing, worst reading per run 2.16,
2.24, 3.01, 3.25, 3.21 css px against a 1.5 budget. The failures cluster
on one swap index per run, which reads like a real defect at one moment
of the choreography.

They are not one thing. There are three effects stacked, and only the
smallest of them is the scene's fault.

## 1. Sequential runs drift upward

The five runs above climb monotonically. Interleaving the arms of an A/B
inside one session instead — the discipline `knobs-lighting.md` recorded
for the same reason — never produced a reading above 2.19. Sequential
comparison at this scale is worthless; the machine heats.

## 2. The two channels disagree, and the disagreement is not constant

The gate watches the screen two ways: a screencast decoded at half
scale, and full-size screenshots. They do not read the same centroid
from the same word. The run measures that offset once, on a calibration
burst under the page's hold, and subtracts it from every later shot:

```
channel offset   shot − cast (−2.01 x, +0.15 y) css px
```

The offset is treated as a constant. It is not. It comes from where the
ink threshold lands on letter edges at the two resolutions, and the
conductor keeps re-dealing letters into different fonts, weights and
matters — so the edge population under the threshold changes between the
calibration burst and each swap. The correction is right for the deal it
was measured on and wrong by up to ~1.5 px for later ones, which is the
entire budget.

This only bites **backward** swaps (gl→page). They are the only ones that
must compare the two channels: the cast is dark for ~250 ms after a
return handoff (platform.md item 13), so the after-window has to be
shots. Forward swaps compare cast to cast and score better.

Frame dump of a failing backward swap, `CARRY_DEBUG=1`:

```
pre   -35ms cast (637.80, 412.08)     ← last real cast sample
post   31ms shot (639.30, 411.76)     ← first real shot sample
at flip: before fit (637.41, …) · after fit (639.41, …)   err 2.00
```

The shots are steady to 0.36 px across the whole after-window. The gap is
not jitter; it is the two channels naming different positions for the
same word.

## 3. The handoff itself is clean

At a STATIC swap, where nothing moves, the same run reads:

```
swap 1  ink centroid moved 0.00 css px
swap 2  ink centroid moved 0.02 css px
swap 3  ink centroid moved 0.19 css px
swap 4  ink centroid moved 0.19 css px
```

Canvas and page agree on the word's position to within 0.19 px. The
identity theorem holds. Whatever the carry check is failing on, it is not
a visible pop at the handoff.

## 4. The gel weave adds ~0.33 px, and that part is real

Interleaved A/B, `LOGO_DEFAULTS.jelly` 0 against the shipped 0.55, two
passes, arms alternated inside one session:

| | mean err | worst | swaps over budget |
|---|---|---|---|
| weave off | 0.93 px | 1.52 | 1 of 12 |
| weave on | 1.26 px | 2.19 | 4 of 12 |

Split by direction, the weave costs +0.50 px on backward swaps and
+0.17 on forward ones.

It is NOT slipping past the admission rule, which was the first guess.
The coverage filter already stops admitting frames ~226 ms before the
swap, and the matter gate closes at 219 ms by derivation
(`SETTLE_MS` 670 × the progress at which smoothstep reaches
`MATTER_GATE.from` 0.25). The filter cuts in the right place. What the
weave does is enlarge the arc the parabola is fitted to over the frames
that ARE admitted, so the 30 ms extrapolation to the flip swings further
— measured ±0.75 px between swaps in one run.

Note also that the weave-off arm still grazes the budget (1.52). The
budget was already marginal before the weave existed.

## What would fix it

In order of how much of the error each removes:

1. **Re-derive the channel offset per deal, not once per run.** After a
   backward swap the page holds and the cast comes back, so both channels
   see the same DOM word with the deal that swap actually used. The offset
   for that deal is measurable there, after the fact.
2. **Shorten the before-window, or weight its late samples.** The
   extrapolation, not the fit, is what the weave perturbs.
3. **Only then** consider the budget. Setting it from the measured spread
   would need ~2.5 px, which is enough slack to hide a real 2 px break.

Nothing here is done. The gate is not in CI (`npm test`, `typecheck`,
`lint` and `gate:idle-zero` are), so nothing is red on push — but the
carry check does not currently pass by hand, and that is worth fixing
before it is trusted again.

## Method

`CARRY_DEBUG=1 npm run gate:crossing` prints every admitted frame with
its timestamp, centroid and coverage, plus both fits evaluated at the
flip. That dump is what separated the three effects above; the pass/fail
line alone cannot.
