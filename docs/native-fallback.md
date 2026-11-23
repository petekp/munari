# When enhanced rendering is unavailable

A `Surface` keeps its HTML native and preserves author intent. No scene-only
completion callback can finish a gesture that never entered the scene, so branch
inside actions with `supportsSurfaces()` and commit their ordinary HTML outcome.
Scene-only visuals need their own fallback. Keep the content-root sizing, paint,
mask, and hover rules in [authoring](https://github.com/petekp/munari/blob/v0.4.1/docs/authoring.md).
