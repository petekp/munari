# Add custom scene content

The snippets from here on assume a sized `SurfaceCanvas` is mounted on the page,
as in the [first example](../README.md#your-first-surface). Use the explicit composition form when the effect needs
its own meshes or logic:

```tsx
<Surface.Root inScene={selected} canvasId="controls">
  <Surface.HTML><ControlBoard /></Surface.HTML>
  <Surface.Scene>
    <Surface.Mesh alpha="source" pointerRoute="auto">
      <ControlsHardware />
    </Surface.Mesh>
  </Surface.Scene>
</Surface.Root>

<SurfaceCanvas id="controls"><ControlsLights /></SurfaceCanvas>
```

`ControlBoard`, `ControlsHardware`, and `ControlsLights` are application components
in this example. The first draws HTML; the second supplies the physical controls
and their motion; the third supplies ordinary R3F lights. Munari's `Surface.Mesh`
draws the captured HTML and provides its texture, named anchors, and input mapping.
See the complete [Controls caller](https://github.com/petekp/munari/blob/v0.4.1/apps/lab/src/scenes/controls/Controls.tsx).

`Surface.Scene` retains custom children through preparation, reversal, and return.
It contributes to the shared canvas rather than creating another renderer. Declare
it before it is requested. Shared cameras and lights belong under `SurfaceCanvas`.
Use `placement="manual"` and normal R3F geometry/transforms for scene-owned placement.
`group`, `mesh`, and `planeGeometry` are R3F's Three.js elements.

For several pieces of HTML that must transfer together, give each `Surface.HTML`
a distinct `part` name and select that part on its mesh. `sampledParts` records
additional sources sampled by a material. A manual pointer proxy cannot claim
those draw receipts. [Knobs](https://github.com/petekp/munari/blob/v0.4.1/apps/lab/src/scenes/knobs/Knobs.tsx) and
[Logo](https://github.com/petekp/munari/blob/v0.4.1/apps/lab/src/scenes/logo/Logo.tsx) show coordinated parts and anchors.

## Follow a drag on `window` in the capture phase

With `pointerMode="surfaces"`, a press on a Surface mesh belongs to the canvas
until it is released. Until then, the canvas pointer gate stops the browser's
`pointermove`, `pointerup` and `pointercancel` in the document's capture
phase and sends R3F a copy, whose `isTrusted` is false. So a scene that follows
the drag with `window` listeners adds them with `capture: true` to hear the
browser's own events.

## Materials on a SurfaceCanvas

`SurfaceCanvas` converts each fragment to the canvas's sRGB encoding and
blends it there, as `WebGLRenderer` did. The conversion expects premultiplied
color:

- A stock material that draws its own translucency, such as a fading
  `meshBasicMaterial`, sets `premultipliedAlpha: true`. With Three's default of
  `false`, its alpha applies twice and it draws too dark. `Surface.Mesh` sets
  the flag on the material in its `material` slot for you.
- A custom `outputNode` returns its color through `premultipliedOutput`, for
  premultiplied linear color, or `encodedOutput`, for premultiplied color
  already in sRGB. Both come from `@petepetrash/munari`.
- A material that samples a Surface capture returns it through
  `premultipliedOutput`. The capture is already premultiplied, so a `colorNode`
  or a stock `map` multiplies it by alpha again, and translucent pixels draw
  darker than the page. `premultipliedAlpha: true` does not fix that.
- A material that samples the canvas, such as Three's transmission or a
  viewport-texture node, draws too bright. Render the scene behind it into a
  render target and sample that instead, as `registry/glass/` does.

Opaque materials need neither. Custom materials are TSL node materials, because
the renderer does not accept GLSL. [Decision #72](https://github.com/petekp/munari/blob/v0.4.1/docs/decisions.md) has the
measurements.

### A custom material on Surface.Mesh

The slot does not apply the capture to the material, so the material samples it
itself. Build it in a component that calls `useSurfaceNodes()`, return it with
`<primitive attach="material" />`, and pass the component as `material`:

```tsx
import { useEffect, useMemo } from 'react'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { uv, vec3, vec4 } from 'three/tsl'
import { Surface, premultipliedOutput, useSurfaceNodes } from '@petepetrash/munari'

function TintMaterial() {
  const surface = useSurfaceNodes()
  const material = useMemo(() => {
    const m = new MeshBasicNodeMaterial({ transparent: true })
    const sample = surface.map.sample(uv()).mul(surface.radiusMask())
    m.outputNode = premultipliedOutput(vec4(sample.rgb.mul(vec3(0.5, 1, 1)), sample.a))
    return m
  }, [surface])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}

<Surface.Root inScene={inScene}>
  <Surface.HTML><Card /></Surface.HTML>
  <Surface.Scene>
    <Surface.Mesh material={<TintMaterial />} />
  </Surface.Scene>
</Surface.Root>
```

`surface.map` is the capture, `surface.radiusMask()` applies the Surface's
rounded corners, and the tint halves red in linear light. `useSurfaceNodes()`
and `useSurfaceTexture()` work only inside the component passed as `material`.

`material` also takes a material instance you own and dispose, such as
`material={tint}`. An instance cannot call `useSurfaceNodes()`, so one that
shows the capture builds its texture node from `useSurfaceTextureOf(handle)`,
which is `null` until the first upload.

For a lit slab, pass `material={<Surface.LitMaterial roughness={0.4} />}` and
add lights under `SurfaceCanvas`. A JSX tag such as `<meshBasicNodeMaterial />`
throws "is not part of the THREE namespace" until you register it with R3F's
`extend()`, so build the material as above instead.

### First draws and Surface.Prewarm

A `Surface.Mesh` in a `SurfaceCanvas`, and a `FrameSurface` given a
`presentation` requirement, first draw once their render pipelines are built.
Until then the content stays where it was. A shader that no browser cache
holds can take a few hundred milliseconds to build, and the content waits
that long to move into the scene.

To build them ahead, mount `Surface.Prewarm` in the `SurfaceCanvas` with
meshes that wear your presenters' materials:

```tsx
<SurfaceCanvas>
  <Surface.Prewarm alpha="source" onReady={() => setPrewarmed(true)}>
    <mesh>
      <planeGeometry />
      <TintMaterial />
    </mesh>
  </Surface.Prewarm>
  {/* Surfaces that mount later */}
</SurfaceCanvas>
```

The meshes are never drawn. Inside `Surface.Prewarm`, `useSurfaceNodes()`,
`useSurfaceTexture()` and `useFrameTexture()` return stand-in textures, so a
material component written for a `Surface.Mesh` works there unchanged.

A pipeline is reused only when everything three keys it by matches:

- the material's shader, blending and `side`
- the geometry's attributes
- `alpha`, which takes the same value as the presenters' `Surface.Mesh`

An opaque `Surface.Mesh` with rounded corners turns on `alphaToCoverage`,
so its stand-in material sets that too. `onReady` fires once every build has
finished. Keep `Surface.Prewarm` mounted while a presenter may need its
pipelines, because three deletes a pipeline that nothing uses.

Outside a `SurfaceCanvas`, in an R3F `Canvas` of your own, `Surface.Mesh`,
`Surface.LitMaterial` and `Surface.Prewarm` first render after Munari's scene
module loads. R3F's `Canvas` passes that wait to the page, so put a `Suspense`
boundary above the `Canvas`. Without one, the page stops committing updates
until the module arrives. A load that fails reaches the nearest error
boundary, and the next mount loads again.

## Renderer settings

`gl` passes options to the `WebGPURenderer` that `SurfaceCanvas` creates.
Two of them decide most of a canvas's GPU memory:

```tsx
<SurfaceCanvas gl={{ antialias: false, depth: false }}>
```

- `antialias` defaults to `true`. It smooths triangle edges by keeping 4 color
  and 4 depth samples per pixel. On WebGPU, those buffers take 32 bytes per
  canvas pixel, about 160 MB for a full-window canvas at 1440×900 and device
  pixel ratio 2. Turn it off when the canvas draws no visible triangle edges,
  such as a full-screen shader quad, or HTML on unrotated planes square to
  the camera.
- `depth` defaults to `true`. Turn it off when nothing on the canvas needs
  depth testing, such as a single mesh or transparent layers drawn in order.
  With `antialias` on, it saves half of those 32 bytes.

Three 0.186.1 ignores `antialias` on its WebGL 2 fallback, so a browser without
WebGPU draws aliased edges either way
([three.js#34947](https://github.com/mrdoob/three.js/issues/34947)).
