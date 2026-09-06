# The API across every demo

**Status: implemented in the isolated API worktree.** All 24 routes and seven Candidate studies have a concrete implementation. Lamp and Rain retain their existing renderers. The diagrams use the implemented public names. This checkout has not been published.

The sketches show ownership and composition. The linked files contain the complete geometry, material, state, and event code. [API details](API-REVISION-2.md) explain the shared contracts.

<a id="home"></a>

## Home

**Implemented.** The postcard enters the scene; the masthead and starter have separate jobs.

```text
HomePostcard → handoff state stays in this component
├─ Surface.Root inScene={in3D}
│  └─ Surface.HTML → Postcard
└─ SurfaceCanvas → positioned in the page section
   └─ Surface.Scene surface={postcard}
      └─ HeroMesh → motion and deformation
         └─ Surface.Mesh → postcard grid
            └─ useSurfaceBeforeRender → update shadow after pose

HomeStarter → Surface + its own SurfaceCanvas
```

The postcard and its shadow use the same frame; its canvas scrolls with the page.

HomePostcard owns the request, handle, camera, and canvas. HomeHero owns the HTML and flight geometry. The post-pose callback updates the existing light renderer.

The starter uses the simple Surface wrapper. Its counter and the postcard have separate canvas identities.

The website was copied into the isolated worktree. The active site checkout remains untouched.

Checked: Desktop/mobile typing and stamping, original field identity, six-cycle companion pixels, frame timing, and compositor-scroll marker comparison.

[Complete source](apps/lab/src/scenes/home/HomePostcard.tsx).

<a id="workspace"></a>

## Workspace

**Implemented.** HTML panels remain in a navigable 3D workspace.

```text
SurfaceCanvas
├─ Environment + camera/focus rig
└─ Per-panel group (drag position)
   └─ FocusGroup
      ├─ SceneSurface.Root
      │  ├─ SceneSurface.HTML → WorkspacePanelSource
      │  └─ SceneSurface.Mesh → panel plane
      └─ Satellite dial (ordinary 3D control)
```

The panel and its satellite dial share focus and movement; the camera is workspace-wide.

Panel content and size come from the existing workspace specification.

There is no page-to-scene toggle for each resident panel. FocusScene and FocusGroup retain their current jobs.

Checked: Maintained demand-rendering mutation/resize gate.

[Complete source](apps/lab/src/scenes/workspace/Workspace.tsx).

<a id="glass"></a>

## Glass

**Implemented.** Live HTML appears on glass panels whose refraction is drawn by custom render passes.

```text
SurfaceCanvas
├─ Environment + WebAppFraming
├─ GlassBufferCoordinator / GlassSdfCompositor
└─ Per-panel group
   └─ SceneSurface.Root
      ├─ SceneSurface.HTML → panel's form or text
      └─ SceneSurface.Mesh
         ├─ Transmission geometry/material OR manual proxy
         └─ GlassInk / InkRegistrar
```

The shared glass compositor belongs beside the panels, not inside one panel's Scene.

The transmission variant retains its per-panel render target and ink overlay.

The SDF variant retains presentation=manual and the advanced surfaceManualPresenter receipts. A hidden proxy is not proof that the final image was drawn.

No generic glass shader is created by Munari; these are existing demo renderers.

Checked: Route and compositor setup; maintained scene drag and pointer checks.

[Complete source](apps/lab/src/scenes/glass/Glass.tsx).

<a id="flight"></a>

## Flight

**Implemented.** The live card lifts, moves between columns, and returns to the page.

```text
Page list → <li ref={target.ref}> for each card

Surface.Root (stable React position per card)
├─ Surface.HTML target={target} → CardBody
└─ Surface.Scene
   ├─ Driver → flight physics
   ├─ Shadow mesh
   └─ Group → position and rotation
      └─ Surface.Mesh → card grid + CardMaterial

SurfaceCanvas → shared camera and frame scheduling
```

A page target moves the card between columns while its React instance stays mounted.

Each target comes from createPageTarget; its ref names the current list slot. The card Root stays outside the changing column lists.

The demo supplies the measured dimensions, physics, bend, crumple, shadow, and deletion policy.

Checked: Real cross-column drag retained the original card; maintained delete/shadow checks; six-move focused-input target check.

[Complete source](apps/lab/src/scenes/flight/Flight.tsx).

<a id="explode"></a>

## Explode

**Implemented.** Inspect separately captured DOM paint layers at different depths.

```text
Demo creates plate.node for each DOM layer

SurfaceCanvas
└─ Per-plate group → depth from spread
   ├─ SceneSurface.Root
   │  ├─ SceneSurface.HTML element={plate.node}
   │  └─ SceneSurface.Mesh → interactive plate
   ├─ PlateFrame → line geometry
   └─ SceneSurface.Root → label HTML + label mesh
```

SceneSurface.HTML accepts the detached plate element and retains HTML input routing.

The demo creates each detached plate and its dimensions. element and React children are mutually exclusive source inputs.

The native subject stays in place; the scene controls plate depth, camera, frames, and labels.

Checked: Six adopted plates, original native subject, spread/collapse, and camera drag.

[Complete source](apps/lab/src/scenes/explode/Explode.tsx).

<a id="genie"></a>

## Genie

**Implemented.** A live window bends into a dock and can reverse during the motion.

```text
Surface.Root (one window)
├─ Surface.HTML → window content
└─ Surface.Scene
   └─ Group (window position and stacking)
      ├─ Window motion/deformation controller
      └─ Surface.Mesh → subdivided sheet + GenieMaterial
         └─ FilmComposite / FrameSurface (video variant)

Page → dock buttons, visibility, and window state
```

The window uses Surface composition; the video variant retains its specialized FrameSurface compositor.

The demo owns the reversible grid warp, dock destination, stacking, and minimized visibility.

The original film canvas and separate video decoder stay mounted. Inert snapshots copy pixels without creating a second live publisher.

FrameSurface retains the existing frozen-generation and actual-presentation receipts.

Checked: Maintained film identity/playback/context-loss gate and traveling-shadow gate.

[Complete source](apps/lab/src/scenes/genie/Genie.tsx).

<a id="fisheye"></a>

## Fisheye

**Implemented.** The queue remains interactive while a lens stretches its rows.

```text
Surface.Root inScene=true
├─ Surface.HTML → Queue (native fallback)
└─ Surface.Scene
   └─ Group (measured panel position)
      └─ Surface.Mesh
         ├─ Subdivided plane + LensMaterial
         └─ WarpDrive (changes the geometry)

SurfaceCanvas → pixel-aligned camera
```

The warp changes actual geometry through deformSurfaceGeometry so pointer targeting follows it.

The Root keeps a native presentation for browsers without capture.

The demo still owns lens strength, pointer focus, grid density, and pixel-to-world placement.

Checked: Maintained deformed-pointer gate.

[Complete source](apps/lab/src/scenes/fisheye/Fisheye.tsx).

<a id="slider"></a>

## Slider

**Implemented.** A lens enlarges the slider's ticks while native value changes remain meaningful.

```text
Surface.Root inScene=true
├─ Surface.HTML → slider track and ticks
└─ Surface.Scene
   └─ Group (track position)
      └─ Surface.Mesh
         ├─ Subdivided plane + slider lens material
         └─ Lens geometry/drag controller

Page → native readout and other controls
```

The slider owns drag/value policy; Munari connects the displayed geometry to the HTML.

Keep the existing deformation-based pointer mapping and native fallback.

Its magnified ticks require an explicit capture-resolution policy.

Checked: Maintained slider drag gate.

[Complete source](apps/lab/src/scenes/slider/Slider.tsx).

<a id="veil"></a>

## Veil

**Implemented.** The article stays native while a scrolling band blurs its captured appearance.

```text
capture = useElementCapture()

Page
├─ Article element ref=capture.ref
└─ Scrolling slab
   └─ SurfaceCanvas
      ├─ PixelPerfect + WakeOn
      └─ VeilBand capture=capture
         └─ Copy pass, blur passes, final quad
```

There is no Surface.Scene here: the article never hands its presentation to the canvas.

The real Veil adapter uses the element-capture hook.

The canvas stays in the scrolling layer. The band consumes useCaptureFrame(capture) and owns its blur shader.

Checked: Element-capture lifecycle and real blur-band adapter checks.

[Complete source](apps/lab/src/scenes/veil/Veil.tsx).

<a id="knobs"></a>

## Knobs

**Implemented.** One responsive HTML panel supplies pixels and locations for physical controls.

```text
SurfaceCanvas
├─ Lighting, camera, panel frame, and backdrop
└─ SceneSurface.Root
   ├─ SceneSurface.HTML → KnobsPanel
   └─ SceneSurface.Mesh → panel plane + LitMaterial
      ├─ Source and anchor measurements
      ├─ Readout windows and lights
      └─ SceneSurface.Anchor (one per named control)
         └─ Knob / toggle geometry
```

The HTML lays out the controls; named anchors place the demo's 3D hardware on that layout.

Knobs is already inside the canvas, so it uses SceneSurface rather than a page-handoff Scene.

The real adapter preserves the full hardware, material, readout, and resize implementation.

Checked: Maintained power-toggle input and 14-step resize gate.

[Complete source](apps/lab/src/scenes/knobs/Knobs.tsx).

<a id="optics"></a>

## Optics

**Implemented.** Movable lenses refract six HTML specimens and route clicks through the same optical mapping.

```text
SurfaceCanvas
├─ PixelPerfect + optical render passes
├─ SceneSurface.Root (one per specimen)
│  ├─ SceneSurface.HTML → specimen content
│  └─ SceneSurface.Mesh → plane + LitMaterial
│     └─ Custom lens-aware raycast
└─ Optical bench
   ├─ Lens bodies, collars, and frames
   └─ Rail, cradles, drag controls
```

The shared lenses affect several Surfaces, so their bodies and compositor belong at canvas scope.

The six specimen sizes and positions come from the optical sheet model.

Custom raycasts must remain paired with the refraction law; changing the material alone would not preserve clicks.

Checked: Maintained loupe pickup interaction and route setup.

[Complete source](apps/lab/src/scenes/optics/Optics.tsx).

<a id="logo"></a>

## Logo

**Implemented.** All letters switch between page and scene together, while each retains its own motion and material.

```text
Surface.Root (one word)
├─ Surface.HTML part=letter-0 → first letter
├─ Surface.HTML part=letter-1 → second letter
├─ …remaining letters
└─ Surface.Scene
   └─ Per-letter group (pose and animation)
      └─ Surface.Mesh part=matching-letter-id
         └─ Demo glyph geometry + letter material

SurfaceCanvas → shared camera and lighting
```

One Root coordinates all six parts; Munari does not generate extruded letter geometry from HTML.

The demo supplies glyph geometry, shaders, measurements, and a shared animation clock.

One Root coordinates six named letter parts. The scene implementation is logoScene.tsx.

Checked: Renderer handoff sweep plus compiled/linked shader walk through extrusion and mesh-body settings.

[Complete source](apps/lab/src/scenes/logo/Logo.tsx).

<a id="selection"></a>

## Selection

**Implemented.** The browser selects the text; a glass shader draws over the selected line rectangles.

```text
capture = useElementCapture()

Page → paragraph ref=capture.ref
Browser selection → measured line rectangles

SurfaceCanvas
├─ PixelPerfect
└─ Selection overlay mesh
   └─ BubbleMaterial
      ├─ Captured paragraph frame
      └─ Selected line rectangles
```

The paragraph stays native; the captured copy supplies clean text for magnification and refraction.

The browser keeps native selection and editing. useElementCapture supplies the paragraph texture.

The demo owns line measurements, glass optics, fading, and pointer light. Without capture, the native selection remains usable.

Checked: Native selection of 124 characters with captured glass pixels; no-flag selection with no capture mesh.

[Complete source](apps/lab/src/scenes/selection/Selection.tsx).

<a id="candidates"></a>

## Candidates (bench)

**Implemented.** One selected study uses the bench's canvas and camera.

```text
Page
├─ Selected candidate
├─ Candidate navigation
└─ Native tuning panel

SurfaceCanvas (one for the whole bench)
├─ PixelPerfect
└─ Candidate's scene objects
```

Choose one of the seven Candidate entries in this selector to inspect its own structure.

Switching candidates tears down the old study's owned resources.

Their effect clocks differ; the bench keeps its current explicit frame scheduling.

Checked: Route load, capture capability, and browser error check.

[Complete source](apps/lab/src/scenes/candidates/Candidates.tsx).

<a id="refraction"></a>

## Refraction

**Implemented.** The outgoing document determines how the incoming document appears, then the incoming document becomes native.

```text
Surface.Root → one document transition
├─ Surface.HTML part="leaving" → outgoing document
├─ Surface.HTML part="arriving" → incoming document
└─ Surface.Scene
   └─ Surface.Mesh part="leaving"
      ├─ sampledParts={["arriving"]}
      └─ RefractionMaterial → samples both parts

Landing → application reveals the chosen native document
```

One visible shader draw covers both sources; a missing source keeps the page in control.

The material reads its primary texture through useSurfaceTexture and the other through useSurfaceTextureOf(handle, part).

sampledParts makes additional source coverage explicit. Both HTML instances remain mounted; hidden page parts have explicit dimensions.

Checked: Maintained arriving-source gate; delayed-source blocking and red/blue framebuffer proof; both-direction landing and cancellation.

[Complete source](apps/lab/src/scenes/refraction/Refraction.tsx).

<a id="gallery"></a>

## Gallery

**Implemented.** The gallery transitions between two active content slots while preserving interactions with the arriving item.

```text
Surface.Root → one coordinated transition
├─ Surface.HTML part="a" → retained view A
├─ Surface.HTML part="b" → retained view B
└─ Surface.Scene
   └─ Shared stage group
      ├─ Surface.Mesh → shader samples both parts
      │  └─ sampledParts names the additional source
      └─ Surface.Mesh presentation="manual"
         └─ Incoming input proxy; no color/depth writes

Landing → reveal the chosen native slot
```

The visible mesh supplies both-source draw evidence; the invisible proxy routes incoming clicks.

Gallery keeps two source slots for five items and preserves its scrubbing, retargeting, and slot-reuse behavior.

The proxy cannot report sampledParts. The mesh that draws those pixels owns that declaration.

Checked: Maintained pointer/pixel gate: 32 of 34 comparisons passed (94%, existing floor 90%).

[Complete source](apps/lab/src/scenes/gallery/Gallery.tsx).

<a id="crystal"></a>

## Crystal

**Implemented.** A full-page HTML source is viewed through a refracting crystal material.

```text
SurfaceCanvas
├─ PixelPerfect
└─ SceneSurface.Root
   ├─ SceneSurface.HTML → Pad
   └─ SceneSurface.Mesh
      ├─ Full-page plane
      ├─ CrystalMaterial
      └─ Optical raycast

Page → native controls and tuning
```

The shader and pointer mapping must agree about which HTML location appears under the cursor.

The current source has no native page presenter; this maps to scene-only content.

The demo supplies optical state, viewport measurements, and inverse hit mapping.

Checked: Maintained optical pointer gate.

[Complete source](apps/lab/src/scenes/crystal/Crystal.tsx).

<a id="controls"></a>

## Controls

**Implemented.** The same live form gains raised controls and returns to ordinary page rendering.

```text
Surface.Root (form handoff)
├─ Surface.HTML → ControlBoard
└─ Surface.Scene
   └─ Surface.Mesh → live form on a plane
      └─ ControlsHardware
         ├─ Motion driver
         ├─ Shadow receiver
         └─ Surface.Anchor (named HTML control)
            └─ PhysicalPiece geometry/material

SurfaceCanvas → ControlsLights
```

ControlBoard supplies the real form; the mesh and named anchors connect its pixels to the hardware.

The real implementation keeps one React instance and synchronizes physical retraction with page return.

ControlsLights and ControlsHardware are demo code, not new library primitives.

Checked: Delayed preparation, one-instance field state, physical retraction, and native fallback.

[Complete source](apps/lab/src/scenes/controls/Controls.tsx).

<a id="marble-hand"></a>

## Marble Hand

**Implemented.** The native poster supplies reflections to a separately modelled hand.

```text
Page → native poster, themes, background shader
Demo builds a detached reflection mirror
└─ CaptureContent element={mirror} → capture handle

Hand scene
├─ Captured page + matching animated background
├─ Authored hand geometry + reflection material
└─ Hand shadow and outline
```

CaptureContent owns the mirror capture; the demo redraws its animated background in the reflection.

The specialized mirror is a deliberate source choice. Capturing the whole page would not reconstruct the matching background render pass.

The hand is authored geometry. The capture handle supplies the page pixels and their lifetime.

Checked: Maintained full gate: actual reflected headline, themes, controls, responsive layout, native path, and idle hand.

[Complete source](apps/lab/src/scenes/marble-hand/marbleHandPageCapture.tsx).

<a id="plume"></a>

## Plume

**Implemented.** Native text editing supplies letter images and locations for a particle effect.

```text
Page → native textarea + visible ink

CaptureContent → PlumeCopy (letter markup)
             ↓ capture handle
SurfaceCanvas
├─ PlumeCamera + PlumeFrames
└─ PlumeParticles
   ├─ Particle-grid geometry
   ├─ PlumeMaterial using the capture texture
   └─ PlumeReleaseBridge using captured anchor boxes
```

The particle source is separately authored letter markup; the textarea itself is never moved into the scene.

The real adapter uses CaptureContent and the shared capture-frame interface.

Plume owns release timing, particle geometry, shader uniforms, and reduced-motion behavior.

Checked: Maintained full gate, including captured character anchors, resize, and native fallback.

[Complete source](apps/lab/src/scenes/plume/Plume.tsx).

<a id="gravity"></a>

## Gravity

**Implemented.** A word leaves its paragraph, falls in a 3D pile, and can be restored to the paragraph.

```text
Native paragraph
└─ Surface.Root per word
   ├─ Surface.HTML as="span" layout="reflow"
   │  └─ Original word span
   └─ Surface.Scene
      └─ Word-body group → physics
         └─ Surface.Mesh → word plane

Without capture → existing canvas-text renderer
```

Inline HTML stays valid; the paragraph releases the word’s space after the scene draws it.

layout="reflow" removes the page slot only after presentation. The default preserves the slot.

The original word returns on a later click. Gravity still owns dragging, collision, and the native fallback.

Checked: Valid paragraph markup, measured reflow, original node identity, first-click return, and no-flag fallback.

[Complete source](apps/lab/src/scenes/gravity/Gravity.tsx).

<a id="lamp"></a>

## Lamp

**Existing renderer.** A movable lantern lights native text and casts shadows from a prepared headline mask.

```text
Page → native article and headline

Existing multiply canvas
└─ Light/shadow shader using headline mask

Existing normal-blend canvas
└─ Lantern model + flicker

Shared demo clock and pointer position
```

There is no HTML handoff here; Surface.Scene is not required.

Lamp deliberately uses separate blend modes for lighting and for the visible lantern.

Its mask packs several pre-blurred glyph images. Element capture could supply source ink in a future adapter, but it is not a replacement for that mask processing.

Checked: Route load, capture capability, and browser error check.

[Complete source](apps/lab/src/scenes/lamp/Lamp.tsx).

<a id="rain"></a>

## Rain

**Existing renderer.** Rain interacts with page ledges and the headline's glyph terrain.

```text
Page → native article
├─ Measured boxes → ledges
└─ Headline glyph terrain → collision field

Existing Three.js renderer
├─ Rain streaks
├─ Drops and splashes
└─ Accumulated water meshes
```

Rain primarily needs geometry measurements and a collision field, not an HTML-backed scene mesh.

The article remains native. RainField owns its renderer, physics, and shared draw loop.

Element capture might help generate an ink field later; adding a Surface handoff would not serve the current interaction.

Checked: Route load, capture capability, and browser error check.

[Complete source](apps/lab/src/scenes/rain/Rain.tsx).

<a id="wordmark"></a>

## Wordmark

**Implemented.** The official MunariLogo component uses the same coordinated letter model as Logo.

```text
Wordmark page
├─ Native tuning controls
└─ MunariLogo (reusable demo/site component)
   └─ Surface.Root (one word)
      ├─ Surface.HTML per named letter
      └─ Surface.Scene
         └─ Per-letter group + Surface.Mesh
```

Wordmark tunes the same MunariLogo component used by other hosts.

MunariLogo uses the grouped letter API and shares logoScene.tsx with the Logo demo.

The page supplies tuning and layout; it does not recreate the logo renderer.

Checked: Route load, capture capability, and browser error check.

[Complete source](apps/lab/src/scenes/wordmark/Wordmark.tsx).

<a id="candidate-ripple"></a>

## Candidate: Ripple

**Implemented.** A press sends waves through the displayed control and its shadow.

```text
Surface.Root (while waves are active)
├─ Surface.HTML → target control
└─ Surface.Scene
   └─ Surface.Mesh → subdivided plane + RippleMaterial
      ├─ RippleShadow
      └─ WaveDrive

Shared candidate SurfaceCanvas + PixelPerfect
```

The demo's WaveDrive determines when the effect is finished; the Root retains the scene through return.

RippleMaterial and RippleShadow consume the same wave state.

Keep the existing pointer mapping and scale; a shader displacement alone is not a general hit-testing solution.

Checked: Press produced scene draws and the scene released after the wave.

[Complete source](apps/lab/src/scenes/candidates/CandidateRipple.tsx).

<a id="candidate-billow"></a>

## Candidate: Billow

**Implemented.** Apply the shared press-and-wave behavior to a single button.

```text
RippleTarget (existing shared demo behavior)
└─ Surface.Root
   ├─ Surface.HTML → button
   └─ Surface.Scene
      └─ Surface.Mesh + ripple material/shadow/driver

Shared candidate SurfaceCanvas
```

Billow reuses RippleTarget; it does not need a second library API.

The button content and tuning differ, while capture and renderer ownership stay shared with Ripple.

Checked: Shared RippleTarget produced and released the button effect.

[Complete source](apps/lab/src/scenes/candidates/CandidateBillow.tsx).

<a id="candidate-unroll"></a>

## Candidate: Unroll

**Implemented.** A menu is displayed as a rolling sheet while opening, open, or closing.

```text
Page → native menu trigger

Shared SurfaceCanvas
└─ SceneSurface.Root (kept through close animation)
   ├─ SceneSurface.HTML → menu items
   └─ SceneSurface.Mesh
      ├─ Subdivided sheet + SheetMaterial
      └─ RollSheet geometry controller
```

The menu has no ordinary page presentation; keep it mounted until its close animation finishes.

The application owns the trigger position, selected action, and open/closing state.

The opaque menu sheet uses geometry pointer targeting. Without capture, the same actions appear in a native HTML menu.

Checked: Clicked projected menu item, selected Duplicate, and observed cleanup; native menu action also passed.

[Complete source](apps/lab/src/scenes/candidates/CandidateUnroll.tsx).

<a id="candidate-dissolve"></a>

## Candidate: Dissolve

**Implemented.** A card dissolves from one slot and reforms in the other.

```text
Surface.Root → one coordinated transfer
├─ Surface.HTML part="left" → left card instance
├─ Surface.HTML part="right" → right card instance
└─ Surface.Scene
   ├─ Surface.Mesh part="left" → origin/destination cloud
   ├─ Surface.Mesh part="right" → destination/origin cloud
   └─ One PhaseDrive → both clouds

Page → reveal the occupied slot after landing
```

Two stable named parts share one transition; each slot’s content instance survives both directions.

Dissolve already models two presentations of the same controlled content. Both part instances stay mounted.

For one stateful instance moving between different list parents, use the page-target form shown by Flight.

Checked: Both directions, original element identities, cleanup, and immediate native fallback.

[Complete source](apps/lab/src/scenes/candidates/CandidateDissolve.tsx).

<a id="candidate-analyze"></a>

## Candidate: Analyze

**Implemented.** The active paragraph receives a prism-like visual treatment and returns after the effect fades.

```text
Surface.Root (one analyzed block)
├─ Surface.HTML → section heading and prose
└─ Surface.Scene
   └─ Surface.Mesh
      ├─ Subdivided plane
      └─ PrismMaterial + fade completion

Page → reading/selection state
```

The active block requests the scene; fading and actual page return remain separate events.

The application decides which block is active. Its shader owns the visual treatment and fade.

Checked: All three blocks completed and the scene released.

[Complete source](apps/lab/src/scenes/candidates/CandidateAnalyze.tsx).

<a id="candidate-copy"></a>

## Candidate: Copy

**Implemented.** A clean image of the code block flies to the cursor while the original block can fade independently.

```text
Page → native code block + Copy button

SceneSurface.Root → clean copy
├─ SceneSurface.HTML → unfaded code markup
└─ SceneSurface.Mesh
   ├─ Subdivided plane + SuckMaterial
   └─ PhaseDrive → cursor-directed animation

Shared candidate SurfaceCanvas
```

The original code stays native; a separately authored clean copy supplies the flying effect.

The clipboard write remains in the user click handler. SceneSurface supplies the copied content and material context.

The copy has no HTML pointer target. Without capture, copying completes immediately and leaves the code visible.

Checked: One copy action, original block restored, animation cleanup, and no-flag copy path.

[Complete source](apps/lab/src/scenes/candidates/CandidateCopy.tsx).

<a id="candidate-delete"></a>

## Candidate: Delete

**Implemented.** A row melts, shatters, or peels before the application removes it.

```text
Surface.Root (one exiting row)
├─ Surface.HTML → retained row content
└─ Surface.Scene
   └─ Surface.Mesh
      ├─ Melt plane / shard geometry / peel grid
      ├─ Matching material
      └─ PhaseDrive or PeelDrive

Completion → application commits row removal
```

The row must remain owned until its exit is complete; it should not flash back onto the page before removal.

The application selects the variant and commits deletion. Munari supplies capture and the renderer boundary.

Scene cleanup still needs a final clearing draw; setting a deletion flag alone is not evidence that the old pixels are gone.

Checked: Melt, shatter, and peel removed rows after their exit, cleared the scene, and allowed restore; native removal also passed.

[Complete source](apps/lab/src/scenes/candidates/CandidateDelete.tsx).

## Changes that closed the gaps

Gravity uses inline hosts and explicit reflow. Explode accepts detached DOM layers. Gallery and Refraction declare all sampled source parts. Genie retains its original film publisher. Flight uses page targets to preserve identity across columns. The postcard uses a post-pose callback and a canvas in its scrolling section.

These are implemented adapters, not promises that every visual state has a pixel oracle. Each entry names its verification. [The instrument guide](instruments/api-all-demos/README.md) records the checks and their limits.
