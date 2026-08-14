# Spike: the optics loupe

**Date:** 2026-08-11 · **Chrome 150, headless, dpr 1, `--enable-features=CanvasDrawElement`**

**Questions asked:**

1. Is a 3× re-raster measurably *sharper* than a 1× raster magnified 3× — not
   just bigger?
2. Does a click through a refracting lens land on target, using forward ray
   refraction (refract the pointer ray exactly as the shader refracts the view
   ray) rather than an inverse solve?
3. What does moving the lens cost in paints?

**Kill criterion, named in advance:** no measurable sharpness gain, or landing
error above ~4 CSS px at the lens edge that won't come down.

**Verdict: viable.** All three came back yes, with margin. Q1 is a 3× gain on a
metric that is blind to contrast; Q2 lands below the measuring instrument's own
noise floor; Q3 is free. The apparatus also turned up three authoring traps that
will cost a day each if the real implementation meets them cold.

Subject under study: a Mac OS X Aqua "save changes?" dialog, chosen because its
2px-period pinstripes are an accidental resolution test chart.

---

## What we learned

### Q1 — re-raster is sharper, by 3×

Two Surfaces, identical DOM, identical on-screen size (660×450), differing only
in `resolution`: `1` (a 1× raster stretched 3×, which is what any screenshot
magnifier does) against `3` (a true vector replay at 3×).

Two metrics on the same pixels, because one of them is a control:

| Band | Metric | 1× upscaled | 3× re-raster | Ratio |
|---|---|---|---|---|
| pinstripes | total variation | 5.49 | 5.45 | **0.99×** |
| pinstripes | gradient energy (Σ Δ²) | 60.7 | 180.0 | **2.96×** |
| pinstripes | max step | 12 | 33 | 2.75× |
| body text | gradient energy | 471.0 | 1574.7 | **3.34×** |
| body text | max step | 125 | 214 | 1.71× |

Total variation is the control and it is *supposed* to come out at 1.0: blurring
an edge spreads the same total excursion over more pixels. It reads 0.99×, which
says the two images carry identical contrast. Gradient energy is the answer:
same excursion concentrated into fewer pixels, 2.96× on stripes and 3.34× on
text. The difference is sharpness, not contrast, and the control is what proves
it.

The raw scanline across the pinstripe band is the finding without any statistics
at all:

```
1× upscaled : 245,255,255,255,255,245,234,222,222,222,222,234, …
3× re-raster: 255,255,255,255,255,255,222,222,222,222,222,222, …
```

The re-raster is a perfect square wave with zero ramp pixels. The upscale ramps
through 245 and 234 at every edge. Same source, same size on screen, same
bilinear magnification available to both.

### Q2 — the pointer lands, at 0.35–0.68 px

Method: a calibration chart whose red channel encodes source x and green encodes
source y, one level per CSS px, so a rendered pixel decodes directly to the
source coordinate it is *showing*. Ground truth is therefore the render itself.
Against that, the JS twin of the fragment shader predicts where a pointer at the
same screen position should land.

Lens: plano-convex, aperture 80px, sphere radius 140px, standing 160px above the
page, IOR 1.5 — about 1.6× magnification with hard nonlinearity at the rim.

| Sample | Mean error | Max error |
|---|---|---|
| control (flat page, no lens) | **0.79 px** | 1.22 px |
| lens, r=10 | 0.35 px | 0.83 px |
| lens, r=25 | 0.61 px | 0.94 px |
| lens, r=40 | 0.50 px | 0.83 px |
| lens, r=55 | 0.66 px | 1.15 px |
| lens, r=68 | 0.68 px | 0.85 px |
| lens, r=76 (rim) | 0.37 px | 0.85 px |

Every lens figure is **at or below the control**, which is the chart's own
1-level quantisation. There is no error to measure: the forward refraction is
exact, and it does not degrade toward the rim where distortion is worst. No
inverse solve, no lookup table, no iteration — refract the pointer ray with the
same six lines the shader uses on the view ray.

### Q3 — the lens is free; only LOD costs

| Action | Paints |
|---|---|
| 120-frame lens sweep across the panel | **0** |
| `resolution` 1 → 3 | **1** |

Moving the lens is pure fragment work on a texture that is already resident, so
a quiescent page under a moving loupe stays at the idle-zero floor. The only
paint in the whole interaction is the LOD commit, and there is exactly one of
it, matching platform.md item 6.

---

## What surprised us

Three traps, all of which presented as "renders, no error, wrong pixels" — the
expensive kind.

**1. A `<style>` tag inside the `html` prop does not apply.** The subtree
mounted, the markup was correct, and the capture came back as unstyled native
buttons on transparent black — clean paints, no console error. Styles have to be
injected into the page, which is where the parked subtree actually lives. This
is the lab's existing pattern (`injectWorkspaceStyles`) and now I know why it
exists. Worth a line in `docs/authoring.md`; it is the same *class* of failure as
the `mask-image` item, and it cost about the same to find.

**2. A raw `ShaderMaterial` gets none of three's output encoding.** The lens
rendered plausible-looking content that decoded to exactly `srgbToLinear()` of
the correct texel — 0.6706 → 103 where 171 was expected. Geometrically perfect,
photometrically wrong, and it looks like "the glass is slightly tinted" rather
than like a bug. `#include <colorspace_fragment>` fixes it. Any instrument in
the kit that samples the DOM texture through its own shader needs this, or it
will render visibly darker than the page it sits on.

**3. Uniforms must be written through the material ref, not the memoized
object.** Writing to the `useMemo`'d uniforms object left `uTex` unbound; the
sampler read `(0,0,0,0)`, and because the material was `transparent`, alpha 0
made the lens *invisible* rather than black — so it silently showed the plane
behind it and every measurement looked like a plausible-but-wrong optics result.
That is the failure mode that ate most of the spike.

Also worth recording: `useSurfaceTexture()` returns null on first render and the
texture arrives later, so a material that binds it as a JSX prop never gets it.
Bind in the frame loop.

---

## Still unknown

**Which surface gets the high LOD.** The spike pinned whole Surfaces. A loupe
needs the region *under the glass* sharp while the rest of the page stays cheap,
and one Surface has one tier. Three candidates, unresolved:

- Split the page into per-block Surfaces and pin the ones the lens intersects.
  Coarse, but it is exactly what the workspace scene's `approach()` already does
  and platform.md item 6 already measures.
- One page Surface pinned high throughout. Simple, 9× the memory, and it
  destroys the effect — the surrounding page would be sharp too, and the whole
  demonstration is the *contrast* between under-the-glass and beside-the-glass.
- A second high-LOD Surface mirroring the region. Rejected on sight: two clones
  means two copies of form state.

The first is almost certainly right, but it decides how the "page" is authored,
so it should be settled before the kit is designed.

**End-to-end pointer delivery.** Q2 verified the math against the render at
sub-pixel accuracy, but the pointer path in the spike is analytic (orthographic
screen → world), not a real raycast through `Surface`'s forwarding. Wiring a
lens-aware UV override into the relay is unproven work. The risk is plumbing,
not geometry.

**Perspective camera.** Everything here is orthographic, where the view ray is
constant. A perspective camera makes the incident ray per-fragment. The shader
change is one line; whether the JS twin stays this cheap is untested.

---

## Recommended approach

- Build the loupe against a page composed of **per-block Surfaces**, and let the
  lens pin the tier of whatever it overlaps. Do this first; it is the open
  question everything else sits on.
- Keep the optics in **one module, two languages**, adjacent in the same file,
  with the JS twin transcribing `refract()` literally. The agreement is exact
  and cheap to keep exact, but only if the two never drift apart.
- Every instrument material: `#include <colorspace_fragment>`, uniforms through
  the ref, texture bound in the frame loop. All three are one-line rules and all
  three fail silently.
- Pin the sharpness claim with the **gradient-energy-plus-total-variation pair**,
  not energy alone. The control is what makes the number mean "sharper" instead
  of "different", and a perceptual floor for the kit should be stated in those
  terms.
- The lens costing zero paints means the kit can carry several instruments at
  once without a budget conversation. Worth knowing before the industrial design.

## Cost signals

The real build is mostly content and industrial design, not mechanism. The hard
parts are the per-block LOD policy (new, and it decides the authoring shape) and
the lens-aware pointer override in the relay (plumbing through existing code).
No new dependencies. The optics are ~20 lines and already written twice.

---

*Apparatus: `spikes/optics/` — deleted. Untracked throughout; `spikes/` is in
`.git/info/exclude`.*
