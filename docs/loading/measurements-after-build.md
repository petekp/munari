# After the loading build

On 2026-11-27 the committed probe, `instruments/loading-matrix/`, measured
the `loading-build` branch at `7bb3780` against its base, `c424f75`
(main with the glass finish). Both lab builds were served by `vite preview`
on loopback on m2, during one evening.

The runs were paired. Each round ran one scene on both builds back to back,
base first in odd rounds and branch first in even ones. One run loads every
browser and engine once cold and once warm, so a pair is the same cell from
the two runs of one round. Bench ran 12 rounds. Knobs and Light ran 30.

The plan was 12 rounds for every scene, and a cell counted as regressed when
its interval's lower bound was above 0. After 12 rounds, six warm cells had
intervals wider than ±100 ms, and one, Knobs on CfT 156 with snapDOM, read
regressed: +49 ms [3, 95]. Knobs and Light then ran 18 more rounds under an
addendum written before the extension's data came in. The table below pools all 30.
Looking twice raises the chance of a false "ruled out" from 2.5% to at most
about 5%, which cannot move an upper bound near 58 ms past 100.

Each difference is branch minus base, in ms: the mean of the paired
differences with its 95% t interval. A negative number means the branch
stopped less or finished sooner. The median column is `base → branch`.

- Stopped in total adds every animation-frame gap over 50 ms. Longest stop
  is each load's largest gap.
- Work done is the last pipeline build or Surface capture.
- Blocking builds count synchronous pipeline creations.

Bench loads in the top window, so its times count from navigation start.
Knobs and Light load inside the site shell's iframe, the way the catalog
shows them, so their times count from the iframe's start. That start comes
42–482 ms after the page's, and it differs between the builds by less than
10 ms on average in each cell.

| Scene | Browser | Engine | Load | Pairs | Stopped in total, median | Stopped difference | Longest stop difference | Work done difference |
|---|---|---|---|---|---|---|---|---|
| Bench | CfT 156 | html-in-canvas | cold | 12 | 475 → 67 | -418 [-482, -354] | -314 [-335, -293] | -249 [-373, -125] |
| Bench | CfT 156 | html-in-canvas | warm | 12 | 133 → 109 | -32 [-71, 7] | -10 [-29, 9] | 206 [153, 259] |
| Bench | CfT 156 | snapDOM | cold | 12 | 592 → 150 | -456 [-536, -375] | -304 [-324, -285] | -278 [-387, -169] |
| Bench | CfT 156 | snapDOM | warm | 12 | 209 → 150 | -65 [-120, -10] | -11 [-23, 1] | 169 [135, 204] |
| Bench | Chrome 159 | html-in-canvas | cold | 12 | 483 → 0 | -489 [-519, -459] | -342 [-362, -321] | -135 [-179, -92] |
| Bench | Chrome 159 | html-in-canvas | warm | 12 | 92 → 67 | -35 [-75, 5] | -21 [-44, 2] | 208 [166, 250] |
| Bench | Chrome 159 | snapDOM | cold | 12 | 583 → 75 | -535 [-626, -444] | -301 [-324, -279] | -147 [-246, -49] |
| Bench | Chrome 159 | snapDOM | warm | 12 | 133 → 67 | -42 [-82, -1] | -7 [-22, 8] | 181 [153, 209] |
| Knobs | CfT 156 | html-in-canvas | cold | 30 | 2342 → 359 | -2076 [-2214, -1938] | -1094 [-1142, -1046] | -250 [-347, -152] |
| Knobs | CfT 156 | html-in-canvas | warm | 30 | 250 → 275 | 23 [-12, 58] | -30 [-37, -22] | 86 [54, 117] |
| Knobs | CfT 156 | snapDOM | cold | 30 | 2409 → 434 | -2038 [-2174, -1902] | -1068 [-1115, -1021] | -214 [-292, -136] |
| Knobs | CfT 156 | snapDOM | warm | 30 | 400 → 400 | 12 [-18, 43] | -42 [-52, -31] | 67 [47, 87] |
| Knobs | Chrome 159 | html-in-canvas | cold | 30 | 2200 → 234 | -2040 [-2124, -1956] | -1093 [-1131, -1056] | -248 [-279, -217] |
| Knobs | Chrome 159 | html-in-canvas | warm | 30 | 234 → 150 | -42 [-86, 2] | -11 [-28, 6] | 69 [35, 103] |
| Knobs | Chrome 159 | snapDOM | cold | 30 | 2259 → 267 | -2052 [-2141, -1964] | -1078 [-1111, -1045] | -271 [-314, -228] |
| Knobs | Chrome 159 | snapDOM | warm | 30 | 300 → 317 | -3 [-62, 57] | -33 [-42, -24] | 56 [16, 96] |
| Light | CfT 156 | html-in-canvas | cold | 30 | 3125 → 700 | -2524 [-2650, -2399] | -1865 [-1976, -1754] | -1116 [-1179, -1052] |
| Light | CfT 156 | html-in-canvas | warm | 30 | 467 → 417 | -32 [-77, 12] | -85 [-112, -59] | 96 [47, 144] |
| Light | CfT 156 | snapDOM | cold | 30 | 2983 → 525 | -2501 [-2605, -2397] | -1787 [-1887, -1688] | -1577 [-1629, -1524] |
| Light | CfT 156 | snapDOM | warm | 30 | 467 → 467 | -12 [-61, 38] | -92 [-113, -71] | 73 [28, 118] |
| Light | Chrome 159 | html-in-canvas | cold | 30 | 2967 → 475 | -2507 [-2583, -2431] | -1940 [-2011, -1870] | -1164 [-1242, -1087] |
| Light | Chrome 159 | html-in-canvas | warm | 30 | 333 → 300 | -19 [-75, 37] | -140 [-190, -90] | 114 [48, 179] |
| Light | Chrome 159 | snapDOM | cold | 30 | 2908 → 533 | -2406 [-2464, -2348] | -1995 [-2057, -1933] | -1368 [-1477, -1260] |
| Light | Chrome 159 | snapDOM | warm | 30 | 417 → 367 | -39 [-91, 13] | -163 [-201, -126] | 81 [30, 133] |

Cold loads improved in every cell. They stop 418–2,524 ms less in total and
finish their work 135–1,577 ms sooner.

In this session, no warm cell regressed by 100 ms or more in stopped time. Every warm upper
bound is below 60 ms. Ten of the 12 warm upper bounds are above 0, so a
small regression, up to 58 ms, is not ruled out in those cells. The largest
means are +23 and +12 ms, on Knobs with CfT 156. Warm
longest stops are 11–163 ms shorter on Knobs and Light, where one of the
eight intervals crosses zero. On Bench every warm interval for the longest
stop crosses zero.

Blocking builds fell from 18 to 2 on Bench, 13 to 2 on Knobs and 17 to 1 on
Light, on every load. The ones left are the mipmap pipelines three creates
with the blocking call: two on Bench and Knobs, one on Light. This counts
calls. Each remaining call takes at most 1.6 ms in JavaScript; its cost in
the GPU process was not measured.

Switching one Bench card to Oil-slick foil no longer stops frames on a cold
load. The base stopped for a median of 267 ms (233–450). The branch had no
gap over 50 ms in any of the 48 switches. The old finish stays until the new
one's pipelines resolve, 356–502 ms after the click cold and 48–240 ms warm.
No frame was checked, so the new finish shows no earlier than that. Warm
switches stop 0 ms at the median on both builds.

Two things are worse.

- Warm loads finish their work later, by 56–208 ms, in all 12 warm cells.
  The branch builds its pipelines asynchronously, and on Light its first
  capture lands 73–119 ms later. The first screen draw is not later. Every
  warm interval for it lies within about ±51 ms, and five lie entirely below
  zero.
- Bench with html-in-canvas adds a second layout shift on warm loads. Both
  builds shift by 0.033 on every warm load. On the branch, a canvas also
  grows from 0 to 280 px tall after the first paint, a shift of 0.016. The base
  makes it on 18 of 24 cold loads and no warm ones; the branch makes it on
  20 of 24 cold loads and all 24 warm ones. Warm CLS is 0.048 at the median
  instead of 0.033. Cold CLS is 0.074 → 0.080 on CfT 156 and 0.074 → 0.068 on
  Chrome 159.

Light's layout shift of 0.029 is gone on every load, but the lab's Light
scene also changed on this branch, so the probe cannot say which change
removed it.

One base load, Light on CfT 156 with snapDOM cold, hit the 25 s settle
timeout. It is counted. Its 4,483 ms of stopped time is the highest in its
cell, so it adds about 40–50 ms to that cell's improvement. No other load
timed out, no page threw an uncaught error, and every load ran on WebGPU.

The probe has limits.

- It runs headless Chrome on one machine during one evening, and headless
  Chrome paces frames without a display. Rounds 1–12 and 13–30 differed by up
  to 79 ms in a warm cell's mean and up to 278 ms in a cold one. In three of
  the 16 Knobs and Light cells the halves differ by more than twice their
  standard error, where chance alone would give about one. So the intervals
  cover this session only. Another session could read outside them by about that much.
- Longest stop, work done, first draw, capture and CLS were not in the plan.
  With about 100 intervals, a few will exclude zero by chance; a single
  cell's reading deserves that caveat. The later warm work holds in all 12
  warm cells.
- The shell's reveal of Knobs and Light was not timed.
- Blank and incomplete frames were not classified, so these numbers do not
  show what the page displays while the work finishes.
