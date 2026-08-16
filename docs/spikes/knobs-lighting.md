# Spike: relighting the knobs — one light story, told once

Two observations from the same session, both true, both the same defect:

1. The knob faces glow plum when the slab stands on the left half of the
   glass, and look right at the berth.
2. The artwork — the brightest thing in the room — casts no light on the
   panel.

The defect: **the scene's only art light is a full-sphere mirror wrap,
and its only honest light path is switched off.** The environment bake
paints the artwork twice around the sphere "so every reflection angle
finds it" (`Knobs.tsx`, `ArtEnvironment`), and fills the rest of the
sphere with the art's backdrop colors. There is no dark direction
anywhere. Meanwhile the positional art lights exist (`ArtLightRig`) but
ship tuned to zero (`lightArt: 0`, `lightAmbient: 0`), and the two white
directionals dim themselves near the art. So the panel receives the
picture only as a direction-indexed hue — whatever color the wrap put in
each normal's direction — and receives it from directions where, in the
scene's own fiction, there is nothing but dark room.

## The evidence

Every claim below is a browser measurement, not an argument. The probes
live as a recipe at the end of this doc. All colors are the mean RGB of
a 30-device-px disc centered on the first rotary's dial, artwork frozen
(`knobsValues.speed = 0`), carry verified (the vacated berth readout
must go dark, or the run measured the berth twice).

| toggle (within one run)          | dial crop, left station | reading |
| -------------------------------- | ----------------------- | ------- |
| baseline                         | rgb(57, 28, 37)         | plum: magenta excess (r−g) = 29 |
| hide the art's DOM               | rgb(57, 28, 37)         | unchanged — the DOM picture is not the source |
| hide `.knb-panel` (capture src)  | rgb(145, 117, 129)      | slab vanishes, art shows — capture follows the DOM |
| hide the canvas                  | rgb(139, 49, 47)        | slab vanishes at BOTH stations — WebGL presents at rest |
| hide the knob hardware meshes    | rgb(35, 27, 25)         | knob pixels are 3D hardware + lit face beneath |
| `scene.environment = null`       | rgb(27, 24, 20)         | **plum dies: excess 29 → 3** |
| environment restored             | rgb(57, 28, 37)         | and returns exactly — the env is the whole difference |

Two earlier cross-run "eliminations" (cap color, corona gain) were
unsafe: the frozen artwork freezes at a load-dependent phase, so only
within-run toggles are comparable. The table above is all within-run.

Why the left station and not the berth: the equirect carries a bright
art copy (gain 0.95) and a dim one (0.55) at different azimuths, over a
backdrop-colored ground. The slab's standing yaw and sway swing every
normal's sample direction as it travels, so each screen address gets its
own mix. Today's picture runs huge magenta fields; left of center the
normals land in them, at the berth they land in the dim/dark band. The
hue is position-indexed because *direction* is the only thing the wrap
knows.

Also established on the way, and worth keeping:

- **The canvas presents the slab at every station, always.** The DOM
  panel is capture source only, never the visible thing. (This scene
  never rests into a compositor hold; its picture animates, so there is
  no quiescent state to hand back to. Fine — but it means the WebGL
  lighting story is THE story. There is no CSS twin on screen to agree
  with; the capture and the meshes must agree with each other.)
- Hiding the capture-source DOM empties the capture. A DOM-side toggle
  can never distinguish which renderer presents; only starving the
  canvas can.
- The face of the slab is a `MeshStandardMaterial` with the capture in
  BOTH slots: `map` (lit matter — this is what the environment tints)
  and `emissiveMap` at `lightDom = 0.3` (its own light). The plum rides
  the lit slot, on the face and on the metal knob parts alike.

## The scene as built — the full stock-take

What exists, what it is made of, what lights it today, and what should
light it in a scene that tells the truth.

**Emitters (things that ARE light):**

| element | today | honest role |
| --- | --- | --- |
| artwork (page SVG behind the slab) | no positional light; full-sphere env wrap | the room's dominant lamp: a huge colored plane BEHIND the slab |
| LCD readout windows | pure emitters + warm point lights (`ReadoutLamps`) | correct — keep; their pools on the coat already read true |
| dial tick rings (`DialRings`) | emitter quads over the face | correct — keep |
| indicator lamps | emissive bulbs | correct — keep |
| knob index marks (`indexMat`) | emissive | correct — keep |
| corona (`BacklightCorona`) | shader-painted art-colored edge glow | correct as painted light *wrapping the silhouette*; it is not, and should not be, a light source |
| key + fill directionals | white, 0.08 / 0.6, self-dimming near the art | the studio: dim, white, constant — definition, not color |

**Matter (things light falls ON):**

| element | material today | defect |
| --- | --- | --- |
| slab face (captured DOM) | standard, r 0.5 / m 0.18, capture in `map` + `emissiveMap` ×0.3 | lit by the wrap from directions that should be dark room |
| knob skirt | steelDark: m 0.88, r 0.34, env 1.0 | high-metal surface inherits the wrap's hue wholesale — the plum's biggest carrier |
| knob cap | painted aluminum: m 0.35, r 0.8, env **0** | the zero is a compensation, not a description |
| toggle collar / lever | graphite / chrome (env 1.2, tuning-dripped) | same wrap exposure as the skirt |
| screws, rim | steel / rim materials (`SlabRim` dripped) | same |

**The panel's own CSS** paints a second copy of some of this light:
coat sheen gradients, dial-well shadows, knurl rings. Albedo and
geometry cues belong there; painted directional light competes with the
scene's light and can only agree by luck.

## The three structural defects

1. **The wrap lies about direction.** The art is behind the slab. The
   face and knob tops point at the camera — their light should come
   from a dark room. The wrap puts the picture there anyway, so every
   art-colored highlight on a camera-facing surface is light from a
   direction where nothing exists. Roughness cannot save it; a blurred
   lobe still integrates the same colors.
2. **The honest path is dead.** Nothing in the scene carries the
   picture's light to the front of the panel. The positional rig that
   looks like it should (`ArtLightRig`, `lightArt: 0`) ships switched
   off — but see the correction below: switching it on does not fix
   this, because punctual lights standing behind the slab cannot reach
   a camera-facing surface at all. The real missing term is the room.
3. **Materials encode compensations, not matter.** Cap env 0. Key at
   0.08 under a fill of 0.6. Directionals that dim by art level. Each
   value patched a symptom of (1); none describes what the thing is
   made of. This is how the scene lost the ability to be reasoned
   about — the numbers stopped meaning anything physical.

## From scratch — the architecture

One principle: **light comes from where things are.** Everything below
is that sentence applied.

1. **An environment that tells the truth about direction.** Keep the
   per-frame equirect + PMREM machinery exactly as is — change only the
   painting. The art occupies the band of the sphere where the art
   plane actually is (behind the slab, one copy, full gain, sized to
   the plane's real angular footprint). The camera hemisphere is dark
   room: near-black with the faint neutral ceiling glint the bake
   already has. Result, for free: camera-facing tops go quiet at every
   station; edges and skirt flanks that genuinely face the art keep a
   real, directional, art-colored grazing sheen; position dependence
   becomes small and physically motivated instead of large and
   arbitrary.
2. **The art becomes the room's lamp.** Re-enable `ArtLightRig`
   (`lightArt > 0`): two or three points at the art plane, colors
   sampled from the picture's law by region, physical decay. This is
   what makes "the visualization casts light on the dials" true — as
   colored rim and flank light, pooled shadowing, a panel that visibly
   stands in front of a bright picture. With the wrap fixed, this term
   no longer double-pays and can be tuned up without the scene
   bleaching.

   **This step was wrong, and measurement is what proved it. See
   "Correction" below — the punctual rig cannot do this job, and the
   room's bounce can.**
3. **Materials say what they are, in one table.** A single materials
   module: skirt steel (m ~0.9, r ~0.3, env 1), painted cap (m ~0.2,
   r ~0.65, env 1 — the zero dies), chrome, graphite, coat. Every
   compensation removed in the same pass: no env zeros, no
   art-proximity dimming on the directionals. If a material misbehaves
   under the honest environment, the environment is wrong — fix it
   there, never in the material.
4. **The face stays split: matter in `map`, light in the windows.**
   The current structure (lit capture + emissive floor, LCDs as pure
   emitters on their own) is right. With a dark camera
   hemisphere the lit term goes quiet on its own — no face-specific
   knob needed. `lightDom` stays the one dial for how much the panel's
   painted content self-illuminates.
5. **CSS paints matter, the scene paints light.** Strip painted sheen
   and directional glints from the coat and knob wells; keep albedo,
   text, geometry cues (well rings, knurl texture). One owner per
   phenomenon.
6. **Pin it with an instrument.** Promote the probe recipe to
   `instruments/knobs-glow/`: carry the slab to three stations, mean
   RGB on a knob face, and assert the thing that was actually broken —
   **station-to-station hue drift**, not absolute magenta. An absolute
   threshold would fail a scene that is correctly standing in a pink
   room. Keep the within-run discipline (frozen art, carry
   verification, single-run toggles) and the window anchor. The bug
   becomes a gate the way idle-zero did.

**What this is not** (second-system guard): no per-object reflection
probes, no light-probe grids, no bounce simulation. The whole rig is
one honest environment, ≤3 colored points, two white directionals, and
the emitters the scene already has.

**Order of work:** (1) repaint the equirect — smallest change, kills
the plum outright; (2) turn the art lights on and tune against the now-
quiet base; (3) materials table + delete compensations; (4) re-tune
`lightDom` and the corona against the new room; (5) commit the
instrument gate.

## Correction — what the relight measured, and where the plan was wrong

The plan above was written before the work. Two of its claims did not
survive contact with a probe. Both corrections are the point of the
spike, so they stay here beside the claims they replace.

**Punctual lights cannot light this hardware.** Step 2 said re-enabling
`ArtLightRig` is what makes the artwork illuminate the panel. It is not,
and the reason is geometry. The lamps stand behind the slab; every
surface a viewer sees faces the camera, so N·L is negative and there is
no diffuse term to collect. The one part that does turn away, the knob
skirt, is metal at 0.88 — metal has no diffuse term either. Measured:
400,000 candela moved the skirt 1.8%, and at any sane value the toggle
and the rim both read 0.0%. `lightArt` therefore ships at 0, with the
rig kept so the claim is one drag from being re-tested.

**The room's bounce is the honest path.** A bright picture in a dark
room paints the room, and the room lights the panel's front. So the bake
now measures the art half it just drew (a 1×1 `drawImage` downscale,
flux = rgb × coverage alpha) and fills the rest of the sphere with that
average under `destination-over`. Being an average it is the same in
every direction, so it cannot change when the slab moves — which is
exactly the difference between light and the lie it replaced. The
acceptance test is the HUE knob: nothing else in the scene answers to
hue, so if turning it moves the knob FACE, the picture is lighting the
panel. It moves it by 20.2.

**The overhead was the scene's hidden dominant illuminant.** A literal
in the bake, never a dial. It now has one (`envSky`), and finding it is
what let the balance shift toward the artwork at all.

**Results, four balances read at both stations in one run:**

| `envRoom` / `envSky` / key / fill | magenta, berth/left | drift | HUE response |
| --- | --- | --- | --- |
| 0.18 / 0.32 / 0.45 / 0.60 | 6 / 7 | 1.2 | 16.2 |
| **0.25 / 0.22 / 0.35 / 0.45 (shipped)** | **12 / 11** | **1.2** | **20.2** |
| 0.32 / 0.16 / 0.28 / 0.38 | 16 / 16 | 0.2 | 30.3 |
| 0.45 / 0.10 / 0.18 / 0.25 | 26 / 28 | 2.7 | 63.3 |

The defect was drift 16 (13 at the berth against 29 at the left). Every
balance above kills it; the row shipped is the one that also lands on
the magenta level Pete had already called correct.

## Probe recipe (what made this diagnosable)

Puppeteer + vite dev server, `--enable-features=CanvasDrawElement`.
The transport quirk: scripts import `puppeteer-core`/`vite`, so they
run copied into `node_modules/` (`cp probe.mjs node_modules/.p.mjs &&
node node_modules/.p.mjs; rm …`). The discipline that mattered:

- Freeze the picture through the live law (`knobsValues.speed = 0`) —
  but freezing lands at a load-dependent phase, so **cross-run color
  comparisons are invalid**. Every A/B above toggles within one run.
- Verify the carry: after dragging the slab, the vacated berth
  readout's luma must collapse, or the run is measuring the berth twice.
- Who holds the pixels is only discriminable by starving the canvas
  (`canvas.style.visibility = 'hidden'`). Hiding source DOM empties the
  capture and proves nothing about who presents.
- Decode screenshots in-page (data URL → canvas → `getImageData`) —
  the browser already has the PNG decoder, and hue (r−g), not luma, is
  the signal for an art-colored cast.
- **Anchor the crop to the slab, never to a computed address.** This
  cost a whole sweep. The crop was placed from the startup layout, but
  the capture DOM parks at x = 0 after the first drag and the slab does
  not land where the drop coordinate says: at the far station the crop
  missed the dial by 23 px and reported a station swing that was really
  a miss. Locate before every reading. A dark-run scan finds the
  ARTWORK's dark fields, not the panel; the lit amber windows are the
  one thing only the slab has, so their centroid is the anchor, and the
  untouched first frame calibrates the vector from it to the dial.
- **Read a stability series before trusting any A/B.** Six readings of
  one station, seconds apart, agreed to the last digit — which is how a
  drifting panel was ruled out and the crop was convicted instead.
- **Alternate the stations inside one run.** One carry cannot separate
  a station effect from a run-level one. Three round trips can, because
  everything else is held fixed across all six readings.

## The bounce came out the color of the middle of the picture (2026-08-14)

**Symptom.** The panel's front took its light from the smallest, innermost
blades of the artwork, not from the large outer ones that cover most of it.

**Cause.** The room bounce is one flat color flooded under the whole
environment sphere, and it was averaged off the equirect bake. An
equirect is equal-**angle**. The art plane is ~918 px wide standing 48 px
behind the slab, so it spans 84° of half-angle: the middle is magnified
and the rim is squashed onto the horizon.

Integrating the projection against a 10-layer stack (1440×900, `envArt`
0.6):

| | equirect share | true area share |
|---|---|---|
| inner half-radius (¼ of the picture) | 83.3% | 25.0% |
| outer half of the stack | 21.7% | 75.3% |
| two smallest blades (4.3% of the area) | 40.1% | 4.3% |

A second bounce is driven by **flux**, and flux goes with **area**. Solid
angle is the right measure for *how much* of the surroundings is lit
picture, and the wrong one for *what color* that light is.

**Fix.** Split the two questions. Coverage stays on the equirect. Color
moves to a flat 32×32 copy of the picture in its own frame
(`roomLight`, `knobsEnvironment.ts`), luminance-weighted so a bright
region counts for more than its area, with the chroma that RGB averaging
destroys restored — opposed hues used to bounce **gray**, which is the
one answer a complementary scheme cannot have.

**Measured swing**, defaults at hue 210, chroma 0.85, 10 layers:

| scheme | angle-weighted | area-weighted | Δhue |
|---|---|---|---|
| mono | 209° sat 0.66 val 0.85 | 202° sat 0.75 val 0.50 | 7° |
| analogous | 189° sat 0.62 val 0.80 | 211° sat 0.71 val 0.52 | 22° |
| p2 | 224° sat 0.51 val 0.73 | 328° sat 0.64 val 0.45 | 104° |
| p3 | 280° sat 0.47 val 0.64 | 3° sat 0.67 val 0.56 | 83° |
| p4 | 267° sat 0.49 val 0.69 | 24° sat 0.67 val 0.59 | 117° |
| p5 | 249° sat 0.52 val 0.68 | 33° sat 0.71 val 0.49 | 144° |
| p6 | 293° sat 0.53 val 0.60 | 74° sat 0.69 val 0.43 | 141° |

Mono barely moves, which is the control: with one hue there is nothing to
redistribute. The wide schemes swing up to 144° — the bounce was landing
on the far side of the wheel from where the picture's bulk stands.

Value falls ~30% across the board, because the outer blades really are
the darker ones (`light = 66 − 16·t`). That is the correction working,
not a regression; `envRoom` absorbs it.

**Method.** `generateArt` is pure, so both averages can be taken offline
with no browser: point-sample the plane through `equirectUV` for the
angle-weighted figure, on a uniform grid for the area-weighted one,
composite the layers at each sample, and hand both to `roomLight`.

## The frame drops were one pixel (2026-08-14)

**Symptom.** Visible hitches. `instruments/knobs-hz` on committed code:
idle p99 **141.5 ms**, max **317 ms**, **42 long tasks** across four phases.
The median said 0.40 ms, which is not a fast scene — it is the signature
of a blocked pipeline flushing a burst between stalls.

**Cause.** One `getImageData(0, 0, 1, 1)`. The room bounce measured its
coverage by downscaling the equirect to a single pixel and reading it
back. That canvas also feeds a `CanvasTexture`, so it lives on the GPU,
and reading any part of it makes the CPU wait for the GPU: **~18 ms per
call, 20 times a second**. A CPU profile put it at **70.9% of all JS
time** — 7.2 s out of 10.

It was also wrong, in the same way and for the same reason as the color
was: a 1x1 `drawImage` downscale is not a box filter. It reported
coverage **1.0000** against a true **0.8137**.

**Two fixes that did not work**, both measured before being discarded:

- *Software-back the equirect* (`willReadFrequently`). Kills the stall and
  **doubles the mean frame** (1.67 → 3.47 ms): every polygon fill and the
  texture upload go through the CPU instead. Net loss.
- *Throttle the PMREM re-bake.* Costs nothing. Interleaved A/B, six
  alternations inside one session: re-bake on 5.73 ms mean, off 5.70 ms.
  Identical at every percentile.

**Fix.** Stop asking the GPU. Coverage is solid angle, and solid angle is
geometry: each texel of the flat raster the color is already measured
from subtends `dA·d/r³`, and the hemisphere is `2π`. The weights depend
only on the viewport and the art plane's depth, so they are built once
per resize (`solidAngleField`, `roomCover`). Measured against the
equirect: 0.918 where the readback said 1.000 and the equirect's own
pixel mean says 0.814 — the residual is the equal-angle/solid-angle
difference, and solid angle is the physical one. Stable across the
`envArt` range (12.8% at 2.0, 14.1% at 0.6) where a flat-area weighting
drifts 0.2% → 27%.

**Result.** Every long task in the scene, gone.

| | committed | fixed |
|---|---|---|
| idle p99 / max | 141.5 / 317.0 ms | 15.7 / 29.2 ms |
| drag p99 / max | 139.4 / 284.4 ms | 18.6 / 32.1 ms |
| long tasks | 42 | **0** |

**What is left is fill rate, not JS.** With the stall gone the profile is
76% `uniformMatrix4fv`/`3fv` — at 129 matrix uniforms and 54 draw calls a
frame, those calls are blocking, not working. Interleaved, dpr 1 against
dpr 2: **mean 2.59 vs 5.16 ms, p95 7.3 vs 16.0**. The panel covers 18% of
a 5.2 Mpx buffer, so the cost tracks the canvas, not the content. The
lever is `dpr={[1, 2]}` in `App.tsx`; it is a sharpness trade, not a free
win, so it is recorded here rather than taken.

**Method.** Seven sequential headed-Chrome runs drift upward as the
machine heats: the same build measured 3.59, 3.69, 3.78, 4.05, 5.39 ms.
Sequential A/B is worthless at that scale. Every comparison above
alternates its arms inside ONE session, which is the same lesson the
relight recorded about stations.
