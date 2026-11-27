# Quality probe

Measures what each candidate quality setting costs and how it changes the
picture, for the [quality levels proposal](../../docs/quality/README.md). It is a local
measurement, not a gate, and CI does not run it.

None of the settings is public yet. `hooks.mjs apply` patches a
measurement checkout so the page can set each one through
`globalThis.__quality`: the canvas pixel ratio and MSAA, the environment
bake size, the glass tap count, the capture resolution, and finish
overrides. `hooks.mjs restore` puts the files back from `HEAD`. Never
commit an applied tree. The glass files exist only on commits with the
transmission layer, such as `cdf9501`.

```sh
node instruments/quality/hooks.mjs apply
npm run dev -w @munari/lab -- --port 5183 --strictPort
OUT=/tmp/quality MODE=frame node instruments/quality/run.mjs
node instruments/quality/hooks.mjs restore
```

Modes:

- `frame` times 12 cards of one preset on the glass bench page. Each
  sample renders 30 frames back to back and waits for the GPU queue. It
  needs a commit with the glass page.
- `first` loads the finishes page in a new browser per sample and records
  when every card presents, the environment bake's marks, the longest gap
  between animation frames, and GPU texture memory.
- `pixels-finishes` and `pixels-glass` screenshot each card at device scale
  2 under each setting and compare it with the base setting. They save the
  worst card of each setting as a PNG.

Environment variables: `MODE`, `OUT` (required), `LAB_URL` (default
`http://127.0.0.1:5183`), `CHROME_PATH`, `ROUNDS`, `SAMPLES`, `COUNT`,
`PRESET`, and `PRESETS` and `CONFIGS` as comma-separated subsets.
`SCALE` sets the device scale (default 2). `TILT=pointer` tilts the finish
cards toward a fixed mouse position before the pixel shots. A setting
marked for frame runs only, such as `dpr3`, runs in a pixel mode when
`CONFIGS` names it.

Limits: texture memory counts `createTexture` minus `destroy` and leaves
out the swap chain and buffers. Frame time is GPU work per frame, not the
presented frame rate. A pixel difference says where pixels change, not
whether a viewer minds. The `again` setting repeats the base to show the
noise floor, which was 0 on every card on 2026-11-26.
