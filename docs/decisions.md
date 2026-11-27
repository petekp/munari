# munari decisions

Numbered rules that govern Munari today, grouped by area. Each rule states the current constraint. A measured rule keeps the number that justifies it. Git history keeps earlier versions and the evidence behind them. Terms follow the glossary in [CONTEXT.md](../CONTEXT.md).

Code cites a rule as `decisions.md #N`, and this index maps the number to its file. Numbers are permanent. A retired number is never reused. A new decision takes the next free number, #82, in the file for its area, and gets a row here.

Changing a rule needs evidence and matching changes to its owning tests (#2). Browser facts and how they were measured live in [platform.md](platform.md).

| Area | File |
|---|---|
| Project, packaging and tests | [decisions/project.md](decisions/project.md) |
| Capture and paint | [decisions/capture.md](decisions/capture.md) |
| Surface API and presentation evidence | [decisions/surface.md](decisions/surface.md) |
| Handoffs between page and canvas | [decisions/handoff.md](decisions/handoff.md) |
| Pointer input | [decisions/input.md](decisions/input.md) |
| Renderer and materials | [decisions/renderer.md](decisions/renderer.md) |
| Lab and demos | [decisions/lab.md](decisions/lab.md) |

| # | Decision |
|---|---|
| <a id="1"></a>[#1](decisions/project.md#1) | One public package, with three as a peer |
| <a id="2"></a>[#2](decisions/project.md#2) | The conformance suite defines kernel laws |
| <a id="3"></a>#3 | Retired: merged into [#75](decisions/lab.md#75) |
| <a id="4"></a>[#4](decisions/project.md#4) | Core speaks in structural shapes that three satisfies |
| <a id="5"></a>[#5](decisions/capture.md#5) | Every DOM-sourced texture is premultiplied |
| <a id="6"></a>[#6](decisions/project.md#6) | The root entry is curated, and `/advanced` re-exports the kernel whole |
| <a id="7"></a>[#7](decisions/project.md#7) | The kernel grows only when a consumer needs it, and sets no globals |
| <a id="8"></a>#8 | Retired: the gesture types moved into Flight (#32) and no longer take a vector type |
| <a id="9"></a>[#9](decisions/project.md#9) | Focus ships as imported API |
| <a id="10"></a>[#10](decisions/project.md#10) | `registry/flight-card` is documentation until a second consumer exists |
| <a id="11"></a>[#11](decisions/project.md#11) | The published package is staged, with the kernel bundled inside |
| <a id="12"></a>[#12](decisions/capture.md#12) | The capability check runs before a source is built |
| <a id="13"></a>[#13](decisions/capture.md#13) | A source adopts an unparented element and returns it on dispose |
| <a id="14"></a>[#14](decisions/capture.md#14) | GPU storage is reallocated by comparing sizes at upload |
| <a id="15"></a>[#15](decisions/capture.md#15) | The backing store floats inside a density band and is cut exact at rest |
| <a id="16"></a>#16 | Retired: removed; the passage scene was retired |
| <a id="17"></a>#17 | Retired: removed; the passage scene was retired |
| <a id="18"></a>#18 | Retired: removed; the passage scene was retired, and its library lessons live in #5 and #14 |
| <a id="19"></a>#19 | Retired: removed; the passage scene was retired |
| <a id="20"></a>#20 | Retired: merged into [#22](decisions/capture.md#22) |
| <a id="21"></a>[#21](decisions/capture.md#21) | The kernel owns the density laws, and no store exceeds the texture limit |
| <a id="22"></a>[#22](decisions/capture.md#22) | The kernel owns the pixel-grid phase law |
| <a id="23"></a>[#23](decisions/lab.md#23) | Tokens a lifted Surface reads live on `:root` |
| <a id="24"></a>[#24](decisions/surface.md#24) | A frame counts as presented only when a receipt names it |
| <a id="25"></a>[#25](decisions/surface.md#25) | A draw releases a presenter only if it reached the screen with color |
| <a id="26"></a>[#26](decisions/surface.md#26) | Unmounting the last Surface forces one more render |
| <a id="27"></a>[#27](decisions/handoff.md#27) | A handoff never doubles or drops translucent pixels |
| <a id="28"></a>[#28](decisions/handoff.md#28) | The crossing is a four-phase kernel law |
| <a id="29"></a>[#29](decisions/handoff.md#29) | Presentation is exclusive, and drawing is inclusive |
| <a id="30"></a>[#30](decisions/handoff.md#30) | Carried motion crosses mid-flight |
| <a id="31"></a>[#31](decisions/handoff.md#31) | Hold, handoff and lift are the vocabulary, and choreography is a function of progress |
| <a id="32"></a>[#32](decisions/project.md#32) | A law with one consumer lives with that consumer |
| <a id="33"></a>[#33](decisions/input.md#33) | Input follows the eye |
| <a id="34"></a>#34 | Retired: never assigned |
| <a id="35"></a>[#35](decisions/input.md#35) | Bend a Surface by moving vertices, never in the vertex shader |
| <a id="36"></a>[#36](decisions/capture.md#36) | Another material can sample a Surface that has only a source |
| <a id="37"></a>[#37](decisions/project.md#37) | A kernel law needs a caller, and a declared part needs a presenter |
| <a id="38"></a>[#38](decisions/project.md#38) | Agent tooling uses the existing owners and states its limits |
| <a id="39"></a>[#39](decisions/input.md#39) | One pure law picks the pointer route, and one pose feeds both routes |
| <a id="40"></a>#40 | Retired: removed; replaced by the current Surface API in #43, with its wait warning in #42 |
| <a id="41"></a>#41 | Retired: merged into [#43](decisions/surface.md#43); its postcard budgets live in `instruments/api-all-demos/README.md` |
| <a id="42"></a>[#42](decisions/surface.md#42) | Placement, renderer loss and routing follow the actual canvas and source |
| <a id="43"></a>[#43](decisions/surface.md#43) | Surface is one live HTML component with explicit parts |
| <a id="44"></a>[#44](decisions/capture.md#44) | Native text clarity is the default |
| <a id="45"></a>[#45](decisions/surface.md#45) | Retained content keeps React ownership and clips like the page |
| <a id="46"></a>#46 | Retired: removed; it recorded an open question and decided nothing |
| <a id="47"></a>#47 | Retired: merged into [#43](decisions/surface.md#43) |
| <a id="48"></a>[#48](decisions/capture.md#48) | Resize invalidation, lit sampling and release velocity |
| <a id="49"></a>#49 | Retired: removed; `AGENTS.md` and `docs/README.md` state its rule |
| <a id="50"></a>[#50](decisions/lab.md#50) | One light shades native type, controls and the postcard |
| <a id="51"></a>[#51](decisions/lab.md#51) | Paper geometry supplies appearance, input and shadow |
| <a id="52"></a>[#52](decisions/lab.md#52) | The lamp refracts the page through a hollow glass shell |
| <a id="53"></a>#53 | Retired: merged into [#51](decisions/lab.md#51) |
| <a id="54"></a>#54 | Retired: merged into [#52](decisions/lab.md#52) |
| <a id="55"></a>#55 | Retired: merged into [#50](decisions/lab.md#50) |
| <a id="56"></a>[#56](decisions/lab.md#56) | The headline demonstrates HTML, 3D and shaders |
| <a id="57"></a>[#57](decisions/lab.md#57) | The Light demo reveals together and falls back to native after four visible seconds |
| <a id="58"></a>#58 | Retired: merged into [#57](decisions/lab.md#57) |
| <a id="59"></a>#59 | Retired: removed; demos no longer render inside the site document (#75) |
| <a id="60"></a>[#60](decisions/capture.md#60) | Capture is an engine, and the binding never asks which one |
| <a id="61"></a>[#61](decisions/handoff.md#61) | A handoff works without `moveBefore` |
| <a id="62"></a>[#62](decisions/capture.md#62) | snapDOM pays for fonts once and paces a live source by a period |
| <a id="63"></a>[#63](decisions/handoff.md#63) | Preparation borrows the live node only for a caret |
| <a id="64"></a>[#64](decisions/capture.md#64) | What a texture follows, and where `live` applies |
| <a id="65"></a>[#65](decisions/handoff.md#65) | A lift releases the page only onto pixels read after the lift began |
| <a id="66"></a>[#66](decisions/handoff.md#66) | Declarative motion stands still while a canvas holds the content |
| <a id="67"></a>[#67](decisions/handoff.md#67) | Consumer clocks stop on `onFreezeChange`, before the capture |
| <a id="68"></a>[#68](decisions/handoff.md#68) | A crossing waits for evidence, not for time |
| <a id="69"></a>[#69](decisions/renderer.md#69) | `SurfaceCanvas` renders with `WebGPURenderer`, tone mapping off |
| <a id="70"></a>[#70](decisions/surface.md#70) | No receipt for a frame that could not be drawn |
| <a id="71"></a>[#71](decisions/renderer.md#71) | Surface draws with node materials |
| <a id="72"></a>[#72](decisions/renderer.md#72) | `SurfaceCanvas` draws through `DirectRenderPipeline` |
| <a id="73"></a>[#73](decisions/renderer.md#73) | `SurfaceCanvas` replaces a lost renderer |
| <a id="74"></a>[#74](decisions/capture.md#74) | Capture canvases use CPU storage on a software GPU |
| <a id="75"></a>[#75](decisions/lab.md#75) | The overview leads with a running demo, and one catalog lists the demos |
| <a id="76"></a>[#76](decisions/renderer.md#76) | A presenter first draws with pipelines already built |
| <a id="77"></a>[#77](decisions/handoff.md#77) | A capture transition applies each update once, behind its cover, within a bound |
| <a id="78"></a>[#78](decisions/input.md#78) | A nearer scene mesh takes the pointer from the Surface behind it |
| <a id="79"></a>[#79](decisions/renderer.md#79) | A finish is data on the Surface, and the canvas lights it |
| <a id="80"></a>[#80](decisions/renderer.md#80) | A glass finish samples the canvas once per render, decoded |
| <a id="81"></a>[#81](decisions/project.md#81) | `@petepetrash/munari/gpu`, Material Manifests, and `munari` CLI |
