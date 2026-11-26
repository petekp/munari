# Materials and lighting API: body and text color

Part of the [materials and lighting API proposal](../materials-api.md). Status: proposal. Nothing in it is built, and code blocks marked "Sketch" show an API that does not exist yet.

## The body color

A finish with a `color` paints its own body in the scene, and the HTML's
transparent pixels show it. The capture must therefore have a transparent
body. The page shows the HTML with no canvas, so there the HTML must paint
the same color itself. One value has to reach both places, and each place
has to switch at the right moment. A finish with `color: null` needs
none of this: the HTML paints its own body everywhere, and the capture is
lit whole.

### What the code does today

| Fact | Evidence |
|---|---|
| While the page presents, the live node sits in Munari's page element, and the source host holds a snapshot copy | Surface.tsx:392, 282-283, 359 |
| While the scene presents, the live node sits under the source host, and the page element holds a hidden placeholder copy | Surface.tsx:270-274 |
| The source host is created on the client in a layout effect, beside the page element, so the server never renders it | Surface.tsx:163 |
| `Surface.Root` renders no DOM, so no Munari element contains both places | Surface.tsx:99-103 |
| A Surface that is not `live` repaints its capture on input, layout, fonts, images and `useSurfaceRefresh()`. Its mutation observer runs only while live or while input is open, and the native path drops a paint that is not owed | rasterizedSource.ts:456-463, htmlInCanvas.ts:171 |
| The lift waits for a capture taken at or after the read it asks for | decisions/handoff.md #65 |
| While the page presents and a focused field needs the live node, Munari moves the live node into the source host and shows the host in the page copy's place. The host paints its own pixels, caret included | Surface.tsx:243-271 |
| On renderer loss every Surface returns to the page. `WebGPURenderer` reports a lost WebGPU device and a lost WebGL 2 context alike | surfaceHandle.ts:892-900, SurfaceCanvas.tsx:449-454 |
| `useSurfaceStatus()` reports the presentation to JavaScript. Nothing tells CSS | surfaceStatus.ts |

### Probe: does a CSS change reach the scene?

A throwaway page on m2 ran one `<Surface>` in headless Chrome for Testing
156 on Apple metal-3, with `frameloop="demand"`. The card's background
was `var(--munari-body, transparent)` over a blue page. The probe set the
property to red on the source host and read the card's center from a
screenshot. It ran the native capture path and the snapDOM fallback, and
both gave the same rows.

| Case | Pixel | Time |
|---|---|---|
| Scene presents, property set on the host | blue | read 1000 ms after the set |
| The same, after `useSurfaceRefresh()` | red | red appeared 146 ms after the refresh, 151 ms on the fallback |
| Property set while the page presents, then the scene requested | red, 3 of 3 runs | the scene status came 41–50 ms after the request, 42–60 ms on the fallback |
| Property set and the page requested in one task, then the scene requested | red | read after the scene status |

While the scene presented, the element under the source host was the live
node, and its computed background turned red at once. The capture did not
change until a refresh or a handoff. Every read was a screenshot taken
after the status change. The fourth row's read came while the transition
was still running, and the others came after it ended. The probe never
observed the first scene frame, so it cannot rule out a frame with the
old body.

### Designs

| Design | What happens | Where it fails |
|---|---|---|
| A. A presented-state attribute | Munari sets an attribute, and author CSS switches the background | The attribute changes no capture. While a field has focus the host is both on screen and captured, and one selector cannot serve both. The author still writes the color twice |
| B. The author's own state | The lab switches a class from `inScene` | It follows the requested state. After renderer loss the page presents transparent cards |
| C. Munari writes `--munari-body` | The page element carries the finish color. The source host carries `transparent` while its capture feeds a finish, and the color while it is shown as the page. The content inherits from whichever of the two holds it, so the value follows the live node as it moves. Munari changes the source host's value as part of each handoff and owes a paint, so the lift's existing wait covers it | The focused-field case still needs its switch to land in the frame the scene takes over |

### Recommendation: C

The author writes the background once:

```css
/* Sketch, not built. The fallback paints the card outside a finish. */
.settings-card { background: var(--munari-body, #3a3d42); }
```

With `color: null` Munari writes no property, and the fallback paints
the body in both places. The page element's style is rendered on the
server, so the page copy has its body before hydration. The page
element's `style` type omits custom properties today, so the build widens
it.

### Cases a build must check

Each case needs a browser check on the native path and on the snapDOM
fallback.

1. The page presents. The page copy shows the finish color, including on
   the first server-rendered paint.
2. The scene presents and the finish color changes. Munari writes the
   property and owes a paint. The probe's first row shows what happens
   without the owed paint.
3. The lift. The source host holds `transparent` before the capture the
   lift waits for. The probe's third row shows a value set before the
   request is in the scene once the transition ends. The first scene frame
   was not observed, so a check must read it.
4. A focused field during the lift. The same element is on screen as the
   page and is the capture. It shows the color until the scene presents and
   is transparent in the capture the scene first draws. This case is
   unverified and is the hardest.
5. A return to the page, including renderer loss. The page copy has the
   color whatever the requested state.

## Text color

A finish changes the body under the text, so the text color has to follow
it. Dark ink is unreadable on crimson lacquer. The lab sets `--mf-body`
from JavaScript on its page wrapper (`.mf-page`), and `--mf-ink` and
`--mf-quiet` come from CSS rules keyed on its `data-finish` attribute.
Its stylesheet calls the ink rules "content styling, not part of a
finish".

| Design | Usage | Consequence |
|---|---|---|
| A. CSS owns ink, a table suggests it | `style={{ '--ink': inks['lacquer-crimson'].ink }}` beside the finish | The author sees and controls every color, and page and scene match. One more value to pass |
| B. Munari writes ink properties | Munari sets `--munari-ink` and `--munari-quiet` on the content root | No wiring. Munari owns a contrast rule for every custom color |
| C. The shader recolors unlit text | none | The page shows the old colors, and contrast leaves the author's hands |

Recommended: A. The registry module exports `inks` beside `finishes`,
keyed by preset, each with `ink` and `quietInk`. A suggested ink matches
its preset's color. A Surface that overrides `color` picks its own ink.
