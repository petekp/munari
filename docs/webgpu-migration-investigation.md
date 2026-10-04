# WebGPU migration investigation

**Status: investigated 2026-10-05. Migration is unimplemented.**

Munari's existing DOM capture canvas works with WebGPU. The migration requires
changes to materials, renderer lifecycle, frame evidence, and browser checks.
Most of the kernel can stay. Migrating every lab scene is a larger task than
making the published binding support WebGPU.

Use Three's `WebGPURenderer` with Three Shading Language, or TSL. TSL describes
shaders in JavaScript and generates WGSL for WebGPU or GLSL for the renderer's
WebGL 2 backend. This permits one material implementation for both backends.
Three's fallback uses the new renderer and node materials. It does not make
existing custom GLSL materials compatible. [Three migration guide](https://threejs.org/manual/pages/webgpurenderer).

| Investigation baseline | Value |
| --- | --- |
| Repository commit | `9073983926173ece04cd307b67892ec952269581` |
| Branch | `pkp/browser-gate-recording` |
| Installed Three | `0.185.1` |
| Installed React Three Fiber | `9.7.0` |
| Installed Three types | `0.185.3` |
| Installed React | `19.2.8` |
| Diagnostic browser | Chrome `154.0.8037.98`, headless, macOS |
| Diagnostic GPU | Apple, `metal-3`, actual WebGPU backend |

The installed dependencies already expose the necessary renderer. Fiber v9
accepts an asynchronous `gl` factory that awaits renderer initialization.
`SurfaceCanvas` already forwards that prop. Its internals still assume WebGL.
A dependency upgrade alone will not migrate them. Published peer ranges need
validation against the chosen minimum versions before release. [Current host](../packages/react/src/primitives/surface/SurfaceCanvas.tsx),
[Fiber v9 WebGPU setup](https://r3f.docs.pmnd.rs/api/canvas#webgpu).

Consumers that supply a legacy `WebGLRenderer` or custom GLSL material need a
documented migration path. Preserve Surface identity, capture, motion, and input
interfaces where their behavior is unchanged. Choose support for legacy
renderer injection explicitly before changing the default.

A disposable diagnostic captured a retained DOM element with opaque red and
blue bands and a half-transparent green band. It exercised the current capture
engine, a standard WebGPU upload, and a Three `CanvasTexture` on a node material.

| Observation | Result and limit |
| --- | --- |
| Retained source | Original element identity preserved; completed capture generation `1` |
| Standard WebGPU upload | Opaque bands preserved; half-transparent green uploaded as `[0, 128, 0, 128]` with premultiplication enabled |
| Alpha control | Disabling premultiplication produced `[0, 255, 0, 128]`, which the pixel check distinguishes |
| Orientation control | `flipY` moved the green band from the bottom to the top |
| Three upload and draw | Actual WebGPU backend rendered the expected opaque bands; no reported errors |
| Naive node material | Half-transparent green rendered as `[0, 93, 0, 128]` into an sRGB target; this requires an explicit material output policy |
| Callback order | Mesh `onAfterRender` ran before queue submission; scene `onAfterRender` ran after submission |
| Lit texture synchronization | Material `onBeforeRender` was called zero times |
| Viewport API | `getCurrentViewport` was absent |
| Experimental direct upload | Both `copyElementImageToTexture` and `drawElementImageToTexture` were present under the flag |
| Separate no-flag Chrome | Both HTML-in-canvas capability checks were false; enhanced capture was unavailable |

The enhanced run used `--enable-features=CanvasDrawElement` and
`--enable-unsafe-webgpu`. This establishes a first-frame capture and off-screen
GPU readback. It does not establish a Surface handoff, displayed frame continuity,
live updates, resize recovery, snapDOM, device-loss recovery, or performance.
The no-flag run checked capability absence; it did not exercise a native Surface
fallback. The executable diagnostic is included at the end of this document.

## Necessary changes

| Owner | Required work |
| --- | --- |
| [SurfaceCanvas](../packages/react/src/primitives/surface/SurfaceCanvas.tsx) | Initialize and own the selected renderer correctly. Adapt render wrapping, submission timing, device loss, initialization failures, and fallback behavior. Keep caller-owned renderer instances under caller ownership. |
| [SurfaceMesh](../packages/react/src/primitives/surface/SurfaceMesh.tsx) and [surfaceMaterials](../packages/react/src/primitives/surface/surfaceMaterials.tsx) | Replace shader-string patches with node materials. Port corner masks, alpha discard, unlit output, lit sampling, emission, and shared material configuration. |
| [surfaceLitTexture](../packages/react/src/primitives/surface/surfaceLitTexture.ts) and [surfaceSourceRuntime](../packages/react/src/primitives/surface/surfaceSourceRuntime.ts) | Preserve capture generations, raw and sRGB texture views, resize allocation, mipmaps, and borrowed texture lifetime. Move lit-view synchronization to a callback the new renderer executes. |
| [FrameSurface](../packages/react/src/primitives/FrameSurface.tsx), [host registry](../packages/react/src/primitives/surface/surfaceHostRegistry.ts), and [manual presenters](../packages/react/src/primitives/surface/surfaceManualPresenter.ts) | Accept presentation only after an eligible draw reaches the output submission. Cover direct draws, intermediate targets, final composition, and FrameSurface's plain R3F Canvas use. |
| [Raster alignment](../packages/react/src/primitives/surface/surfaceRasterAlignment.ts) and [render-frame types](../packages/react/src/primitives/surface/surfaceFrame.ts) | Replace WebGL target types with `RenderTarget`. Read the active viewport in physical pixels, including render targets and DPR. Respect the camera's backend coordinate system. |
| [Public entries](../packages/react/src/index.ts) and [package build](../packages/react/tsdown.config.ts) | Provide node-compatible material helpers for custom consumers. Migrate the GLSL corner-mask contract and uniform examples. Keep Three subpath imports external and verify a packed consumer. |
| [Lab scenes](../apps/lab/src/scenes) | Port custom shaders, standalone renderers, multipass effects, and WebGL-specific helpers. Preserve each scene's appearance and interaction. |
| [Glass registry](../registry/glass) | Port the compositor and shader together with their lab copies. Preserve the vendored-file identity checks. |
| [Browser instruments](../instruments/README.md) | Add backend-specific shader validation, asynchronous GPU readback, loss injection, and actual backend checks. Keep screenshot and native input evidence. |

**Materials require a shader port.** Three does not support `ShaderMaterial`,
`RawShaderMaterial`, or `onBeforeCompile` customization in `WebGPURenderer`.
Munari uses shader patches even for its default Surface material, so switching
the host renderer leaves rounded-corner behavior unsupported. Custom consumers
also use the exported GLSL corner-mask helper and uniform objects. The node
replacement must keep each presenter's current texture, radii, and size connected
to the material. [Current material implementation](../packages/react/src/primitives/surface/surfaceMaterials.tsx),
[public GLSL helper](../packages/react/src/lib/surfaceRadiusGlsl.ts),
[Three supported material model](https://threejs.org/manual/pages/webgpurenderer#Migration).

Premultiplied alpha needs deliberate treatment. Three's node material output
multiplies RGB by alpha when `premultipliedAlpha` is enabled, including for
custom fragment output. A premultiplied texture sample must not receive that
weight twice. Preserve the library's upload and blending contract. For lit
materials, preserve its existing order: filter encoded channels, remove alpha,
decode sRGB for lighting, and apply output coverage once. Compare translucent
edges over light and dark backgrounds before selecting the node implementation.
[Alpha contract and amendments](decisions.md#5),
[current raw texture view](../packages/react/src/primitives/surface/surfaceLitTexture.ts),
[pinned node output implementation](https://github.com/mrdoob/three.js/blob/2431a09f46f34c560bc8e44b33be0e567723d5b9/src/materials/nodes/NodeMaterial.js#L1184).

**Frame evidence is the main correctness risk.** A presentation receipt is the
record that permits Munari to release the page's pixels. The current binding
uses texture update and mesh callbacks to produce these records. Pinned Three
can run the mesh callback while skipping a draw whose pipeline is unavailable.
It also catches canvas-copy exceptions before calling `texture.onUpdate`.
Those callbacks alone cannot establish the same evidence on the new renderer.
[Current presentation contract](decisions.md#25),
[pinned render lifecycle](https://github.com/mrdoob/three.js/blob/2431a09f46f34c560bc8e44b33be0e567723d5b9/src/renderers/common/Renderer.js),
[pinned copy exception handling](https://github.com/mrdoob/three.js/blob/2431a09f46f34c560bc8e44b33be0e567723d5b9/src/renderers/webgpu/utils/WebGPUTextureUtils.js#L930).

Track capture, upload, encoded draw, and output submission separately. Defer
presentation candidates to a submission boundary. Reject candidates with stale
source identity, unavailable pipelines, failed uploads, disabled color writes,
or output that never reaches the canvas. Preserve write-free preparation and
the final clearing draw after removal. GPU completion and browser presentation
remain different observations. Waiting for `onSubmittedWorkDone()` on every
frame would add latency and would still not prove screen presentation.

Start with the existing host registry and render wrapper. The new renderer's
public render-object callback and draw counters are candidate ways to observe
encoded draws. A focused experiment must establish whether they distinguish
the required cases before implementation relies on them. If they cannot,
the missing signal belongs in the renderer integration or upstream Three.
A general renderer framework is unnecessary for this requirement.
[Pinned renderer API](https://github.com/mrdoob/three.js/blob/2431a09f46f34c560bc8e44b33be0e567723d5b9/src/renderers/common/Renderer.js#L2665),
[pinned draw accounting](https://github.com/mrdoob/three.js/blob/2431a09f46f34c560bc8e44b33be0e567723d5b9/src/renderers/common/Info.js).

**The host needs compatible lifecycle and measurement APIs.** After
`await renderer.init()`, pinned Three's `render()` is synchronous.
`renderAsync()` is deprecated. Fiber v9 can schedule the initialized renderer,
so making every frame asynchronous is unnecessary. However, Fiber's store
still types `gl` as `WebGLRenderer`. Munari needs a checked renderer type at
the binding boundary instead of letting that type hide missing methods.
[Pinned renderer initialization](https://github.com/mrdoob/three.js/blob/2431a09f46f34c560bc8e44b33be0e567723d5b9/src/renderers/common/Renderer.js#L1362),
[pinned Fiber store](https://github.com/pmndrs/react-three-fiber/blob/0a107412ac64667b1908422e859447952f57feef/packages/fiber/src/core/store.ts).

The new renderer's `getViewport()` reports logical canvas units. It is not a
direct replacement for WebGL's current viewport in physical pixels. Output
targets and internal color-processing targets also complicate a simple
`getRenderTarget() === null` screen check. Normalize the actual pass target,
viewport, and camera before raster alignment and companion reads.
WebGPU uses a different clip-depth range. Three updates camera projection for
the backend, but Munari currently prepares its companions before that render.
Check first-frame projection, near-plane clipping, target orientation, and
native pointer placement. [Current pass preparation](../packages/react/src/primitives/surface/SurfaceCanvas.tsx),
[current raster preparation](../packages/react/src/primitives/surface/SurfaceMesh.tsx),
[pinned common renderer](https://github.com/mrdoob/three.js/blob/2431a09f46f34c560bc8e44b33be0e567723d5b9/src/renderers/common/Renderer.js).

WebGPU device loss uses `onDeviceLost`, rather than the host's current WebGL
canvas events. Revoke renderer presentation and restore the retained native
content when the device fails. Decide whether recovery recreates the renderer;
it does not have WebGL's restoration event. Handle rejected initialization and
unmount during initialization separately. Chain Three's loss and error behavior
when installing callbacks. Strict acceptance must inspect the selected backend,
because `isWebGPURenderer` remains true after WebGL fallback.
[Current host loss handling](../packages/react/src/primitives/surface/SurfaceCanvas.tsx),
[pinned backend selection](https://github.com/mrdoob/three.js/blob/2431a09f46f34c560bc8e44b33be0e567723d5b9/src/renderers/webgpu/WebGPURenderer.js),
[pinned device loss handling](https://github.com/mrdoob/three.js/blob/2431a09f46f34c560bc8e44b33be0e567723d5b9/src/renderers/webgpu/WebGPUBackend.js#L262).

WebGPU needs a secure context and an available adapter/device. Keep renderer
readiness separate from capture availability. `supportsSurfaces()` currently
checks the capture engine, and a WebGL fallback can still use that engine.
Checking `navigator.gpu` alone answers neither question.
[Current support check](../packages/react/src/primitives/surface/surfaceSupport.ts),
[WebGPU context requirements](https://gpuweb.github.io/gpuweb/#navigator-gpu).

**Capture can keep its existing ownership.** Both capture engines produce
2D canvases. The native capture and raw WebGPU copy succeeded in the diagnostic.
Keep the capture canvas, retained element, paint generation, anchor generation,
and native input host under their current owners. Keep the storage-size and
mipmap allocation guards. GPU texture dimensions are still fixed at allocation.
Core's state machines, physics, DOM event relay, and matrix-based pointer mapping
do not need a GPU dependency. [Capture engine boundary](../packages/core/src/paint/captureEngine.ts),
[source runtime](../packages/react/src/primitives/surface/surfaceSourceRuntime.ts),
[WebGPU external-image source contract](https://gpuweb.github.io/gpuweb/#gpucopyexternalimagesourceinfo).

Three's direct `HTMLTexture` route reparents content under the renderer canvas
and installs its paint callback. Replacing Munari's capture with it would change
source-host ownership, native hit testing, page preparation, and source lifetimes.
That is a separate design change with no demonstrated need for this migration.
[Pinned HTMLTexture host management](https://github.com/mrdoob/three.js/blob/2431a09f46f34c560bc8e44b33be0e567723d5b9/src/renderers/common/Textures.js#L240).

Chrome documents new capture names, drawable markup, and geometry synchronization
in Chrome 155. The origin trial is extended through Chrome 160. Both old and new
WebGPU upload methods were present in the flagged Chrome 154 diagnostic, so a
rename alone does not establish a failure. Check the supported browser versions
and feature-detect the required capture setup. This capture compatibility work
applies to WebGL too. WebGPU availability does not grant HTML-in-canvas capture
capability in other browsers. [Chrome API changes](https://developer.chrome.com/blog/html-in-canvas-ot-changes),
[capture proposal](https://wicg.github.io/html-in-canvas/).

**The lab needs a separate shader and effect migration.** Port each scene's
custom shader while retaining its pure laws and CPU deformation. Multipass
effects need the new renderer's target, depth, and output conventions.

| Scene group | Concrete migration work |
| --- | --- |
| Default postcard and lit controls | [Home postcard shader patch](../apps/lab/src/scenes/postcard/PostcardMaterial.tsx), Surface materials, masks, light and emission |
| Glass | [SDF compositor](../apps/lab/src/scenes/glass/glassSdf.tsx), depth sampling, final blit, manual receipts, and the [Drei transmission material](../apps/lab/src/scenes/glass/Glass.tsx) that patches GLSL |
| Logo and Refraction | [Logo field passes](../apps/lab/src/scenes/logo/logoFields.ts) and [Refraction field passes](../apps/lab/src/scenes/refraction/refractionField.tsx), target formats, sampling, and custom output |
| Home, Lamp, Rain, Gravity, and Marble Hand backgrounds | Standalone `WebGLRenderer` creation, material compatibility, resize, loss handling, and renderer-specific environment generation |
| Fisheye, Flight, Genie, Knobs, Optics, Plume, Selection, Slider, Veil, Crystal, and candidates | Custom material declarations and GLSL helpers; preserve drawn deformation, CPU hit geometry, motion, and input |

The current shader gate hooks WebGL shader compilation and program linking.
It cannot validate WGSL. Add GPU shader diagnostics and validation errors to
the new path, require the actual backend, and confirm each intended scene state
was exercised. Replace direct `gl.readPixels` calls with asynchronous target
readback where that measures the same contract. Keep compositor recordings and
native event checks for behavior that readback cannot prove.
[Current shader gate](../instruments/shader-compile/run.mjs),
[current frame readback fixture](../instruments/frame-surface/main.tsx).

## Proposed migration sequence

1. **Resolve frame evidence and material output in one small fixture.** The
   capture bridge has passed locally. The remaining experiment must use the
   actual source runtime and presenter. Exercise missing pipelines, failed
   uploads, write-free preparation, a final output pass, translucent pixels,
   mutation, and resize. Require that invalid draws leave native content visible.
   Owners: renderer integration, materials, and browser instruments.

2. **Port the binding and built-in materials using the new renderer's WebGL
   backend first.** This separates node-material and host changes from native
   WebGPU changes. Adapt viewport and target reads, lit texture synchronization,
   receipts, and public material helpers. Keep the retained DOM and capture
   interfaces. Owners: `packages/react` and its public consumer examples.

3. **Verify native WebGPU on a simple Surface and FrameSurface.** Exercise
   page-to-scene and return handoffs, retained input/focus, shared-host warm-up,
   off-screen composition, sharpness, device loss, failed startup, unmount, and
   the final clearing draw. Run the same cases with `forceWebGL` separately.
   Check HTML-in-canvas, snapDOM, and native-only fallback as distinct paths.
   Owners: binding lifecycle and the existing instrument fixtures.

4. **Port and verify scenes in groups.** Start with the postcard and a lit
   control. Then migrate custom surface effects, multipass compositors, and
   standalone renderers. Replace each migrated GLSL implementation with its
   node implementation. Change welded registry copies in the same change.
   Owners: each scene and registry entry.

5. **Verify the package and acceptance tooling before changing the default.**
   Run the required tests, four typechecks, lint, and package build. Validate a
   packed external consumer and the minimum peer versions. Reuse the existing
   handoff, frame, shader, idle, resize, sharpness, and pointer checks after their
   renderer-specific measurements are adapted. Update owning decisions and
   examples with the supported behavior. Investigate current CI GPU capability
   before proposing any runner or launch changes. Specific CI or release-tooling
   changes require separate approval under the repository's rules.

The published binding can support WebGPU before every lab scene is ported.
Calling the whole repository migrated requires the scene, registry, package,
and browser evidence above. No performance comparison or complete Surface
handoff was run in this investigation.

<details>
<summary>Reproduce the disposable capture diagnostic</summary>

Save the three source blocks below under `/private/tmp/munari-webgpu-probe`.
They use this checkout's absolute path and installed dependencies. Adjust those
paths if the checkout moves. No dependencies are installed and no production
source is modified.

Start the server with its output redirected to a log:

```sh
node /private/tmp/munari-webgpu-probe/server.mjs > /private/tmp/munari-webgpu-server.log 2>&1
```

Read the URL from that log. In another terminal, use a dedicated browser session:

```sh
agent-browser --session munari-webgpu-research --executable-path '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --webgpu --args '--enable-features=CanvasDrawElement' --no-webmcp open <URL-from-log>
agent-browser --session munari-webgpu-research eval 'window.__webgpuProbe' --json
agent-browser --session munari-webgpu-research close
```

Wait for the result object. Require `pass: true`, `backend.webgpu: true`, and
an empty `errors` array. The result prints to the page too. For the separate
capability control, launch a fresh session without `--webgpu` or `--args`.
Missing capture capability is an unverified enhanced path, not a migration pass.
Close that browser and stop the server with Ctrl-C when finished.

The diagnostic temporarily observes queue submission and callbacks. Those
observations are diagnostic code, not a production integration proposal.

`index.html`

```html
<!doctype html><html><head><meta charset="utf-8"><title>Munari WebGPU capture probe</title></head><body><pre id="result">Running</pre><script type="module" src="/main.js"></script></body></html>
```

`server.mjs`

```javascript
import { createServer } from '/Users/petepetrash/Code/munari/node_modules/vite/dist/node/index.js'
const server = await createServer({ configFile: false, root: '/private/tmp/munari-webgpu-probe', logLevel: 'warn', server: { host: '127.0.0.1', port: 0, fs: { allow: ['/private/tmp/munari-webgpu-probe', '/Users/petepetrash/Code/munari'] } } })
await server.listen()
console.log(JSON.stringify({ url: `http://127.0.0.1:${server.httpServer.address().port}`, pid: process.pid }))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0) })
```

`main.js`

```javascript
import { createDomTextureSource, detectHtmlInCanvas } from '/@fs/Users/petepetrash/Code/munari/packages/core/src/index.ts'
import * as THREE from '/@fs/Users/petepetrash/Code/munari/node_modules/three/build/three.webgpu.js'

const result = { browser: navigator.userAgent, capability: detectHtmlInCanvas(), secure: isSecureContext, errors: [], stages: [] }
const originalError = console.error.bind(console)
console.error = (...args) => { result.errors.push(args.map(String).join(' ')); originalError(...args) }
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
const pixel = (bytes, x, y) => Array.from(bytes.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4))
const matches = (actual, wanted) => actual.every((value, index) => Math.abs(value - wanted[index]) <= 1)
let source, renderer, device, target, captureTexture, material, geometry
try {
  if (!result.capability.drawElementImage || !navigator.gpu) throw new Error('Required HTML capture or WebGPU API absent')
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('WebGPU adapter unavailable')
  result.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description, fallback: adapter.info.isFallbackAdapter }
  device = await adapter.requestDevice()
  device.addEventListener('uncapturederror', event => result.errors.push(event.error.message))
  result.directElementMethods = { old: typeof device.queue.copyElementImageToTexture === 'function', current: typeof device.queue.drawElementImageToTexture === 'function' }
  const element = document.createElement('div')
  element.style.cssText = 'width:64px;height:64px;background:transparent'
  element.innerHTML = '<div style="height:24px;background:rgb(255,0,0)"></div><div style="height:24px;background:rgb(0,0,255)"></div><div style="height:16px;background:rgba(0,255,0,0.5)"></div>'
  source = createDomTextureSource(element, 64, 64, { scale: 1, live: false })
  const deadline = performance.now() + 10000
  let nativePixels
  while (performance.now() < deadline) {
    await nextFrame()
    nativePixels = source.canvas.getContext('2d').getImageData(0, 0, 64, 64).data
    if (source.painted() && matches(pixel(nativePixels, 8, 8), [255,0,0,255])) break
  }
  result.source = { painted: source.painted(), identityPreserved: source.element === element, generation: source.currentPaint()?.frame.generation, top: pixel(nativePixels,8,8), middle: pixel(nativePixels,8,32), bottom: pixel(nativePixels,8,56) }
  if (!matches(result.source.top,[255,0,0,255]) || !matches(result.source.bottom,[0,255,0,128])) throw new Error('Native capture did not contain expected pixels')
  async function copyRead(premultipliedAlpha, flipY) {
    const texture = device.createTexture({ size: [64,64], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    const buffer = device.createBuffer({ size: 64*256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    device.pushErrorScope('validation')
    device.queue.copyExternalImageToTexture({ source: source.canvas, flipY }, { texture, premultipliedAlpha }, [64,64])
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({texture}, {buffer, bytesPerRow:256}, [64,64])
    device.queue.submit([encoder.finish()])
    await buffer.mapAsync(GPUMapMode.READ)
    const bytes = new Uint8Array(buffer.getMappedRange())
    const pixels = {top:pixel(bytes,8,8),middle:pixel(bytes,8,32),bottom:pixel(bytes,8,56)}
    buffer.unmap(); buffer.destroy(); texture.destroy()
    const error = await device.popErrorScope()
    if(error) throw new Error(error.message)
    return pixels
  }
  result.premultipliedCopy = await copyRead(true, false)
  result.straightControl = await copyRead(false, false)
  result.flipControl = await copyRead(true, true)
  if (!matches(result.premultipliedCopy.bottom,[0,128,0,128]) || !matches(result.straightControl.bottom,[0,255,0,128]) || !matches(result.flipControl.top,[0,128,0,128])) throw new Error('WebGPU copy violated alpha or orientation checks')
  renderer = new THREE.WebGPURenderer({ device, antialias:false, alpha:true })
  await renderer.init()
  renderer.setSize(64,64)
  renderer.setPixelRatio(1)
  renderer.toneMapping=THREE.NoToneMapping
  result.backend = { webgpu: renderer.backend.isWebGPUBackend === true, currentViewport: typeof renderer.getCurrentViewport, materialBeforeRenderCalls: 0 }
  if(!result.backend.webgpu) throw new Error('Three renderer selected fallback backend')
  captureTexture = new THREE.CanvasTexture(source.canvas)
  captureTexture.colorSpace = THREE.SRGBColorSpace
  captureTexture.premultiplyAlpha = true
  captureTexture.generateMipmaps = false
  captureTexture.minFilter = THREE.NearestFilter
  captureTexture.magFilter = THREE.NearestFilter
  captureTexture.onUpdate = () => result.stages.push('texture-onUpdate')
  material = new THREE.MeshBasicNodeMaterial({map:captureTexture,transparent:true,premultipliedAlpha:true,toneMapped:false})
  material.onBeforeRender = () => result.backend.materialBeforeRenderCalls++
  geometry = new THREE.PlaneGeometry(2,2)
  const mesh = new THREE.Mesh(geometry,material)
  mesh.onBeforeRender = () => result.stages.push('mesh-before')
  mesh.onAfterRender = () => result.stages.push('mesh-after')
  const scene = new THREE.Scene(); scene.add(mesh)
  scene.onAfterRender = () => result.stages.push('scene-after')
  const camera = new THREE.OrthographicCamera(-1,1,1,-1,0.1,10); camera.position.z=1
  target = new THREE.RenderTarget(64,64,{type:THREE.UnsignedByteType,depthBuffer:false})
  target.texture.colorSpace = THREE.SRGBColorSpace
  renderer.setRenderTarget(target)
  const submit=device.queue.submit.bind(device.queue)
  device.queue.submit=(...args)=>{result.stages.push('queue-submit');return submit(...args)}
  renderer.render(scene,camera)
  const bytes=await renderer.readRenderTargetPixelsAsync(target,0,0,64,64)
  device.queue.submit=submit
  result.threePixels={top:pixel(bytes,8,8),middle:pixel(bytes,8,32),bottom:pixel(bytes,8,56)}
  result.threeOpaqueBandsPass = [result.threePixels.top,result.threePixels.bottom].some(p=>matches(p,[255,0,0,255])) && matches(result.threePixels.middle,[0,0,255,255])
  if(!result.threeOpaqueBandsPass) throw new Error('Three CanvasTexture did not render expected opaque bands')
  result.pass=result.errors.length===0
} catch(error) {
  result.pass=false; result.failure=String(error)
} finally {
  target?.dispose();captureTexture?.dispose();material?.dispose();geometry?.dispose();renderer?.dispose();source?.dispose()
  if(!renderer)device?.destroy()
  window.__webgpuProbe=result
  document.querySelector('#result').textContent=JSON.stringify(result,null,2)
}
```

</details>
