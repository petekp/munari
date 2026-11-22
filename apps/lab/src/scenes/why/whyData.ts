// Why Munari data — structured copy, compiled JSX snippets, demo links, and comparison matrix.
//
// The law: every code sample and metric on the visual walkthrough page matches
// `docs/why-munari.md` and `docs/platform.md`, so the site page and repository
// guide never contradict each other.
//
// Ownership: this module holds static content and types; `Why.tsx`,
// `whyDiagrams.tsx`, and `whyStage.tsx` own rendering and interaction.

export type DiagramKind = 'handoff' | 'curve' | 'anchor' | 'resize' | 'capture' | 'engines'

export interface RelatedSceneLink {
  readonly id: string
  readonly label: string
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
  readonly demoId: string
  readonly demoTitle: string
  readonly demoThumb: string
  readonly demoInstruction: string
  readonly relatedScenes: readonly RelatedSceneLink[]
  readonly code: string
}

export interface DecisionCard {
  readonly tag: string
  readonly title: string
  readonly verdict: string
  readonly detail: string
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

export const INSTALL_SNIPPET =
  'npm install @petepetrash/munari @react-three/fiber\nnpm install three@0.186.1 --save-exact'

export const DECISION_CARDS: readonly DecisionCard[] = [
  {
    tag: '0 kB capture',
    title: 'CSS perspective() or Drei <Html>',
    verdict: 'Use when planes stay flat',
    detail:
      'Vector text in every browser with native menus and zero GPU capture. Choose this when UI never bends, refracts, or intersects 3D geometry in depth.',
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
    verdict: 'Use for real UI in 3D scenes',
    detail:
      'Components start in normal page flow, lift into lit or curved 3D with zero blank frames, keep input accurate on warped meshes, sleep at 0 fps, and run outside Chrome.',
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
    code: `function LitCardHandoff() {
  const canvasId = useId()
  const supported = useSurfaceSupport()
  const [inScene, setInScene] = useState(false)

  return (
    <section style={{ position: 'relative', minHeight: 320 }}>
      {supported && (
        <SurfaceCanvas
          id={canvasId}
          pointerMode="surfaces"
          frameloop="demand"
          gl={{ alpha: true }}
          onCreated={({ gl }) => gl.setClearAlpha(0)}
          style={{ position: 'absolute', inset: 0 }}
        >
          <ambientLight intensity={0.45} />
          <directionalLight position={[-1.5, 2, 3]} intensity={2.6} color="#fff1d6" />
        </SurfaceCanvas>
      )}
      <Surface.Root canvasId={canvasId} inScene={inScene}>
        <Surface.HTML><NoteCard /></Surface.HTML>
        <Surface.Scene>
          <Surface.Mesh material={<Surface.LitMaterial roughness={0.32} metalness={0.05} />} />
        </Surface.Scene>
      </Surface.Root>
      <button type="button" disabled={!supported} onClick={() => setInScene((v) => !v)}>
        {inScene ? 'Return to flat HTML' : 'Light in 3D'}
      </button>
    </section>
  )
}`,
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
    code: `// Pair hover selectors so bent and fallback surfaces match:
// .wave-btn:hover, .wave-btn[data-hover] { background: #000; color: #fff; }

function CurvedSheet({ width, height }: { width: number; height: number }) {
  const geoRef = useRef<THREE.PlaneGeometry>(null)

  useFrame(({ clock }) => {
    const geometry = geoRef.current
    if (!geometry) return
    const t = clock.getElapsedTime()
    deformSurfaceGeometry(geometry, [width, height], (x, y) => ({
      x,
      y,
      z: Math.sin((x / width) * Math.PI * 2 + t) * 18,
    }))
  })

  return (
    <group scale={1 / 120}>
      <Surface.Mesh
        placement="manual"
        pointerRoute="auto"
        geometry={<planeGeometry ref={geoRef} args={[width, height, 48, 24]} />}
      />
    </group>
  )
}`,
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
    code: `const ignoreRaycast = () => {}

function ButtonBezel() {
  const box = useSurfaceAnchorBox()
  if (!box) return null
  const depth = 0.04
  return (
    <mesh position={[0, 0, -depth / 2]} raycast={ignoreRaycast}>
      <boxGeometry args={[box.width * 1.08, box.height * 1.16, depth]} />
      <meshStandardMaterial color="#2148bd" roughness={0.35} />
    </mesh>
  )
}

function CoolTintMaterial() {
  const surface = useSurfaceNodes()
  const material = useMemo(() => {
    const m = new MeshBasicNodeMaterial({ transparent: true })
    const sample = surface.map.sample(uv()).mul(surface.radiusMask())
    m.outputNode = premultipliedOutput(vec4(sample.rgb.mul(vec3(0.85, 0.95, 1)), sample.a))
    return m
  }, [surface])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}`,
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
    code: `export function SpatialBoard() {
  return (
    <SurfaceCanvas frameloop="demand" camera={{ position: [0, 0, 5], fov: 45 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[2, 3, 4]} intensity={2} />
      <FocusScene>
        <group position={[-1.2, 0, 0]}>
          <FocusGroup id="metrics">
            <SceneSurface.Root>
              <SceneSurface.HTML size={[320, 200]}>
                <div style={{ width: 320, height: 200, padding: 16, background: '#fff' }}>
                  <h3>Latency</h3>
                  <p>Tab or click to approach; 3D objects occlude this panel in depth.</p>
                </div>
              </SceneSurface.HTML>
              <SceneSurface.Mesh material={<Surface.LitMaterial roughness={0.4} />} />
            </SceneSurface.Root>
          </FocusGroup>
        </group>
      </FocusScene>
    </SurfaceCanvas>
  )
}`,
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
    code: `export function PageWithLens() {
  const capture = useElementCapture()
  return (
    <div style={{ position: 'relative' }}>
      <article ref={capture.ref} style={{ padding: 24 }}>
        <h2>Native article</h2>
        <p>Select this text normally while the 3D glass band magnifies its pixels.</p>
      </article>
      <SurfaceCanvas
        frameloop="demand"
        pointerMode="surfaces"
        gl={{ alpha: true }}
        onCreated={({ gl }) => gl.setClearAlpha(0)}
        style={{ position: 'absolute', inset: 0 }}
      >
        <MagnifyingBand capture={capture} />
      </SurfaceCanvas>
    </div>
  )
}`,
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
    code: `import { enableSnapdomCapture } from '@petepetrash/munari/snapdom'

// Keep native HTML-in-canvas on Chrome 157+; fall back to snapDOM elsewhere.
enableSnapdomCapture({
  isolatedTextInputs: 'input[data-munari-capture-region]',
})`,
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
    requirement: 'Per-pixel lighting, refraction, or bent meshes on live UI',
    cssAndDrei: 'Cannot deform or shade DOM pixels',
    diyCanvas: 'Custom WebGPU + custom hit-test math',
    munari: 'Built in (Surface.LitMaterial, useSurfaceNodes, deformSurfaceGeometry)',
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
