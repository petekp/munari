import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import { detectHtmlInCanvas, FocusScene, paintStats } from '@petepetrash/munari'
import { showChrome } from './bareMode'
import { Workspace, WorkspaceHud } from './scenes/workspace/Workspace'
import { Glass } from './scenes/glass/Glass'
import { GlassTweakPanel } from './scenes/glass/GlassTweaks'
import { FlightApp } from './scenes/flight/Flight'
import { Explode, ExplodeHud } from './scenes/explode/Explode'
import { GenieApp } from './scenes/genie/Genie'
import { VeilApp } from './scenes/veil/Veil'
import { KnobsApp } from './scenes/knobs/Knobs'
import { OpticsApp } from './scenes/optics/Optics'
import { LogoApp } from './scenes/logo/Logo'

// Eight scenes (decisions.md #3): workspace focus wall, glass SDF compositor,
// flight drag trilogy, exploded-paint inspector, genie minimize-to-dock,
// veil progressive blur, knobs-and-switches instrument rail, optics bench.
// Plus one sketch off the roster: the logo playground (animated wordmark,
// letters liftable into matter).
// Everything they render reaches the library through the `@petepetrash/munari` barrel —
// this app is the proof that the public surface is sufficient.

type SceneId =
  | 'workspace'
  | 'glass'
  | 'flight'
  | 'explode'
  | 'genie'
  | 'veil'
  | 'knobs'
  | 'optics'
  | 'logo'
const SCENES = [
  'workspace',
  'glass',
  'flight',
  'explode',
  'genie',
  'veil',
  'knobs',
  'optics',
  'logo',
] as const

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

// `?scene=glass` opens that scene directly. Not a router — just enough
// of one that a scene can be linked, reloaded into, and screenshotted
// without a human clicking a chip first. (Deep links used to be `#glass`;
// the hash is still honored on arrival so old links keep landing.)
const SCENE_IDS = new Set<string>(SCENES)

/** Whether an arbitrary URL fragment names a scene this build ships. */
function isSceneId(value: string | null): value is SceneId {
  return value !== null && SCENE_IDS.has(value)
}

function readScene(): SceneId {
  const q = new URLSearchParams(window.location.search).get('scene')
  if (isSceneId(q)) return q
  const h = window.location.hash.slice(1)
  // Flight is the landing scene: what a cold visitor should see first. Every
  // browser gate names its scene in the URL, so none of them ride this default.
  return isSceneId(h) ? h : 'flight'
}

export default function App() {
  const support = useMemo(detectHtmlInCanvas, [])
  const [scene, setScene] = useState<SceneId>(readScene)

  // …and the URL stays authoritative afterwards. Without this, navigating
  // by URL only works on a cold load: back/forward alone does not reload,
  // so the initializer above never runs again and the scene silently stays
  // put — the same screenshot twice, which is a very quiet way to draw the
  // wrong conclusion about a change you just made.
  useEffect(() => {
    const onPop = () => setScene(readScene())
    window.addEventListener('popstate', onPop)
    // An arrival on the legacy hash form normalizes to the param form once,
    // so the address bar shows the link worth copying.
    const h = window.location.hash.slice(1)
    if (!window.location.search.includes('scene=') && isSceneId(h)) {
      window.history.replaceState(null, '', `?scene=${h}`)
    }
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Console story: the kernel stamps nothing on `window`, so the app hangs
  // the paint ledger where devtools probes can reach it, as
  // `__munari.stats()`. This is a consumer choice, not library behavior
  // — the seam it reads is `paintStats()` (decisions.md #7).
  useEffect(() => {
    window.__munari = {
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
  // `?bare` hands every page scene `undefined` instead, which is already
  // the "no chips" case each of them handles.
  const chips = !showChrome ? undefined : (
    <div className="tabs">
      {SCENES.map((id) => (
        <button
          key={id}
          data-active={scene === id}
          onClick={() => {
            window.history.pushState(null, '', `?scene=${id}`)
            setScene(id)
          }}
        >
          {id}
        </button>
      ))}
    </div>
  )
  const domSurfaceDemandProbe =
    scene === 'workspace' &&
    new URLSearchParams(window.location.search).get('probe') === 'dom-surface-demand'

  if (unsupported) {
    return (
      <div className="app">
        <div className="hud">
          <h1>
            mun<em>ari</em>
          </h1>
          <p className="sub">a component library made of real materials</p>
          {/* The lamp carries the verdict — a ✓/✗ pair reads as two glyphs
           * where an instrument reads as one state. */}
          <ul className="features">
            <li data-ok={false}>drawElementImage</li>
            <li data-ok={support.texElementImage2D}>texElementImage2D</li>
          </ul>
          <p className="hint">
            HTML-in-canvas unavailable — every Surface needs it, and only Chromium ships it
            today. On the public demo, current <strong>Chrome</strong> gets the capability from
            the page's origin-trial token just by visiting. Anywhere else — localhost, another
            Chromium browser — enable <code>chrome://flags/#canvas-draw-element</code> and
            relaunch; a browser that is already running ignores the flag, so quit it fully
            first.
          </p>
        </div>
      </div>
    )
  }

  // Some scenes are not scenes in the shared canvas — they ARE pages, with
  // their own overlay canvas on top. The others are content inside one 3D
  // room; these invert the relationship, so they take the whole route and
  // carry the scene chips themselves.
  if (scene === 'flight') return <FlightApp chips={chips} />
  if (scene === 'genie') return <GenieApp chips={chips} />
  if (scene === 'veil') return <VeilApp chips={chips} />
  if (scene === 'knobs') return <KnobsApp chips={chips} />
  if (scene === 'optics') return <OpticsApp chips={chips} />
  if (scene === 'logo') return <LogoApp chips={chips} />

  return (
    <div className="app">
      <Canvas
        frameloop={domSurfaceDemandProbe ? 'demand' : 'always'}
        shadows
        camera={{ position: [0, 2.5, 9], fov: 45 }}
        dpr={[1, 2]}
        onCreated={(state) => {
          // Dev diagnostics: lets automation inspect the scene graph.
          window.__r3f = state
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
            {scene !== 'explode' && scene !== 'glass' && (
              <ContactShadows position={[0, -0.15, 0]} opacity={0.5} blur={2.2} scale={20} />
            )}
            {/* Glass frames itself. It is the one scene that claims to be a
                PAGE rather than a room, so it owns its camera outright and
                the shared rig has to get out of the way — not merely be
                disabled. A disabled OrbitControls still runs `update()` every
                frame while damping is on, and that call rebuilds the camera's
                position from the controls' own spherical state, which would
                silently undo the scene's framing on frame one. The floor
                shadow goes for the same reason: it is a room's furniture. */}
            {scene !== 'glass' && (
              <OrbitControls
                makeDefault
                enableDamping
                target={[0, 1.4, 0]}
                maxPolarAngle={Math.PI / 2.05}
                minDistance={3}
                maxDistance={16}
              />
            )}
          </Suspense>
        </FocusScene>
      </Canvas>

      {showChrome && (
        <div className="hud">
          <h1>
            mun<em>ari</em>
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
      )}

      {showChrome && scene === 'workspace' && <WorkspaceHud />}
      {showChrome && scene === 'explode' && <ExplodeHud />}
      {showChrome && scene === 'glass' && <GlassTweakPanel />}
    </div>
  )
}
