// The wake scene — navigation as an event in a medium.
//
// THE CLAIM. Every page transition the web can express is a composite of two
// pictures. A cross-fade interpolates their opacity; a clip-path reveal cuts
// one out of the other; View Transitions photographs the old page and animates
// the photograph. In all three the pixels being animated stopped being a page
// the moment the transition started, and the compositor is moving a rectangle
// of colour that used to be one.
//
// Here the boundary between two routes is a WAVE. It is not authored anywhere:
// there is no keyframe, no easing curve on a mask, no `::view-transition-*`
// rule in wake.css. There is a height field in a render target, stepped by the
// wave equation, and both routes are sampled THROUGH it — displaced by its
// gradient, split into red and blue by its slope, lit along its crests. The
// front the new page arrives behind is a circle whose radius is offset by the
// height of the water it is crossing, so it runs ahead of itself on a swell
// and lags in a trough.
//
// And both pages are still pages the entire time. The counter in each sidebar
// is driven by that route's own requestAnimationFrame loop, so a screenshot
// taken mid-transition shows two DIFFERENT routes, on screen simultaneously,
// with two DIFFERENT numbers, both advancing — separated by a refracting
// boundary. Click into the search field of the arriving page while it is still
// arriving and the caret blinks under the water, because a caret is a paint
// and a paint is the upload signal.
//
// WHAT IS ACTUALLY IMPOSSIBLE HERE, precisely, since "impossible" is a claim
// worth being careful about:
//
//   - Sampling another element's rendering at a DISPLACED coordinate. CSS has
//     no primitive for it. `backdrop-filter` can blur what is behind, but it
//     cannot move it, and it cannot move it by an amount that came from a
//     simulation. SVG's feDisplacementMap can — of a static image, from a
//     static map, and not of a live interactive subtree.
//   - Two live DOM trees composited by a per-pixel rule. Two stacked live
//     pages can be cross-faded, but the cut between them must be a shape CSS
//     can describe. This one is described by the contents of a texture that
//     did not exist a frame ago.
//   - Chromatic dispersion of live text. There is no CSS channel-splitting
//     model at all.
//
// The rest of the file is a docs site with a three-item sidebar.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SurfaceApp, cameraDistance, useSurfaceTexture } from '@petekp/munari'
import {
  FIELD_SIM_FRAG,
  FIELD_VERT,
  PAGE_FRAG,
  WAVE_C2,
  WAVE_DAMPING,
  settleSteps,
} from './wakeField'
import './wake.css'

// ── the handbook ─────────────────────────────────────────────────────────

interface Block {
  kind: 'p' | 'h2' | 'code' | 'table' | 'cards'
  text?: string
  code?: string
  rows?: [string, string][]
  cards?: [string, string][]
}

interface Doc {
  id: string
  crumb: string
  title: string
  lede: string
  blocks: Block[]
  next: string
}

const DOCS: Doc[] = [
  {
    id: 'surface',
    crumb: 'primitives',
    title: 'Surface',
    lede: 'A piece of live DOM with a position in space. Not a screenshot of one, and not a DOM-shaped thing drawn with triangles — the real subtree, laid out and painted by the browser, arriving as a texture on the frame it changes.',
    blocks: [
      { kind: 'h2', text: 'usage' },
      {
        kind: 'code',
        code: `import { SurfaceApp } from '@petekp/munari'

// The subtree is parked off-document and drawn from there.
// Everything inside it is ordinary React.
<SurfaceApp width={420} height={280} resolution={2}>
  <Panel onSubmit={save} />
</SurfaceApp>`,
      },
      { kind: 'h2', text: 'what it costs' },
      {
        kind: 'p',
        text: 'A Surface that is not changing costs nothing. There is no repaint loop and no MutationObserver anywhere in the library — the compositor fires a paint signal by itself whenever the subtree’s paint record changes, and that signal is the upload.',
      },
      {
        kind: 'table',
        rows: [
          ['idle', '0 paints / second'],
          ['typing', '1 upload per keystroke'],
          ['animating', '~64–96 concurrent at 120 Hz'],
        ],
      },
      { kind: 'h2', text: 'the one rule' },
      {
        kind: 'p',
        text: 'Never animate opacity or transform on the drawn root — changing them does not invalidate its paint record, so nothing repaints. On descendants both work correctly.',
      },
    ],
    next: 'paint',
  },
  {
    id: 'paint',
    crumb: 'internals',
    title: 'The paint signal',
    lede: 'Everything in the library hangs off one question: how does a texture know its DOM changed? The answer is that it does not have to ask. The compositor already knows, because it is the thing that decided to repaint.',
    blocks: [
      { kind: 'h2', text: 'the loop that is not there' },
      {
        kind: 'code',
        code: `// Passive by construction. No rAF, no observer, no dirty flag.
canvas.onpaint = () => {
  // The paint record changed. That is the whole event.
  texture.needsUpdate = true
}`,
      },
      {
        kind: 'p',
        text: 'A dirty-flag heuristic has to guess, and every guess is wrong in one of two directions: it misses a change, or it uploads a frame that was identical. Both were measured, and both were worse than doing nothing.',
      },
      { kind: 'h2', text: 'storage is immutable' },
      {
        kind: 'p',
        text: 'GL allocates a texture once and writes into it afterwards. A source that resizes every frame outruns that: the upload is rejected, the old texels stay, and nothing raises. So the allocation is reconciled by comparison at upload time, and the backing store floats inside a density band instead of tracking the box exactly.',
      },
      {
        kind: 'cards',
        cards: [
          ['a mark is a promise', 'A deferred realloc re-armed by every commit chases its own tail forever.'],
          ['a comparison is a fact', 'Ask what is allocated, ask what is here, act on the difference.'],
        ],
      },
    ],
    next: 'pointer',
  },
  {
    id: 'pointer',
    crumb: 'internals',
    title: 'The pointer relay',
    lede: 'A Surface has no pointer of its own. A ray hits a quad, the hit becomes a coordinate in the parked subtree, and the subtree is told a pointer arrived — in the full vocabulary a real one would use, including the parts nobody remembers.',
    blocks: [
      { kind: 'h2', text: 'provenance' },
      {
        kind: 'code',
        code: `// Every synthetic event leaves through one door, branded.
window.addEventListener('pointermove', (e) => {
  if (!e.isTrusted) return   // the retellings bubble here by design
  orbit(e)
})`,
      },
      {
        kind: 'p',
        text: 'The retellings reach the document on purpose: that is where every floating-UI library keeps its grace areas, and stopping them would break the thing they exist to serve. So provenance is the listener’s job.',
      },
      { kind: 'h2', text: 'the vocabulary' },
      {
        kind: 'table',
        rows: [
          ['pointer / mouse', 'down, move, up, and the click that follows'],
          ['boundary', 'enter, leave — per element crossed, non-bubbling'],
          ['departure', 'a burst of moves after the leave, not one'],
          ['keyboard', 'never — the real one is already there'],
        ],
      },
      {
        kind: 'p',
        text: 'A departure sent as a single event is a pointer that teleported. Consumers arm their close listeners on the leave and then wait for moves that a discrete exit never sends, so the burst is load-bearing.',
      },
    ],
    next: 'surface',
  },
]

const KEYWORDS = new Set([
  'import',
  'from',
  'const',
  'let',
  'return',
  'if',
  'function',
  'new',
  'await',
  'export',
  'default',
])

/** A five-line highlighter. Dense high-contrast edges are the best possible
 *  subject for a refraction — a displacement of three pixels is legible in a
 *  code block and invisible in a paragraph. */
function Code({ src }: { src: string }) {
  const parts = useMemo(
    () =>
      src.split(
        /(\/\/[^\n]*|'[^']*'|\b(?:import|from|const|let|return|if|function|new|await|export|default)\b|\b\d+(?:\.\d+)?\b)/g,
      ),
    [src],
  )
  return (
    <pre className="wk-code">
      {parts.map((p, i) => {
        if (!p) return null
        const cls = p.startsWith('//')
          ? 'c'
          : p.startsWith("'")
            ? 's'
            : KEYWORDS.has(p)
              ? 'k'
              : /^\d/.test(p)
                ? 'n'
                : undefined
        return (
          <span key={i} className={cls}>
            {p}
          </span>
        )
      })}
    </pre>
  )
}

// ── the liveness instrument ──────────────────────────────────────────────
//
// A counter per mounted route, driven by a single rAF pump. Mid-crossing
// there are two of them, in two parked subtrees, painting two DIFFERENT
// numbers — the departing page has been counting since it arrived, the
// arriving one starts at zero — and both go up. A photograph of either would
// be a constant, which is the entire difference this scene exists to show.
//
// The pump only counts WHILE THE WATER IS MOVING, and that is not a dodge, it
// is the same discipline as everything else here: a counter that ticks at
// rest would repaint a full-window Surface 120 times a second forever, and
// this library's central claim is that an idle Surface costs nothing. So the
// instrument runs exactly when there is something to doubt. At rest the water
// is still, the numbers are still, and the caret in the search field is the
// standing proof — it blinks, a blink is a paint, and a paint is an upload.

let moving: () => boolean = () => false
let pumping = 0
const tickers = new Set<() => void>()

function pump() {
  if (moving()) for (const l of tickers) l()
  pumping = requestAnimationFrame(pump)
}

function subscribeTick(l: () => void) {
  tickers.add(l)
  if (tickers.size === 1) pumping = requestAnimationFrame(pump)
  return () => {
    tickers.delete(l)
    if (tickers.size === 0) cancelAnimationFrame(pumping)
  }
}

/** Frames this route has been alive for, counted from its own mount. */
function useTick(): number {
  const [n, setN] = useState(0)
  useEffect(() => subscribeTick(() => setN((v) => v + 1)), [])
  return n
}

// ── the page, as ordinary DOM ────────────────────────────────────────────

function DocView({
  doc,
  route,
  onGo,
  width,
  height,
}: {
  doc: Doc
  route: string
  onGo: (id: string) => void
  width: number
  height: number
}) {
  const frame = useTick()
  return (
    // The root declares its own pixel size. A parked subtree has no viewport
    // to fill — `100vw` inside one is the PAGE's width, which is a number
    // about something else entirely.
    <div className="wk" style={{ width, height }}>
      <aside className="wk-side">
        <div className="wk-brand">
          <b>munari</b>
          <span>handbook</span>
        </div>

        <input className="wk-search" placeholder="search the handbook" spellCheck={false} />

        <nav className="wk-nav">
          <div className="wk-navhead">reference</div>
          {DOCS.map((d) => (
            <button
              key={d.id}
              className="wk-link"
              data-current={String(d.id === route)}
              onClick={() => onGo(d.id)}
            >
              <i />
              {d.title}
            </button>
          ))}
        </nav>

        <div className="wk-meta">
          <b>{doc.id}</b> · frames <b>{frame}</b>
          <br />
          counted by this page, while the water moves
        </div>
      </aside>

      <main className="wk-main">
        <article className="wk-doc">
          <div className="wk-crumbs">
            <span>{doc.crumb}</span>
            <span>/</span>
            <b>{doc.id}</b>
          </div>
          <h1>{doc.title}</h1>
          <p className="wk-lede">{doc.lede}</p>

          {doc.blocks.map((b, i) => {
            if (b.kind === 'h2') return <h2 key={i}>{b.text}</h2>
            if (b.kind === 'p') return <p key={i}>{b.text}</p>
            if (b.kind === 'code') return <Code key={i} src={b.code!} />
            if (b.kind === 'cards')
              return (
                <div className="wk-cards" key={i}>
                  {b.cards!.map(([t, s]) => (
                    <div className="wk-card" key={t}>
                      <b>{t}</b>
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              )
            return (
              <table className="wk-table" key={i}>
                <thead>
                  <tr>
                    <th>what</th>
                    <th>and</th>
                  </tr>
                </thead>
                <tbody>
                  {b.rows!.map(([a, c]) => (
                    <tr key={a}>
                      <td>{a}</td>
                      <td>{c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          })}

          <button className="wk-next" onClick={() => onGo(doc.next)}>
            <em>next</em>
            {DOCS.find((d) => d.id === doc.next)?.title}
          </button>
        </article>
      </main>
    </div>
  )
}

// ── the water ────────────────────────────────────────────────────────────

/** Field texels per screen pixel, inverted: one texel every three pixels.
 *  The field is a low-frequency thing — it is sampled bilinearly by a page
 *  pass running at full device resolution, so its own resolution buys
 *  wavelength, not sharpness. */
const FIELD_SCALE = 3

// Every one of these was set by looking at the screen, and two of them were
// set TWICE — the first pass read as numbers rather than as light. The
// shader's additive terms land in LINEAR space and are encoded on the way
// out, so a term of 0.24 over a page whose background is 0.03 arrives as a
// mid-grey band: +0.24 linear is 0.56 after the sRGB transfer. Anything
// added to this page has to be judged after that curve, not before it.
//
// The sheen was set twice for a second reason worth writing down. The white
// arc it made was read as the front's own crest and tuned as if it were —
// wrongly. Sampling the radius told the truth: the ripple from the drop
// travels at the simulation's wave speed and had reached almost exactly the
// front's radius at the moment of the capture, so the two were on top of
// each other. The number that was too high belonged to the other term.
/** Peak refraction, px. */
const REFRACT = 52
/** How far the height field displaces the front's radius, px. */
const WARP = 60
/** The crest's width, px. */
const BAND = 11
const DISPERSION = 0.14
const SHEEN = 0.18
/** Normalized on the CPU so the shader never has to. */
const LIGHT: [number, number] = [0.55, 0.835]

/** How long the front takes to cross the window, seconds. */
const CROSSING = 1.05

/**
 * The scene's instrument panel, reachable as `__wake.debug`. Inert at its
 * default.
 *
 * `hold` parks a crossing at a fixed fraction of its path so a capture can be
 * taken at a chosen point rather than at whatever moment a screenshot command
 * happened to land — the difference between a regression capture and a
 * souvenir.
 */
const debug: { hold: number | null } = { hold: null }

interface Wave {
  texture: THREE.Texture | null
  texel: THREE.Vector2
  /** Field size in texels — a drop's radius is measured in these. */
  size: THREE.Vector2
  /** One slot: a second drop in the same frame replaces the first. */
  pending: [u: number, v: number, radiusTexels: number, depth: number] | null
  /** Steps of simulation left before the field is flat enough to stop. */
  left: number
}

interface Stage {
  wave: Wave
  /** xy = the front's centre in uv, r = its radius in px, max = the corner. */
  front: { x: number; y: number; r: number; max: number; on: boolean }
  /** The arriving page has real pixels. Nothing moves before this. */
  painted: boolean
}

function makeStage(): Stage {
  return {
    wave: {
      texture: null,
      texel: new THREE.Vector2(1, 1),
      size: new THREE.Vector2(1, 1),
      pending: null,
      left: 0,
    },
    front: { x: 0.5, y: 0.5, r: 0, max: 0, on: false },
    painted: false,
  }
}

function drop(stage: Stage, u: number, v: number, radiusPx: number, depth: number) {
  const w = stage.wave
  w.pending = [u, v, radiusPx / FIELD_SCALE, depth]
  // Sized to THIS disturbance. A tap that barely dents the surface does not
  // earn the same settle window as a navigation, and the difference is not a
  // guess — it is where the decay curve for that amplitude crosses the floor.
  w.left = Math.max(w.left, settleSteps(WAVE_DAMPING, depth))
}

function useTarget(w: number, h: number) {
  const target = useMemo(
    () =>
      new THREE.WebGLRenderTarget(1, 1, {
        // Linear, because the page pass samples this between texels: with
        // NEAREST the reconstructed normal is piecewise constant and the
        // refraction comes out in visible three-pixel blocks.
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        // Half float and not 8-bit: the state holds h and its previous value,
        // and the scheme is a DIFFERENCE of two nearly equal numbers. Eight
        // bits quantizes that difference to zero and the wave simply does not
        // propagate — it sits where it was dropped and fades.
        type: THREE.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
      }),
    [],
  )
  useLayoutEffect(() => {
    target.setSize(w, h)
  }, [target, w, h])
  useEffect(() => () => target.dispose(), [target])
  return target
}

/**
 * The simulation. Two targets, read one, write the other, swap.
 *
 * It runs at priority 0 and restores the default render target before
 * returning, so r3f's own render still happens afterwards in the ordinary way
 * — this is a pass that happens BEFORE the frame, not a takeover of it.
 */
function WaveSim({ stage }: { stage: Stage }) {
  const size = useThree((s) => s.size)
  const fw = Math.max(8, Math.round(size.width / FIELD_SCALE))
  const fh = Math.max(8, Math.round(size.height / FIELD_SCALE))
  const a = useTarget(fw, fh)
  const b = useTarget(fw, fh)
  const io = useRef({ read: a, write: b })

  const [scene, material, cam] = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uState: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uC2: { value: WAVE_C2 },
        uDamping: { value: WAVE_DAMPING },
        uDrop: { value: new THREE.Vector4(0, 0, 0, 0) },
      },
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_SIM_FRAG,
      depthTest: false,
      depthWrite: false,
    })
    const s = new THREE.Scene()
    s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat))
    return [s, mat, new THREE.Camera()] as const
  }, [])

  useEffect(() => () => material.dispose(), [material])

  // The field is published before any frame runs, so a page material that
  // samples it on frame one finds a real texture rather than a null sampler.
  useLayoutEffect(() => {
    stage.wave.texel.set(1 / fw, 1 / fh)
    stage.wave.size.set(fw, fh)
    stage.wave.texture = io.current.read.texture
  }, [stage, fw, fh])

  // A fresh render target holds whatever was in that memory. Clearing both to
  // zero is what makes "at rest" mean flat water rather than noise — and it
  // has to happen again on every resize, because setSize reallocates.
  const gl = useThree((s) => s.gl)
  useLayoutEffect(() => {
    const prev = gl.getRenderTarget()
    for (const t of [a, b]) {
      gl.setRenderTarget(t)
      gl.clear(true, false, false)
    }
    gl.setRenderTarget(prev)
    stage.wave.left = 0
  }, [gl, a, b, fw, fh, stage])

  useFrame(({ gl }) => {
    const w = stage.wave
    // Still water is not simulated. The step is skipped entirely once the
    // amplitude can no longer move an 8-bit pixel — which is a number derived
    // from the damping constant rather than a timeout somebody liked.
    if (w.left <= 0 && !w.pending) return
    w.left--

    const { read, write } = io.current
    material.uniforms.uState.value = read.texture
    material.uniforms.uTexel.value.set(1 / fw, 1 / fh)
    if (w.pending) {
      material.uniforms.uDrop.value.set(w.pending[0], w.pending[1], w.pending[2], w.pending[3])
      w.pending = null
    } else {
      material.uniforms.uDrop.value.w = 0
    }

    const prev = gl.getRenderTarget()
    gl.setRenderTarget(write)
    gl.render(scene, cam)
    gl.setRenderTarget(prev)

    io.current = { read: write, write: read }
    w.texture = write.texture
  })

  return null
}

/**
 * The page, seen through the water.
 *
 * One quad per route. During a crossing there are two, and the arriving one
 * stands in front and discards itself outside the wave front — so what fills
 * the rest of the window is not a picture of the old page, it is the old
 * page, still mounted, still painting, still refracting the same field.
 */
function WaterPage({
  doc,
  route,
  stage,
  cut,
  z,
  onGo,
  onPainted,
}: {
  doc: Doc
  route: string
  stage: Stage
  cut: boolean
  z: number
  onGo: (id: string) => void
  onPainted?: () => void
}) {
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const mat = useRef<THREE.ShaderMaterial>(null)

  const uniforms = useMemo(
    () => ({
      uPage: { value: null as THREE.Texture | null },
      uState: { value: null as THREE.Texture | null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uPxToUv: { value: new THREE.Vector2(1, 1) },
      uRefract: { value: REFRACT },
      uDispersion: { value: DISPERSION },
      uSpecular: { value: SHEEN },
      uLight: { value: new THREE.Vector2(...LIGHT).normalize() },
      uFront: { value: new THREE.Vector3(0.5, 0.5, 0) },
      uFrontOn: { value: 0 },
      uCut: { value: cut ? 1 : 0 },
      uEdge: { value: new THREE.Vector2(WARP, BAND) },
    }),
    // Built once. Every frame-varying value is written through the material
    // ref below, never through this object — r3f copies these entries into
    // holders of its own, so a scalar written here after mount lands in an
    // object the renderer no longer reads. Vector values survive it (the copy
    // shares the instance), which is exactly what makes the failure so hard
    // to see: the geometry tracks and the numbers do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <SurfaceApp
      label={`wake-${doc.id}`}
      // The Surface is the window. Its box is the layout input for the page
      // inside it, so this is the same number the DOM is laid out at.
      width={size.width}
      height={size.height}
      // Pinned at the display's own density, exactly. This page never moves
      // in depth, so there is no LOD schedule to run and no reason to be
      // anything but 1:1 with the screen.
      resolution={dpr}
      material="none"
      position={[0, 0, z]}
      scale={[size.width, size.height, 1]}
      // Order is by renderOrder alone: both quads are coplanar for practical
      // purposes and neither writes depth, so the arriving page is simply
      // drawn second and discards where it has not arrived.
      renderOrder={cut ? 1 : 0}
      frustumCulled={false}
      onFirstUpload={onPainted}
      content={<DocView doc={doc} route={route} onGo={onGo} width={size.width} height={size.height} />}
    >
      <planeGeometry args={[1, 1]} />
      <PageMaterial mat={mat} uniforms={uniforms} stage={stage} />
    </SurfaceApp>
  )
}

function PageMaterial({
  mat,
  uniforms,
  stage,
}: {
  mat: React.RefObject<THREE.ShaderMaterial | null>
  uniforms: Record<string, { value: unknown }>
  stage: Stage
}) {
  const texture = useSurfaceTexture()
  const size = useThree((s) => s.size)

  useFrame(() => {
    const u = mat.current?.uniforms
    if (!u) return
    u.uPage.value = texture ?? null
    u.uState.value = stage.wave.texture
    ;(u.uTexel.value as THREE.Vector2).copy(stage.wave.texel)
    ;(u.uPxToUv.value as THREE.Vector2).set(1 / size.width, 1 / size.height)
    const f = stage.front
    ;(u.uFront.value as THREE.Vector3).set(f.x, f.y, f.r)
    u.uFrontOn.value = f.on ? 1 : 0
  })

  return (
    <shaderMaterial
      ref={mat}
      uniforms={uniforms}
      vertexShader={PAGE_VERT}
      fragmentShader={PAGE_FRAG}
      transparent
      // The 2D canvas backing store is premultiplied, and so is everything
      // this shader adds on top of it.
      premultipliedAlpha
      depthTest={false}
      depthWrite={false}
      toneMapped={false}
    />
  )
}

const PAGE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * The front, and the only clock in the scene.
 *
 * It does not start until the arriving page has uploaded real pixels — the
 * house rule for every handoff here, because "a few frames should be enough"
 * is a race that loses under load, and losing it means the front reveals a
 * blank quad.
 */
function FrontDriver({ stage, on, onDone }: { stage: Stage; on: boolean; onDone: () => void }) {
  const size = useThree((s) => s.size)
  const t = useRef(0)

  useEffect(() => {
    if (!on) return
    t.current = 0
    const f = stage.front
    // The far corner, so the front is done when it has genuinely left the
    // window rather than when a number somebody picked has elapsed.
    const cx = f.x * size.width
    const cy = (1 - f.y) * size.height
    f.max =
      Math.max(
        Math.hypot(cx, cy),
        Math.hypot(size.width - cx, cy),
        Math.hypot(cx, size.height - cy),
        Math.hypot(size.width - cx, size.height - cy),
      ) + 40
  }, [on, stage, size])

  useFrame((_, dt) => {
    if (!on || !stage.painted) return
    if (debug.hold != null) {
      stage.front.r = stage.front.max * debug.hold
      return
    }
    t.current = Math.min(1, t.current + Math.min(dt, 1 / 20) / CROSSING)
    // Eased out, not linear. A front at constant speed reads as a wipe; the
    // deceleration at the end is what makes it read as something spreading
    // across a surface and running out of energy.
    const p = 1 - Math.pow(1 - t.current, 2.4)
    stage.front.r = stage.front.max * p
    if (t.current >= 1) onDone()
  })

  return null
}

function PixelPerfect() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  useLayoutEffect(() => {
    // Far enough back that the frustum is exactly the viewport at z = 0, so a
    // CSS pixel is a world unit and the page quad is the window.
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(size.height, FOV))
    camera.near = 1
    camera.far = camera.position.z * 3
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera, size.width, size.height])
  return null
}

const FOV = 42

// Clicking a canvas moves focus to <body>, which blurs whatever hidden field
// a Surface has focused and kills native typing. Suppressing mousedown's
// default suppresses the focus change; clicks and drags still work.
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

// ── the app ──────────────────────────────────────────────────────────────

export function WakeApp({ chips }: { chips?: React.ReactNode }) {
  const stage = useMemo(makeStage, [])
  const [route, setRoute] = useState('surface')
  const [leaving, setLeaving] = useState<string | null>(null)
  const [, force] = useState(0)

  const doc = DOCS.find((d) => d.id === route)!
  const leavingDoc = leaving ? DOCS.find((d) => d.id === leaving)! : null

  // Where the water is struck. Read from the REAL pointer rather than from the
  // forwarded click, and guarded on `isTrusted` like every other page-level
  // listener here: the relayed retellings of this scene's own events bubble to
  // the document by design, and a listener that does not check provenance
  // hears its own echo.
  // The pump's predicate. Installed here because `moving` is what keeps a
  // settled page from repainting itself 120 times a second for nothing.
  useEffect(() => {
    moving = () => stage.wave.left > 0
    return () => {
      moving = () => false
    }
  }, [stage])

  const at = useRef({ u: 0.5, v: 0.5 })
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!e.isTrusted) return
      at.current = { u: e.clientX / window.innerWidth, v: 1 - e.clientY / window.innerHeight }
      // Every press disturbs the surface, whether or not it navigates. The
      // page is water; this is the cheapest way to say so.
      if (!stage.front.on) drop(stage, at.current.u, at.current.v, 42, 0.16)
    }
    // CAPTURE PHASE, and that is not a preference. A Surface stops the native
    // pointerdown on purpose — the canvas sits outside every portaled layer,
    // so without it a click into a Surface would dismiss every open popover
    // on the page. In this scene the Surface is the WHOLE WINDOW, so a
    // bubble-phase listener here never hears a real press at all: it hears
    // only the relayed retelling, which this guard correctly throws away, and
    // the effect silently never happens. Measured — one pointerdown reached
    // window, isTrusted false, at exactly the pressed coordinates. Capture
    // runs window → target, so it is ahead of the stop.
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [stage])

  const go = useCallback(
    (id: string) => {
      // One crossing at a time. A second front would need a third live route
      // underneath it, and the honest version of that is a queue, not a
      // special case.
      if (stage.front.on || id === route) return
      const { u, v } = at.current
      stage.front = { x: u, y: v, r: 0, max: 0, on: true }
      stage.painted = false
      drop(stage, u, v, 78, 0.5)
      setLeaving(route)
      setRoute(id)
    },
    [route, stage],
  )

  const done = useCallback(() => {
    stage.front.on = false
    stage.front.r = 0
    setLeaving(null)
    force((n) => n + 1)
  }, [stage])

  // Scene hook. As in the passage scene the object is installed once and every
  // method reads through a ref, so a probe that grabs `window.__wake` at the
  // top of a script is not holding a snapshot of the scene as it was before
  // anything happened.
  const live = useRef({ go, route, leaving })
  live.current = { go, route, leaving }
  useEffect(() => {
    ;(window as unknown as { __wake?: unknown }).__wake = {
      go: (id: string) => live.current.go(id),
      route: () => live.current.route,
      leaving: () => live.current.leaving,
      tick: () => tickers.size,
      front: () => ({ ...stage.front, painted: stage.painted }),
      wet: () => stage.wave.left,
      ripple: (u = 0.5, v = 0.5, px = 60, depth = 0.4) => drop(stage, u, v, px, depth),
      docs: () => DOCS.map((d) => d.id),
      debug,
    }
  }, [stage])

  return (
    <div className="wk-page">
      <Canvas
        style={{ position: 'fixed', inset: 0 }}
        gl={{ alpha: true, antialias: true }}
        // Always: the page IS the mesh here, so a frame that does not run is
        // a keystroke that does not appear. The idle cost is a render of two
        // triangles — the paint counters stay at zero, and the simulation
        // switches itself off once the water is flat.
        frameloop="always"
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => {
          state.gl.setClearAlpha(0)
          ;(window as unknown as { __r3f: unknown }).__r3f = state
        }}
      >
        <PixelPerfect />
        <KeepDomFocus />
        <WaveSim stage={stage} />
        {leavingDoc && (
          <WaterPage
            key={leavingDoc.id}
            doc={leavingDoc}
            route={route}
            stage={stage}
            cut={false}
            z={0}
            onGo={go}
          />
        )}
        <WaterPage
          key={doc.id}
          doc={doc}
          route={route}
          stage={stage}
          cut={!!leavingDoc}
          z={0.5}
          onGo={go}
          onPainted={() => {
            stage.painted = true
          }}
        />
        <FrontDriver stage={stage} on={!!leavingDoc} onDone={done} />
      </Canvas>

      <div className="wk-hud">
        {chips}
        <span>
          pick a page — the new one arrives through the water · click anywhere to
          strike the surface · type in the search field while it is still moving
        </span>
      </div>
    </div>
  )
}
