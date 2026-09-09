# Candidates

Seven maintained interaction studies at `?scene=candidates`, selected by
`&candidate=<id>`. These are lab examples, not package API or copyable registry
entries. Selection is a separate scene at `?scene=selection` and still uses
the shared camera, measurement and uniform helpers in `candidateStage.tsx`.

| ID | Behavior | Check |
| --- | --- | --- |
| `ripple` | A button press deforms its sheet | The same press increments the native counter |
| `billow` | The Ripple effect on one isolated button | Uses Ripple's implementation and tuning |
| `unroll` | A dropdown rolls open and closed | CPU geometry keeps pointer hits aligned; cancelling preparation removes the scene |
| `dissolve` | A card dissolves and reassembles elsewhere | Its editable content and counter survive the transition |
| `analyze` | A read head moves across a glass-like code block | The effect follows the block's luminance edges |
| `copy` | A captured code block flies toward the cursor | The copy tracks the pointer; its normal follows the full deformation |
| `delete` | A row melts, shatters or peels away | The list keeps its height until deletion finishes |

## Current API and ownership

Page handoffs use `Surface.Root`, named `Surface.HTML` parts and
`Surface.Mesh` presentations. Scene-owned copies, including the Unroll menu
and Copy's flying sheet, use `SceneSurface`. `Surface.Scene` retains custom
handoff content through preparation, return and cleanup; it does not own the
enclosing canvas's lifetime. Read current presentation from
`useSurfaceStatus().presentation` and motion completion from `onMotionComplete`.

The shared canvas runs continuously because the studies have independent
animation clocks. Each study owns its intent, geometry and cleanup.
`candidateStage.tsx` supplies the pixel-calibrated camera, DOM-to-world
measurements, uniform ownership and phase helpers. Manual placement keeps
these shaders' pixel-based deformation units explicit.

For a custom final draw, `Surface.Mesh presentation="manual"` keeps a pointer
proxy while the advanced manual presenter records actual draw evidence. The
quad clouds here use ordinary meshes to support rotated particles and avoid
the driver's point-size ceiling.

## Shader and geometry rules

- Use premultiplied alpha (decision #5): scale added light by source alpha
  and fade the whole premultiplied color. Include the output color-space
  conversion required by a custom `ShaderMaterial`.
- Preserve the source's corner mask with `SURFACE_RADIUS_GLSL`,
  `uMunariRadii` and `uMunariSize`.
- R3F 9.7 copies uniform entries into the material's own container.
  `useOwnUniforms` keeps per-frame scalar writes attached to the actual material.
  See the measured failure in `candidateStage.tsx`.
- CPU-deformed geometry must update its bounds for raycasting. Unroll and
  Peel clear the bounding sphere after modifying vertices.

`candidateCurlLaw.test.ts` pins arc length, hinge continuity and nested turns.
`candidateUnrollLaw.test.ts` covers early cancellation and close/reopen timing.
`candidateShaders.test.ts` compares Copy normals with numerical derivatives
of the complete deformation. `candidateTokens.test.ts` covers the displayed
code tokenizer. Tuned values remain in `candidateTuning.ts`; tessellation
comments record the geometric scale each scene needs.

Historical measurements explain these rules; they are not a backlog of
missing public APIs. Check the published entries before copying an old workaround.
