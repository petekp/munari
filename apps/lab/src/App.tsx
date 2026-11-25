import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Environment, OrbitControls } from '@react-three/drei'
import { ContactShadows } from './lib/ContactShadows'
import {
  FocusScene,
  SurfaceCanvas,
  useCaptureSupport,
} from '@petepetrash/munari'
import { captureEngine, paintStats } from '@petepetrash/munari/advanced'
import { showChrome, showShell } from './bareMode'
import { HomeApp } from './scenes/home/Home'
import { SurfaceProviderProbe } from './lib/surfaceProvider'
import { SceneNav } from './components/SceneNav'
import { BROWSER_GUIDE, DEMOS, demoFor, type DemoId } from './components/sceneCatalog'
import { SceneBoundary } from './components/SceneBoundary'
import { revealSite } from './components/siteOpening'
import { sceneUrl } from './captureMode'
import { DEMO_PAGES } from './demoPages'

// A home visit must not fetch or evaluate every lab. Keep Home eager; each
// other scene loads only in its own frame, with the same page and R3F roots.
const Workspace = lazy(() => import('./scenes/workspace/Workspace').then(m => ({ default: m.Workspace })))
const WorkspaceHud = lazy(() => import('./scenes/workspace/Workspace').then(m => ({ default: m.WorkspaceHud })))
const Glass = lazy(() => import('./scenes/glass/Glass').then(m => ({ default: m.Glass })))
const GlassTweakPanel = lazy(() => import('./scenes/glass/GlassTweaks').then(m => ({ default: m.GlassTweakPanel })))
const Explode = lazy(() => import('./scenes/explode/Explode').then(m => ({ default: m.Explode })))
const ExplodeHud = lazy(() => import('./scenes/explode/Explode').then(m => ({ default: m.ExplodeHud })))
const FisheyeApp = lazy(() => import('./scenes/fisheye/Fisheye').then(m => ({ default: m.FisheyeApp })))
const SliderApp = lazy(() => import('./scenes/slider/Slider').then(m => ({ default: m.SliderApp })))
const VeilApp = lazy(() => import('./scenes/veil/Veil').then(m => ({ default: m.VeilApp })))
const OpticsApp = lazy(() => import('./scenes/optics/Optics').then(m => ({ default: m.OpticsApp })))
const CandidatesApp = lazy(() => import('./scenes/candidates/Candidates').then(m => ({ default: m.CandidatesApp })))
const RefractionApp = lazy(() => import('./scenes/refraction/Refraction').then(m => ({ default: m.RefractionApp })))
const GalleryApp = lazy(() => import('./scenes/gallery/Gallery').then(m => ({ default: m.GalleryApp })))
const CrystalApp = lazy(() => import('./scenes/crystal/Crystal').then(m => ({ default: m.CrystalApp })))
const ControlsApp = lazy(() => import('./scenes/controls/Controls').then(m => ({ default: m.ControlsApp })))
const GravityApp = lazy(() => import('./scenes/gravity/Gravity').then(m => ({ default: m.GravityApp })))
const LampApp = lazy(() => import('./scenes/lamp/Lamp').then(m => ({ default: m.LampApp })))
const DistortionWaveApp = lazy(() => import('./scenes/distortion-wave/DistortionWave').then(m => ({ default: m.DistortionWaveApp })))
const RainApp = lazy(() => import('./scenes/rain/Rain').then(m => ({ default: m.RainApp })))
const StyleApp = lazy(() => import('./scenes/style/Style').then(m => ({ default: m.StyleApp })))
const WhyApp = lazy(() => import('./scenes/why/Why').then(m => ({ default: m.WhyApp })))
const PolymerPrototypeApp = lazy(() => import('./scenes/polymer-prototype/PolymerPrototype').then(m => ({ default: m.PolymerPrototypeApp })))
const MaterialFinishesApp = lazy(() => import('./scenes/material-finishes/MaterialFinishes').then(m => ({ default: m.MaterialFinishesApp })))
const FrontierPrototypeApp = lazy(() => import('./scenes/frontier-prototype/FrontierPrototype').then(m => ({ default: m.FrontierPrototypeApp })))
const BeyondPrototypeApp = lazy(() => import('./scenes/beyond-prototype/BeyondPrototype').then(m => ({ default: m.BeyondPrototypeApp })))
const SignaturePrototypeApp = lazy(() => import('./scenes/signature-prototype/SignaturePrototype').then(m => ({ default: m.SignaturePrototypeApp })))
const WordmarkApp = lazy(() => import('./scenes/wordmark/Wordmark').then(m => ({ default: m.WordmarkApp })))

// The promoted scene roster is decisions.md #75. URL-only studies stay beside
// it without claiming promotion: the candidates bench, refraction, gallery,
// crystal, and the controls / plume / marble-hand trio. Everything they render
// reaches the library through its published entries — this app is the proof
// that the public surface is sufficient.

const LAB_SCENES = [
  'workspace',
  'glass',
  'explode',
  'fisheye',
  'slider',
  'veil',
  'optics',
  'candidates',
  'refraction',
  'gallery',
  'crystal',
  'controls',
  'gravity',
  'lamp',
  'rain',
  'distortion-wave',
  'wordmark',
  'style',
  'why',
  'polymer-prototype',
  'material-finishes',
  'frontier-prototype',
  'beyond-prototype',
  'signature-prototype',
] as const

type SceneId = 'home' | DemoId | (typeof LAB_SCENES)[number]
const SCENES: readonly SceneId[] = ['home', ...DEMOS.map((demo) => demo.id), ...LAB_SCENES]


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
// without a human clicking a chip first.
const SCENE_IDS = new Set<string>(SCENES)

/** Whether a `?scene=` value names a scene this build ships. */
function isSceneId(value: string | null): value is SceneId {
  return value !== null && SCENE_IDS.has(value)
}

const DEMO_IDS = new Set<string>(DEMOS.map((demo) => demo.id))

function isDemoId(scene: SceneId): scene is DemoId {
  return DEMO_IDS.has(scene)
}

function readScene(): SceneId {
  const q = new URLSearchParams(window.location.search).get('scene')
  // Home is the landing page a cold visitor should see first. Every browser gate names its scene in the URL, so
  // none of them ride this default.
  return isSceneId(q) ? q : 'home'
}


const PAGE_SCENES = {
  fisheye: FisheyeApp,
  slider: SliderApp,
  veil: VeilApp,
  optics: OpticsApp,
  refraction: RefractionApp,
  gallery: GalleryApp,
  crystal: CrystalApp,
  controls: ControlsApp,
  wordmark: WordmarkApp,
  style: StyleApp,
  why: WhyApp,
  'polymer-prototype': PolymerPrototypeApp,
  'material-finishes': MaterialFinishesApp,
  'frontier-prototype': FrontierPrototypeApp,
  'beyond-prototype': BeyondPrototypeApp,
  'signature-prototype': SignaturePrototypeApp,
  candidates: CandidatesApp,
  gravity: GravityApp,
  lamp: LampApp,
  rain: RainApp,
  'distortion-wave': DistortionWaveApp,
} as const

/**
 * The scenes that ARE pages, with their own overlay canvas on top, rather
 * than content inside the one shared 3D room. They take the whole route;
 * `null` means the room renders it.
 */
function pageSceneFor(scene: SceneId) {
  if (scene === 'home') return <HomeApp />
  if (isDemoId(scene)) {
    const DemoPage = DEMO_PAGES[scene]
    return <DemoPage />
  }
  if (scene in PAGE_SCENES) {
    // SAFETY: `in` narrows `scene` to a key of `PAGE_SCENES`.
    const StudyPage = PAGE_SCENES[scene as keyof typeof PAGE_SCENES]
    return <StudyPage />
  }
  return null
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

const SITE_TITLES = {
  home: 'Munari · Live HTML in 3D',
  style: 'Style guide · Munari',
  why: 'Why Munari · Munari',
  'polymer-prototype': 'Polymer prototype · Munari',
  'material-finishes': 'Material finishes · Munari',
  'frontier-prototype': 'Frontier prototypes · Munari',
  'beyond-prototype': 'Beyond flat UI · Munari',
  'signature-prototype': 'Signature prototypes · Munari',
} as const
const SITE_LAZY_PAGES = {
  style: StyleApp,
  why: WhyApp,
  'polymer-prototype': PolymerPrototypeApp,
  'material-finishes': MaterialFinishesApp,
  'frontier-prototype': FrontierPrototypeApp,
  'beyond-prototype': BeyondPrototypeApp,
  'signature-prototype': SignaturePrototypeApp,
} as const
const OMITS_NOTICE = new Set<SceneId>(['home', 'why', 'polymer-prototype', 'material-finishes', 'frontier-prototype', 'beyond-prototype', 'signature-prototype', 'marble-hand', 'plume', 'postcard'])

function isSitePage(scene: SceneId): boolean {
  return scene in SITE_TITLES
}

function sceneDocumentTitle(scene: SceneId): string {
  if (scene in SITE_TITLES) {
    // SAFETY: `in` narrows `scene` to a key of `SITE_TITLES`.
    return SITE_TITLES[scene as keyof typeof SITE_TITLES]
  }
  return `${demoFor(scene)?.title ?? scene} · Munari`
}

function omitsTrialNotice(scene: SceneId): boolean {
  return OMITS_NOTICE.has(scene)
}

function renderSitePage(scene: SceneId) {
  if (scene === 'home') return <HomeApp onReady={revealSite} />
  if (scene in SITE_LAZY_PAGES) {
    // SAFETY: `in` narrows `scene` to a key of `SITE_LAZY_PAGES`.
    const Page = SITE_LAZY_PAGES[scene as keyof typeof SITE_LAZY_PAGES]
    return <Suspense fallback={null}><Page onReady={revealSite} /></Suspense>
  }
  return null
}

export default function App() {
  const unsupported = !useCaptureSupport()
  const [scene, setScene] = useState(readScene)
  const [, setSearch] = useState(() => window.location.search)

  // index.html paints the overview's white while this document is still
  // empty. Framed lab scenes keep their bench; the shell stays white.
  useLayoutEffect(() => {
    const style = document.documentElement.style
    const previous = style.getPropertyValue('--document-background')
    style.setProperty('--document-background', showShell || isSitePage(scene) ? '#fff' : 'var(--bench)')
    return () => { style.setProperty('--document-background', previous) }
  }, [scene])

  useEffect(() => {
    document.title = sceneDocumentTitle(scene)
  }, [scene])

  // …and the URL stays authoritative afterwards. Without this, navigating
  // by URL only works on a cold load: back/forward alone does not reload,
  // so the initializer above never runs again and the scene silently stays
  // put — the same screenshot twice, which is a very quiet way to draw the
  // wrong conclusion about a change you just made.
  useEffect(() => {
    const onPop = () => {
      setScene(readScene())
      setSearch(window.location.search)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
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
  // Measured that way on 2026-08-23, the five nav scenes of the time were all
  // 100%: flight, genie, logo and selection author a page copy, and knobs has
  // a degraded branch of its own (see `supported` in Knobs.tsx). The scenes
  // promoted since, and the URL-only scenes, have not been measured this way.

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
  // The overview holds no demo; Marble Hand, Plume, and Postcard explain
  // capability in their own UI.
  const notice =
    showChrome && unsupported && !omitsTrialNotice(scene) ? (
      <details className="trial-notice">
        <summary>Standard HTML mode</summary>
        <p className="hint">
          This browser doesn’t have HTML-in-canvas available. The page content
          still works, but this example’s 3D interaction needs the experimental API.{' '}
          <a href={BROWSER_GUIDE} target="_blank" rel="noreferrer">See Chrome’s setup guide.</a>
        </p>
      </details>
    ) : null

  // Full-width site pages (overview, style guide, Why Munari) have no sidebar.
  // Every demo assumes a window-sized canvas, so each keeps its own frame beside
  // navigation; replacing a frame avoids an extra joint-history entry.
  const sitePage = showShell ? renderSitePage(scene) : null
  if (sitePage !== null) {
    return <SceneBoundary key={scene} scene={scene}>{sitePage}</SceneBoundary>
  }
  if (showShell) {
    const frameSrc = sceneUrl(scene, { framed: true })
    return (
      <div className="site-shell">
        <a className="site-skip" href="#site-content" onClick={(event) => {
          event.preventDefault()
          document.getElementById('site-content')?.focus()
        }}>Skip to demo</a>
        <SceneNav
          active={scene}
          onSelect={(id) => {
            if (!isSceneId(id)) return
            window.history.pushState(null, '', sceneUrl(id))
            setScene(id)
            setSearch(window.location.search)
          }}
        />
        <main className="site-content" id="site-content" tabIndex={-1}>
          <iframe
            key={frameSrc}
            src={frameSrc}
            title={`${demoFor(scene)?.title ?? scene} demo`}
            className="site-frame"
            onLoad={revealSite}
          />
        </main>
      </div>
    )
  }


  const domSurfaceDemandProbe =
    scene === 'workspace' &&
    new URLSearchParams(window.location.search).get('probe') === 'dom-surface-demand'

  // The notice rides along rather than replacing the scene — see `unsupported`.
  const page = pageSceneFor(scene)
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
    <SceneBoundary key={scene} scene={scene}>
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
    </SceneBoundary>
  )
}
