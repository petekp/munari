# Materials catalog

> **Status: research (nothing built).** This is the per-candidate detail for [materials research](materials-research.md). Costs marked "measured" come from its [§2](materials-research.md#2-measured-gpu-cost): GPU ms per full-screen layer at 2880×1800 on an Apple M2 Pro. Every other cost is an estimate and says what it rests on. Parameter ranges cite their source. Ranges without a source come from the lab's existing tuning and need checking by eye.

"Unlit HTML" means the capture is composited over the lit body, as the polymer prototype does. It needs a transparent content root (see [§3](materials-research.md#3-how-a-material-interacts-with-the-captured-html)). Every three.js file named here is MIT-licensed at [r186](https://github.com/mrdoob/three.js/blob/r186/LICENSE).

---

## 1. Physical materials

| Candidate | Look and demo | three 0.186 | Captured HTML | Cost | Preset parameters |
|---|---|---|---|---|---|
| Molded polymer (ABS, Delrin, silicone) | Soft matte plastic with a lit bevel and a contact shadow. Polymer prototype. | Lighting is `MeshPhysicalNodeMaterial`. The bevel normal and shadow are custom TSL, already in the lab. | Unlit HTML keeps text exact. Shading only, so hit testing is unchanged. | Measured: lab body 0.42, physical body 0.76 plus the bevel math | `baseColor`; `roughness` 0.3–0.6; `clearcoat` 0–0.3; `sheen` 0–0.4; `ior` about 1.49 for opaque ABS and 1.38–1.41 for silicone (both unverified); `bevelWidth` 4–12 px; `pillow` 0–0.3; `grain` 0–0.03 |
| Lacquer and glazed ceramic | A gloss coat over a colored base, with sharp highlights. Product cards, a ceramic control panel. | `clearcoat`, `clearcoatRoughness` and `clearcoatNormalNode` | Lit HTML takes the coat highlight, so unlit HTML is the safer default. | Measured: 1.13 | `clearcoat` 1; `clearcoatRoughness` 0–0.15; base `roughness` 0.4–0.8; coat normal noise 0–0.05 for orange peel |
| Brushed and anodized metal | Stretched highlights that turn with the light. Dials, a hardware faceplate. | `anisotropy` and `anisotropyRotation` with `metalness` 1 | Metal has no diffuse color, so text must be unlit HTML or engraved through a normal map. | Measured: 1.07 | `baseColor` from metal F0, such as aluminum (0.916, 0.923, 0.924); `roughness` 0.2–0.5; `anisotropy` 0–0.9; rotation 0–π |
| Clear and frosted glass | Refraction at the rim, a blurred backdrop through the body. Glass demo, overlays. | Stock `transmission`, `thickness`, `ior` and `dispersion` exist but sample the canvas, which draws too bright ([decisions.md #72](decisions.md#72)). Use the `registry/glass` compositor. | Glass lays its HTML unrefracted on top. It needs a render target of the scene behind it. | Measured: stock transmission +1.05 per frame, +2.46 with dispersion. The glass pack's per-pass cost can be measured with `instruments/glass-performance`; no result is recorded. | Existing `GlassParams`. `ior` 1.49 for PMMA and 1.52 for soda-lime glass; `dispersion` = 20 / Abbe number, 0.33 for crown glass and 0.625 for polycarbonate; frost sigma 2–16 CSS px |
| Thin-film foil | Color that shifts with view angle, like a soap film or a holographic card. A collectible card or badge. | `iridescence`, `iridescenceIOR` and `iridescenceThicknessNode`. Without a thickness map, the node path uses only the maximum of `iridescenceThicknessRange` (`MaterialNode.js`), so the film is one constant thickness. | Lit HTML is tinted by the film, so mask the film to pixels without text. | Measured: 1.77 at a constant 400 nm. A varying thickness through `iridescenceThicknessNode` was not measured. | `iridescence` 0–1; `iridescenceIOR` 1.3 by default; thickness 100–400 nm by default, up to 1000 nm for soap film |
| Velvet and felt | A soft rim glow at grazing angles. A fabric-covered speaker panel. | `sheen`, `sheenRoughness` and `sheenColor` (Charlie sheen) | Sheen sits at the edges, so lit HTML stays readable. | Measured: 0.82 | `sheen` 0–1; `sheenColor` starting at sqrt(baseColor); `sheenRoughness` 0.3–0.8; base `roughness` 0.7–1 |
| Paper | Matte stock with visible fiber. Editorial layouts, the polymer prototype's variant A. | Physical with high roughness, plus a fiber texture. three has no paper model. | Lit HTML is correct here, because ink on paper is lit. | Estimate: about physical (0.76) plus one texture fetch, from the measured basic sample | `roughness` 0.8; color (0.794, 0.834, 0.884) for office paper; fiber scale and contrast |
| Rubber and soft-touch | Dead-matte coating with a faint broad highlight. Knobs, grips. | Physical with high roughness and low `specularIntensity` | Lit HTML is fine. | Estimate: same as physical with no lobes (0.76) | `roughness` 0.7–0.9, with tire rubber at 0.7; `specularIntensity` 0.3–0.6 |
| Translucent wax and silicone | Light bleeding through thin edges. Polymer variant C. | `MeshSSSNodeMaterial`, a view-dependent back-scatter term rather than diffusion | Lit HTML takes the scatter color, so use unlit HTML. | Measured: 0.87 | `thicknessColorNode`, which must be set or the effect does nothing; `thicknessDistortionNode` 0.1; `thicknessPowerNode` 1–4 (default 2); `thicknessScaleNode` 1–10 (default 10) |

Sources for this table:
- Layer models are in the [OpenPBR Surface spec](https://academysoftwarefoundation.github.io/OpenPBR/) (Apache-2.0), [Autodesk Standard Surface](https://autodesk.github.io/standard-surface/) (Apache-2.0), and the Disney principled BRDF [2012](https://media.disneyanimation.com/uploads/production/publication_asset/48/asset/s2012_pbs_disney_brdf_notes_v3.pdf) and [2015](https://blog.selfshadow.com/publications/s2015-shading-course/burley/s2015_pbs_disney_bsdf_notes.pdf) notes. All three stack a fuzz or sheen layer, a coat, a thin film and a base.
- Default parameter values come from the [Khronos glTF material extensions](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos). These include `KHR_materials_iridescence` (IOR 1.3, 100–400 nm), `KHR_materials_dispersion` (20 / Abbe number, with its Abbe table) and `KHR_materials_anisotropy`, all ratified.
- Metal F0 colors, the cloth model and the reflectance table come from [Filament's material guide](https://google.github.io/filament/Filament.md.html) (Apache-2.0). Plastics and glass reflect 4–5%, at IOR 1.5–1.58.
- IORs and the paper, rubber and aluminum values come from [physicallybased.info](https://physicallybased.info) (CC0). PMMA is 1.4905, polycarbonate 1.5848 and soda-lime glass 1.52. physicallybased.info has no entry for ABS, Delrin or silicone. ABS is about 1.49 for opaque grades, from a MatWeb summary that was not opened. Silicone (PDMS) is 1.384 on Wikipedia and about 1.41 in patent summaries. The Delrin IOR is unverified.
- three implements thin film from Belcour and Barla 2017, "[A Practical Extension to Microfacet Theory for the Modeling of Varying Iridescence](https://hal.science/hal-01518344)". Its sheen is Estevez and Kulla 2017, "[Production Friendly Microfacet Sheen BRDF](https://fpsunflower.github.io/ckulla/data/s2017_pbs_imageworks_sheen.pdf)". Both are in `src/nodes/functions/` at r186.
- Anisotropy on a flat `PlaneGeometry` rendered without errors in the bench. Whether the highlight is correct without a tangent attribute was not checked.

---

## 2. Surface effects

| Candidate | Look and demo | three 0.186 | Captured HTML | Cost | Preset parameters |
|---|---|---|---|---|---|
| Grain and dither | Fine stable noise that also removes banding in soft gradients and shadows | No grain node in materials. `mx_noise_*` exists. A blue-noise texture is one `texture()` sample. | Add grain to the body, not to unlit HTML, or text edges shimmer. | Measured: 3-octave `mx_fractal_noise_float` costs 1.73. Estimate: a blue-noise texture is about the 0.02 of a texture sample. | `amount` 0–0.03; scale 1–2 CSS px; static or animated |
| Bevel and cushion normal | A molded edge that catches the light | The polymer prototype's rounded-rect gradient, fed to `normalNode` | Shading only. Moving vertices would need `deformSurfaceGeometry`. | Measured as part of the 0.42 body | `bevelWidth`, `cornerRadius` (from the Surface), `pillow`, recessed or raised |
| Embossed or engraved content | Text pressed into the material | A `normalNode` built from the gradient of the capture's alpha | Needs the capture as an input; shading only | Estimate: about 4 extra texture samples, from the measured basic sample | depth 0–1 px; light-facing or both edges |

Sources:
- [Free blue noise textures](https://github.com/Calinou/free-blue-noise-textures) by Christoph Peters are CC0.
- [Paper Shaders](https://github.com/paper-design/shaders) is Apache-2.0 and keeps its NOTICE. Its `grain-gradient`, `paper-texture` and `dithering` are GLSL and would need a TSL port.
- [tsl-textures](https://github.com/boytchev/tsl-textures) is MIT and already in TSL.
- [LYGIA](https://github.com/patriciogonzalezvivo/lygia) uses the Prosperity license, which allows commercial use only as a trial. Use it as reference only.

---

## 3. Scene and screen effects

| Candidate | Look and demo | three 0.186 | Captured HTML | Cost | Preset parameters |
|---|---|---|---|---|---|
| Soft contact shadows | A card floating above the page under an area light | The polymer prototype's ray-projected rounded-rect shadow. Shadow maps offer `PCFShadowMap` and `VSMShadowMap`. No PCSS node exists. `webgpu_shadow_contact` blurs a depth render. | No interaction: drawn on its own skirt mesh | Not measured separately. Its shader evaluates three rounded-rect distances; the measured 0.42 body evaluates five. | elevation; light radius; opacity 0.08–0.2; contact opacity |
| Backdrop blur (frost) | A blurred page behind a panel | `gaussianBlur` in `tsl/display`, with `{ premultipliedAlpha: true }` for premultiplied input. `premultipliedGaussianBlur` is deprecated since r180. | Reads a render target of the scene. The panel's own HTML stays sharp. | Measured: +0.86 at half resolution, +2.57 at full (sigma 8) | sigma 2–16 CSS px; resolution scale 0.25–0.5 |
| Bloom | Glow from bright pixels: LED readouts, highlights | `bloom()` | Page white is luminance 1, so the threshold must sit above it and glow must come from emissive values above 1 | Measured: +0.58 | strength 0–1; radius 0–1; threshold just above page white |
| Depth of field | Focus pulls between panels | `dof()` | Blurs the captured text it covers | Measured: +2.80 | focus distance; focal length; bokeh scale |
| Ambient occlusion | Darkening where panels meet | `ao()` (GTAO) and `SSAONode` | Sees each Surface as a flat plane | Measured: +4.00 at half resolution, +15.02 at full | radius; intensity |
| Refraction with dispersion | Rainbow fringes at a glass rim | Glass pack spectral taps. Stock dispersion draws too bright on `SurfaceCanvas`. | See glass in §1 | Measured: stock +2.46 per frame | see glass |
| Caustics | Light patterns cast through glass or water | Example-local TSL in `webgpu_caustics` and `webgpu_volume_caustics`, not a library node | Needs a light-space render | Not measured; no basis for an estimate | ior; intensity; scale |
| Film grain, chromatic aberration | Camera-like finish over the whole canvas | `film`, `chromaticAberration` | Applies to text too | Not measured. Each is one full-screen pass, fewer than bloom's chain, which measured +0.58. | intensity |

Sources:
- Evan Wallace's [fast rounded rectangle shadows](https://madebyevan.com/shaders/fast-rounded-rectangle-shadows/) is CC0. It is an exact Gaussian integral over a rounded rectangle and a closer fit than the prototype's `smoothstep` penumbra.
- The dual-filter (Kawase) blur from Bjørge's SIGGRAPH 2015 "[Bandwidth-Efficient Rendering](https://blog.frost.kiwi/dual-kawase/)" talk would be a cheaper frost at large radii. The technique can be reimplemented. Blog code needs its own license check.
- GTAO is Jimenez and others, SIGGRAPH 2016, "Practical Realtime Strategies for Accurate Indirect Occlusion". [N8AO](https://github.com/N8python/n8ao) is CC0 and WebGL-only.
- Caustics references: [webgl-water](https://github.com/evanw/webgl-water) (MIT, stated only in the `main.js` header; the repo has no LICENSE file and its images state no license) and [threejs-caustics](https://github.com/martinRenou/threejs-caustics) (BSD-3-Clause). Both are WebGL, so only the technique carries over.
- Refraction references: drei's [MeshTransmissionMaterial](https://github.com/pmndrs/drei/blob/master/src/core/MeshTransmissionMaterial.tsx) is MIT, but it credits two upstream shaders with unchecked licenses, and it is GLSL. Maxime Heckel's [refraction post](https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/) states no license. Use both as reference only.

---

## 4. Licenses at a glance

| Can be copied into Munari, keeping the notice | Reference only |
|---|---|
| three.js examples (MIT), tsl-textures (MIT), Paper Shaders (Apache-2.0, with NOTICE and change marking), Evan Wallace's shadow (CC0), blue noise (CC0), N8AO (CC0), webgl-water code (MIT), threejs-caustics (BSD-3-Clause), pmndrs/postprocessing (Zlib), physicallybased.info data (CC0) | Shadertoy code (CC BY-NC-SA 3.0 unless a shader states otherwise), LYGIA (Prosperity), [pokemon-cards-css](https://github.com/simeydotme/pokemon-cards-css) (GPL-3.0), Maxime Heckel's post (no license), drei's transmission material (unchecked upstream credits) |
