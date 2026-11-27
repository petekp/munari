// Why Munari data — structured copy, paradigm comparison, capability cards, and walkthrough entries.
//
// The law: every metric and capability on the visual walkthrough page matches
// `docs/why-munari.md` and `docs/platform.md`, so the site page and repository
// guide never contradict each other.
//
// Ownership: this module holds static copy and types; `whySnippets.ts` holds
// copyable JSX blocks; `Why.tsx`, `whyDiagrams.tsx`, and `whyStage.tsx` render them.

import type { DemoId } from '../../components/sceneCatalog'
import {
  ANCHOR_TSL_SNIPPET,
  CURVED_INPUT_SNIPPET,
  ELEMENT_CAPTURE_SNIPPET,
  HANDOFF_SNIPPET,
  INSTALL_SNIPPET,
  SNAPDOM_SNIPPET,
  SPATIAL_BOARD_SNIPPET,
} from './whySnippets'

export { INSTALL_SNIPPET }

export type DiagramKind = 'handoff' | 'curve' | 'anchor' | 'resize' | 'capture' | 'engines'

export interface RelatedSceneLink {
  readonly id: string
  readonly label: string
}

export interface PromotedDemoLink {
  readonly id: DemoId
  readonly label: string
}

export interface ParadigmCard {
  readonly tag: string
  readonly title: string
  readonly verdict: string
  readonly detail: string
}

export interface LifecycleMode {
  readonly badge: string
  readonly title: string
  readonly detail: string
}

export interface UnlockItem {
  readonly wall: string
  readonly title: string
  readonly detail: string
  readonly demos: readonly PromotedDemoLink[]
}

export interface DecisionCard {
  readonly tag: string
  readonly title: string
  readonly verdict: string
  readonly detail: string
}

export interface WhySectionItem {
  readonly id: string
  readonly number: string
  readonly navLabel: string
  readonly title: string
  readonly summary: string
  readonly breaksTitle: string
  readonly breaksPoints: readonly string[]
  readonly munariTitle: string
  readonly munariPoints: readonly string[]
  readonly diagram: DiagramKind
  readonly demoId: DemoId
  readonly demoTitle: string
  readonly demoThumb: string
  readonly demoInstruction: string
  readonly relatedScenes: readonly RelatedSceneLink[]
  readonly code: string
}

export interface TradeoffItem {
  readonly title: string
  readonly detail: string
}

export interface ComparisonRow {
  readonly requirement: string
  readonly cssAndDrei: string
  readonly diyCanvas: string
  readonly munari: string
}

export const PARADIGM_CARDS: readonly ParadigmCard[] = [
  {
    tag: '0% idle GPU',
    title: 'Standard HTML & CSS',
    verdict: 'Crisp document, isolated flat boxes',
    detail:
      'Native text shaping, selection, forms, autofill, Cmd+F, and screen readers. Every element paints as an isolated flat plane with its own fixed shadow, uniform Gaussian backdrop blur, and no shared light or pixel shaders.',
  },
  {
    tag: 'Continuous 60 fps',
    title: 'Full-Canvas WebGL',
    verdict: 'Shared shaders, lost browser',
    detail:
      'Scene-wide lighting, refraction, and curved geometry, paid for by rebuilding text layout, giving up native inputs, text selection, password managers, and screen readers, and running a full-viewport render loop.',
  },
  {
    tag: '0 fps at rest',
    title: 'Selective DOM promotion (Munari)',
    verdict: 'Keep the HTML page, shade what needs it',
    detail:
      'Your document stays ordinary HTML. Specific React components enter WebGPU shaders and shared 3D space, either for a 400 ms gesture or as a persistent lit surface, while keeping live inputs, selection, and 0 fps idle.',
  },
]

export const LIFECYCLE_MODES: readonly LifecycleMode[] = [
  {
    badge: '0 GPU textures at rest',
    title: 'Transient promotion for gestures and transitions',
    detail:
      'Set inScene={active} only while dragging, minimizing, or folding. At rest, the component is plain HTML with zero VRAM cost; on interaction, Munari swaps on the verified GPU frame and hands back when settled.',
  },
  {
    badge: '0 fps when still',
    title: 'Demand-driven surfaces for persistent lighting and optics',
    detail:
      'Pair frameloop="demand" with pointerMode="surfaces". Promoted elements draw one frame when light, state, or springs move, leave surrounding HTML directly clickable, and sleep at 0 fps (<1% CPU) once motion ends.',
  },
]

export const UNLOCK_ITEMS: readonly UnlockItem[] = [
  {
    wall: 'Shared spatial field',
    title: 'One scene light and real cast shadows across separate components',
    detail:
      'CSS box-shadow hardcodes a local offset per element. Munari places separate DOM components under one light source so headings, forms, and raised selections cast coherent penumbras across the page.',
    demos: [
      { id: 'light', label: 'Light' },
      { id: 'postcard', label: 'Postcard' },
    ],
  },
  {
    wall: 'Optical transport & substrates',
    title: 'True refraction and physical materials over selectable text',
    detail:
      'CSS stops at flat fills and uniform Gaussian backdrop-filter. Custom TSL materials shade live HTML with variable-thickness Snell refraction, dispersion, cotton paper grain, or machined hardware.',
    demos: [
      { id: 'selection', label: 'Selection' },
      { id: 'postcard', label: 'Postcard' },
      { id: 'knobs', label: 'Knobs' },
    ],
  },
  {
    wall: 'Non-affine geometry',
    title: 'Bent, elastic, and particle-dissolved UI that still takes input',
    detail:
      'CSS matrix3d projects only rigid flat planes. Munari bends windows into docks, crumples dragged cards, and dissolves typed words into particles while clicks, typing, hover, and scroll still hit the real controls.',
    demos: [
      { id: 'genie', label: 'Genie' },
      { id: 'flight', label: 'Flight' },
      { id: 'plume', label: 'Plume' },
    ],
  },
  {
    wall: 'DOM-driven shaders',
    title: 'Shaders and 3D hardware locked to responsive DOM layout',
    detail:
      'Captured surfaces expose premultiplied color, alpha silhouettes, and frame-matched Surface.Anchor boxes. 3D dials, resize handles, and page-reflecting cursors track responsive DOM with zero 1-frame lag.',
    demos: [
      { id: 'knobs', label: 'Knobs' },
      { id: 'marble-hand', label: 'Marble hand' },
    ],
  },
  {
    wall: '2D to 3D depth',
    title: 'Two-way flow between document layout and depth-buffered 3D',
    detail:
      'No walled canvas box. Components sit in normal page flow, lift into a shared depth buffer where 3D objects pass in front of and behind them, and return to plain HTML with React state and focus intact.',
    demos: [
      { id: 'logo', label: 'Logo' },
      { id: 'flight', label: 'Flight' },
    ],
  },
]

export const DECISION_CARDS: readonly DecisionCard[] = [
  {
    tag: '0 kB capture',
    title: 'CSS perspective() or Drei <Html>',
    verdict: 'Use when planes stay flat',
    detail:
      'Vector text in every browser with native menus and zero GPU capture. Choose this when UI stays on rigid flat quads and needs no pixel shaders, refraction, or 3D depth intersections.',
  },
  {
    tag: '~50 lines · Chrome 157+',
    title: 'Raw HTML-in-canvas',
    verdict: 'Use for a single-browser flat demo',
    detail:
      'One element parked inside <canvas content="drawable"> on a flat quad. Chrome handles focus, typing, and tilted hit-testing, while shadows clip at the border box.',
  },
  {
    tag: '@petepetrash/munari',
    title: 'Munari',
    verdict: 'Use for native-grade UI on real DOM',
    detail:
      'Components start in normal page flow, gain shared lighting, refraction, or curved motion with zero blank frames, keep input accurate on warped meshes, sleep at 0 fps, and run across Chrome, Safari, and Firefox.',
  },
]

export const WHY_SECTIONS: readonly WhySectionItem[] = [
  {
    id: 'handoff',
    number: '01',
    navLabel: 'Zero-flash handoff',
    title: 'Normal page HTML at rest, zero-flash handoff into lit 3D',
    summary:
      'Keep components in ordinary document flow with unclipped CSS shadows until 3D runs, then hand the live DOM node to Three.js on the exact frame its pixels draw.',
    breaksTitle: 'What breaks from scratch',
    breaksPoints: [
      'drawElementImage only accepts direct children of <canvas>, clipping box-shadow at the border box and running WebGPU at rest.',
      'Hiding the DOM on a React state toggle drops the element before WebGPU finishes async shader compilation and texture upload.',
      'Moving nodes with appendChild blurs focused inputs, clears text selection, and resets scrollTop to 0.',
    ],
    munariTitle: 'What Munari does',
    munariPoints: [
      'Compiles the shader and verifies a color-writing GPU screen draw before hiding the page slot in that same frame.',
      'Relocates the single mounted React subtree via Element.moveBefore, preserving focus, selection range, and scroll offsets.',
      'Restores focus, selection direction, and scroll around insertBefore on Safari where moveBefore is absent.',
    ],
    diagram: 'handoff',
    demoId: 'postcard',
    demoTitle: 'Postcard',
    demoThumb: '/thumbs/postcard.jpg',
    demoInstruction: 'Type in the form, select text, then lift the postcard into lit 3D paper and return it.',
    relatedScenes: [
      { id: 'flight', label: 'Flight' },
      { id: 'genie', label: 'Genie' },
      { id: 'glass', label: 'Glass compositor' },
    ],
    code: HANDOFF_SNIPPET,
  },
  {
    id: 'input',
    number: '02',
    navLabel: 'Curved mesh input',
    title: 'Input that works on curved meshes and transparent overlays',
    summary:
      'Chrome hit-tests flat canvas transforms natively, yet misses as soon as vertices bend. Munari switches between native browser hit-testing and 3D UV pointer relay automatically.',
    breaksTitle: 'What breaks from scratch',
    breaksPoints: [
      'Native canvas hit-testing only maps a flat 4x4 matrix; a vertex-shader warp leaves CPU hit boxes flat, missing clicks by 60–100+ px.',
      'A full-viewport <canvas> overlay swallows clicks and wheel scroll meant for ordinary HTML controls underneath.',
    ],
    munariTitle: 'What Munari does',
    munariPoints: [
      'pointerMode="surfaces" keeps the overlay canvas transparent to pointers everywhere no Surface mesh stands.',
      'pointerRoute="auto" uses native browser matrix3d hit-testing (isTrusted: true) while flat and switches to UV relay when bent.',
      'deformSurfaceGeometry moves CPU vertices in DOM pixel space, mirrors [data-hover] / [data-active], and chains WheelEvent scroll.',
    ],
    diagram: 'curve',
    demoId: 'genie',
    demoTitle: 'Genie',
    demoThumb: '/thumbs/genie.jpg',
    demoInstruction: 'Drag or minimize the window so it bends into the dock, or reverse mid-flight while fields stay live.',
    relatedScenes: [
      { id: 'fisheye', label: 'Fisheye list' },
      { id: 'slider', label: 'Magnified slider' },
      { id: 'optics', label: 'Optics' },
    ],
    code: CURVED_INPUT_SNIPPET,
  },
  {
    id: 'anchors',
    number: '03',
    navLabel: '3D anchors & TSL',
    title: '3D geometry locked to CSS layout and color-accurate TSL shaders',
    summary:
      'Attach 3D bezels, dials, and shadows to responsive DOM children without 1-frame layout lag, and shade premultiplied HTML textures without dark alpha halos.',
    breaksTitle: 'What breaks from scratch',
    breaksPoints: [
      'getBoundingClientRect() updates on layout while captured pixels upload a frame later, making 3D bezels jump ahead during resizes.',
      'Stock Three.js materials double-multiply premultiplied sRGB alpha (darkening glyph edges) and shift UI colors via tone mapping.',
    ],
    munariTitle: 'What Munari does',
    munariPoints: [
      'data-munari-anchor and <Surface.Anchor> lock 3D children to the exact texture frame currently uploaded on the mesh.',
      'SurfaceCanvas disables renderer tone mapping on UI pixels so CSS colors match 0/255.',
      'useSurfaceNodes() and premultipliedOutput() compose custom TSL node shaders without dark translucent fringes.',
    ],
    diagram: 'anchor',
    demoId: 'knobs',
    demoTitle: 'Knobs',
    demoThumb: '/thumbs/knobs.jpg',
    demoInstruction: 'Turn a physical dial, toggle power, and drag the lower-right corner to resize the responsive HTML panel.',
    relatedScenes: [
      { id: 'controls', label: 'Controls bench' },
      { id: 'crystal', label: 'Crystal TSL' },
    ],
    code: ANCHOR_TSL_SNIPPET,
  },
  {
    id: 'sharpness',
    number: '04',
    navLabel: 'Zoom sharpness & 0 fps',
    title: 'Depth-occluded scene UI, zoom sharpness, and 0 fps idle',
    summary:
      'Put interactive HTML inside the 3D depth buffer so meshes and lights interact with it, step texture density up on camera approach without blanking, and sleep at rest.',
    breaksTitle: 'What breaks from scratch',
    breaksPoints: [
      'Setting canvas.width zeroes the buffer synchronously while Chrome repaints after the frame: 38 of 40 resize frames upload blank.',
      'Sharing one capture canvas pins all panels to one resolution, blurring text when the camera approaches.',
      'Continuous requestAnimationFrame loops burn GPU and battery when nothing on screen is moving.',
    ],
    munariTitle: 'What Munari does',
    munariPoints: [
      'Carries existing pixels across intermediate resize and LOD steps so textures never blank, then settles to an exact 1:1 raster.',
      'Snaps upright stationary panels to the device pixel grid so 1 px borders match adjacent DOM.',
      'frameloop="demand" drops to 0 frames/s and 0 paints/s the moment transitions and captures settle.',
    ],
    diagram: 'resize',
    demoId: 'logo',
    demoTitle: 'Logo',
    demoThumb: '/thumbs/logo.jpg',
    demoInstruction: 'Switch letters between HTML and 3D, then change shape and motion while observing crisp edges at rest.',
    relatedScenes: [
      { id: 'workspace', label: '3D Workspace' },
      { id: 'candidates', label: 'Candidate studies' },
    ],
    code: SPATIAL_BOARD_SNIPPET,
  },
  {
    id: 'capture',
    number: '05',
    navLabel: 'Live page lenses',
    title: 'Non-destructive page capture for lenses and reflections',
    summary:
      'Leave an article untouched in document flow for native scrolling and text selection while a 3D glass lens, progressive blur, or reflection samples its live pixels.',
    breaksTitle: 'What breaks from scratch',
    breaksPoints: [
      'Manual DOM cloning drops form values, ::before and ::after pseudo-elements, and scroll offsets.',
      'Pushing captured frames through React state triggers full component re-renders on every paint.',
    ],
    munariTitle: 'What Munari does',
    munariPoints: [
      'useElementCapture() mirrors computed styles, pseudo-elements, form state, and scroll positions from an in-place element.',
      'useCaptureFrame(capture).get() hands the latest GPU texture directly to useFrame with zero React re-renders.',
    ],
    diagram: 'capture',
    demoId: 'selection',
    demoTitle: 'Selection',
    demoThumb: '/thumbs/selection.jpg',
    demoInstruction: 'Drag across words on the page to select them and watch liquid glass refract and shadow the live text.',
    relatedScenes: [
      { id: 'light', label: 'Light lamp' },
      { id: 'marble-hand', label: 'Marble hand' },
      { id: 'veil', label: 'Progressive blur veil' },
    ],
    code: ELEMENT_CAPTURE_SNIPPET,
  },
  {
    id: 'browsers',
    number: '06',
    navLabel: 'Cross-browser & limits',
    title: 'One component across Chrome 157+, Safari, Firefox, and iOS',
    summary:
      'Keep zero-copy HTML-in-canvas in Chrome 157+ and fall back to snapDOM or native HTML everywhere else, with honest trade-offs up front.',
    breaksTitle: 'What breaks from scratch',
    breaksPoints: [
      'HTML-in-canvas does not exist in Safari, Firefox, or any iOS browser.',
      'Raw SVG-to-canvas exporters soften borders in WebKit, stall 137 ms per capture re-encoding fonts, and drop input ::placeholder styles.',
    ],
    munariTitle: 'What Munari does',
    munariPoints: [
      'enableSnapdomCapture() keeps native HTML-in-canvas in Chrome 157+ and runs snapDOM elsewhere (14 ms cached WebKit font pass).',
      'Omitting snapDOM leaves <Surface> content native and interactive on the page and reports the reason on useSurfaceStatus().',
    ],
    diagram: 'engines',
    demoId: 'flight',
    demoTitle: 'Flight',
    demoThumb: '/thumbs/flight.jpg',
    demoInstruction: 'Drag a card between columns, then switch the stage engine between Auto and Force snapDOM to compare.',
    relatedScenes: [
      { id: 'plume', label: 'Plume' },
      { id: 'distortion-wave', label: 'Distortion wave' },
    ],
    code: SNAPDOM_SNIPPET,
  },
]

export const TRADEOFFS: readonly TradeoffItem[] = [
  {
    title: 'Bundle weight (~550–640 kB gzip)',
    detail:
      'Most of the bundle is three/webgpu. Lazy-load routes that mount SurfaceCanvas with React.lazy() so initial page loads stay small.',
  },
  {
    title: 'TSL node materials only',
    detail:
      'WebGPURenderer and its WebGL 2 fallback reject GLSL ShaderMaterial, onBeforeCompile, and GLSL-based Drei helpers like Text. Write custom shaders with three/tsl.',
  },
  {
    title: 'Captured CSS rules',
    detail:
      'Pair :hover and :active selectors with [data-hover] and [data-active] for bent or non-Chrome surfaces. Avoid CSS mask-image inside captured subtrees, and keep <iframe>, <video>, and Shadow DOM outside Surface.',
  },
  {
    title: 'snapDOM vs. Chrome 157+ ceiling',
    detail:
      'Chrome 157+ updates in ~12 ms with live carets and fractional borders. On Safari and Firefox, snapDOM takes ~37 ms on quiet input, paces live animations to ~4 fps, omits the blinking caret in 3D, and restarts CSS animations on Safari handoff.',
  },
]

export const COMPARISON_ROWS: readonly ComparisonRow[] = [
  {
    requirement: 'Flat tilted cards with vector text',
    cssAndDrei: 'Native in all browsers (0 kB)',
    diyCanvas: 'Unnecessary overhead',
    munari: 'Prefer CSS 3D unless lighting or shaders apply',
  },
  {
    requirement: 'Shared scene lighting, refraction, or bent meshes on live UI',
    cssAndDrei: 'Cannot deform or shade DOM pixels',
    diyCanvas: 'Custom WebGPU + custom hit-test math',
    munari: 'Built in (finish on Surface.Root, useSurfaceNodes, deformSurfaceGeometry)',
  },
  {
    requirement: 'Start in normal page flow, enter 3D without blank flashes',
    cssAndDrei: 'Native (CSS 3D) / scene-only (<Html>)',
    diyCanvas: 'Flashes blank during async shader compile',
    munari: 'Frame-verified handoff + moveBefore state retention',
  },
  {
    requirement: 'Accurate clicks and scroll on curved geometry',
    cssAndDrei: 'Flat planes only',
    diyCanvas: 'Hit box stays flat; clicks miss displaced pixels',
    munari: 'Automatic switch between native matrix3d and UV relay',
  },
  {
    requirement: '3D meshes synced to responsive DOM children',
    cssAndDrei: 'Manual ResizeObserver',
    diyCanvas: 'getBoundingClientRect leads texture by 1–2 frames',
    munari: 'Frame-matched Surface.Anchor and useSurfaceAnchorBox()',
  },
  {
    requirement: 'Dynamic resize, zoom sharpness, and idle GPU cost',
    cssAndDrei: 'Browser compositor',
    diyCanvas: 'canvas.width clears 38/40 frames; continuous rAF',
    munari: 'Retained density band, pixel-grid snap, 0 fps demand sleep',
  },
  {
    requirement: 'Safari, Firefox, and iOS',
    cssAndDrei: 'Native',
    diyCanvas: 'Unsupported by drawElementImage',
    munari: 'enableSnapdomCapture() fallback or native-DOM degradation',
  },
]
