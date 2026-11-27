# docs

Start with the document that answers the task. A design proposal is not proof
of implemented behavior. A source implementation is not proof of browser
output. Preserve both distinctions when resolving a conflict.

| Need | Canonical home | Status |
|---|---|---|
| Evaluate Munari against raw HTML-in-canvas | [Why Munari](why-munari.md) | Current overview with JSX examples and lab links |
| Make payload opt-in by effect class | [Payload optimization research](payload-optimization-research.md) | Measured bundle breakdown and proposed opt-in tiers; unbuilt |
| Design opt-in payload | [Opt-in payload proposal](opt-in-dx-proposal.md) | Per-module build and budget check (built); R3F 10 migration, lazy canvas recipe, and rollout (unbuilt) |
| Set up and use the package | [Root README](../README.md), public entry types | Current usage |
| Choose a capture engine or enable snapDOM | [Capture engines](capture-engines.md) | Current usage |
| Add custom scene content, materials and prewarming | [Custom scene content](scene-content.md) | Current usage |
| Draw Surfaces through a custom compositor | [Custom compositor output](compositor-output.md) | Current usage |
| Put HTML in a scene with no page slot | [HTML that belongs in a scene](scene-surface.md) | Current usage |
| Check capture sharpness and density | [Sharpness](sharpness.md) | Current usage |
| Read Surface status, progress and drivers | [Observe and animate a Surface](observing-a-surface.md) | Current usage |
| Return content to different page layouts or use several canvases | [Page layouts and canvases](page-layouts-and-canvases.md) | Current usage |
| Handle a browser with no capture engine | [When enhanced rendering is unavailable](native-fallback.md) | Current usage |
| Use Munari with Next.js or server rendering | [Next.js and server rendering](nextjs.md) | Current usage |
| Test Surface content or read console output | [Testing and troubleshooting](testing-and-troubleshooting.md) | Current usage |
| Capture a page element that stays native | [Element capture](element-capture.md) | Current usage |
| Animate an app update behind a capture | [Element capture](element-capture.md#run-an-update-behind-a-capture), [capture transitions](transition-api.md), [decision #77](decisions/handoff.md#77) | Built; the effect hook is provisional |
| Find the owner, control and relevant check | [Agent operating guide](agent-workflow.md) | Current workflow |
| Understand how the abstractions fit | [System model](system-model.md), [glossary](../CONTEXT.md) | Current model and constraints |
| Improve the public React authoring interface | [React API improvement plan](react-api-improvement-plan.md) | Partially shipped (SurfaceCanvas, SurfaceStatus, handles/callbacks in v0.4.x); remaining items proposed |
| WebGPU renderer, TSL materials, and fallback | [Decision #69](decisions/renderer.md#69) (with #70–#74) | Shipped in v0.4.0 (`WebGPURenderer` + TSL node materials, WebGL 2 fallback) |
| Build the next agent-facing capability | [Agent system plan](agent-system-plan.md) | Work in progress; unbuilt stages are explicit |
| Review earlier performance findings | [Performance audit](performance-audit.md) | Assessment of 2026-09-26; each remedy is unbuilt unless its finding says otherwise |
| Diagnose capture and GPU costs | [Performance diagnosis](performance-diagnosis.md) | 2026-10-14 diagnosis; capture optimizations are linked below |
| Review the first-edit capture experiment | [Full capture input reuse](full-capture-input-reuse.md) | Rejected; CPU typing gains did not pass GPU tail checks |
| Review input-window pacing experiments | [Input capture pacing](input-capture-pacing.md) | Rejected; shorter input pacing added extra captures |
| Review clone-removal experiments | [Capture spike report](svg-splitting-performance.md) | Rejected; production typing or submission regressions remained |
| Review snapDOM optimization summary | [Performance optimization](performance-optimization.md) | Implemented summary across font, style, and input-region passes |
| Check full SVG capture performance | [Full-capture report](full-capture-performance.md) | Implemented; CPU background reuse, production benchmarks and exact-pixel evidence |
| Check serialized-style caching | [Style-cache report](style-cache-performance.md) | Implemented; production benchmarks and exact-pixel evidence |
| Check snapDOM input region performance | [Incremental capture report](incremental-capture.md) | Implementation and local benchmark evidence |
| Add automatic canvas refresh without idle polling | [Automatic canvas refresh spec](automatic-canvas-refresh-spec.md) | Proposed, unbuilt; browser and pixel-lifetime gates are explicit |
| Report when components first show complete content on load | [Loading spec](loading-spec.md) | Proposed, unbuilt; names and policy settled |
| Make effects load without the user noticing | [Loading proposal](loading/README.md) | Proposed, unbuilt; measurements from 2026-11-26 and open decisions |
| Add snapDOM as a second capture engine | [Decision #60](decisions/capture.md#60) (with #61–#64) | Shipped 2026-09-10; completed plan archived in Git history |
| Read release notes for 0.4.1 and earlier | [Earlier changelog](changelog-0.4-and-earlier.md) | Released history; later releases are in [CHANGELOG.md](../CHANGELOG.md) |
| Understand an architectural choice | [Decisions](decisions.md) | Current rules by number, grouped by area |
| Check a browser-specific claim | [Platform](platform.md), [instruments](../instruments/README.md) | Measurements under the recorded conditions |
| Write captured HTML | [Authoring](authoring.md), [retained HTML](retained-html.md) | Current rules derived from measurements |
| Work on the repo itself | [Development](development.md) | Repo layout and check commands |
| Implement focus and spatial navigation | [Focus](focus.md) | Contract, implemented in the binding |
| Check a kernel law | [Conformance suites](../tests/conformance/README.md) | Intended behavior with scoped evidence |
| Find an implemented example | [Demo source map](../ALL-DEMO-API.md) | Current source links; verification belongs to each instrument |
| Understand the retained-HTML cutover | [Decision #43](decisions/surface.md#43), with #42, #44, #45 and #48 | Current API, behavior, sharpness and naming rules |

Code comments cite `decisions.md #N` and `platform.md #N`; numbering never
changes. Each decision states the current rule. A change rewrites it, and Git
history keeps the earlier text. A new measurement records its conditions and probe instead of
silently changing a threshold. If code, a contract and a browser result
disagree, record the conflict and run the smallest discriminating check.

Keep usage in the current guide, reasoning in the decision, and unbuilt work
in the plan. Link these homes rather than maintaining several versions of the
same rule. Package-local availability remains a separate concern; the
[packaging stage](agent-system-plan.md#p1-version-local-package-guidance) is not
implemented by adding repository documents.

Superseded API proposals and completed hardening plans were removed from the
working tree after their decisions and executable checks were retained. Git
history contains those records when the design process itself is the subject.
They are not additional API guides.

## spikes/

One-off measurement write-ups, kept for their numbers. Each records
the measurement, the Chrome version, and the date. They are not plans;
some predate designs that later changed shape. `design-language.html`
is a visual reference sheet for the lab; open it in a browser.
