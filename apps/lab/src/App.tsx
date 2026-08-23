import { Suspense, useEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import {
  detectHtmlInCanvas,
  FocusScene,
  SurfaceCanvas,
  useSupportsDOMSurfaces,
} from '@petepetrash/munari'
import { paintStats } from '@petepetrash/munari/advanced'
import { showChrome } from './bareMode'
import { Workspace, WorkspaceHud } from './scenes/workspace/Workspace'
import { Glass } from './scenes/glass/Glass'
import { GlassTweakPanel } from './scenes/glass/GlassTweaks'
import { FlightApp } from './scenes/flight/Flight'
import { Explode, ExplodeHud } from './scenes/explode/Explode'
import { GenieApp } from './scenes/genie/Genie'
import { FisheyeApp } from './scenes/fisheye/Fisheye'
import { SliderApp } from './scenes/slider/Slider'
import { VeilApp } from './scenes/veil/Veil'
import { KnobsApp } from './scenes/knobs/Knobs'
import { OpticsApp } from './scenes/optics/Optics'
import { LogoApp } from './scenes/logo/Logo'
import { SelectionApp } from './scenes/selection/Selection'
import { CandidatesApp } from './scenes/candidates/Candidates'
import { RefractionApp } from './scenes/refraction/Refraction'
import { SurfaceProviderProbe } from './lib/surfaceProvider'
import { SceneNav } from './components/SceneNav'
import { SceneBoundary } from './components/SceneBoundary'

// Nine scenes (decisions.md #3): workspace focus wall, glass SDF compositor,
// flight drag trilogy, exploded-paint inspector, genie minimize-to-dock,
// veil progressive blur, knobs-and-switches instrument rail, optics bench,
// selection bead. Plus one sketch off the roster: the logo playground
// (animated wordmark, letters liftable into matter).
// Everything they render reaches the library through its published entries —
// this app is the proof that the public surface is sufficient.

type SceneId =
  | 'workspace'
  | 'glass'
  | 'flight'
  | 'explode'
  | 'genie'
  | 'fisheye'
  | 'slider'
  | 'veil'
  | 'knobs'
  | 'optics'
  | 'logo'
  | 'selection'
  | 'candidates'
  | 'refraction'
const SCENES = [
  'workspace',
  'glass',
  'flight',
  'explode',
  'genie',
  'fisheye',
  'slider',
  'veil',
  'knobs',
  'optics',
  'logo',
  'selection',
  'candidates',
  'refraction',
] as const

// The nav shows only the focus five; the rest stay routable by URL so the
// browser gates and old links keep working, they just aren't advertised.
const NAV_SCENES = ['flight', 'genie', 'knobs', 'selection', 'logo'] as const satisfies readonly SceneId[]

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

/**
 * The scenes that ARE pages, with their own overlay canvas on top, rather
 * than content inside the one shared 3D room. They take the whole route and
 * carry the scene chips themselves; `null` means the room renders it.
 */
function pageSceneFor(scene: SceneId, chips: React.ReactNode) {
  switch (scene) {
    case 'flight':
      return <FlightApp chips={chips} />
    case 'genie':
      return <GenieApp chips={chips} />
    case 'fisheye':
      return <FisheyeApp chips={chips} />
    case 'slider':
      return <SliderApp chips={chips} />
    case 'veil':
      return <VeilApp chips={chips} />
    case 'knobs':
      return <KnobsApp chips={chips} />
    case 'optics':
      return <OpticsApp chips={chips} />
    case 'logo':
      return <LogoApp chips={chips} />
    case 'selection':
      return <SelectionApp chips={chips} />
    case 'refraction':
      return <RefractionApp chips={chips} />
    // No chips: the candidates page has its own left-column nav, and the two
    // menus side by side read as one broken one.
    case 'candidates':
      return <CandidatesApp />
    default:
      return null
  }
}

export default function App() {
  const unsupported = !useSupportsDOMSurfaces()
  // Both trial entry points, for the capability chips only. The branch
  // above is the hook's job — a Surface needs `drawElementImage`, and
  // `texElementImage2D` is reported here as diagnostics.
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

  // A missing trial is a degraded lab, not a blocked one. Every scene keeps
  // its page DOM: `surfaceSourceHost` catches UnsupportedPlatformError and
  // leaves `presentedView` at `dom`, so the DOM presenters stay mounted and
  // the r3f tree survives. Measured 2026-08-22, Chrome without the flag,
  // all 14 scenes: zero page errors, 100% of sampled points take a caret.
  //
  // This replaced a full-page block that was correct when it was written —
  // a Surface used to throw out of the Canvas and take the whole tree with
  // it, leaving a solid black <body> and no message (2026-08-03). The
  // library fixed the throw; the block outlived the fault and hid the one
  // property that is hardest to get from the raw API, which is that the
  // content is still there.
  //
  // What DOESN'T come back is content that lives only in a source with no
  // page-side presenter. Measure that by what a READER can reach — text
  // outside any parked canvas and outside `aria-hidden` — not by
  // `body.innerText`, which counts a `<Surface.DOM>` park as a second copy
  // and scored Selection at 67% when it was already whole.
  //
  // By that metric the five nav scenes are all 100%: flight, genie, logo
  // and selection already author a page copy, and knobs grew a degraded
  // branch of its own (see `supported` in Knobs.tsx). The nine unpromoted
  // scenes have not been measured this way.

  // Never blocking, and `pointer-events: none` so it cannot eat a click on
  // the degraded page underneath — a notice that broke the interactivity it
  // is describing would be its own contradiction.
  // Closed by default, and small enough to sit in a corner none of the
  // scenes use. The full notice was a 560x150 panel pinned bottom-centre,
  // where it covered the genie dock outright; measured across the five nav
  // scenes at that size, every corner collided with something, and at
  // 250x34 the bottom-left corner is clear in all five (2026-08-23).
  //
  // <details> rather than a state flip: the disclosure, the keyboard
  // handling and the ARIA are the browser's, and this is the one piece of
  // lab furniture that shows up on a page whose whole subject is that the
  // browser's own machinery still works.
  const notice =
    showChrome && unsupported ? (
      <details className="trial-notice">
        <summary>HTML-in-canvas unavailable</summary>
        <ul className="features">
          <li data-ok={false}>drawElementImage</li>
          <li data-ok={support.texElementImage2D}>texElementImage2D</li>
        </ul>
        <p className="hint">
          This page is its plain DOM — selectable, focusable, and navigable, with no
          Surface lifted into WebGL. On the public demo, current <strong>Chrome</strong>{' '}
          gets the capability from the page's origin-trial token just by visiting.
          Anywhere else — localhost, another Chromium browser — enable{' '}
          <code>chrome://flags/#canvas-draw-element</code> and relaunch; a browser that is
          already running ignores the flag, so quit it fully first.
        </p>
      </details>
    ) : null

  // The flight scene is not a scene in the shared canvas — it IS a page,
  // with its own overlay canvas on top of it. The other scenes are content
  // inside one 3D room; this one inverts the relationship, so it takes the
  // whole route and carries the scene chips itself.
  // `?bare` hands every page scene `undefined` instead, which is already
  // the "no chips" case each of them handles.
  const chips = !showChrome ? undefined : (
    <SceneNav
      scenes={NAV_SCENES}
      active={scene}
      onSelect={(id) => {
        window.history.pushState(null, '', `?scene=${id}`)
        setScene(id)
      }}
    />
  )
  const domSurfaceDemandProbe =
    scene === 'workspace' &&
    new URLSearchParams(window.location.search).get('probe') === 'dom-surface-demand'

  // The notice rides along rather than replacing the scene — see `unsupported`.
  const page = pageSceneFor(scene, chips)
  if (page !== null) {
    return (
      <>
        <SceneBoundary key={scene} scene={scene}>
          {page}
        </SceneBoundary>
        {notice}
      </>
    )
  }

  return (
    <div className="app">
      <SurfaceProviderProbe value="lab">
        <SurfaceCanvas
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
        </SurfaceCanvas>
      </SurfaceProviderProbe>

      {showChrome && (
        <div className="hud">
          <h1>
            mun<em>ari</em>
          </h1>
          <p className="sub">{scene}</p>
          {chips}
          {!unsupported && (
            <ul className="features">
              <li data-ok={support.drawElementImage}>drawElementImage</li>
              <li data-ok={support.texElementImage2D}>texElementImage2D</li>
            </ul>
          )}
        </div>
      )}
      {notice}

      {showChrome && scene === 'workspace' && <WorkspaceHud />}
      {showChrome && scene === 'explode' && <ExplodeHud />}
      {showChrome && scene === 'glass' && <GlassTweakPanel />}
    </div>
  )
}
