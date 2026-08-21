# candidates

Seven prototypes of one question, on one bench: **which state changes are
worth handing to the other renderer?**

Each candidate takes a state a component already has — pressed, selected,
open, moved, being read, copied, deleted — and gives the pixels to WebGL
for exactly as long as that state lasts. They exist to be compared, not
shipped. Nothing here is a public API, and nothing here is welded to
`registry/`.

Open the bench at `?scene=candidates`; each demo deep-links as
`?scene=candidates&candidate=<id>`.

| id | what it does | the claim to check |
| --- | --- | --- |
| `ripple` | a press lifts the control off the page and sends one crest across it | the press still registers — the counter is incremented by the copy that heard the click, through the relay |
| `selection` | each selected line sits in its own strip of glass that refracts it off the page | the paragraph never leaves the DOM; this is the one **inclusive** demo, a second presentation of live text |
| `unroll` | a dropdown is a sheet wound on a roll, paid out as it opens | the menu is usable mid-roll — the vertices are warped on the CPU, so the hit test follows the pixels |
| `dissolve` | a card comes apart into its own pixels, crosses the page, and reassembles | it lands as a real card; the edit counter inside it keeps counting |
| `analyze` | the block an agent is reading turns to glass with a travelling read head | the colour is derived from the block's own luminance edges and the sheet's own slope, not a wash laid over it |
| `copy` | a copy of a code block is drawn into the cursor, and the block regenerates behind it | the original never moves, and the copy tracks the live pointer while it flies |
| `delete` | melt, shatter, peel — three materials for the same gesture | the list keeps its height, and all three leave through the bottom of the window rather than fading |

## The two rules every candidate obeys

**Premultiplied alpha** (decisions.md #5). Tint with `c.rgb += k * c.a`,
fade with `c *= f` on the whole `vec4`. A shader that fades only `.a` here
produces a bright halo on every antialiased glyph edge.

**Every fragment shader ends with `#include <colorspace_fragment>`.** The
Surface texture is `SRGBColorSpace`, so the sampler hands back linear and a
raw `ShaderMaterial` writes to the framebuffer with no encode of its own.
Leave the chunk out and the whole capture lands one sRGB decode too dark —
gap 2 below has the measured numbers.

**The silhouette stays the control's.** Any custom material splices
`SURFACE_RADIUS_GLSL` and supplies `uMunariRadii` and `uMunariSize`
itself. Without it a rounded button becomes a square one the instant it
changes hands.

## Where the numbers come from

`candidateCurlLaw.ts` is the only pure law in the folder, and it has the
only test: an inextensible sheet wound on a roll, which the dropdown and
the peel delete both use. Tessellation is sized against each
deformation's own period, never guessed — the comment at each
`planeGeometry` says which period and why.

## Capability gaps found while building this

Notes for later. Each is something a candidate wanted, that munari does
not currently offer, and that a workaround had to stand in for.

1. **A scalar uniform written in `useFrame` never reaches the GPU.** This
   one is a live trap, not a wish. `@react-three/fiber` 9.7 stopped adopting
   the `uniforms` prop and started copying it entry by entry into the
   material's own container (`applyProps`: "ShaderMaterial uniforms must
   keep a stable target reference"). An object-valued uniform survives the
   copy, because both containers hold the same Vector or Texture instance.
   A **number** does not: the material keeps its own `{ value }` box, and a
   per-frame write to the memoized bag lands in an object nothing samples.
   Five of the seven candidates drew their `t = 0` frame forever while their
   clocks ran perfectly. `useOwnUniforms()` in `candidateStage.tsx` swaps
   the container back. No other lab scene is affected — flight and genie
   write theirs during render, where the prop is re-applied, and veil writes
   through `m.uniforms` on a ref, which is the material's own bag already.

2. **Nothing warns a custom material that it owes an sRGB encode.** The
   Surface texture is `SRGBColorSpace`, so the sampler hands a shader
   linear values, and a raw `ShaderMaterial` writes them to the framebuffer
   with none of the encoding three injects into its own materials. The
   whole capture goes through one extra sRGB→linear decode and lands dark.
   Measured in Chrome on 2026-08-20: the candidates' `#f2f0e4` panel
   arrived as `226,222,198` — a 30-count drop in blue, which reads as the
   page's background vanishing for the length of the effect and snapping
   back at the end. The fix is one line, `#include <colorspace_fragment>`,
   and every shader in this folder was missing it. The library knows the
   texture's colour space and knows the material is custom; a dev-mode
   warning when a material sampling a Surface texture has no encode in its
   fragment source would have caught all eight at once.

3. **A presenter is always a mesh.** `Surface.WebGL` renders a `<mesh>`,
   so the pixel cloud could not be `THREE.Points`. Worked around by
   building billboarded quads by hand (`candidateCloud.ts`) and expanding
   them in the vertex shader — four vertices and two triangles per grain
   where one point sprite would do. A `Points` presentation would be a
   real saving for any particulate effect.

4. **A material can only reach its own Surface's texture.**
   `useSurfaceTexture()` answers with the enclosing Surface's capture and
   there is no way to sample another one, so a single cloud cannot morph
   card A into card B. `dissolve` is staged instead as two overlapping
   clouds, one fading out and one fading in, sharing a path and a clock.
   A cross-fade between two captures in one material is the shape that is
   missing.

5. **`placement="match-dom"` is unusable for anything physical.** It
   places a *unit* plane at `MATCH_DOM_DISTANCE = 1` from the camera and
   scales it to size, so vertex displacement written in pixels comes out
   scaled by the plane's own factor. Every candidate here uses
   `placement="manual"` plus a pixel-perfect camera instead, and every one
   of them re-measures its own `getBoundingClientRect()` to do it. A
   match-dom mode whose geometry is in CSS pixels would delete that
   measuring code from seven files.

6. **No shared pixel-perfect camera.** `cameraDistance()` is exported, but
   fitting a camera to the viewport so that one world unit is one CSS
   pixel is written out by hand in fisheye, in flight, and again in
   `candidateStage.tsx`. It is the same twelve lines each time.

7. **Nothing measures a DOM box into world space.** `worldBoxOf()` in
   `candidateStage.tsx` is the fourth copy of this in the lab. It is four
   lines, but it is four lines that every manually-placed presentation
   needs and that are wrong in a subtle way if the viewport is scrolled.

8. **A geometry that changes every frame must drop its own bounding
   sphere.** Three caches it on the first raycast, so a CPU-warped mesh
   silently stops hit-testing at the displacement. Both `unroll` and
   `delete`'s peel set `geometry.boundingSphere = null` by hand each
   frame. Fisheye is named after this fault. Something in the library
   should own it.

9. **No per-effect frameloop claim.** A scene either runs `always` or
   manages `demand` itself. Seven independent effects with seven clocks
   would each need to claim and release, so this bench simply runs
   `always` and gives up the zero-paint property. A presenter-scoped
   "I am animating" claim is the missing piece.

10. **`onWebGLReleased` is the only end-of-handoff signal.** It says the
   pixels are back, which is what `useLift` uses to unmount the mesh. What
   several candidates actually wanted is a signal for *the mesh is about to
   be torn down*, so a material can hold its last frame — the current
   workaround is to keep `mounted` as separate state from `view`.
