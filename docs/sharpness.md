# Sharpness by default

The canvas uses the display's native pixel ratio, and capture density follows the
rendered size on each axis. Stationary, flat HTML meshes align their rendered pixels
to the display grid. Their animation state and DOM layout remain unchanged. Moving
or warped content keeps its continuous pose. Explicit `dpr` or `resolution` limits
remain available when you choose a rendering budget; large textures still obey the
4096-pixel edge limit.
