# WebGPU integration diagnostic

This is an S0 diagnostic for the [WebGPU migration specification](../../docs/webgpu-migration-spec.md). It investigates native command observation and renderer cleanup. It is not a production observer or migration acceptance check. No Surface handoff is mounted.

Run it serially with other GPU work:

```sh
WEBGPU_S0_OUTPUT=/private/tmp/munari-webgpu-s0 node instruments/webgpu-integration/run.mjs
```

The output directory defaults to a unique folder in the system temporary directory. `CHROME_PATH` can select Chrome. The runner uses the installed global `agent-browser` CLI with its own named session. It serves a local Vite fixture, requires the actual WebGPU backend, and closes the browser and server in `finally`. Each CLI command has at most 30 seconds; the main run has 90 seconds plus bounded browser cleanup. Capability failure is an unverified run with a nonzero exit, never a successful skip.

The runner aliases Three entries to one installed source graph. It saves page observations, command stdout/stderr, source copies, dependency/source digests, the Git revision and dirty-file scope, browser identity, adapter identity, and backend. This records the tested configuration rather than claiming package or platform support.

| Case | What it observes |
| --- | --- |
| `ordinary` | A nonempty native command binds the tracked allocation and the control returns opaque red. |
| `empty` | Zero watched geometry leaves the blue clear and cannot count as a nonempty command with a known source binding. |
| `invalid`, `invalidSettled` | Deliberately invalid WGSL reaches validation and cannot establish a known-source command. Pixels remain diagnostic because failed work can leave older contents. |
| `nested` | An unrelated nested draw is followed by the watched red source. |
| `nestedOnly` | The unrelated draw is green while watched geometry is empty. That draw cannot count for the watched source. |
| `cachedBorrowed` | A second renderer is prewarmed before observation. It records red pixels before and after observation while earlier pipelines/views/bindings may remain unknown. The fixture owns this renderer; it models cache adoption rather than proving application-owned renderer lifetime. |
| `preInitDispose` | A real force-WebGL renderer is disposed before initialization. An instance wrapper forwards the actual `init()` call and observes its returned promise. If disposal requests initialization, that promise must settle and a magenta render without a manual `init()` establishes that it became usable. No initialization request during this bounded observation is recorded separately; it does not establish safe cleanup. |

The solid red, blue, green and conditional magenta controls validate setup and readback. Missing or incorrect pixels must fail so a broken experiment cannot appear to establish integration support. These assertions are independent known-color controls; they do not freeze renderer internals. No duplicate unit suite is retained.

The page temporarily wraps native device, queue, encoder, texture and pass instances. It also wraps Three's render-object dispatch to associate commands with the watched object. Shared native prototypes must remain unchanged. Closures retain observed resources until cleanup, which is bounded to these fixtures. `hasKnownSourceCommand` describes a bound allocation, a nonempty native command, and its validation scope. It does not prove shader sampling, color writes, or presentation. This mechanism is diagnostic code and has not met the production contract.

The first recorded cached draw on 2026-10-05 returned red while pipeline and source-binding metadata were unknown. The driver records that result rather than declaring support from the pixels or a draw counter. Later metadata completeness is also a valid diagnostic result; it still requires the full S0 integration contract.

The run does not establish upload/frame-generation identity, an output composition chain, native input, WebGL 2 material parity, device-loss recovery, asynchronous field safety, or portable performance. It does not promote the temporary uploader or public-root shell experiments. A valid setup exits zero and prints that the integration gate remains unselected.
