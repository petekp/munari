// Why Munari JSX snippets — copyable code specimens paired with each walkthrough section.
//
// The law: every snippet compiles against `@petepetrash/munari` and matches the
// examples in `docs/why-munari.md`.
//
// Ownership: imported by `whyData.ts`; rendered inside `CopyBlock` in `Why.tsx`.

export const INSTALL_SNIPPET =
  'npm install @petepetrash/munari @react-three/fiber\nnpm install three@0.186.1 --save-exact'

export const HANDOFF_SNIPPET = `function LitCardHandoff() {
  const canvasId = useId()
  const supported = useCaptureSupport()
  const [inScene, setInScene] = useState(false)

  return (
    <section style={{ position: 'relative', minHeight: 320 }}>
      {supported && (
        <SurfaceCanvas
          id={canvasId}
          pointerMode="surfaces"
          frameloop="demand"
          lighting="none"
          gl={{ alpha: true }}
          onCreated={({ gl }) => gl.setClearAlpha(0)}
          style={{ position: 'absolute', inset: 0 }}
        >
          <ambientLight intensity={0.45} />
          <directionalLight position={[-1.5, 2, 3]} intensity={2.6} color="#fff1d6" />
        </SurfaceCanvas>
      )}
      <Surface.Root canvasId={canvasId} inScene={inScene} finish={{ color: null, roughness: 0.32, metalness: 0.05 }}>
        <Surface.HTML><NoteCard /></Surface.HTML>
        <Surface.Scene>
          <Surface.Mesh />
        </Surface.Scene>
      </Surface.Root>
      <button type="button" disabled={!supported} onClick={() => setInScene((v) => !v)}>
        {inScene ? 'Return to flat HTML' : 'Light in 3D'}
      </button>
    </section>
  )
}`

export const CURVED_INPUT_SNIPPET = `// Pair hover selectors so bent and fallback surfaces match:
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
}`

export const ANCHOR_TSL_SNIPPET = `const ignoreRaycast = () => {}

function ButtonBezel() {
  const box = useSurfaceAnchorBox()
  if (!box) return null
  const width = box.uv.uMax - box.uv.uMin
  const height = box.uv.vMax - box.uv.vMin
  const depth = 0.04
  return (
    <mesh position={[0, 0, -depth / 2]} raycast={ignoreRaycast}>
      <boxGeometry args={[width * 1.08, height * 1.16, depth]} />
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
}`

export const SPATIAL_BOARD_SNIPPET = `export function SpatialBoard() {
  return (
    <SurfaceCanvas frameloop="demand" lighting="none" camera={{ position: [0, 0, 5], fov: 45 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[2, 3, 4]} intensity={2} />
      <FocusScene>
        <group position={[-1.2, 0, 0]}>
          <FocusGroup id="metrics">
            <SceneSurface.Root finish={{ color: null, roughness: 0.4 }}>
              <SceneSurface.HTML size={[320, 200]}>
                <div style={{ width: 320, height: 200, padding: 16, background: '#fff' }}>
                  <h3>Latency</h3>
                  <p>Tab or click to approach; 3D objects occlude this panel in depth.</p>
                </div>
              </SceneSurface.HTML>
              <SceneSurface.Mesh />
            </SceneSurface.Root>
          </FocusGroup>
        </group>
      </FocusScene>
    </SurfaceCanvas>
  )
}`

export const ELEMENT_CAPTURE_SNIPPET = `export function PageWithLens() {
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
}`

export const SNAPDOM_SNIPPET = `import { enableSnapdomCapture } from '@petepetrash/munari/snapdom'

// Keep native HTML-in-canvas on Chrome 157+; fall back to snapDOM elsewhere.
enableSnapdomCapture({
  isolatedTextInputs: 'input[data-munari-capture-region]',
})`
