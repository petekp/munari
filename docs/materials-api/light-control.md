# Materials and lighting API: light control

Part of the [materials and lighting API proposal](../materials-api.md). Status: proposal. Nothing in it is built, and code blocks marked "Sketch" show an API that does not exist yet.

## 4. Light control

The question is how a light follows the pointer without a React render per
move, including under `frameloop="demand"`, and what each move costs.

### Measured cost

A throwaway probe ran on m2, an M2 Pro, in headless Chrome for Testing 156
with WebGPU. It drew three Surfaces with `Surface.LitMaterial`, an
ambient light and a point light, on a `frameloop="demand"` canvas of
2880 × 1800 pixels (1440 × 900 at DPR 2). Puppeteer moved the pointer in a
loop for 4 s per block. Each block measured Chrome's main-thread task time
(CDP `TaskDuration`) and divided it by the moves sent. Five modes ran in
one page load, three times each, in alternating order.

| Mode | What one move does | Task ms per move (3 blocks) | Mean |
|---|---|---|---|
| idle | nothing | 0.65, 0.67, 0.59 | 0.64 |
| handle | write the light's position in the event, call `invalidate()` | 1.75, 1.41, 1.19 | 1.45 |
| placed at draw | store the pointer, call `invalidate()`; the frame places the light | 1.32, 1.64, 1.53 | 1.50 |
| React state in the light component | `setState` in a canvas component that renders the light | 2.48, 2.80, 2.95 | 2.74 |
| React state at the page root | `setState` in the app root, which re-renders the three Surfaces | 4.71, 4.27, 4.42 | 4.47 |

Every mode but idle drew one frame per move (52 to 60 frames per second),
and in every block the light moved. Above idle, a move that draws costs 0.8 to 0.9 ms without React and 2.1
to 3.8 ms with React state. Most of the 0.8 ms is the frame's own draw,
because idle draws nothing. React adds 1.3 ms in the light component and
3.0 ms at the page root. The two non-React modes differ by less than the
spread between their blocks.

These numbers have limits.

- Puppeteer delivered about 56 moves per second, and headless Chrome
  paces frames at 60 Hz, so each move drew its own frame. A 120 Hz pointer
  on a 120 Hz screen would request up to twice the frames. The cost per
  frame at 120 Hz is unmeasured.
- Only `frameloop="demand"` ran.
- The page reported `navigator.gpu`, which shows WebGPU is exposed. The
  probe did not record which adapter drew.
- `TaskDuration` counts all main-thread work, including the input
  dispatch. Idle measures that floor.
- GPU time was not measured. The materials research measured the GPU cost
  of each layer on a full-screen draw: 0.71 ms for the standard model up
  to 2.37 ms with all four reflection layers (docs/materials-research.md
  §2).
- The probe used three Surfaces and the standard material, not finish
  materials. The page-root cost grows with the page tree, which the probe
  did not vary. That mode committed the page root 1.5 times per move, so
  its 3.0 ms includes more than one render.

### A. Declarative props

```tsx
// Sketch, not built.
const [pointer, setPointer] = useState({ x: 0, y: 0 })
<SurfaceCanvas lighting={{ key: { x: pointer.x, y: pointer.y } }} onPointerMove={(e) => setPointer({ x: e.clientX, y: e.clientY })} />
```

This is the most familiar React shape. It renders React on every move,
measured at 2.1 to 3.8 ms above idle per move, and the cost grows with
what the state re-renders. It suits a light that changes on a click.

### B. A light handle

```tsx
// Sketch, not built.
const key = createSurfaceLight({ z: 480, brightness: 1 })

<SurfaceCanvas lighting={{ key }} />
window.addEventListener('pointermove', (e) => key.set({ x: e.clientX, y: e.clientY }))
```

`createSurfaceLight` returns a plain object, like `createSurface` and
`createPageTarget` do today. `set` writes numbers and requests a frame on
every canvas whose rig uses the handle. Each canvas converts the position
during its next draw. R3F 9.8.1's `invalidate()` sets a pending frame to 1
outside `useFrame`, so several writes before one frame draw one frame.
`get()` returns the resolved position in client px. An omitted `x` or
`y` resolves from the viewport size, so it follows a resize. On the
server `get()` returns `null` for them. `subscribe(fn)` calls `fn`
immediately, then on each `set` and each resize, so DOM UI such as a drag
handle can follow the light without React state. A following handle
calls `fn` at most once per animation frame, with the position the
canvases draw. Converting at draw is the probe's "placed at
draw" mode, 0.9 ms above idle per move.

### C. The light follows the pointer by itself

```tsx
// Sketch, not built.
const key = createSurfaceLight({ follow: 'pointer', z: 480 })
```

The handle reads the latest pointer position when the frame draws. This
is the "placed at draw" mode, measured the same as B. It needs no event
code.

### D. Signals

A signal library or a new reactive primitive would give the light the same
behavior as B. It adds a dependency or a concept for one kind of value, and
B already matches the library's handle pattern.

### Recommendation: B, with C as an option of the handle

The handle is the one primitive, and `follow: 'pointer'` is an option of
it. One handle drives several canvases. Each move draws one frame and no
React. Declarative values stay supported for a light that changes on a
click, where one React render is acceptable. Under the default
`frameloop="always"` a write should cost nothing beyond the frame that
was already coming. That mode was not measured. The handle imports no
three code.

### The pointer light's lifecycle

- Creating a handle does nothing else. It is safe at module scope and on
  the server, because it adds no listener and reads no `window`.
- The handle adds one `pointermove` listener on `window` when the first
  mounted canvas uses it, and removes it when the last one unmounts.
- The rest position is the handle's `x` and `y` options, or the rig's
  default key position. The light sits there before the first move.
- When the pointer leaves the window, the light stays where it was. A
  return to rest would sweep every highlight across the page with nothing
  the reader did.
- By default the light follows mouse and pen pointers only. A touch drag
  usually scrolls the page, and the browser cancels the pointer once it
  scrolls, so the light would jump to each finger and stop.
  `pointerTypes` widens the list.
- Under `prefers-reduced-motion: reduce` the light stays at rest. The
  handle watches the media query, so the setting applies while the page is
  open. `reducedMotion: 'follow'` opts out.
- `set()` on a following handle moves its rest position.
