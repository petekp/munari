import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import { detectHtmlInCanvas, FocusScene, paintStats } from '@petepetrash/munari'
import { Workspace, WorkspaceHud } from './scenes/Workspace'
import { Glass } from './scenes/Glass'
import { FlightApp } from './scenes/Flight'
import { Explode, ExplodeHud } from './scenes/Explode'
import { PassageApp } from './scenes/Passage'
import { WakeApp } from './scenes/Wake'

// Six scenes (decisions.md #3): workspace focus wall, glass SDF compositor,
// flight drag trilogy, exploded-paint inspector, passage route transition,
// wake navigation-through-a-medium.
// Everything they render reaches the library through the `@petepetrash/munari` barrel —
// this app is the proof that the public surface is sufficient.

type SceneId = 'workspace' | 'glass' | 'flight' | 'explode' | 'passage' | 'wake'
const SCENES = ['workspace', 'glass', 'flight', 'explode', 'passage', 'wake'] as const

const FOOTERS: Record<SceneId, string> = {
  workspace:
    'double-click a panel to approach · double-click the floor to step back · drag a title bar · click into text and type',
  glass:
    'drag a lens across the panel — the UI refracts and stays live · click through the glass and type',
  flight: 'drag a card off the board · throw it · ✕ to crumple it',
  explode:
    'one div, no children, six plates · orbit to see the depths · drag spread to zero and it stacks back into the card',
  passage:
    'open a note · the card leaves the page and lays itself out again at every width on the way',
  wake:
    'pick a page — the new one arrives through the water · click anywhere to strike the surface · type while it moves',
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
  // `#flight` opens the flight lab directly. Not a router — just enough of
  // one that a scene can be linked, reloaded into, and screenshotted without
  // a human clicking a chip first.
  const [scene, setScene] = useState<SceneId>(() => {
    const h = window.location.hash.slice(1) as SceneId
    return (SCENES as readonly string[]).includes(h) ? h : 'workspace'
  })

  // …and the hash stays authoritative afterwards. Without this, navigating
  // by URL only works on a cold load: a hash change alone does not reload,
  // so the initializer above never runs again and the scene silently stays
  // put — the same screenshot twice, which is a very quiet way to draw the
  // wrong conclusion about a change you just made.
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.slice(1) as SceneId
      if ((SCENES as readonly string[]).includes(h)) setScene(h)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Console story: the kernel stamps nothing on `window`, so the app hangs
  // the paint ledger where devtools probes can reach it, as
  // `__munari.stats()`. This is a consumer choice, not library behavior
  // — the seam it reads is `paintStats()` (decisions.md #7).
  useEffect(() => {
    ;(window as unknown as { __munari?: unknown }).__munari = {
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
        <button
          key={id}
          data-active={scene === id}
          onClick={() => {
            window.location.hash = id
            setScene(id)
          }}
        >
          {id}
        </button>
      ))}
    </div>
  )

  if (unsupported) {
    return (
      <div className="app">
        <div className="hud">
          <h1>
            ana<em>morph</em>
          </h1>
          <p className="sub">a component library made of real materials</p>
          {/* The lamp carries the verdict — a ✓/✗ pair reads as two glyphs
           * where an instrument reads as one state. */}
          <ul className="features">
            <li data-ok={false}>drawElementImage</li>
            <li data-ok={support.texElementImage2D}>texElementImage2D</li>
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

  // Two scenes are not scenes in the shared canvas — they ARE pages, with
  // their own overlay canvas on top. The others are content inside one 3D
  // room; these invert the relationship, so they take the whole route and
  // carry the scene chips themselves.
  if (scene === 'flight') return <FlightApp chips={chips} />
  if (scene === 'passage') return <PassageApp chips={chips} />
  if (scene === 'wake') return <WakeApp chips={chips} />

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
        <h1>
          ana<em>morph</em>
        </h1>
        <p className="sub">{scene}</p>
        {chips}
        <ul className="features">
          <li data-ok={support.drawElementImage}>drawElementImage</li>
          <li data-ok={support.texElementImage2D}>texElementImage2D</li>
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
