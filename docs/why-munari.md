# Why Munari

Chrome 157 ships HTML-in-canvas (`content="drawable"` and `drawElementImage`) on by default. If you want a Chrome-only demo where one element lives permanently inside `<canvas content="drawable">` on a flat quad, the browser handles capture, focus, text selection, typing, and tilted hit-testing in about fifty lines of code.

Munari (`@petepetrash/munari`) is for what happens next, when that effect has to behave like real product UI:

- Components start in normal page flow and enter 3D only when needed, with zero blank swap frames.
- Meshes bend, curl, or refract in shaders without breaking clicks, `:hover`, or scroll.
- 3D bodies and shadows align with responsive CSS layout on the exact frame its pixels upload.
- Resizing and camera zoom sharpen text without zeroing the capture buffer, and idle scenes sleep at `0 fps`.
- One React component runs on Chrome 157+, Safari, Firefox, and iOS without maintaining two UIs.

Run `npm run lab` to try the linked scenes locally, or see the [Root README](../README.md) for setup.

## 1. Normal page HTML at rest, zero-flash handoff into 3D

### What breaks from scratch

Raw `drawElementImage` only accepts immediate children of a `<canvas>` ([platform.md #10](platform.md)). Keeping UI permanently inside `<canvas>` clips `box-shadow` and outlines at the element's border box ([platform.md #9](platform.md)) and forces WebGPU to draw resting content.

Keeping the component in normal document flow and toggling visibility from React state fails in two ways:

1. **Blank or doubled swap frames:** React hides the page DOM before `WebGPURenderer` finishes async pipeline compilation, uploads the texture, and completes any off-screen post-processing pass.
2. **Lost DOM state on reparent:** Moving an element with `appendChild` blurs focused inputs, clears text selection, resets `scrollTop` to `0`, and restarts CSS animations from `0 ms`.

### What Munari does

Munari mounts your React subtree once. On lift, it runs a write-free GPU warm-up pass while the page HTML stays visible, verifies that a color-writing pass drew primitives to the screen, and hides the page slot inside that same frame. It moves the live DOM node with `Element.moveBefore` where supported and restores focus, selection direction, scroll offsets, and CSS animation `currentTime` where `moveBefore` is absent.

```tsx
import { useId, useState } from 'react'
import { Surface, SurfaceCanvas, useSurfaceSupport } from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

function NoteCard() {
  const [title, setTitle] = useState('Draft')
  return (
    <form style={{ width: 320, padding: 16 }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} />
      <div style={{ maxHeight: 96, overflowY: 'auto' }}>
        <p>Select text or scroll here, then toggle 3D mid-edit.</p>
      </div>
    </form>
  )
}

export function CardHandoff() {
  const canvasId = useId()
  const supported = useSurfaceSupport()
  const [inScene, setInScene] = useState(false)

  return (
    <section style={{ position: 'relative', minHeight: 360 }}>
      {supported && (
        <SurfaceCanvas
          id={canvasId}
          pointerMode="surfaces"
          frameloop="demand"
          style={{ position: 'absolute', inset: 0 }}
        />
      )}
      <Surface canvasId={canvasId} inScene={inScene}>
        <NoteCard />
      </Surface>
      <button type="button" disabled={!supported} onClick={() => setInScene((v) => !v)}>
        {inScene ? 'Return to page' : 'Lift into 3D'}
      </button>
    </section>
  )
}
```

When a custom compositor renders Surfaces into off-screen render targets first, `useSurfaceOutput([sceneTarget])` from `@petepetrash/munari/advanced` defers page release until the final screen draw completes.

**Lab examples:** [Postcard](../apps/lab/src/scenes/postcard/Postcard.tsx), [Flight](../apps/lab/src/scenes/flight/Flight.tsx), [Genie](../apps/lab/src/scenes/genie/Genie.tsx), and [Glass](../apps/lab/src/scenes/glass/Glass.tsx).

## 2. Input that survives flat poses, curved meshes, and full-page overlays

### What breaks from scratch

Chrome's native `<canvas content="drawable">` hit-testing maps a single flat `4x4` matrix and clips hits to the canvas box ([platform.md #18](platform.md)). Two things break in real scenes:

1. **Vertex shaders leave hit boxes flat:** Displacing vertices in a shader moves the pixels on screen while Three.js and the browser keep hit-testing the flat plane. In the lab's fisheye list, a shader-only warp misses clicks by `60 px` vertically and over `100 px` horizontally.
2. **Overlay canvases block the page:** A full-viewport `<canvas>` positioned above page content swallows clicks and wheel scroll meant for ordinary HTML underneath.

### What Munari does

`SurfaceCanvas` with `pointerMode="surfaces"` raycasts only registered Surface meshes and keeps the `<canvas>` transparent to pointer events everywhere else.

On each Surface, `pointerRoute="auto"` chooses the strongest input path per frame:

- **Planar, front-facing poses in Chrome:** Uses native browser `matrix3d` hit-testing for `isTrusted: true` clicks, real `:hover` and `:active`, click-and-drag text selection, and native `<select>` menus.
- **Deformed poses or fallback browsers:** Calling `deformSurfaceGeometry` moves CPU vertices in DOM pixel coordinates, updates Three's cached bounding sphere, and switches that Surface to UV-to-DOM pointer relay. The relay maps raycast UVs to the deepest hit-testable DOM node, mirrors `:hover` and `:active` chains onto `[data-hover]` and `[data-active]`, suppresses keyboard-only `:focus-visible` rings on pointer clicks via `[data-pointer-focus]`, and chains `WheelEvent` scrolling before camera zoom.

```tsx
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, deformSurfaceGeometry } from '@petepetrash/munari'

function CurvedSheet({ width, height }: { width: number; height: number }) {
  const geoRef = useRef<THREE.PlaneGeometry>(null)

  useFrame(({ clock }) => {
    const geometry = geoRef.current
    if (!geometry) return
    const t = clock.getElapsedTime()
    deformSurfaceGeometry(geometry, [width, height], (x, y) => ({
      x,
      y,
      z: Math.sin((x / width) * Math.PI * 2 + t) * 18,
    }))
  })

  return (
    <Surface.Mesh pointerRoute="auto">
      <planeGeometry ref={geoRef} args={[1, 1, 48, 24]} />
    </Surface.Mesh>
  )
}

export function WavingForm({ inScene }: { inScene: boolean }) {
  return (
    <Surface.Root inScene={inScene}>
      <Surface.HTML>
        <div style={{ width: 360, height: 220 }}>
          <input placeholder="Still focusable and clickable while waving" />
          <button type="button">Submit</button>
        </div>
      </Surface.HTML>
      <Surface.Scene>
        <CurvedSheet width={360} height={220} />
      </Surface.Scene>
    </Surface.Root>
  )
}
```

**Lab examples:** [Fisheye](../apps/lab/src/scenes/fisheye/Fisheye.tsx), [Slider](../apps/lab/src/scenes/slider/Slider.tsx), [Optics](../apps/lab/src/scenes/optics/Optics.tsx), and [Gravity](../apps/lab/src/scenes/gravity/Gravity.tsx).

## 3. Paint-matched 3D anchors and color-exact TSL materials

### What breaks from scratch

Combining HTML textures with 3D geometry and shaders exposes two mismatches:

1. **Layout-to-texture lag:** Reading `getBoundingClientRect()` to place 3D caps, bezels, or shadows updates on the layout frame, while the captured texture uploads a frame later. During responsive resizes, 3D parts visibly lead the HTML pixels underneath them.
2. **Dark fringes and shifted UI colors:** Captured DOM textures use premultiplied sRGB alpha. Stock Three.js materials multiply RGB by alpha a second time, darkening translucent edges, while renderer tone mapping shifts UI brand colors away from the page CSS.

### What Munari does

Mark any DOM descendant with `data-munari-anchor="name"` and mount 3D children inside `<Surface.Anchor name="name">`. `useSurfaceAnchorBox()` exposes that element's dimensions locked to the paint generation currently on the mesh, so 3D hardware and HTML pixels move on the exact same frame.

For shaders, `SurfaceCanvas` leaves renderer tone mapping off so HTML colors match the DOM `0/255`. Custom TSL node materials read `useSurfaceNodes()` and wrap linear premultiplied output in `premultipliedOutput()`, or use `<Surface.LitMaterial>` for lit surfaces.

```tsx
import { useEffect, useMemo } from 'react'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { uv, vec3, vec4 } from 'three/tsl'
import {
  Surface,
  premultipliedOutput,
  useSurfaceAnchorBox,
  useSurfaceNodes,
} from '@petepetrash/munari'

function ButtonBezel() {
  const box = useSurfaceAnchorBox()
  if (!box) return null
  return (
    <mesh position={[0, 0, -6]}>
      <boxGeometry args={[box.width + 8, box.height + 8, 12]} />
      <meshStandardMaterial color="#2148bd" roughness={0.35} />
    </mesh>
  )
}

function CoolTintMaterial() {
  const surface = useSurfaceNodes()
  const material = useMemo(() => {
    const m = new MeshBasicNodeMaterial({ transparent: true })
    const sample = surface.map.sample(uv()).mul(surface.radiusMask())
    m.outputNode = premultipliedOutput(vec4(sample.rgb.mul(vec3(0.85, 0.95, 1)), sample.a))
    return m
  }, [surface])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}

export function HardwareForm({ inScene }: { inScene: boolean }) {
  return (
    <Surface.Root inScene={inScene}>
      <Surface.HTML>
        <div style={{ width: 300, padding: 20 }}>
          <button type="button" data-munari-anchor="cta">Save changes</button>
        </div>
      </Surface.HTML>
      <Surface.Scene>
        <Surface.Mesh alpha="source" material={<CoolTintMaterial />}>
          <Surface.Anchor name="cta">
            <ButtonBezel />
          </Surface.Anchor>
        </Surface.Mesh>
      </Surface.Scene>
    </Surface.Root>
  )
}
```

**Lab examples:** [Controls](../apps/lab/src/scenes/controls/Controls.tsx), [Knobs](../apps/lab/src/scenes/knobs/Knobs.tsx), and [Crystal](../apps/lab/src/scenes/crystal/Crystal.tsx).

## 4. Sharp text across resizes, camera zoom, and `0 fps` idle

### What breaks from scratch

1. **Per-frame resizes upload blank textures:** Writing `canvas.width` or `canvas.height` clears the backing store synchronously, while Chrome's `onpaint` refill arrives after the current frame ([platform.md #12](platform.md)). Resizing a capture canvas on every animation frame uploads blank pixels on `38 of 40` frames.
2. **Fixed density blurs zoomed panels:** Sharing one `<canvas>` pins every child to a single backing-to-CSS ratio ([platform.md #15](platform.md)), blurring typography when the camera moves close to a panel.
3. **Idle render loops drain battery:** Keeping `requestAnimationFrame` running after a transition finishes burns GPU every frame when nothing on screen is changing.

### What Munari does

Each Surface manages its own backing-store hysteresis band (`storeForBox`). During continuous resizes or camera-distance LOD steps, Munari carries existing pixels across intermediate sizes without blanking and settles to an exact `1:1` raster once motion stops. Upright Surfaces snap to the device pixel grid so `1 px` borders match adjacent DOM.

With `frameloop="demand"`, work claims reference-count active captures, transitions, and motion drivers, dropping the renderer to `0` frames and `0` paints per second as soon as every Surface settles.

```tsx
import { FocusGroup, FocusScene, SceneSurface, SurfaceCanvas } from '@petepetrash/munari'

export function SpatialBoard() {
  return (
    <SurfaceCanvas frameloop="demand" camera={{ position: [0, 0, 5], fov: 45 }}>
      <FocusScene>
        <group position={[-1.4, 0, 0]}>
          <FocusGroup id="metrics">
            <SceneSurface size={[320, 200]}>
              <div style={{ width: 320, height: 200, padding: 16, background: '#fff' }}>
                <h3>Latency</h3>
                <p>Click or Tab to approach; text re-rasters at the closer LOD tier.</p>
              </div>
            </SceneSurface>
          </FocusGroup>
        </group>
      </FocusScene>
    </SurfaceCanvas>
  )
}
```

**Lab examples:** [Workspace](../apps/lab/src/scenes/workspace/Workspace.tsx) and [Unroll](../apps/lab/src/scenes/candidates/CandidateUnroll.tsx).

## 5. Non-destructive page capture for lenses and reflections

### What breaks from scratch

Some effects should never move the HTML into `<canvas>` at all: you want native document scrolling and text selection while a 3D glass lens, blur veil, or marble reflection samples the live page underneath. Cloning `document.body` or an `<article>` by hand drops form values, `::before` and `::after` rules, and scroll offsets, and storing frames in React state re-renders the component tree on every paint.

### What Munari does

`useElementCapture()` keeps the native element untouched in the page, mirrors computed styles, pseudo-elements, form values, and scroll offsets into a capture source, and exposes the latest GPU texture through `useCaptureFrame(capture).get()` without triggering React re-renders per frame.

```tsx
import { useFrame } from '@react-three/fiber'
import { SurfaceCanvas, useCaptureFrame, useElementCapture, type CaptureHandle } from '@petepetrash/munari'

function GlassBackdrop({ capture }: { capture: CaptureHandle }) {
  const frame = useCaptureFrame(capture)
  useFrame(() => {
    const latest = frame.get()
    if (!latest) return
    // Sample `latest.texture` in your lens or reflection material.
  })
  return null
}

export function PageWithLens() {
  const capture = useElementCapture()
  return (
    <>
      <article ref={capture.ref}>
        <h2>Native article</h2>
        <p>Select this text normally while the 3D scene samples its pixels.</p>
      </article>
      <SurfaceCanvas frameloop="demand" pointerMode="surfaces">
        <GlassBackdrop capture={capture} />
      </SurfaceCanvas>
    </>
  )
}
```

**Lab examples:** [Selection](../apps/lab/src/scenes/selection/Selection.tsx), [Veil](../apps/lab/src/scenes/veil/Veil.tsx), [Light](../apps/lab/src/scenes/light/Light.tsx), and [Marble Hand](../apps/lab/src/scenes/marble-hand/MarbleHand.tsx).

## 6. One component across Chrome 157+, Safari, Firefox, and iOS

### What breaks from scratch

HTML-in-canvas does not exist in Safari, Firefox, or any iOS browser. A scratch `drawElementImage` implementation either leaves non-Chrome users with a broken UI or requires building a parallel fallback path. Wiring a generic DOM-to-SVG rasterizer hits browser-specific traps measured in [platform.md #24–#31](platform.md):

- WebKit's canvas exporter softens `1 px` borders and type by roughly a third of edge contrast unless you decode and draw the raw SVG directly.
- Re-embedding webfonts on every capture stalls Safari for four animation frames (`137 ms` per capture vs. `14 ms` with per-sheet subset caching).
- `<input>` `::placeholder` and `::after` styles vanish from cloned form fields unless materialized explicitly.
- Safari lacks `Element.moveBefore`, so handoffs drop focus, selection, and scroll unless saved and restored around `insertBefore`.

### What Munari does

Enable `@petepetrash/munari/snapdom` once at startup. Chrome 157+ continues using zero-copy `html-in-canvas`, while Safari, Firefox, and iOS run the exact same `<Surface>` and `useElementCapture()` code on Munari's hardened `snapDOM` adapter. If you omit `snapDOM` to minimize bundle size, unsupported browsers leave `<Surface>` content native and interactive on the page and report the reason on `useSurfaceStatus()`.

```tsx
import { enableSnapdomCapture } from '@petepetrash/munari/snapdom'

// Keep native HTML-in-canvas on Chrome 157+; fall back to snapDOM elsewhere.
enableSnapdomCapture({
  isolatedTextInputs: 'input[data-munari-capture-region]',
})
```

## Summary: DIY `html-in-canvas` vs. Munari

| Capability | DIY `html-in-canvas` | Munari (`@petepetrash/munari`) |
| --- | --- | --- |
| Flat quad permanently inside `<canvas>` in Chrome 157+ | ~50 lines; native input works | Supported (`SceneSurface` or `Surface`) |
| Start in normal page flow, lift into 3D on demand | Manual reparenting; flashes blank during async WebGPU compile | Zero-flash two-stage readiness + `moveBefore` state retention |
| Curved, waved, or lens-warped meshes | Native hit box stays flat; clicks miss displaced pixels | `deformSurfaceGeometry` + automatic switch between `native` and UV `relay` |
| 3D geometry aligned to responsive DOM children | `getBoundingClientRect()` leads texture uploads by 1–2 frames | Paint-generation-locked `Surface.Anchor` and `useSurfaceAnchorBox()` |
| Premultiplied sRGB + Three.js WebGPU materials | Dark alpha fringes and tone-mapped UI color shifts | `NoToneMapping` canvas + `useSurfaceNodes()`, `premultipliedOutput()`, `Surface.LitMaterial` |
| Dynamic resize and camera-distance zoom | Setting `canvas.width` clears buffer (`38/40` frames blank) | Hysteresis backing-store band, LOD ladder, and pixel-grid snapping |
| Idle GPU cost | Continuous `rAF` unless custom-scheduled | Reference-counted `frameloop="demand"` sleeps at `0 fps` |
| Safari, Firefox, and iOS | Unsupported by `drawElementImage` | `enableSnapdomCapture()` fallback or automatic native-DOM degradation |
