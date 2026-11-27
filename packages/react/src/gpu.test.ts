// Pins the curated export list for `@petepetrash/munari/gpu` so new exports enter
// intentionally rather than by accident (matches `index.test.ts`).
import { describe, expect, it } from 'vitest'
import * as gpu from './gpu'

const GPU_ENTRY = [
  'Surface',
  'SurfaceCanvas',
  'createManifestDriver',
  'unlitSurfaceManifest',
  'getGpuHostStats',
  'requestGpuFrame',
  'simulateGpuDeviceLoss',
  'supportsCapture',
  'createSurfaceLight',
  'detectHtmlInCanvas',
  'paintStats',
  'pixelGridSnap',
]

describe('@petepetrash/munari/gpu', () => {
  it('exports the exact curated WebGPU runtime surface', () => {
    expect(Object.keys(gpu).sort()).toEqual([...GPU_ENTRY].sort())
  })
})
