# Postcard edge, paper and shadow probes

`npm run probe:postcard-edges` freezes a curl on the real page and compares its
composited silhouette with a supersampled lighting draw. A half-density draw
is the negative control; native edge error must be below 65% of that control.
The test reads the actual mesh alpha to select boundary pixels, checks that
the reference buffer was not clamped, and exercises a larger 4x-density window.
The lighting band must retain native density and cover the viewport when its
offscreen margin shrinks to fit the browser's buffer limit. `HEADED=1` preserves
native density for the main comparison; `PAPER_OUTPUT` selects the evidence folder.
`EDGE_BASELINE_ONLY=1` saves a before image without asserting the new contract.
All pose and density controls affect only the served copy. Decision
[#53](../../docs/decisions.md#53) records the rendering change and measured result.

`npm run probe:postcard-paper` checks the real paper mesh, its rendered outline,
corner response, stamp impulse, native field input and exact return. A flat
geometry control runs with `PAPER_FLAT=1`; it must remain planar and produce
the corresponding straight-edged outline. The probe keeps the display canvas's
buffer only in its served copy so it can inspect rendered alpha. Its timing is
diagnostic; `probe:postcard` retains the unrecorded frame-gap contract.

`PAPER_RECORD=1` saves a short Chrome sequence and encodes `postcard.mp4` with
ffmpeg. `PAPER_OUTPUT` selects the output directory, `CHROME_PATH` selects Chrome,
and `HEADED=1` uses visible Chrome at native display density. Recordings and
screenshots stay outside the repository.

`npm run probe:postcard-paper-shadows` checks the actual lighting renderer with
a known curl. The curved geometry must change the cast shadow and shade visible
parts of its own surface. Removing only the shadow-depth texture is the control;
the flat sheet must remain free of self-shadow acne. This check renders on
WebGPU by default and does not need HTML capture. With `MUNARI_BACKEND=webgl2`
it needs `EXT_color_buffer_float` for the half-float shadow map. These are local
commands; CI membership is unchanged. Decision [#51](../../docs/decisions.md#51)
records the model and its bounds.
