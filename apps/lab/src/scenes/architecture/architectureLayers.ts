// Architecture layers — the six levels one piece of HTML passes through on
// its way into a scene, with the public names, files, guides and demos that
// show each one.
//
// The prose here is hand-written; everything it names is checked. The export
// map plugin calls architectureLayerProblems at build time and stops the build
// when a listed API is not exported or a listed file is missing. DemoId
// checks each demo at compile time.

import type { DemoId } from '../../components/sceneCatalog.ts'
import type { ExportMap, PublicEntry } from './architectureExportMap.ts'

export type ArchitectureLayerId = 'content' | 'capture' | 'scene' | 'materials' | 'handoff' | 'input'

export interface ArchitectureLayer {
  readonly id: ArchitectureLayerId
  readonly title: string
  readonly summary: string
  readonly detail: readonly string[]
  /** Public names, in the order a reader meets them. */
  readonly api: readonly string[]
  /** Repository-relative source files and folders. */
  readonly code: readonly string[]
  /** Repository-relative guides, each with an optional heading anchor. */
  readonly guides: readonly { readonly label: string; readonly path: string; readonly anchor?: string }[]
  readonly demos: readonly DemoId[]
  /** What leaves this layer for the next one down; null for the last layer. */
  readonly handsOn: string | null
}

export const ARCHITECTURE_LAYERS = [
  {
    id: 'content',
    title: 'Your HTML',
    summary: 'Retained content: your React tree, with its state, focus and input.',
    detail: [
      'Surface wraps an ordinary component. The component mounts once, so its state and uncontrolled inputs survive the trip into the scene and back.',
      'The page presentation owns layout, accessibility, focus and the browser’s ordinary input path. A page target moves the retained HTML between layout slots without remounting it.',
      'SceneSurface is for HTML written only for the scene. It has no page destination, and neither demo below uses it.',
    ],
    api: ['Surface', 'SceneSurface', 'createPageTarget', 'usePageTarget'],
    code: ['packages/react/src/primitives/Surface.tsx', 'packages/react/src/primitives/pageTarget.ts'],
    guides: [
      { label: 'Your first Surface', path: 'README.md', anchor: 'your-first-surface' },
      { label: 'HTML that belongs in a scene', path: 'docs/scene-surface.md' },
    ],
    demos: ['flight', 'logo'],
    handsOn: 'live element',
  },
  {
    id: 'capture',
    title: 'Capture',
    summary: 'A capture engine turns the live element into pixels, one paint generation at a time.',
    detail: [
      'HTML-in-canvas is the default engine where Chrome provides it. snapDOM runs only after the app calls enableSnapdomCapture().',
      'Each successful capture is a paint generation: a raster whose receipt records its painted size and stored size. Anchors measured with that paint stay matched to its pixels.',
      'useElementCapture and CaptureContent capture with no handoff. A native element that stays in place, or separately authored content, supplies frames to scene code.',
    ],
    api: ['useCaptureSupport', 'supportsCapture', 'enableSnapdomCapture', 'useSurfaceRefresh', 'useElementCapture', 'CaptureContent'],
    code: ['packages/react/src/primitives/surface/surfaceSourceRuntime.ts', 'packages/core/src/paint', 'packages/react/src/snapdom.ts'],
    guides: [
      { label: 'Capture engines', path: 'docs/capture-engines.md' },
      { label: 'Element capture', path: 'docs/element-capture.md' },
    ],
    demos: ['selection', 'marble-hand'],
    handsOn: 'paint generation',
  },
  {
    id: 'scene',
    title: 'Scene host',
    summary: 'SurfaceCanvas: the shared R3F renderer, camera and scene that Surfaces draw into.',
    detail: [
      'SurfaceCanvas renders with Three’s WebGPURenderer and falls back to WebGL 2. Neither accepts GLSL, so materials are TSL node materials.',
      'Each paint generation is uploaded as a texture on this canvas’s renderer. A mesh presenter stands where the HTML stood and supplies the evidence for each draw.',
      'Several Surfaces can share one canvas, matched by its id, while their HTML stays in different parts of the page.',
    ],
    api: ['SurfaceCanvas', 'useSurfaceBeforeRender'],
    code: [
      'packages/react/src/primitives/surface/SurfaceCanvas.tsx',
      'packages/react/src/primitives/surface/surfaceHostRegistry.ts',
      'packages/react/src/primitives/surface/SurfaceMesh.tsx',
    ],
    guides: [
      { label: 'Custom scene content', path: 'docs/scene-content.md' },
      { label: 'Page layouts and canvases', path: 'docs/page-layouts-and-canvases.md' },
    ],
    demos: ['postcard', 'review-notes'],
    handsOn: 'texture on a mesh',
  },
  {
    id: 'materials',
    title: 'Materials and shaders',
    summary: 'A TSL node material shades the captured texture while the mesh draws.',
    detail: [
      'Inside Surface.Mesh, useSurfaceNodes gives a material the live capture, already premultiplied, with the corner mask and source size.',
      'deformSurfaceGeometry moves the vertices, so the raycast hits the shape the eye sees and relayed input stays correct on any bend.',
      'Surface anchors give the source-UV box of a named element, measured with the paint the mesh draws, so scene objects can be placed on it.',
    ],
    api: ['useSurfaceNodes', 'useSurfaceTexture', 'useSurfaceTextureOf', 'surfaceRadiusMask', 'premultipliedOutput', 'deformSurfaceGeometry', 'useSurfaceAnchorRects'],
    code: [
      'packages/react/src/primitives/surface/surfaceMaterials.tsx',
      'packages/react/src/primitives/surface/surfaceDeform.ts',
      'packages/react/src/lib/surfaceRadius.ts',
    ],
    guides: [{ label: 'Materials on a SurfaceCanvas', path: 'docs/scene-content.md', anchor: 'materials-on-a-surfacecanvas' }],
    demos: ['tear-planner', 'genie'],
    handsOn: 'draw and its presentation receipt',
  },
  {
    id: 'handoff',
    title: 'Surface and handoff',
    summary: 'One identity for the content, and the renderer hold that moves between page and scene.',
    detail: [
      'Setting inScene requests a destination. The page keeps the renderer hold until the scene draw earns a presentation receipt, so the content never disappears between renderers.',
      'Progress is the motion between page and scene, from 0 to 1. A driver moves it by hand, for a drag or a gesture.',
      'useSurfaceStatus reports what was requested, which presentation holds the content and whether the scene is ready.',
      'Focus moves with the hold. SURFACE_FOCUS_ATTRIBUTE names an element so focus finds the same element in the other copy.',
    ],
    api: ['createSurface', 'useSurfaceHandle', 'useSurfaceStatus', 'useSurfaceProgress', 'useSurfaceDriver', 'useSurfaceMotion', 'SURFACE_FOCUS_ATTRIBUTE'],
    code: ['packages/react/src/primitives/surface/surfaceHandle.ts', 'packages/core/src/transfer'],
    guides: [{ label: 'Observe and animate a Surface', path: 'docs/observing-a-surface.md' }],
    demos: ['genie', 'flight'],
    handsOn: 'pixels on screen',
  },
  {
    id: 'input',
    title: 'Input routing',
    summary: 'Pointer and keyboard input on the drawn pixels goes back to the real element.',
    detail: [
      'SurfaceCanvas takes the pointer over the whole canvas by default (pointerMode="scene"). pointerMode="surfaces" takes it only over Surfaces, so the page around them stays directly clickable.',
      'By default, a pointer on a drawn Surface is raycast against the presented shape and relayed to the DOM element under that point. With pointerRoute="auto", a flat Surface gets the browser’s own pointer events. Typing and focus stay native.',
      'A visible scene mesh nearer the camera than a Surface takes the pointer where it covers it, unless that mesh has a no-op raycast.',
    ],
    api: ['SurfacePointerEvents', 'PointerRouteRequest', 'relay'],
    code: ['packages/core/src/pointer', 'packages/react/src/primitives/surface/surfaceNativeRoute.ts'],
    guides: [{ label: 'Meshes in front of a Surface', path: 'docs/page-layouts-and-canvases.md', anchor: 'meshes-in-front-of-a-surface' }],
    demos: ['knobs', 'review-notes'],
    handsOn: null,
  },
] as const satisfies readonly ArchitectureLayer[]

/** Every public entry that exports `name`. */
export function entriesExporting(map: ExportMap, name: string): readonly PublicEntry[] {
  return map.entries.filter((entry) => entry.exports.some((declaration) => declaration.name === name))
}

/** Each name or file a layer lists that the source does not have. */
export function architectureLayerProblems(
  layers: readonly ArchitectureLayer[],
  map: ExportMap,
  pathExists: (repositoryPath: string) => boolean,
): string[] {
  const problems: string[] = []
  for (const layer of layers) {
    for (const name of layer.api) {
      if (entriesExporting(map, name).length === 0) problems.push(`${layer.id}: no public entry exports ${name}`)
    }
    for (const file of [...layer.code, ...layer.guides.map((guide) => guide.path)]) {
      if (!pathExists(file)) problems.push(`${layer.id}: ${file} does not exist`)
    }
  }
  return problems
}
