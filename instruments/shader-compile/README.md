# shader-compile

Checks that the lab's shaders compile and link. `npm run gate:shaders`.
Three generates each shader from its node graph only in a browser, so
nothing else in CI can tell a working one from a broken one: typecheck,
lint, and the unit suites see the node calls, never the WGSL or GLSL
they produce. This gate hooks
shader compiles and program links from inside the page, walks the logo
scene through the states that build materials (page, scene, extruded,
mesh body, back to page), and prints every error against its own source
lines.

On WebGPU, each `createShaderModule` call counts as a compile and each
render pipeline as a link. Errors come from each module's
`getCompilationInfo()` and from the device's uncaptured errors. On the
WebGL 2 fallback (`MUNARI_BACKEND=webgl2`), the gate hooks
`compileShader` and `linkProgram`. Either way it fails on any error, or
when it sees no compile or link at all. A planted WGSL error failed it on
both backends (2026-10-08).

The walk covers only the programs its states construct. A new material
needs a new state here. The states read the letter material's uniforms
through a wrapper the gate adds around `createLetterMaterial` when it
serves the lab.

Each step waits up to 30 seconds for its state and prints how long it took.
The check does not judge that time. A hosted runner took 7.65 seconds to
return to the page, in one run on 2026-09-29.

It exists because a shared GLSL block once dropped two sampler
declarations: used in both stages, declared in neither. The unit suite
guarding that block passed, because it checked that no uniform was
declared twice, never that each was declared at all. The failure
surfaced two commands later as a phase-wait timeout inside the
crossing-flash gate (2026-08-14, since removed). This is the cheapest
gate in the repo and the one the others assume.
