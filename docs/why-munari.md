# Why Munari

Before reaching for Munari, check whether a lighter tool already solves the effect:

- **CSS `perspective()` or `@react-three/drei` `<Html transform>`:** Best when your UI stays on flat planes, needs no pixel shaders, and never intersects 3D geometry in depth. You get vector text in every browser with zero capture cost.
- **Raw Chrome `html-in-canvas` (`~50` lines):** Enough for a Chrome 157+ prototype where one element lives permanently inside `<canvas content="drawable">` on a flat quad.
- **Munari (`@petepetrash/munari`):** Built for UI that needs pixel-level 3D (real lighting and cast shadows across live typography, bent or curled meshes, optical refraction or blur lenses, depth-buffered 3D intersections) while still starting in normal page layout, keeping React and form state alive, routing input accurately, and shipping on Safari, Firefox, and iOS.

Run `npm run lab` to inspect the linked scenes locally, or see the [Root README](../README.md) for installation.

## 1. Normal page HTML at rest, zero-flash handoff into lit 3D

### What breaks from scratch

`drawElementImage` only accepts direct children of a `<canvas>` ([platform.md #10](platform.md)). Leaving UI inside `<canvas>` full-time clips `box-shadow` and outlines at the border box ([platform.md #9](platform.md)) and runs WebGPU just to show a resting page.

Keeping the element in normal document flow and toggling visibility from React state introduces two bugs:

1. **Blank or doubled swap frames:** React hides the DOM before `WebGPURenderer` finishes async shader compilation, uploads the texture, and completes any post-processing pass.
2. **Lost DOM state on reparent:** Moving an element with `appendChild` blurs focused inputs, clears text selection, resets `scrollTop` to `0`, and restarts CSS animations.

### What Munari does

Munari mounts your React component once. When `inScene` turns `true`, it compiles the shader and confirms a color-writing GPU pass reached the screen before hiding the page HTML in that same frame. It relocates the live DOM node with `Element.moveBefore` where supported and restores focus, selection direction, and scroll offsets where `moveBefore` is absent.

```tsx
import { useId, useState } from 'react'
import { Surface, SurfaceCanvas, useSurfaceSupport } from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

function NoteCard() {
  const [title, setTitle] = useState('Quarterly notes')
  return (
    <form style={{ width: 320, padding: 16, background: '#fff', borderRadius: 12 }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} />
      <div style={{ maxHeight: 88, overflowY: 'auto', marginTop: 8 }}>
        <p>Select text or scroll here, then toggle 3D lighting mid-edit.</p>
      </div>
    </form>
  )
}

export function LitCardHandoff() {
  const canvasId = useId()
  const supported = useSurfaceSupport()
  const [inScene, setInScene] = useState(false)

  return (
    <section style={{ position: 'relative', minHeight: 320, padding: 24 }}>
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
        <Surface.HTML>
          <NoteCard />
        </Surface.HTML>
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

Chrome's native `<canvas content="drawable">` hit-testing maps one flat `4x4` matrix and clips hits to the canvas box ([platform.md #18](platform.md)).

1. **Shader warps miss clicks:** Displacing vertices in a vertex shader moves pixels on screen while browser and Three.js hit boxes stay flat. In the lab's fisheye list, a shader-only warp misses clicks by `60 px` vertically and over `100 px` horizontally.
2. **Overlay canvases block the page:** A full-bleed `<canvas>` layered above a page intercepts clicks and wheel scroll meant for ordinary HTML underneath.

### What Munari does

`SurfaceCanvas` with `pointerMode="surfaces"` keeps the `<canvas>` transparent to pointer events everywhere no Surface mesh stands.

On each mesh, `pointerRoute="auto"` picks the input path per frame:

- **Flat poses in Chrome 157+:** Uses native browser `matrix3d` hit-testing for `isTrusted: true` clicks, native `:hover` and `:active`, drag text selection, and `<select>` menus.
- **Bent meshes or fallback browsers:** `deformSurfaceGeometry` displaces CPU vertices in DOM pixel coordinates, invalidates Three's bounding sphere, and switches that Surface to UV-to-DOM relay. Because synthetic events cannot trigger browser `:hover`, Munari mirrors hover and press chains onto `[data-hover]` and `[data-active]`, stamps `[data-pointer-focus]` so pointer clicks do not show keyboard focus rings, and scrolls nested overflow containers before letting the 3D camera consume `wheel` events.

```tsx
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, SurfaceCanvas, deformSurfaceGeometry } from '@petepetrash/munari'

// Include [data-hover] and [data-active] so hover styles match on bent meshes:
// .wave-btn:hover, .wave-btn[data-hover] { background: #1d4ed8; color: #fff; }

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
    <group scale={1 / 120}>
      <Surface.Mesh
        placement="manual"
        pointerRoute="auto"
        geometry={<planeGeometry ref={geoRef} args={[width, height, 48, 24]} />}
      />
    </group>
  )
}

export function WavingForm({ inScene }: { inScene: boolean }) {
  return (
    <div style={{ position: 'relative', height: 360 }}>
      <SurfaceCanvas pointerMode="surfaces" camera={{ position: [0, 0, 5], fov: 45 }} />
      <Surface.Root inScene={inScene}>
        <Surface.HTML>
          <div style={{ width: 360, height: 220, padding: 16, background: '#fff' }}>
            <input placeholder="Focusable and editable while waving" />
            <button type="button" className="wave-btn">Submit</button>
          </div>
        </Surface.HTML>
        <Surface.Scene>
          <CurvedSheet width={360} height={220} />
        </Surface.Scene>
      </Surface.Root>
    </div>
  )
}
```

**Lab examples:** [Fisheye](../apps/lab/src/scenes/fisheye/Fisheye.tsx), [Slider](../apps/lab/src/scenes/slider/Slider.tsx), [Optics](../apps/lab/src/scenes/optics/Optics.tsx), and [Gravity](../apps/lab/src/scenes/gravity/Gravity.tsx).

## 3. 3D geometry locked to CSS layout and color-accurate TSL shaders

### What breaks from scratch

1. **3D parts lead the HTML texture:** Sizing 3D bezels or shadows from `getBoundingClientRect()` updates on layout, while the captured texture uploads a frame later. During responsive resizes, 3D attachments visibly drift ahead of the text.
2. **Dark halos and shifted colors:** Captured HTML textures are premultiplied sRGB. Stock Three.js materials multiply RGB by alpha a second time, darkening translucent edges, while renderer tone mapping alters UI colors.

### What Munari does

Tag any HTML descendant with `data-munari-anchor="name"` and place 3D objects inside `<Surface.Anchor name="name">`. `useSurfaceAnchorBox()` returns that element's dimensions matched to the exact texture frame currently on the mesh (`box.width` and `box.height` in local mesh units, plus `box.cssWidth` and `box.cssHeight` in CSS pixels).

`SurfaceCanvas` keeps renderer tone mapping off so UI colors match CSS `0/255`. Custom TSL materials read `useSurfaceNodes()` and wrap premultiplied linear color in `premultipliedOutput()`.

```tsx
import { useEffect, useMemo } from 'react'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { uv, vec3, vec4 } from 'three/tsl'
import {
  Surface,
  SurfaceCanvas,
  premultipliedOutput,
  useSurfaceAnchorBox,
  useSurfaceNodes,
} from '@petepetrash/munari'

const ignoreRaycast = () => {}

function ButtonBezel() {
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
    <div style={{ position: 'relative', height: 260 }}>
      <SurfaceCanvas pointerMode="surfaces" gl={{ alpha: true }} onCreated={({ gl }) => gl.setClearAlpha(0)}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[-2, 3, 4]} intensity={2.2} />
      </SurfaceCanvas>
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
    </div>
  )
}
```

**Lab examples:** [Controls](../apps/lab/src/scenes/controls/Controls.tsx), [Knobs](../apps/lab/src/scenes/knobs/Knobs.tsx), and [Crystal](../apps/lab/src/scenes/crystal/Crystal.tsx).

## 4. Depth-occluded scene UI, zoom sharpness, and `0 fps` idle

### What breaks from scratch

Unlike CSS3D overlays (`<Html transform>`), GPU-textured panels participate in the depth buffer and scene lighting so 3D objects can pass cleanly in front of and behind them. Building that from scratch hits three traps:

1. **Resizing clears the canvas:** Setting `canvas.width` or `canvas.height` zeroes the buffer synchronously while Chrome's `onpaint` refill arrives after the frame ([platform.md #12](platform.md)), producing blank textures on `38 of 40` resize frames.
2. **Shared canvases blur on zoom:** One `<canvas>` locks all children to one resolution ([platform.md #15](platform.md)), blurring text when the camera moves closer.
3. **Continuous render loops waste GPU:** Leaving `requestAnimationFrame` active after motion ends burns battery on static UI.

### What Munari does

Munari retains the previous capture buffer across intermediate size and camera-distance steps so frames never go blank, then re-rasters at exact `1:1` sharpness once motion settles. Upright Surfaces snap to the device pixel grid, and `frameloop="demand"` drops to `0` frames and `0` paints per second at rest.

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
                  <p>Tab or click to approach; lit 3D objects occlude this panel in depth.</p>
                </div>
              </SceneSurface.HTML>
              <SceneSurface.Mesh material={<Surface.LitMaterial roughness={0.4} />} />
            </SceneSurface.Root>
          </FocusGroup>
        </group>
        <mesh position={[-0.4, 0, 0.35]}>
          <torusKnotGeometry args={[0.28, 0.08, 96, 24]} />
          <meshStandardMaterial color="#d97706" roughness={0.25} metalness={0.6} />
        </mesh>
      </FocusScene>
    </SurfaceCanvas>
  )
}
```

**Lab examples:** [Workspace](../apps/lab/src/scenes/workspace/Workspace.tsx) and [Unroll](../apps/lab/src/scenes/candidates/CandidateUnroll.tsx).

## 5. Non-destructive page capture for lenses and reflections

### What breaks from scratch

When a 3D glass bar, progressive blur, or reflection samples an article that should stay native on the page, cloning DOM nodes by hand drops form values, `::before` and `::after` styles, and scroll positions, while pushing frames through React state re-renders on every paint.

### What Munari does

`useElementCapture()` leaves the live element in place for native scrolling and text selection, copies computed styles, pseudo-elements, form values, and scroll offsets into a capture texture, and updates `useCaptureFrame(capture)` without React re-renders.

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { texture, uv } from 'three/tsl'
import {
  SurfaceCanvas,
  premultipliedOutput,
  useCaptureFrame,
  useElementCapture,
  type CaptureHandle,
} from '@petepetrash/munari'

function MagnifyingBand({ capture }: { capture: CaptureHandle }) {
  const frame = useCaptureFrame(capture)
  const [placeholder] = useState(() => {
    const tex = new THREE.Texture()
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  })
  const [map] = useState(() => texture(placeholder))
  const material = useMemo(() => {
    const m = new MeshBasicNodeMaterial({ transparent: true })
    const zoomedUv = uv().sub(0.5).mul(0.75).add(0.5)
    m.outputNode = premultipliedOutput(map.sample(zoomedUv))
    return m
  }, [map])

  useEffect(() => () => {
    material.dispose()
    placeholder.dispose()
  }, [material, placeholder])

  useFrame(() => {
    const latest = frame.get()
    if (latest) map.value = latest.texture
  })

  return (
    <mesh scale={[3.2, 0.9, 1]}>
      <planeGeometry />
      <primitive object={material} attach="material" />
    </mesh>
  )
}

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

HTML-in-canvas does not exist in Safari, Firefox, or any iOS browser. Calling `enableSnapdomCapture()` once at startup keeps zero-copy `html-in-canvas` in Chrome 157+ and runs the same `<Surface>` and `useElementCapture()` code on Munari's `snapDOM` pipeline elsewhere (working around WebKit's `toCanvas` blur, `137 ms` per-capture font stalls, missing input pseudo-elements, and absent `Element.moveBefore` documented in [platform.md #24–#31](platform.md)). If you omit `snapDOM`, unsupported browsers leave `<Surface>` content interactive on the page and report why on `useSurfaceStatus().reason`.

```tsx
import { enableSnapdomCapture } from '@petepetrash/munari/snapdom'

enableSnapdomCapture({
  isolatedTextInputs: 'input[data-munari-capture-region]',
})
```

### Trade-offs to weigh before adopting

- **Bundle weight:** `three/webgpu` adds roughly `550–640 kB` gzipped. Lazy-load routes that mount `SurfaceCanvas` so initial page loads stay small.
- **TSL node materials only:** `SurfaceCanvas` uses `WebGPURenderer` (with WebGL 2 fallback), which rejects GLSL `ShaderMaterial`, `onBeforeCompile`, and GLSL-based Drei helpers such as `Text` and `MeshTransmissionMaterial`. Custom shaders use `three/tsl`.
- **Captured CSS rules:** Pair `:hover` and `:active` selectors with `[data-hover]` and `[data-active]` for bent or non-Chrome surfaces. Avoid `mask-image` inside captured subtrees ([platform.md #7](platform.md)), and keep `<iframe>`, `<video>`, `<audio>`, custom elements, and Shadow DOM outside `Surface` ([authoring.md](authoring.md)).
- **`snapDOM` vs. Chrome 157+ fidelity:** Chrome 157+ updates textures in `~12 ms` with live carets and fractional borders. On Safari and Firefox, `snapDOM` takes `~37 ms` on quiet input, caps `live` animations around `4 fps`, does not draw the blinking text caret inside the 3D texture, rounds fractional CSS borders to whole pixels, and restarts running CSS animations on Safari handoff.

## Comparison at a glance

| Requirement | CSS 3D / Drei `<Html>` | DIY `html-in-canvas` | Munari (`@petepetrash/munari`) |
| --- | --- | --- | --- |
| Flat tilted cards with vector text | Native in all browsers (`0 kB`) | Unnecessary | Possible, prefer CSS 3D unless shaders/lighting apply |
| Per-pixel lighting, refraction, or bent meshes on live UI | Cannot deform or shade DOM pixels | Custom WebGPU + hit-test math | Built in (`Surface.LitMaterial`, `useSurfaceNodes`, `deformSurfaceGeometry`) |
| Start in normal page flow, enter 3D without blank flashes | Native (CSS 3D) / N/A (`<Html>`) | Flashes during async shader compile | Frame-verified handoff + `moveBefore` state retention |
| Accurate clicks and scroll on curved geometry | Flat planes only | Hit box stays flat; clicks miss | Automatic switch between `native` (`matrix3d`) and UV `relay` |
| 3D meshes synced to responsive DOM children | Manual `ResizeObserver` | `getBoundingClientRect` leads texture by 1–2 frames | Frame-matched `Surface.Anchor` and `useSurfaceAnchorBox()` |
| Safari, Firefox, and iOS | Native | Unsupported | `enableSnapdomCapture()` fallback or native-DOM degradation |
