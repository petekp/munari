# Classical marble hand

Munari contributors made `classical-hand.stl` from
[The Creation of Adam](https://sketchfab.com/3d-models/the-creation-of-adam-4d1727c7b83e4e6284bbadb63dbb537e)
by [Loïc Norgeot](https://sketchfab.com/norgeotloic), published on 2019-10-11.
Loïc used a human-hand scan and posed the model after Michelangelo's fresco.
Munari adds the marble material, light, and cursor motion at runtime.

## License and credits

The source model and this derived STL use
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
Retain these credits, the license link, and a record of later changes when
you redistribute the asset.

- Loïc Norgeot, [The Creation of Adam](https://sketchfab.com/3d-models/the-creation-of-adam-4d1727c7b83e4e6284bbadb63dbb537e):
  retopology and pose.
- Artec 3D, [Hand](https://www.artec3d.com/3d-models/hand): source scan,
  licensed under CC BY 4.0.
- Jeremy E. Grayson,
  [Low Poly Human Hands (All Quads)](https://sketchfab.com/3d-models/low-poly-human-hands-all-quads-027173f5759f473b9dfeee724ea0f7f6):
  base mesh for the retopology, licensed under CC BY 4.0.

The [Zenodo record](https://zenodo.org/records/10388139) preserves the source
GLB from Objaverse 1.0 / Sketchfab and records its CC BY 4.0 license.

- [Source GLB download](https://zenodo.org/api/records/10388139/files/4d1727c7b83e4e6284bbadb63dbb537e.glb/content)
- Source size: 1,413,128 bytes
- Source SHA-256: `3fbdc6de2d8723213c7412bab6e36139f61714ef34e58b4b68da4e906de0676d`

## Munari changes, 2026-08-30

The build tool selects the right-side `Other hand_1` group, which Three's
loader names `Other_hand_1`. It keeps both the skin and nail meshes, bakes
their world transforms, and removes the other hand, textures, and materials.

The tool scales the source's longest extent to 250 model units, moves a
real index-tip vertex to `[0, 0, 0]`, and turns the index toward local `+X`.
It removes 35 units from the wrist end at `x = -215`, clips the intersecting
triangles, and closes the 66-vertex cut contour with 64 outward-facing faces.
The binary STL contains 6,004 triangles. These units set the scene scale;
they do not claim a physical measurement of the source hand.

## Rebuild

Run from the repository root with the workspace dependencies installed:

```sh
marble_source_dir=$(mktemp -d)
curl --fail --location \
  'https://zenodo.org/api/records/10388139/files/4d1727c7b83e4e6284bbadb63dbb537e.glb/content' \
  --output "$marble_source_dir/creation-of-adam.glb"
node apps/lab/tools/make-marble-hand.mjs "$marble_source_dir/creation-of-adam.glb"
npm test -- apps/lab/src/scenes/marble-hand/marbleHandGeometry.test.ts
```

`apps/lab/tools/make-marble-hand.mjs` writes `classical-hand.stl` in this
folder. The focused tests read that file and check the tip, wrist cap, and
closed mesh seams. They also check the scene's tuned clearance, wrist
direction, and projected fingertip position.
