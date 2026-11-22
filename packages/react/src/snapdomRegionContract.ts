// Region capture contract — the options and the refusal that the snapDOM engine and the input-region rasterizer share.
//
// The rasterizer catches UnsupportedRegionCaptureError to retry without a clip,
// and the engine throws it when a clipped capture's SVG has a shape the
// rasterizer cannot crop. This module sits beneath both so the engine can load
// the rasterizer on first use: a module imported both statically and
// dynamically stays in the static graph (docs/opt-in-dx-proposal.md, Step 1).

export interface CaptureRegionOptions {
  clip?: { x: number; y: number; width: number; height: number }
  invalidate?: boolean
  retainRootLayout?: boolean
  decodeFull?: (url: string, width: number, height: number) => Promise<HTMLImageElement>
}

export class UnsupportedRegionCaptureError extends Error {}
