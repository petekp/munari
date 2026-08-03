import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import { detectHtmlInCanvas, FocusScene, paintStats } from 'anamorph'
import { Lab006, Lab006Hud } from './scenes/Lab006'
import { Lab012 } from './scenes/Lab012'
import { Lab014App } from './scenes/Lab014'

// Three labs cross (decisions.md #3): 006 focus wall, 012 SDF glass,
// 014 drag trilogy. Everything they render reaches the library through the
// `anamorph` barrel — this app is the proof that the public surface is
// sufficient, and the browser evidence that the port preserved behavior
// (the oracle at three-ui@362c5a1 runs next door for A/B).

type LabId = '006' | '012' | '014'
const LABS = ['006', '012', '014'] as const

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
  const [lab, setLab] = useState<LabId>('006')

  // Console story: the kernel stamps nothing on `window`, so the app hangs
  // the paint ledger where devtools probes expect it (the runbook's
  // `__anamorph.stats()`). This is a consumer choice, not library behavior.
  useEffect(() => {
    ;(window as unknown as { __anamorph?: unknown }).__anamorph = {
      stats: paintStats,
    }
  }, [])

  // Lab 014 is not a scene in the shared canvas — it IS a page, with its own
  // overlay canvas on top of it. The other labs are content inside one 3D
  // room; this one inverts the relationship, so it takes the whole route and
  // carries the lab chips itself.
  const chips = (
    <div className="tabs">
      {LABS.map((id) => (
        <button key={id} data-active={lab === id} onClick={() => setLab(id)}>
          lab {id}
        </button>
      ))}
    </div>
  )

  if (lab === '014') return <Lab014App chips={chips} />

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
            {lab === '012' ? <Lab012 /> : <Lab006 />}
            <ContactShadows position={[0, -0.15, 0]} opacity={0.5} blur={2.2} scale={20} />
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
        <h1>anamorph / lab {lab}</h1>
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

      <div className="footer">
        {lab === '012'
          ? 'drag a lens across the panel — the UI refracts and stays live · click through the glass and type'
          : 'double-click a panel to approach · double-click the floor to step back · drag a title bar · click into text and type'}
      </div>
      {lab === '006' && <Lab006Hud />}
    </div>
  )
}
