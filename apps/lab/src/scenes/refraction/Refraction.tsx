// The refraction scene — one sheet of glass showing two live documents at
// once, the second one seen only through the first.
//
// The law: the page you are leaving IS the lens. Its own ink is the height
// field, and the page you are arriving at is sampled through that height's
// slope. Only one of the two Surfaces is ever presented. The other is a
// RESIDENT SOURCE — declared with content, no view, no `Surface.DOM`, no
// `Surface.WebGL` — and its pixels reach the shader by handle through
// `useSurfaceTextureOf` (decisions.md #36). Nothing in the scene graph
// draws it, and nothing in the document shows it.
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
// the arriving page at a uv the leaving page's slope decides. A framebuffer
// copy could not produce this picture even in principle, because the
// arriving page is drawn nowhere to copy from.
//
// Ownership: this module owns time, layout and the two handles. Shape
// belongs to `refractionLaw.ts`, numbers to `refractionTuning.ts`, pixels
// to `refractionShaders.ts`.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Surface,
  SurfaceCanvas,
  useSurface,
  useSurfaceState,
  useSurfaceTextureOf,
  useSurfaceUniforms,
  type SurfaceHandle,
} from '@petepetrash/munari'
import { cameraDistance } from '@petepetrash/munari/advanced'
import { showChrome } from '../../bareMode'
import { useInkField } from './refractionField'
import { RefractionTweaks } from './RefractionTweaks'
import { refractionStage } from './refractionLaw'
import { REFRACTION_FRAG, REFRACTION_VERT } from './refractionShaders'
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
    <div className="refraction-doc" style={{ width: STAGE_W, height: STAGE_H }}>
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

// ── the glass ──────────────────────────────────────────────────────────

interface RefractionDrive {
  /** Scrub position, 0 at the leaving page and 1 at the arriving one. */
  t: number
}

function RefractionMaterial({
  incoming,
  drive,
  center,
}: {
  incoming: SurfaceHandle
  drive: React.RefObject<RefractionDrive>
  /** Where the sheet stands, in world units, so the pointer can be put in its uv. */
  center: { wx: number; wy: number }
}) {
  const surface = useSurfaceUniforms()
  const arriving = useSurfaceTextureOf(incoming)
  const material = useRef<THREE.ShaderMaterial>(null)

  // The frame loop reads these; it cannot read a render closure.
  const arrivingRef = useRef(arriving)
  arrivingRef.current = arriving
  const outgoingSlot = surface.tMap

  // Registered before the frame write below, so the field the bend samples
  // is this frame's and not the one before it.
  const field = useInkField(outgoingSlot)

  // Initial values only. r3f 9.7 copies the `uniforms` prop entry by entry
  // into slots the material owns and re-runs only when the prop's identity
  // changes, so a per-frame write to this bag lands in an object nothing
  // samples (candidates/README.md gap 1). The frame writes below go through
  // the material's own slots, which is the channel that reaches the GPU.
  const uniforms = useMemo(
    () => ({
      ...surface,
      // Sampling the leaving page as its own stand-in keeps a valid texture
      // bound before the resident source publishes. `uHasIncoming` is 0 on
      // exactly those frames, so nothing of it survives the mix.
      tIncoming: { value: surface.tMap.value },
      uHasIncoming: { value: 0 },
      // The finite difference steps ONE CSS PIXEL either side, not one
      // texel: the amplitude in the tuning is stated in CSS px, and a step
      // that followed the texture's resolution would change the measured
      // gradient — and so the displacement — every time `resolution` moved.
      uTexel: { value: new THREE.Vector2(1 / STAGE_W, 1 / STAGE_H) },
      uRelief: { value: 0 },
      uTransmission: { value: 0 },
      uZoom: { value: tune.approachZoom },
      uAmplitude: { value: tune.amplitude },
      tField: { value: field.target.texture },
      uFieldTexel: { value: field.texel },
      tSpread: { value: field.spread.value },
      tHollow: { value: field.hollow.value },
      uDispersion: { value: tune.dispersion },
      uAspect: { value: STAGE_W / STAGE_H },
      uApertureFloor: { value: tune.apertureFloor },
      uApertureCeil: { value: tune.apertureCeil },
      uApertureInk: { value: tune.apertureInk },
      uApertureGamma: { value: tune.apertureGamma },
      uApertureOvershoot: { value: tune.apertureOvershoot },
      uApertureEdge: { value: tune.apertureEdgePx },
      uMaxBendPx: { value: tune.maxBendPx },
      uBendTaper: { value: tune.bendTaperPx },
      uSheenTransmit: { value: tune.sheenTransmit },
      // Centred until the hand says otherwise, so a sheet nobody has
      // pointed at is still lit rather than flat.
      uLight: { value: new THREE.Vector2(0.5, 0.5) },
      uLightFalloff: { value: tune.lightFalloff },
      uSpecPower: { value: tune.specPower },
      uSheenGain: { value: tune.sheenGain },
      uSheenAmount: { value: tune.sheenAmount },
    }),
    [surface, field],
  )

  useFrame((state) => {
    const u = material.current?.uniforms
    if (!u) return
    const stage = refractionStage(drive.current.t, tune)
    u.uRelief.value = stage.relief
    u.uTransmission.value = stage.transmission
    u.uZoom.value = stage.zoom

    // Every tuned uniform, every frame. The panel writes into the bag and
    // nothing tells the material about it, so re-reading is the whole
    // subscription — and it costs a handful of assignments.
    u.uAmplitude.value = tune.amplitude
    u.uMaxBendPx.value = tune.maxBendPx
    u.uBendTaper.value = tune.bendTaperPx
    u.uDispersion.value = tune.dispersion
    // Each chain alternates between two targets, so the answer is different
    // every frame even though nothing about the material changed.
    u.tSpread.value = field.spread.value
    u.tHollow.value = field.hollow.value
    u.uApertureFloor.value = tune.apertureFloor
    u.uApertureCeil.value = tune.apertureCeil
    u.uApertureInk.value = tune.apertureInk
    u.uApertureGamma.value = tune.apertureGamma
    u.uApertureOvershoot.value = tune.apertureOvershoot
    u.uApertureEdge.value = tune.apertureEdgePx
    u.uSheenGain.value = tune.sheenGain
    u.uSheenAmount.value = tune.sheenAmount
    u.uSheenTransmit.value = tune.sheenTransmit
    u.uLightFalloff.value = tune.lightFalloff
    u.uSpecPower.value = tune.specPower
    const texture = arrivingRef.current
    u.tIncoming.value = texture ?? outgoingSlot.value
    u.uHasIncoming.value = texture ? 1 : 0
    // `useSurfaceUniforms` refreshes its own `tMap` slot every render, but
    // the material holds a copy of that slot — so a source replaced mid-life
    // would leave the sheet drawing the disposed texture.
    u.tMap.value = outgoingSlot.value

    // The pointer, put in the sheet's own uv. Off the panel is a legal
    // answer — the light rakes in from the side and the falloff dims it.
    // Sized from `state.size` rather than `state.viewport`, because the
    // pixel-perfect camera is set in an effect and r3f may still be holding
    // the frustum it computed before that ran.
    const px = (state.pointer.x * state.size.width) / 2 - center.wx
    const py = (state.pointer.y * state.size.height) / 2 - center.wy
    u.uLight.value.set(px / STAGE_W + 0.5, py / STAGE_H + 0.5)
  })

  return (
    <shaderMaterial
      ref={material}
      uniforms={uniforms}
      vertexShader={REFRACTION_VERT}
      fragmentShader={REFRACTION_FRAG}
      transparent
      premultipliedAlpha
      depthWrite={false}
      toneMapped={false}
    />
  )
}

// ── the page ───────────────────────────────────────────────────────────

export function RefractionApp({ chips }: { chips?: React.ReactNode }) {
  const outgoing = useSurface({ name: 'refraction-square' })
  const incoming = useSurface({ name: 'refraction-circle' })
  const st = useSurfaceState(outgoing)

  const [t, setT] = useState(0)
  const [running, setRunning] = useState(false)
  const [form, setForm] = useState<FormKind>('square')
  const holderRef = useRef<HTMLDivElement>(null)
  const drive = useRef<RefractionDrive>({ t: 0 })
  drive.current.t = t

  // Above zero the sheet is matter and the mesh owns the pixels; at exactly
  // zero it is ordinary DOM again, selectable and hit-testable by the
  // browser. So the leaving page lands back into the compositor's hold every
  // time the scrub returns to its start.
  const lifted = t > 0 || running

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
      setT(from + (to - from) * p)
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

  // No controls: nothing can reach this document. It is sampled, never
  // presented, so there is no mesh to point at and no relay to carry a
  // click into it (docs/spikes/cross-surface-sampling.md, still unknown #2).
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
            Two documents, one sheet. The page you are leaving is the lens:
            its own ink is the height field, and the page you are arriving
            at is bent through it. The arriving page is drawn nowhere —
            it has no mesh and no DOM presenter, and the shader reads its
            texture by handle. Park the scrub anywhere: both clocks keep
            running, because both captures are still live layouts.
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
          <Surface
            surface={outgoing}
            view={lifted ? 'webgl' : 'dom'}
            timing={{ settleMs: 0, durationMs: 1 }}
            size={[STAGE_W, STAGE_H]}
            source={leaving}
          >
            <Surface.DOM>{leaving}</Surface.DOM>
          </Surface>

          {/* The resident source. Content and a size, and nothing else: no
              `view`, so it never crosses; no presenter, so it is composited
              nowhere. It exists to be sampled. */}
          <Surface surface={incoming} size={[STAGE_W, STAGE_H]} source={arriving} />
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
        {st.isWebGLMounted && pos && (
          <group position={[pos.wx, pos.wy, 0]}>
            <Surface.WebGL
              surface={outgoing}
              placement="manual"
              alpha="source"
              frustumCulled={false}
              geometry={<planeGeometry args={[STAGE_W, STAGE_H]} />}
              material={
                <RefractionMaterial incoming={incoming} drive={drive} center={pos} />
              }
            />
          </group>
        )}
      </SurfaceCanvas>

      {showChrome && <RefractionTweaks />}
      {chips}
    </div>
  )
}
