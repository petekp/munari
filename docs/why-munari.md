# Why Munari

Native-grade lighting, optics, and physical motion on real DOM components, without turning your website into a full-canvas app.

Your document stays ordinary HTML. Munari promotes only the components or transitions that cross CSS's limits. Run `npm run lab` (`?scene=why`) for the interactive walkthrough, or see the [Root README](../README.md) for installation.

## Selective DOM promotion

Web interfaces usually force a choice between document quality and rendering power:

| Approach | What you keep | Where it stops |
| --- | --- | --- |
| **Standard HTML & CSS** (`0%` idle GPU) | Crisp text shaping, selection, forms, autofill, Cmd+F, screen readers | Every box paints as an isolated flat plane with local fake shadows, uniform Gaussian `backdrop-filter`, and no shared light or pixel shaders |
| **Full-Canvas WebGL** (continuous `60 fps`) | Scene-wide lighting, true refraction, curved geometry, custom shaders | Rebuilt text layout, broken selection and password managers, poor screen-reader fidelity, full-viewport render loop |
| **Selective DOM promotion** (`@petepetrash/munari`) | Native HTML document plus WebGPU shaders and shared 3D space on chosen components | `three/webgpu` bundle weight (`~550–640 kB` gzip) on routes that mount `SurfaceCanvas` |

Two operating modes keep GPU and thermal cost down on desktop and mobile:

- **Transient promotion (`0` GPU textures at rest):** Set `inScene={active}` only during a drag, minimize, or fold. At rest, the component is plain HTML with zero VRAM cost; on interaction, Munari swaps on the verified GPU frame and returns to HTML when settled.
- **Demand-driven surfaces (`0 fps` when still):** Pair `frameloop="demand"` with `pointerMode="surfaces"`. Promoted elements draw one frame when light, state, or springs move, leave surrounding HTML directly clickable, and sleep at `0 fps` (`<1%` CPU) once motion ends.

## What it unlocks

1. **One scene light and real cast shadows across separate components:** CSS `box-shadow` hardcodes a local offset per element. Munari places separate DOM components under a shared light source so headings, forms, and raised selections cast coherent penumbras across the page ([Light](../apps/lab/src/scenes/light/Light.tsx), [Postcard](../apps/lab/src/scenes/postcard/Postcard.tsx)).
2. **True refraction and physical substrates over selectable text:** Custom TSL materials shade live HTML with variable-thickness Snell refraction, dispersion, cotton paper grain, or machined hardware ([Selection](../apps/lab/src/scenes/selection/Selection.tsx), [Postcard](../apps/lab/src/scenes/postcard/Postcard.tsx), [Knobs](../apps/lab/src/scenes/knobs/Knobs.tsx)).
3. **Bent, elastic, and particle-dissolved UI that still takes input:** Cross CSS `matrix3d`'s flat-plane ceiling while clicks, typing, hover, and wheel scroll still reach the real controls ([Genie](../apps/lab/src/scenes/genie/Genie.tsx), [Flight](../apps/lab/src/scenes/flight/Flight.tsx), [Plume](../apps/lab/src/scenes/plume/Plume.tsx)).
4. **Shaders and 3D hardware locked to responsive DOM layout:** Expose premultiplied color, alpha silhouettes, and frame-matched `Surface.Anchor` boxes so 3D dials, resize handles, and page-reflecting cursors track responsive DOM with zero 1-frame lag ([Knobs](../apps/lab/src/scenes/knobs/Knobs.tsx), [Marble Hand](../apps/lab/src/scenes/marble-hand/MarbleHand.tsx)).
5. **Two-way flow between document layout and depth-buffered 3D:** Components sit in normal page flow, lift into a shared depth buffer where 3D objects pass in front of and behind them, and return to plain HTML with React state and focus intact ([Logo](../apps/lab/src/scenes/logo/Logo.tsx), [Flight](../apps/lab/src/scenes/flight/Flight.tsx)).

## Choose the right tool

- **CSS `perspective()` or `@react-three/drei` `<Html transform>`:** Choose this when UI stays on rigid flat planes and needs no pixel shaders, refraction, or 3D depth intersections (`0 kB` capture cost, vector text in all browsers).
- **Raw Chrome `html-in-canvas` (`~50` lines):** Enough for a Chrome 157+ prototype where one element stays permanently inside `<canvas content="drawable">` on a flat quad.
- **Munari (`@petepetrash/munari`):** Built for native-grade UI on real DOM that starts in normal page flow, enters lit or curved 3D with zero blank frames, keeps input accurate on warped geometry, sleeps at `0 fps`, and ships across Chrome, Safari, Firefox, and iOS.

## 1. Normal page HTML at rest, zero-flash handoff into lit 3D

### What breaks from scratch

`drawElementImage` only accepts direct children of `<canvas>` ([platform.md #10](platform.md)), which clips `box-shadow` at the border box ([platform.md #9](platform.md)) and runs WebGPU at rest. Toggling visibility from React state introduces two faults:

1. **Blank swap frames:** React hides the DOM before `WebGPURenderer` finishes async shader compilation and texture upload.
2. **Lost DOM state on reparent:** Moving an element with `appendChild` blurs focused inputs, clears text selection, and resets `scrollTop` to `0`.

### What Munari does

Munari mounts your React component once. When `inScene` turns `true`, it compiles the shader and confirms a color-writing GPU pass reached the screen before hiding the page slot in that same frame. It relocates the live node with `Element.moveBefore` where supported and restores focus, selection direction, and scroll offsets on Safari where `moveBefore` is absent.

```tsx
import { useId, useState } from 'react'
import { Surface, SurfaceCanvas, useSurfaceSupport } from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

export function LitCardHandoff() {
  const canvasId = useId()
  const supported = useSurfaceSupport()
  const [inScene, setInScene] = useState(false)

  return (
    <section style={{ position: 'relative', minHeight: 320 }}>
      {supported && (
        <SurfaceCanvas
          id={canvasId}
          pointerMode="surfaces"
          frameloop="demand"
          gl={{ alpha: true }}
          onCreated={({ gl }) => gl.setClearAlpha(0)}
          style={{ position: 'absolute', inset: 0 }}
        >
          <ambientLight intensity={0.45} />
          <directionalLight position={[-1.5, 2, 3]} intensity={2.6} color="#fff1d6" />
        </SurfaceCanvas>
      )}
      <Surface.Root canvasId={canvasId} inScene={inScene}>
        <Surface.HTML><NoteCard /></Surface.HTML>
        <Surface.Scene>
          <Surface.Mesh material={<Surface.LitMaterial roughness={0.32} metalness={0.05} />} />
        </Surface.Scene>
      </Surface.Root>
      <button type="button" disabled={!supported} onClick={() => setInScene((v) => !v)}>
        {inScene ? 'Return to flat HTML' : 'Light in 3D'}
      </button>
    </section>
  )
}
```

For multi-pass post-processing, `useSurfaceOutput([sceneTarget])` from `@petepetrash/munari/advanced` holds the page HTML until the final composite draw lands on screen.

**Lab examples:** [Postcard](../apps/lab/src/scenes/postcard/Postcard.tsx), [Flight](../apps/lab/src/scenes/flight/Flight.tsx), [Genie](../apps/lab/src/scenes/genie/Genie.tsx), and [Glass](../apps/lab/src/scenes/glass/Glass.tsx).

## 2. Input that works on curved meshes and transparent overlays

### What breaks from scratch

Chrome's native `<canvas content="drawable">` hit-testing maps one flat `4x4` matrix and clips hits to the canvas box ([platform.md #18](platform.md)):

1. **Shader warps miss clicks:** Vertex-shader displacement moves pixels on screen while hit boxes stay flat, missing clicks in the lab's fisheye list by `60–100+ px`.
2. **Overlay canvases block the page:** A full-bleed `<canvas>` intercepts clicks and wheel scroll meant for ordinary HTML underneath.

### What Munari does

`pointerMode="surfaces"` keeps `SurfaceCanvas` transparent to pointer events everywhere no Surface mesh stands. On each mesh, `pointerRoute="auto"` selects the input path per frame:

- **Flat poses in Chrome 157+:** Native browser `matrix3d` hit-testing (`isTrusted: true`), native `:hover` and `:active`, drag text selection, and `<select>` menus.
- **Bent meshes or fallback browsers:** `deformSurfaceGeometry` displaces CPU vertices in DOM pixel space, mirrors `[data-hover]` and `[data-active]`, stamps `[data-pointer-focus]`, and scrolls nested overflow containers before letting the 3D camera consume `wheel` events.

```tsx
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, deformSurfaceGeometry } from '@petepetrash/munari'

// Pair hover selectors so bent and fallback surfaces match:
// .wave-btn:hover, .wave-btn[data-hover] { background: #000; color: #fff; }

export function CurvedSheet({ width, height }: { width: number; height: number }) {
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
    <group scale={1 / 120}>
      <Surface.Mesh
        placement="manual"
        pointerRoute="auto"
        geometry={<planeGeometry ref={geoRef} args={[width, height, 48, 24]} />}
      />
    </group>
  )
}
```

**Lab examples:** [Fisheye](../apps/lab/src/scenes/fisheye/Fisheye.tsx), [Slider](../apps/lab/src/scenes/slider/Slider.tsx), [Optics](../apps/lab/src/scenes/optics/Optics.tsx), and [Gravity](../apps/lab/src/scenes/gravity/Gravity.tsx).

## 3. 3D geometry locked to CSS layout and color-accurate TSL shaders

### What breaks from scratch

1. **3D parts lead the HTML texture:** `getBoundingClientRect()` updates on layout while captured pixels upload a frame later, making 3D bezels drift ahead during responsive resizes.
2. **Dark halos and shifted colors:** Captured HTML textures are premultiplied sRGB. Stock Three.js materials multiply RGB by alpha a second time and alter UI colors via tone mapping.

### What Munari does

Tag any HTML descendant with `data-munari-anchor="name"` and place 3D objects inside `<Surface.Anchor name="name">`. `useSurfaceAnchorBox()` returns dimensions matched to the exact texture frame currently on the mesh. `SurfaceCanvas` keeps renderer tone mapping off so CSS colors match `0/255`, and `premultipliedOutput()` composes TSL materials without dark rims.

```tsx
import { useEffect, useMemo } from 'react'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { uv, vec3, vec4 } from 'three/tsl'
import { premultipliedOutput, useSurfaceAnchorBox, useSurfaceNodes } from '@petepetrash/munari'

const ignoreRaycast = () => {}

export function ButtonBezel() {
  const box = useSurfaceAnchorBox()
  if (!box) return null
  const depth = 0.04
  return (
    <mesh position={[0, 0, -depth / 2]} raycast={ignoreRaycast}>
      <boxGeometry args={[box.width * 1.08, box.height * 1.16, depth]} />
      <meshStandardMaterial color="#2148bd" roughness={0.35} />
    </mesh>
  )
}

export function CoolTintMaterial() {
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
```

**Lab examples:** [Controls](../apps/lab/src/scenes/controls/Controls.tsx), [Knobs](../apps/lab/src/scenes/knobs/Knobs.tsx), and [Crystal](../apps/lab/src/scenes/crystal/Crystal.tsx).

## 4. Depth-occluded scene UI, zoom sharpness, and `0 fps` idle

### What breaks from scratch

1. **Resizing clears the canvas:** Setting `canvas.width` zeroes the buffer synchronously while Chrome's `onpaint` refill arrives after the frame ([platform.md #12](platform.md)), uploading blank textures on `38 of 40` resize frames.
2. **Shared canvases blur on zoom:** One `<canvas>` pins all children to one resolution ([platform.md #15](platform.md)), blurring text when the camera approaches.
3. **Continuous render loops waste GPU:** Active `requestAnimationFrame` loops drain battery on static UI.

### What Munari does

Munari retains the previous capture buffer across intermediate size and camera-distance steps so frames never blank, then re-rasters at exact `1:1` sharpness once motion settles. Upright Surfaces snap to the device pixel grid, and `frameloop="demand"` drops to `0` frames and `0` paints per second at rest.

```tsx
import { FocusGroup, FocusScene, SceneSurface, Surface, SurfaceCanvas } from '@petepetrash/munari'

export function SpatialBoard() {
  return (
    <SurfaceCanvas frameloop="demand" camera={{ position: [0, 0, 5], fov: 45 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[2, 3, 4]} intensity={2} />
      <FocusScene>
        <group position={[-1.2, 0, 0]}>
          <FocusGroup id="metrics">
            <SceneSurface.Root>
              <SceneSurface.HTML size={[320, 200]}>
                <div style={{ width: 320, height: 200, padding: 16, background: '#fff' }}>
                  <h3>Latency</h3>
                  <p>Tab or click to approach; 3D objects occlude this panel in depth.</p>
                </div>
              </SceneSurface.HTML>
              <SceneSurface.Mesh material={<Surface.LitMaterial roughness={0.4} />} />
            </SceneSurface.Root>
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

Cloning DOM nodes by hand for a glass bar or reflection drops form values, `::before` and `::after` pseudo-elements, and scroll positions, while pushing frames through React state triggers full re-renders on every paint.

### What Munari does

`useElementCapture()` leaves the live element in place for native scrolling and text selection, mirrors computed styles, pseudo-elements, form values, and scroll offsets into a capture texture, and updates `useCaptureFrame(capture)` without React re-renders.

```tsx
import { SurfaceCanvas, useElementCapture } from '@petepetrash/munari'

export function PageWithLens() {
  const capture = useElementCapture()
  return (
    <div style={{ position: 'relative' }}>
      <article ref={capture.ref} style={{ padding: 24 }}>
        <h2>Native article</h2>
        <p>Select this text normally while the 3D glass band magnifies its pixels.</p>
      </article>
      <SurfaceCanvas
        frameloop="demand"
        pointerMode="surfaces"
        gl={{ alpha: true }}
        onCreated={({ gl }) => gl.setClearAlpha(0)}
        style={{ position: 'absolute', inset: 0 }}
      >
        <MagnifyingBand capture={capture} />
      </SurfaceCanvas>
    </div>
  )
}
```

**Lab examples:** [Selection](../apps/lab/src/scenes/selection/Selection.tsx), [Veil](../apps/lab/src/scenes/veil/Veil.tsx), [Light](../apps/lab/src/scenes/light/Light.tsx), and [Marble Hand](../apps/lab/src/scenes/marble-hand/MarbleHand.tsx).

## 6. Cross-browser fallback, trade-offs, and limits

HTML-in-canvas does not exist in Safari, Firefox, or iOS browsers. Calling `enableSnapdomCapture()` once at startup keeps zero-copy `html-in-canvas` in Chrome 157+ and runs the same `<Surface>` and `useElementCapture()` code on Munari's `snapDOM` pipeline elsewhere (working around WebKit's `toCanvas` blur, `137 ms` font stalls, missing input pseudo-elements, and absent `Element.moveBefore` documented in [platform.md #24–#31](platform.md)). Omitting `snapDOM` leaves `<Surface>` content interactive on the page and reports why on `useSurfaceStatus().reason`.

```tsx
import { enableSnapdomCapture } from '@petepetrash/munari/snapdom'

enableSnapdomCapture({
  isolatedTextInputs: 'input[data-munari-capture-region]',
})
```

### Trade-offs to weigh before adopting

- **Bundle weight:** `three/webgpu` adds roughly `550–640 kB` gzipped. Lazy-load routes that mount `SurfaceCanvas` so initial page loads stay small.
- **TSL node materials only:** `SurfaceCanvas` uses `WebGPURenderer` (with WebGL 2 fallback), which rejects GLSL `ShaderMaterial`, `onBeforeCompile`, and GLSL-based Drei helpers such as `Text`. Custom shaders use `three/tsl`.
- **Captured CSS rules:** Pair `:hover` and `:active` selectors with `[data-hover]` and `[data-active]` for bent or non-Chrome surfaces. Avoid `mask-image` inside captured subtrees ([platform.md #7](platform.md)), and keep `<iframe>`, `<video>`, `<audio>`, custom elements, and Shadow DOM outside `Surface` ([authoring.md](authoring.md)).
- **`snapDOM` vs. Chrome 157+ ceiling:** Chrome 157+ updates textures in `~12 ms` with live carets and fractional borders. On Safari and Firefox, `snapDOM` takes `~37 ms` on quiet input, caps `live` animations around `4 fps`, omits the blinking caret in 3D, and restarts running CSS animations on Safari handoff.

## Comparison at a glance

| Requirement | CSS 3D / Drei `<Html>` | DIY `html-in-canvas` | Munari (`@petepetrash/munari`) |
| --- | --- | --- | --- |
| Flat tilted cards with vector text | Native in all browsers (`0 kB`) | Unnecessary overhead | Prefer CSS 3D unless lighting or shaders apply |
| Shared scene lighting, refraction, or bent meshes on live UI | Cannot deform or shade DOM pixels | Custom WebGPU + custom hit-test math | Built in (`Surface.LitMaterial`, `useSurfaceNodes`, `deformSurfaceGeometry`) |
| Start in normal page flow, enter 3D without blank flashes | Native (CSS 3D) / scene-only (`<Html>`) | Flashes blank during async shader compile | Frame-verified handoff + `moveBefore` state retention |
| Accurate clicks and scroll on curved geometry | Flat planes only | Hit box stays flat; clicks miss | Automatic switch between `native` (`matrix3d`) and UV `relay` |
| 3D meshes synced to responsive DOM children | Manual `ResizeObserver` | `getBoundingClientRect` leads texture by 1–2 frames | Frame-matched `Surface.Anchor` and `useSurfaceAnchorBox()` |
| Dynamic resize, zoom sharpness, and idle GPU cost | Browser compositor | `canvas.width` clears 38/40 frames; continuous rAF | Retained density band, pixel-grid snap, `0 fps` demand sleep |
| Safari, Firefox, and iOS | Native | Unsupported | `enableSnapdomCapture()` fallback or native-DOM degradation |
