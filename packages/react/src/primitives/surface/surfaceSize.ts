// Authored dimensions — positive finite CSS pixels, separate from an unmeasured DOM box.
// An invalid explicit size must fail before it can allocate a source or texture.
import type { SurfaceSize } from './surfaceSourceRuntime'
export function validateSurfaceSize(size: SurfaceSize): void {
  if (size.length !== 2 || !size.every(value=>Number.isFinite(value)&&value>0)) {
    throw new Error('Surface size must contain two positive, finite CSS pixel dimensions.')
  }
}
