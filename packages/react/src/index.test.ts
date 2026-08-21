// The two entry lists, pinned.
//
// The root is CURATED and `./advanced` is the deliberate second doorway
// (decisions.md #6, amended 2026-08-17). Neither of those is checkable by
// reading a module: a name reaches the root by someone adding a line, and
// the cost of the wrong line — a scene recipe published as library API, or
// an escape hatch a newcomer finds first — is paid by consumers who then
// depend on it. So the lists are written down, and adding a name is a
// deliberate edit here rather than a side effect of an export.
//
// Type-only exports are invisible at runtime and are not pinned here;
// `tests/surfaceTypes.tsx` is where the type surface is checked.
import { describe, expect, it } from 'vitest'
import * as core from '@munari/core'
import * as root from './index'
import * as advanced from './advanced'

const ROOT_ENTRY = [
  'Dial',
  'FocusGroup',
  'FocusScene',
  'SURFACE_ANCHOR_ATTRIBUTE',
  'SURFACE_FOCUS_ATTRIBUTE',
  'SURFACE_RADIUS_GLSL',
  'Surface',
  'SurfaceCanvas',
  'createSurface',
  'deformSurfaceGeometry',
  'detectHtmlInCanvas',
  'surfaceFocusKey',
  'surfaceFocusTarget',
  'useFocusNavPolicy',
  'useFocusReframe',
  'useFocusScene',
  'useFocusSceneEvents',
  'useSurface',
  'useSurfaceAnchorBox',
  'useSurfaceAnchorRects',
  'useSurfaceChrome',
  'useSurfaceDriver',
  'useSurfaceInstance',
  'useSurfacePaintedSize',
  'useSurfaceProgress',
  'useSurfaceSourceRoot',
  'useSurfaceState',
  'useSurfaceTexture',
]

// The kernel is re-exported WHOLE, so this list is core's own surface plus
// the React names the advanced entry adds.
const ADVANCED_ADDITIONS = [
  'FrameSurface',
  'useCarriedMotion',
  'useFrameTexture',
  'surfaceManualPresenter',
]

describe('the published entries', () => {
  it('the root is exactly the curated list', () => {
    expect(Object.keys(root).sort()).toEqual([...ROOT_ENTRY].sort())
  })

  it('the root publishes no scene recipe', () => {
    // Copyable behaviors live in `registry/`, welded to the lab reference.
    // A published component makes one scene's tuning the library's answer.
    expect(root).not.toHaveProperty('FocusOrbitRig')
    expect(root).not.toHaveProperty('arcLayout')
  })

  it('the root keeps the store and the escape hatches out of reach', () => {
    for (const name of [
      'createSurfaceStore',
      'surfaceStoreOf',
      'useSurfaceStore',
      'useSurfaceControls',
      'surfaceManualPresenter',
      'FrameSurface',
      'useCarriedMotion',
    ]) {
      expect(root).not.toHaveProperty(name)
    }
  })

  it('advanced adds exactly the escape hatches on top of the kernel', () => {
    const kernel = new Set(Object.keys(core))
    const added = Object.keys(advanced).filter((name) => !kernel.has(name))
    expect(added.sort()).toEqual([...ADVANCED_ADDITIONS].sort())
  })

  it('advanced carries no store verb', () => {
    for (const name of ['createSurfaceStore', 'surfaceStoreOf', 'useSurfaceStore']) {
      expect(advanced).not.toHaveProperty(name)
    }
  })
})
