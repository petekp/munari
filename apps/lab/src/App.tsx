import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import { detectHtmlInCanvas, FocusScene, paintStats } from 'anamorph'
import { Workspace, WorkspaceHud } from './scenes/Workspace'
import { Glass } from './scenes/Glass'
import { FlightApp } from './scenes/Flight'
import { Explode, ExplodeHud } from './scenes/Explode'

// Four scenes (decisions.md #3): workspace focus wall, glass SDF compositor,
// flight drag trilogy, exploded-paint inspector. Everything they render
// reaches the library through the `anamorph` barrel — this app is the proof
// that the public surface is sufficient.

type SceneId = 'workspace' | 'glass' | 'flight' | 'explode'
const SCENES = ['workspace', 'glass', 'flight', 'explode'] as const

const FOOTERS: Record<SceneId, string> = {
  workspace:
    'double-click a panel to approach · double-click the floor to step back · drag a title bar · click into text and type',
  glass:
    'drag a lens across the panel — the UI refracts and stays live · click through the glass and type',
  flight: 'drag a card off the board · throw it · ✕ to crumple it',
  explode:
    'one div, no children, six plates · orbit to see the depths · drag spread to zero and it stacks back into the card',
}

// Clicking a canvas normally moves focus to <body>, which would blur
// whatever hidden form field a Surface has focused — killing native typing.
// Preventing mousedown's default suppresses that focus change (drags and
// clicks still work).
function KeepDomFocus() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const noSteal = (e: MouseEvent) => e.preventDefault()
    el.addEventListener('mousedown', noSteal)
    return () => el.removeEventListener('mousedown', noSteal)
  }, [gl])
  return null
}

export default function App() {
  const support = useMemo(detectHtmlInCanvas, [])
  const [scene, setScene] = useState<SceneId>('workspace')

  // Console story: the kernel stamps nothing on `window`, so the app hangs
  // the paint ledger where devtools probes can reach it, as
  // `__anamorph.stats()`. This is a consumer choice, not library behavior
  // — the seam it reads is `paintStats()` (decisions.md #7).
  useEffect(() => {
    ;(window as unknown as { __anamorph?: unknown }).__anamorph = {
      stats: paintStats,
    }
  }, [])

  // Every scene below mounts Surfaces, and a Surface on a browser without the
  // trial throws out of the r3f Canvas — which unmounts the whole tree,
  // including the `hint` further down that exists to explain exactly this.
  // The page went solid black with an empty <body> and no message (Chrome
  // without the flag, 2026-08-03). So the capability is checked BEFORE the
  // Canvas is mounted rather than discovered inside it: the one screen whose
  // job is to say "your browser can't run this" must not itself need a
  // browser that can.
  const unsupported = !support.drawElementImage

  // The flight scene is not a scene in the shared canvas — it IS a page,
  // with its own overlay canvas on top of it. The other scenes are content
  // inside one 3D room; this one inverts the relationship, so it takes the
  // whole route and carries the scene chips itself.
  const chips = (
    <div className="tabs">
      {SCENES.map((id) => (
        <button key={id} data-active={scene === id} onClick={() => setScene(id)}>
          {id}
        </button>
      ))}
    </div>
  )

  if (unsupported) {
    return (
      <div className="app">
        <div className="hud">
          <h1>anamorph</h1>
          <p className="sub">a component library made of real materials</p>
          <ul className="features">
            <li data-ok={false}>drawElementImage ✗</li>
            <li data-ok={support.texElementImage2D}>
              texElementImage2D {support.texElementImage2D ? '✓' : '✗'}
            </li>
          </ul>
          <p className="hint">
            HTML-in-canvas unavailable — every Surface needs it. Enable{' '}
            <code>chrome://flags/#canvas-draw-element</code> and relaunch, or start Chrome with{' '}
            <code>--enable-features=CanvasDrawElement</code>. A Chrome that is already running
            ignores the flag, so quit it fully first.
          </p>
        </div>
      </div>
    )
  }

  if (scene === 'flight') return <FlightApp chips={chips} />

  return (
    <div className="app">
      <Canvas
        shadows
        camera={{ position: [0, 2.5, 9], fov: 45 }}
        dpr={[1, 2]}
        onCreated={(state) => {
          // Dev diagnostics: lets automation inspect the scene graph.
          ;(window as unknown as { __r3f: unknown }).__r3f = state
        }}
      >
        <KeepDomFocus />
        <FocusScene>
          <Suspense fallback={null}>
            <Environment preset="city" />
            {scene === 'glass' && <Glass />}
            {scene === 'explode' && <Explode />}
            {scene === 'workspace' && <Workspace />}
            {/* The inspector's plates are unlit sheets on a light table, and
             * a contact shadow under them would be scene furniture pretending
             * to be paint — in the one scene whose subject IS which paint is
             * whose. */}
            {scene !== 'explode' && (
              <ContactShadows position={[0, -0.15, 0]} opacity={0.5} blur={2.2} scale={20} />
            )}
            <OrbitControls
              makeDefault
              enableDamping
              target={[0, 1.4, 0]}
              maxPolarAngle={Math.PI / 2.05}
              minDistance={3}
              maxDistance={16}
            />
          </Suspense>
        </FocusScene>
      </Canvas>

      <div className="hud">
        <h1>anamorph / {scene}</h1>
        <p className="sub">a component library made of real materials</p>
        {chips}
        <ul className="features">
          <li data-ok={support.drawElementImage}>
            drawElementImage {support.drawElementImage ? '✓' : '✗'}
          </li>
          <li data-ok={support.texElementImage2D}>
            texElementImage2D {support.texElementImage2D ? '✓' : '✗'}
          </li>
        </ul>
        {!support.drawElementImage && (
          <p className="hint">
            HTML-in-canvas unavailable — every Surface needs it. Chrome
            148–151 with <code>chrome://flags/#canvas-draw-element</code>.
          </p>
        )}
      </div>

      <div className="footer">{FOOTERS[scene]}</div>
      {scene === 'workspace' && <WorkspaceHud />}
      {scene === 'explode' && <ExplodeHud />}
    </div>
  )
}
