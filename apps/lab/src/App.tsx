import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import {
  FocusScene,
  SurfaceCanvas,
  useSurfaceSupport,
} from '@petepetrash/munari'
import { captureEngine, paintStats } from '@petepetrash/munari/advanced'
import { showChrome, showShell } from './bareMode'
import { HomeApp } from './scenes/home/Home'
import { SurfaceProviderProbe } from './lib/surfaceProvider'
import { SceneNav } from './components/SceneNav'
import { SceneGuide } from './components/SceneGuide'
import { BROWSER_GUIDE, exampleFor, washFor } from './components/sceneCatalog'
import { SceneBoundary } from './components/SceneBoundary'
import { revealSite } from './components/siteOpening'
import { captureParam } from './captureMode'

// A home visit must not fetch or evaluate every lab. Keep Home eager; each
// other scene loads only in its own frame, with the same page and R3F roots.
const Workspace = lazy(() => import('./scenes/workspace/Workspace').then(m => ({ default: m.Workspace })))
const WorkspaceHud = lazy(() => import('./scenes/workspace/Workspace').then(m => ({ default: m.WorkspaceHud })))
const Glass = lazy(() => import('./scenes/glass/Glass').then(m => ({ default: m.Glass })))
const GlassTweakPanel = lazy(() => import('./scenes/glass/GlassTweaks').then(m => ({ default: m.GlassTweakPanel })))
const FlightApp = lazy(() => import('./scenes/flight/Flight').then(m => ({ default: m.FlightApp })))
const Explode = lazy(() => import('./scenes/explode/Explode').then(m => ({ default: m.Explode })))
const ExplodeHud = lazy(() => import('./scenes/explode/Explode').then(m => ({ default: m.ExplodeHud })))
const GenieApp = lazy(() => import('./scenes/genie/Genie').then(m => ({ default: m.GenieApp })))
const FisheyeApp = lazy(() => import('./scenes/fisheye/Fisheye').then(m => ({ default: m.FisheyeApp })))
const SliderApp = lazy(() => import('./scenes/slider/Slider').then(m => ({ default: m.SliderApp })))
const VeilApp = lazy(() => import('./scenes/veil/Veil').then(m => ({ default: m.VeilApp })))
const KnobsApp = lazy(() => import('./scenes/knobs/Knobs').then(m => ({ default: m.KnobsApp })))
const OpticsApp = lazy(() => import('./scenes/optics/Optics').then(m => ({ default: m.OpticsApp })))
const LogoApp = lazy(() => import('./scenes/logo/Logo').then(m => ({ default: m.LogoApp })))
const SelectionApp = lazy(() => import('./scenes/selection/Selection').then(m => ({ default: m.SelectionApp })))
const CandidatesApp = lazy(() => import('./scenes/candidates/Candidates').then(m => ({ default: m.CandidatesApp })))
const RefractionApp = lazy(() => import('./scenes/refraction/Refraction').then(m => ({ default: m.RefractionApp })))
const GalleryApp = lazy(() => import('./scenes/gallery/Gallery').then(m => ({ default: m.GalleryApp })))
const CrystalApp = lazy(() => import('./scenes/crystal/Crystal').then(m => ({ default: m.CrystalApp })))
const ControlsApp = lazy(() => import('./scenes/controls/Controls').then(m => ({ default: m.ControlsApp })))
const MarbleHandApp = lazy(() => import('./scenes/marble-hand/MarbleHand').then(m => ({ default: m.MarbleHandApp })))
const PlumeApp = lazy(() => import('./scenes/plume/Plume').then(m => ({ default: m.PlumeApp })))
const GravityApp = lazy(() => import('./scenes/gravity/Gravity').then(m => ({ default: m.GravityApp })))
const LampApp = lazy(() => import('./scenes/lamp/Lamp').then(m => ({ default: m.LampApp })))
const RainApp = lazy(() => import('./scenes/rain/Rain').then(m => ({ default: m.RainApp })))
const WordmarkApp = lazy(() => import('./scenes/wordmark/Wordmark').then(m => ({ default: m.WordmarkApp })))

// The promoted scene roster is decisions.md #3. URL-only studies stay beside
// it without claiming promotion: the candidates bench, refraction, gallery,
// crystal, and the controls / plume / marble-hand trio. Everything they render
// reaches the library through its published entries — this app is the proof
// that the public surface is sufficient.

type SceneId =
  | 'home'
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
  | 'gallery'
  | 'crystal'
  | 'controls'
  | 'marble-hand'
  | 'plume'
  | 'gravity'
  | 'lamp'
  | 'rain'
  | 'wordmark'
const SCENES = [
  'home',
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
  'gallery',
  'crystal',
  'controls',
  'marble-hand',
  'plume',
  'gravity',
  'lamp',
  'rain',
  'wordmark',
] as const

// The nav shows only the advertised scenes; the rest stay routable by URL so
// the browser gates and old links keep working, they just aren't advertised.
const NAV_SCENES = ['home', 'flight', 'genie', 'knobs', 'selection', 'logo', 'marble-hand', 'plume'] as const satisfies readonly SceneId[]

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
  // Home is the landing scene: the overview and tutorial a cold visitor
  // should see first. Every browser gate names its scene in the URL, so
  // none of them ride this default.
  return isSceneId(h) ? h : 'home'
}

function readRoute() {
  const section = window.location.hash.slice(1)
  return {
    scene: readScene(),
    section: ['examples', 'how-it-works', 'get-started', 'support'].includes(section) ? section : '',
  }
}

/**
 * The scenes that ARE pages, with their own overlay canvas on top, rather
 * than content inside the one shared 3D room. They take the whole route;
 * `null` means the room renders it.
 */
function pageSceneFor(scene: SceneId, section: string) {
  switch (scene) {
    case 'home':
      return <HomeApp section={section} />
    case 'flight':
      return <FlightApp />
    case 'genie':
      return <GenieApp />
    case 'fisheye':
      return <FisheyeApp />
    case 'slider':
      return <SliderApp />
    case 'veil':
      return <VeilApp />
    case 'knobs':
      return <KnobsApp />
    case 'optics':
      return <OpticsApp />
    case 'logo':
      return <LogoApp />
    case 'selection':
      return <SelectionApp />
    case 'refraction':
      return <RefractionApp />
    case 'gallery':
      return <GalleryApp />
    case 'crystal':
      return <CrystalApp />
    // The controls bench is a direct study and does not carry the
    // promoted-scene rail over its own composition.
    case 'controls':
      return <ControlsApp />
    case 'marble-hand':
      return <MarbleHandApp />
    case 'plume':
      return <PlumeApp />
    // Private dial-in bench for the official mark: URL-only, never in the nav.
    case 'wordmark':
      return <WordmarkApp />

    case 'candidates':
      return <CandidatesApp />
    default:
      return spikeSceneFor(scene)
  }
}

/** The 2026-09-01 spikes: page studies under review, URL-only. */
function spikeSceneFor(scene: SceneId) {
  switch (scene) {
    case 'gravity':
      return <GravityApp />
    case 'lamp':
      return <LampApp />
    case 'rain':
      return <RainApp />
    default:
      return null
  }
}

// The shell's wash rides a custom property so siteShell.css can paint every
// surface from one value; the type names the property so no assertion is
// needed to hand it to React.
type ShellStyle = React.CSSProperties & { '--wash': string }
function shellStyle(scene: SceneId): ShellStyle {
  return { '--wash': washFor(scene) }
}

/** Everything inside the shared 3D room: the mounted scene, and the
 *  furniture that scene wants standing in it. */
function Room({ scene }: { scene: SceneId }) {
  return (
    <>
      {/* The `city` preset's own HDR, served from this app. As a preset it
          came from a CDN inside this Suspense boundary, so nothing in the
          room mounted until that fetch landed — 11.8s on a cold cache. */}
      <Environment files="/hdri/potsdamer_platz_1k.hdr" />
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
    </>
  )
}

/** The mounted scene's own control panel, on a chromed page. */
function SceneHud({ scene }: { scene: SceneId }) {
  if (scene === 'workspace') return <WorkspaceHud />
  if (scene === 'explode') return <ExplodeHud />
  if (scene === 'glass') return <GlassTweakPanel />
  return null
}

export default function App() {
  const unsupported = !useSurfaceSupport()
  const [{ scene, section }, setRoute] = useState(readRoute)

  // index.html paints the landing wash while this document is still empty.
  // Framed lab scenes retain their bench; the shell follows its active wash.
  useLayoutEffect(() => {
    const style = document.documentElement.style
    const previous = style.getPropertyValue('--document-background')
    style.setProperty('--document-background', showShell || scene === 'home' ? washFor(scene) : 'var(--bench)')
    return () => { style.setProperty('--document-background', previous) }
  }, [scene])

  useEffect(() => {
    document.title = scene === 'home' ? 'Munari · Live HTML in 3D' : `${exampleFor(scene)?.title ?? scene} · Munari`
  }, [scene])

  // …and the URL stays authoritative afterwards. Without this, navigating
  // by URL only works on a cold load: back/forward alone does not reload,
  // so the initializer above never runs again and the scene silently stays
  // put — the same screenshot twice, which is a very quiet way to draw the
  // wrong conclusion about a change you just made.
  useEffect(() => {
    const onPop = () => setRoute(readRoute())
    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onPop)
    // An arrival on the legacy hash form normalizes to the param form once,
    // so the address bar shows the link worth copying.
    const h = window.location.hash.slice(1)
    if (!window.location.search.includes('scene=') && isSceneId(h)) {
      window.history.replaceState(null, '', `?scene=${h}${captureParam}`)
    }
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onPop)
    }
  }, [])

  // Console story: the kernel stamps nothing on `window`, so the app hangs
  // the paint ledger where devtools probes can reach it, as
  // `__munari.stats()`. This is a consumer choice, not library behavior
  // — the seam it reads is `paintStats()` (decisions.md #7).
  useEffect(() => {
    window.__munari = {
      stats: paintStats,
      // Which engine actually answered, for the per-engine browser gates.
      // The URL says what was asked for; this says what was installed.
      engine: () => captureEngine().name,
    }
  }, [])

  // A missing trial is a degraded lab, not a blocked one. Every scene keeps
  // its page DOM: `surfaceSourceHost` catches UnsupportedPlatformError and
  // leaves the page presented, so the DOM presenters stay mounted and
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
  // `body.innerText`, which counted a parked capture as a second copy
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
  // Home, Marble Hand, and Plume explain capability in their own UI.
  const notice =
    showChrome && unsupported && scene !== 'home' && scene !== 'marble-hand' && scene !== 'plume' ? (
      <details className="trial-notice">
        <summary>Standard HTML mode</summary>
        <p className="hint">
          This browser doesn’t have HTML-in-canvas available. The page content
          still works, but this example’s 3D interaction needs the experimental API.{' '}
          <a href={BROWSER_GUIDE} target="_blank" rel="noreferrer">See Chrome’s setup guide.</a>
        </p>
      </details>
    ) : null

  // Home owns a measured DemoHost and can share this document with navigation.
  // Other scenes still assume a window-sized canvas, so they keep their frames.
  // Replacing a frame on navigation avoids an extra joint-history entry.
  if (showShell) {
    return (
      <div className="site-shell" style={shellStyle(scene)}>
        <a className="site-skip" href="#site-content" onClick={(event) => {
          event.preventDefault()
          document.getElementById('site-content')?.focus()
        }}>Skip to example</a>
        <SceneNav
          scenes={NAV_SCENES}
          active={scene}
          onSelect={(id) => {
            window.history.pushState(null, '', `?scene=${id}${captureParam}`)
            setRoute({ scene: id, section: '' })
          }}
          supported={!unsupported}
        />
        <main className="site-content" id="site-content" tabIndex={-1}>
          {scene !== 'home' && <SceneGuide scene={scene} />}
          {scene === 'home' ? (
            <SceneBoundary scene={scene}><HomeApp section={section} onReady={revealSite} /></SceneBoundary>
          ) : (
            <iframe
              key={`${scene}:${section}`}
              src={`/?scene=${scene}&framed${captureParam}${section ? `#${section}` : ''}`}
              title={`${scene} example`}
              className="site-frame"
              onLoad={revealSite}
            />
          )}
        </main>
      </div>
    )
  }

  const domSurfaceDemandProbe =
    scene === 'workspace' &&
    new URLSearchParams(window.location.search).get('probe') === 'dom-surface-demand'

  // The notice rides along rather than replacing the scene — see `unsupported`.
  const page = pageSceneFor(scene, section)
  if (page !== null) {
    return (
      <>
        <SceneBoundary key={scene} scene={scene}>
          <Suspense fallback={null}>{page}</Suspense>
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
            <Room scene={scene} />
          </Suspense>
        </FocusScene>
        </SurfaceCanvas>
      </SurfaceProviderProbe>

      {notice}

      {showChrome && <Suspense fallback={null}><SceneHud scene={scene} /></Suspense>}
    </div>
  )
}
