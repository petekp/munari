# After the loading build

On 2026-11-26 the committed probe, `instruments/loading-matrix/`, measured
the `loading-build` branch against its base, `7ba5d72`. Both lab builds
were served by `vite preview` on loopback on m2. The runs alternated by
scene: base Bench, branch Bench, base Knobs, and so on. The base always ran
first, so any drift over those minutes fell on the branch. Each cell is the
median of 3 untraced loads, as `before → after`. Every load settled after a
Surface painted and with frames running. The probe differs from the
throwaway one in [Measurements](measurements.md), so compare these numbers
with each other, not with the tables there.

- Stopped in total adds every animation-frame gap over 50 ms. Longest stop
  is the median of each load's largest gap.
- Blocking builds count synchronous pipeline creations.
- Work done is the last pipeline build or first Surface paint, in ms from
  navigation start.
- Finish switch stopped is the stopped time in the 3 s after one Bench card
  switches to Oil-slick foil.

| Scene | Browser | Engine | Load | Stopped in total | Longest stop | Blocking builds | Work done | CLS | Finish switch stopped |
|---|---|---|---|---|---|---|---|---|---|
| Bench | Chrome 159 | html-in-canvas | cold | 650 → 200 | 400 → 117 | 18 → 3 | 1829 → 1659 | 0.068 → 0.068 | 333 → 0 |
| Bench | Chrome 159 | html-in-canvas | warm | 167 → 267 | 100 → 133 | 18 → 3 | 1065 → 1409 | 0.033 → 0.048 | 0 → 0 |
| Bench | Chrome 159 | snapDOM | cold | 817 → 267 | 400 → 183 | 18 → 3 | 2069 → 1818 | 0 → 0 | 317 → 0 |
| Bench | Chrome 159 | snapDOM | warm | 200 → 417 | 100 → 167 | 18 → 3 | 1159 → 1555 | 0 → 0 | 0 → 0 |
| Bench | CfT 156 | html-in-canvas | cold | 500 → 284 | 350 → 150 | 18 → 3 | 1753 → 1805 | 0.073 → 0.068 | 300 → 0 |
| Bench | CfT 156 | html-in-canvas | warm | 217 → 333 | 117 → 167 | 18 → 3 | 1098 → 1494 | 0.033 → 0.048 | 0 → 0 |
| Bench | CfT 156 | snapDOM | cold | 633 → 350 | 350 → 167 | 18 → 3 | 1978 → 1792 | 0 → 0 | 317 → 0 |
| Bench | CfT 156 | snapDOM | warm | 283 → 400 | 117 → 167 | 18 → 3 | 1210 → 1531 | 0 → 0 | 0 → 0 |
| Knobs | Chrome 159 | html-in-canvas | cold | 2750 → 533 | 1383 → 150 | 13 → 2 | 2373 → 2270 | 0 → 0 | – → – |
| Knobs | Chrome 159 | html-in-canvas | warm | 283 → 484 | 117 → 133 | 13 → 2 | 1362 → 1535 | 0 → 0 | – → – |
| Knobs | Chrome 159 | snapDOM | cold | 2767 → 367 | 1417 → 150 | 13 → 2 | 2473 → 2049 | 0 → 0 | – → – |
| Knobs | Chrome 159 | snapDOM | warm | 600 → 367 | 200 → 150 | 13 → 2 | 1687 → 1600 | 0 → 0 | – → – |
| Knobs | CfT 156 | html-in-canvas | cold | 2767 → 750 | 1367 → 200 | 13 → 2 | 2346 → 2484 | 0 → 0 | – → – |
| Knobs | CfT 156 | html-in-canvas | warm | 350 → 550 | 150 → 167 | 13 → 2 | 1362 → 1679 | 0 → 0 | – → – |
| Knobs | CfT 156 | snapDOM | cold | 2667 → 883 | 1333 → 250 | 13 → 2 | 2437 → 2611 | 0 → 0 | – → – |
| Knobs | CfT 156 | snapDOM | warm | 500 → 950 | 217 → 267 | 13 → 2 | 1707 → 2124 | 0 → 0 | – → – |
| Light | Chrome 159 | html-in-canvas | cold | 3366 → 1750 | 1983 → 767 | 17 → 6 | 3476 → 3294 | 0.029 → 0 | – → – |
| Light | Chrome 159 | html-in-canvas | warm | 317 → 733 | 217 → 167 | 17 → 6 | 858 → 1523 | 0.029 → 0 | – → – |
| Light | Chrome 159 | snapDOM | cold | 3900 → 1367 | 2733 → 617 | 17 → 6 | 4523 → 2766 | 0.029 → 0 | – → – |
| Light | Chrome 159 | snapDOM | warm | 600 → 533 | 417 → 167 | 17 → 6 | 1151 → 1322 | 0.029 → 0 | – → – |
| Light | CfT 156 | html-in-canvas | cold | 3483 → 1767 | 2183 → 683 | 17 → 6 | 3523 → 3404 | 0.029 → 0 | – → – |
| Light | CfT 156 | html-in-canvas | warm | 517 → 750 | 217 → 167 | 17 → 6 | 1067 → 1498 | 0.029 → 0 | – → – |
| Light | CfT 156 | snapDOM | cold | 3300 → 1483 | 1967 → 633 | 17 → 6 | 3884 → 3014 | 0.029 → 0 | – → – |
| Light | CfT 156 | snapDOM | warm | 583 → 733 | 333 → 117 | 17 → 6 | 1136 → 1698 | 0.029 → 0 | – → – |

Cold loads improved on every scene, browser and engine.

- Bench stops 200–350 ms in total instead of 500–817. Switching a finish
  no longer stops frames. The old finish stays until the new one's builds
  resolve, 373–497 ms after the click on cold loads and 44–130 ms on warm
  ones. No frame was checked, so the new finish shows no earlier than that.
  The base showed it after a stop of 267–417 ms.
- Knobs stops 367–883 ms in total instead of 2667–2767. Its median longest
  stop is 150–250 ms instead of 1333–1417.
- Light stops 1367–1767 ms in total instead of 3300–3900. Its layout shift
  of 0.029 is gone, but the lab's Light scene changed on this branch too, so
  the probe cannot say which change removed it.

Four things did not improve.

- Warm loads stop longer in total in 10 of 12 cells, by 100–450 ms, and
  finish their work later in 11 of 12. Bench's longest warm stop rose from
  100–117 ms to 133–167 ms. At 3 loads a cell and alternation by scene
  rather than by load, this is a likely regression, not a measured size.
- Light still stops 617–767 ms once on a cold load. Six pipelines are still
  created with the blocking call. One is the mipmap pipeline. The other five
  were built asynchronously by `waitForDrawPipelines` and then created again
  with the blocking call. The cause is not known (decisions.md #80).
- Bench still creates one `MeshPhysicalNodeMaterial` pipeline with the
  blocking call on every load. The hold never built it. Bench and Knobs also
  create two mipmap pipelines, which their prebuilds made cheap.
- Bench's warm layout shift rose from 0.033 to 0.048. A second card's canvas
  grows from 0 to 280 px tall after the first paint. The base build makes the
  same shift on cold loads, so the branch moved it rather than adding it.

The probe loads each scene unframed, so the shell's reveal through the frame
message was not measured. Blank and incomplete frames were not classified.
