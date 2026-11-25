# Payload budget

`npm run gate:payload` measures what each public import costs a consumer, in
gzip bytes. Run `npm run build` first: it measures `packages/react/dist`, the
package that is published. Six small apps in `instruments/payload/entries/`
import it through the published specifiers and Vite builds each in production
mode. The size is the entry chunk plus every chunk it imports statically. A
chunk reached only through a dynamic `import()` is listed as deferred and not
counted, which is how `/snapdom` shows that it leaves the input-region
rasterizer out until `isolatedTextInputs` content is captured.

`lazyCanvas` renders a `Surface` and loads `SurfaceCanvas` through
`React.lazy`, from `entries/deferred/`. Its size is the first page of an app
that mounts the canvas later, so it fails when page-side Surface code imports
three's renderer, TSL or R3F again. Before Surface's scene components moved
behind `surfaceSceneLookup.tsx`, that first page measured 529.0 kB of the
531.6 kB the `surface` entry ships. With the split, it measures 189.5 kB. A static import of `SurfacePrewarm` in
`Surface.tsx` measures 519.5 kB; that fault was run on 2026-11-25 and the check
failed on `lazyCanvas`.

Each entry passes while it stays at or under its recorded size plus its margin
in `budgets.json`. A failure names the entry. The margins are 1 kB for the two
small entries (`advancedKernel`, `snapdomDefault`) and 2 kB for the others.
They absorb a dependency patch release and are far below what a change of
imports costs: a kernel entry that also imports `Surface` measures 224 kB, and
an eager rasterizer import adds 7.4 kB to `snapdomDefault`. Both faults were
run on 2026-11-22 and the check failed on the named entry each time.

The sizes are gzip over the tsdown output staged by `stage-manifest.mjs`, with
Vite 8.2.0, `three` 0.186.1, `@react-three/fiber` 9.8.1 and snapDOM 3.8.2 from
the lockfile. After a dependency upgrade or an intended change of imports,
re-measure and update `budgets.json` in the same commit. The check has no
browser, so it says nothing about whether a page behaves. CI runs it as the
`payload-budget` job after `checks`.
