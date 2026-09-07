// The refraction scene — one sheet of glass showing two live documents at
// once, the second one seen only through the first.
//
// The law: the page you are leaving decides WHERE a drop of glass opens,
// and the page you are arriving at is seen through that drop. The leaving
// page's ink grows a front; the front is the drop's contact line; the
// arriving page is refracted by the meniscus and reads straight through the
// flat middle. At most one of the two Surfaces is presented at a time, and
// while the drop is open NEITHER is: the sheet belongs to the mesh and both
// documents are RESIDENT SOURCES — declared with content, no view, no
// `Surface.DOM`, no `Surface.Mesh` — whose pixels reach the shader by handle
// through `useSurfaceTextureOf` (decisions.md #36). Nothing in the scene
// graph draws a resident source and nothing in the document shows it.
//
// The two trade roles at the ends. The crossing lifts off the leaving page
// and LANDS on the arriving one, which becomes ordinary DOM the browser
// hit-tests, focuses and selects. Skipping that landing is why a GL layer
// used to sit over the page forever (Pete, 2026-08-22): the words a viewer
// had just watched arrive could not be selected, because they had never been
// anywhere but a texture.
//
// The fault this scene exists to press on: a transition between two views
// is normally a crossfade between two *pictures*, because only one of the
// two can be a live layout at a time. Everything else — screen grabs, CSS
// view transitions, a render target of a second scene — freezes the
// arriving view the moment the transition starts. Measured 2026-08-22
// (docs/spikes/cross-surface-sampling.md): a Surface with zero presenters
// still rasterizes and uploads, its `texture.version` climbing 175 → 318
// over 1.2s, under both `frameloop` modes. Both documents here run a
// shared clock at 10Hz, and both readouts are visible mid-crossing — if
// the arriving one lags the leaving one, that capture stopped painting.
//
// The correspondence is content-space, not screen-space: the shader picks
// the arriving page at a uv the leaving page's ink decides. A framebuffer
// copy could not produce this picture even in principle, because the
// arriving page is drawn nowhere to copy from.
//
// Ownership: this module owns time, layout and the two handles. The sheet
// itself is `refractionMaterial.tsx`, which the gallery scene mounts too.
// Shape belongs to `refractionLaw.ts`, numbers to `refractionTuning.ts`,
// pixels to `refractionShaders.ts`.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Surface,
  SurfaceCanvas,
  useSurfaceHandle,
} from '@petepetrash/munari'
import { cameraDistance } from '@petepetrash/munari/advanced'
import { showChrome } from '../../bareMode'
import { RefractionTweaks } from './RefractionTweaks'
import { springEase } from './refractionLaw'
import {
  RefractionMaterial,
  type RefractionDrive,
} from './refractionMaterial'
import {
  refractionTuning as tune,
  STAGE_H,
  STAGE_W,
} from './refractionTuning'
import './refraction.css'

const FOV = 42

// ── the shared clock ───────────────────────────────────────────────────

// One epoch for every copy of every document, so the two readouts print
// the SAME string at the same instant. Two independent counters would
// drift by a tick and a stalled capture would be indistinguishable from
// ordinary drift — the whole liveness claim rests on them agreeing.
const EPOCH = performance.now()

function useTenthSecond(): string {
  const [, bump] = useState(0)
  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [])
  return ((performance.now() - EPOCH) / 1000).toFixed(1)
}

// ── the two documents ──────────────────────────────────────────────────

type FormKind = 'square' | 'circle' | 'grid'

const FORMS: readonly { id: FormKind; label: string }[] = [
  { id: 'square', label: 'quadrato' },
  { id: 'circle', label: 'cerchio' },
  { id: 'grid', label: 'griglia' },
]

function Figure({ form }: { form: FormKind }) {
  if (form === 'grid') {
    return (
      <div className="refraction-grid">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} data-on={i % 2 === 0 || undefined} />
        ))}
      </div>
    )
  }
  return <div className="refraction-form" data-form={form} />
}

function Doc({
  mark,
  eyebrow,
  title,
  columns,
  form,
  folio,
  controls,
}: {
  mark: string
  eyebrow: string
  title: string
  columns: readonly [string, string]
  form: FormKind
  folio: string
  controls?: React.ReactNode
}) {
  const tick = useTenthSecond()
  return (
    <div className="refraction-doc" data-doc={mark} style={{ width: STAGE_W, height: STAGE_H }}>
      <div className="refraction-eyebrow">
        <b>{mark}</b>
        <span>{eyebrow}</span>
      </div>
      <h3 className="refraction-title">{title}</h3>
      <div className="refraction-rule" />
      <div className="refraction-body">
        <p className="refraction-col">{columns[0]}</p>
        <p className="refraction-col">{columns[1]}</p>
        <div className="refraction-figure">
          <Figure form={form} />
        </div>
      </div>
      {controls}
      <div className="refraction-foot">
        <span className="refraction-folio">{folio}</span>
        <span className="refraction-tick">
          <i>live</i>
          {tick}s
        </span>
      </div>
    </div>
  )
}

const SQUARE_COLUMNS = [
  'Il quadrato non esiste in natura. È una forma che l’uomo ha costruito, ' +
    'e per questo la riconosce subito come un segno: quattro lati uguali, ' +
    'quattro angoli retti, nessuna direzione preferita.',
  'Ruotato di quarantacinque gradi diventa un rombo e cambia nome, pur ' +
    'restando lo stesso oggetto. La percezione non misura: giudica.',
] as const

const CIRCLE_COLUMNS = [
  'Il cerchio è invece dappertutto: il sole, la pupilla, l’onda che si ' +
    'allarga nell’acqua. Non ha lati da contare e non ha un verso in cui ' +
    'stare, perché ogni sua rotazione lo lascia identico a se stesso.',
  'Dove il quadrato dichiara una costruzione, il cerchio dichiara un ' +
    'movimento. È la forma che si ottiene quando nulla ferma il compasso.',
] as const

// ── the camera: 1 world unit = 1 CSS px ────────────────────────────────

function PixelPerfect() {
  // SAFETY: r3f types the store's camera as the base class and hands back a
  // PerspectiveCamera unless the Canvas asks for `orthographic`, which this
  // one does not — fitting the frustum to the viewport is what makes a CSS
  // pixel a world unit, and orthographic has no fov to fit.
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  useEffect(() => {
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(size.height, FOV))
    camera.near = 1
    camera.far = camera.position.z * 3
    camera.updateProjectionMatrix()
  }, [camera, size.height])
  return null
}

// ── the page ───────────────────────────────────────────────────────────

export function RefractionApp() {
  const surface = useSurfaceHandle('refraction')

  const [t, setT] = useState(0)
  const [running, setRunning] = useState(false)
  const [form, setForm] = useState<FormKind>('square')
  const holderRef = useRef<HTMLDivElement>(null)
  const drive = useRef<RefractionDrive>({ t: 0 })
  drive.current.t = t

  // Which document the compositor is holding, if either. At both ends of
  // the crossing one of them is ordinary DOM — selectable, focusable, and
  // hit-tested by the browser — and the other is a resident source. In
  // between the answer is NEITHER: the mesh owns the sheet and both
  // documents feed it by handle.
  //
  // Landing on the far side is the half this scene skipped until Pete's
  // report on 2026-08-22. A crossing that lifts and never lands leaves a GL
  // layer over the page forever, and the words a viewer just watched arrive
  // cannot be selected, because they were never anywhere but a texture.
  const landed: 'leaving' | 'arriving' | null =
    running ? null : t === 0 ? 'leaving' : t === 1 ? 'arriving' : null
  const lifted = landed === null

  // The animated crossing. Driven from `requestAnimationFrame` rather than
  // the renderer's frame because it also moves the scrub input, which is
  // page DOM — the material reads `drive.current` and never waits on React.
  useEffect(() => {
    if (!running) return
    const from = t
    const to = from < 0.5 ? 1 : 0
    const span = tune.crossingMs * Math.abs(to - from)
    const start = performance.now()
    let raf = 0
    const step = () => {
      const p = span <= 0 ? 1 : Math.min(1, (performance.now() - start) / span)
      // Eased here rather than inside the law: the law is a function of the
      // scrub, and the scrub is also a slider a hand drags. Easing it there
      // would bend the hand's own timing and move where a parked scrub sits.
      setT(from + (to - from) * springEase(p, tune.crossingSpring))
      if (p < 1) raf = requestAnimationFrame(step)
      else setRunning(false)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // Deliberately not depending on `t`: the effect reads the start value
    // once and owns `t` until it finishes. Re-running on every write would
    // restart the crossing from wherever it had got to, forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  // The mesh stands where the page copy's layout box is. Measured, not
  // authored: the stage is centered by CSS and its center moves with the
  // viewport.
  const [pos, setPos] = useState<{ wx: number; wy: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const r = holderRef.current?.getBoundingClientRect()
      if (!r) return
      setPos({
        wx: r.left + r.width / 2 - window.innerWidth / 2,
        wy: window.innerHeight / 2 - (r.top + r.height / 2),
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const leaving = useMemo(
    () => (
      <Doc
        mark="I"
        eyebrow="scoperta"
        title="Il quadrato"
        columns={SQUARE_COLUMNS}
        form={form}
        folio="munari — 1960"
        controls={
          <div className="refraction-forms">
            {FORMS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="refraction-formbtn"
                data-on={form === f.id || undefined}
                onClick={() => setForm(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      />
    ),
    [form],
  )

  // No controls, because for most of the crossing nothing can reach this
  // document: while it is a resident source there is no mesh to point at and
  // no relay to carry a click into it (docs/spikes/cross-surface-sampling.md,
  // still unknown #2). It is directly interactive only once the crossing has
  // landed on it, which is a presented Surface like any other.
  const arriving = useMemo(
    () => (
      <Doc
        mark="II"
        eyebrow="scoperta"
        title="Il cerchio"
        columns={CIRCLE_COLUMNS}
        form="circle"
        folio="munari — 1964"
      />
    ),
    [],
  )

  return (
    <div className="refraction-page">
      <div className="refraction-stage">
        <div className="refraction-caption">
          <h2>refraction</h2>
          <p>
            Two documents, one sheet. A drop of glass spreads out of the
            leaving page&rsquo;s own ink, and the page you are arriving at is
            what you see inside it — bent at the meniscus, straight through
            the middle. While the drop is open the arriving page is drawn
            nowhere: no mesh, no DOM presenter, and the shader reads its
            texture by handle. Land the crossing and it becomes ordinary DOM
            you can select. Park the scrub anywhere in between and both
            clocks keep running, because both captures are still live
            layouts.
          </p>
          <div className="refraction-drive">
            <div className="refraction-row">
              <span className="refraction-label">scrub</span>
              <input
                className="refraction-scrub"
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={t}
                disabled={running}
                onChange={(e) => setT(Number(e.target.value))}
                aria-label="crossing position"
              />
              <span className="refraction-readout">{t.toFixed(2)}</span>
            </div>
            <div className="refraction-row">
              <span className="refraction-label">run</span>
              <button
                type="button"
                className="refraction-cross"
                disabled={running}
                onClick={() => setRunning(true)}
              >
                {t < 0.5 ? 'cross' : 'return'}
              </button>
            </div>
          </div>
        </div>

        <div ref={holderRef} className="refraction-holder">
          <Surface.Root surface={surface} inScene={lifted} timing={{ settleMs: 0, durationMs: 1 }}>
            <Surface.HTML part="leaving" hidden={landed === 'arriving'} size={[STAGE_W, STAGE_H]}>{leaving}</Surface.HTML>
            <Surface.HTML part="arriving" hidden={landed !== 'arriving'} size={[STAGE_W, STAGE_H]}>{arriving}</Surface.HTML>
          </Surface.Root>
        </div>
      </div>

      <SurfaceCanvas
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0 }}
        gl={{ alpha: true, antialias: true }}
        frameloop={lifted ? 'always' : 'demand'}
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => {
          state.gl.setClearAlpha(0)
          window.__r3f = state
        }}
      >
        <PixelPerfect />
        {/* The custom scene subtree is active only during the business
            interaction. The declared meshes retain their own handoff
            lifetime, including preparation and return. */}
        {pos && (
          <Surface.Scene surface={surface}>
          <group position={[pos.wx, pos.wy, 0]}>
            <Surface.Mesh
              surface={surface}
              part="leaving"
              sampledParts={['arriving']}
              placement="manual"
              alpha="source"
              frustumCulled={false}
              geometry={<planeGeometry args={[STAGE_W, STAGE_H]} />}
              material={
                <RefractionMaterial
                  incoming={surface}
                  incomingPart="arriving"
                  drive={drive}
                  tune={tune}
                  stageW={STAGE_W}
                  stageH={STAGE_H}
                />
              }
            />
          </group>
          </Surface.Scene>
        )}
      </SurfaceCanvas>

      {showChrome && <RefractionTweaks />}
    </div>
  )
}
