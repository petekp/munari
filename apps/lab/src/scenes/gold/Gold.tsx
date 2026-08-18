// Gold Button — acceptance for the exclusive handoff on a shared Canvas.
//
// Two independent exclusive Surfaces and one translucent Twin composite in
// ONE Canvas. That is the shape the shared-canvas law is about: nothing
// here may hide the canvas on behalf of one Surface, so a Surface warming
// draws write-free and its siblings keep their pixels the whole time.
//
// `view` is what makes a Surface exclusive rather than a Twin. The page
// copy is released the frame its mesh proves a color-writing draw, and
// takes the hold back at exactly zero progress on the way home. The
// controls drive every case the slice has to survive — forward, reverse, a
// reversal arriving mid-crossing, and a source replaced while the mesh is
// presenting it.
//
// It is also the interaction route. Gold relays over its whole geometry,
// silver only where its content is opaque, and the twin takes no pointer
// events at all — the three modes side by side, over one canvas, with the
// controls above still clickable. The text field is controlled from above
// the Surface on purpose: the two copies of a source are separate renders,
// so state held below one of them is not the same text in both.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, SurfaceCanvas, useSurfaceInstance } from '@petepetrash/munari'
import type { SurfaceContentProps, SurfaceView } from '@petepetrash/munari'

function GoldButton({ pressed, onPress }: { pressed: boolean; onPress: () => void }) {
  const instance = useSurfaceInstance()
  const source = instance === 'source'
  return (
    <button
      type="button"
      data-gold-button
      data-gold-pressed={pressed ? '' : undefined}
      aria-hidden={source || undefined}
      tabIndex={source ? -1 : 0}
      onClick={onPress}
      style={{
        boxSizing: 'border-box',
        width: 176,
        height: 52,
        border: '1px solid #ffe49a',
        borderRadius: 16,
        color: '#2d1b00',
        background: pressed
          ? 'linear-gradient(180deg, #ffd15c, #db8b11)'
          : 'linear-gradient(180deg, #fff0ac, #efa829)',
        boxShadow: '0 10px 30px rgba(139, 84, 0, 0.28)',
        font: '600 15px/1 system-ui, sans-serif',
      }}
    >
      {pressed ? 'Gold accepted' : 'Accept gold'}
    </button>
  )
}

function Card({
  label,
  mark,
  field,
}: {
  label: string
  mark: string
  field?: React.ReactNode
}) {
  return (
    <div
      {...{ [mark]: '' }}
      style={{
        boxSizing: 'border-box',
        width: 176,
        height: 52,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 16,
        color: '#0d1a22',
        background: 'linear-gradient(180deg, #dff2ff, #8fbcd4)',
        font: '600 15px/1 system-ui, sans-serif',
      }}
    >
      {field ?? label}
    </div>
  )
}

// Two detached elements rather than one whose children change: a source is
// replaced when the CAPTURED ELEMENT changes, and swapping the contents of
// one element is an ordinary repaint. The replacement path is the one that
// voids every presenter's proof, so the probe needs a real second element.
function useAdoptedPair(): readonly [HTMLElement, HTMLElement] | null {
  const [pair, setPair] = useState<readonly [HTMLElement, HTMLElement] | null>(null)
  useEffect(() => {
    const make = (text: string, tint: string) => {
      const element = document.createElement('div')
      element.setAttribute('data-gold-adopted', text)
      element.style.cssText =
        'box-sizing:border-box;width:176px;height:52px;display:grid;place-items:center;' +
        `border-radius:16px;font:600 15px/1 system-ui,sans-serif;color:#2d1b00;background:${tint}`
      element.textContent = text
      return element
    }
    setPair([make('First source', '#ffd15c'), make('Second source', '#9fe0ff')])
  }, [])
  return pair
}

// A multi-part Surface: two sources, one handoff. The point is that it
// cannot half-transfer — every part registers a presenter into one
// readiness ledger, so the page is released once all of them have drawn or
// not at all. The stud stands on a named box in the second part, which is
// the anchor transaction: it exists only while a complete anchor set is
// true of the generation drawn on that geometry.
function PlateHead() {
  return (
    <div
      data-plate-head
      style={{
        boxSizing: 'border-box',
        width: 176,
        height: 28,
        display: 'grid',
        placeItems: 'center',
        borderRadius: '12px 12px 0 0',
        color: '#f4efe6',
        background: '#3b3a36',
        font: '600 13px/1 system-ui, sans-serif',
      }}
    >
      Plate
    </div>
  )
}

function PlateBody() {
  return (
    <div
      data-plate-body
      style={{
        boxSizing: 'border-box',
        width: 176,
        height: 64,
        position: 'relative',
        borderRadius: '0 0 12px 12px',
        background: '#cfc7b8',
      }}
    >
      <span
        data-munari-anchor="stud"
        style={{
          position: 'absolute',
          left: 24,
          top: 22,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#8c8579',
        }}
      />
    </div>
  )
}

// A real post-processing pipeline: the scene is drawn into an off-screen
// target FIRST and composited to the default framebuffer second, both in
// one frame. A positive `useFrame` priority takes the render away from
// R3F, which is how every effect-composer library does it.
//
// This is the ordering the deferred host tail exists for. Draining the
// tail at the scene pass would throw every presenter away one pass before
// the one that puts them on screen, and the symptom is a Surface that
// warms forever and never releases its page copy.
function PostComposite() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const dpr = useThree((state) => state.viewport.dpr)

  const target = useMemo(
    () => new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: true }),
    [],
  )
  const composite = useMemo(() => {
    const quadScene = new THREE.Scene()
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const material = new THREE.MeshBasicMaterial({ map: target.texture, transparent: true })
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material))
    return { quadScene, quadCamera, material }
  }, [target])

  useEffect(() => {
    return () => {
      target.dispose()
      composite.material.dispose()
    }
  }, [target, composite])

  useEffect(() => {
    target.setSize(Math.max(1, size.width * dpr), Math.max(1, size.height * dpr))
  }, [target, size.width, size.height, dpr])

  useFrame(() => {
    gl.setRenderTarget(target)
    gl.clear()
    gl.render(scene, camera)
    gl.setRenderTarget(null)
    gl.clear()
    gl.render(composite.quadScene, composite.quadCamera)
  }, 1)

  return null
}

// Scene matter, sharing the canvas with the Surfaces and overlapping them
// in depth. Its material is authored once and never touched again, so any
// write a warm-up leaves behind on a shared material shows up here.
function Occluder() {
  return (
    <mesh name="gold-occluder" position={[0, -0.32, -0.4]}>
      <boxGeometry args={[1, 0.18, 0.2]} />
      <meshStandardMaterial
        color="#7c5c20"
        roughness={0.5}
        depthWrite
        stencilWrite
        stencilRef={5}
      />
    </mesh>
  )
}

/** Every protocol event, in order, for the shared-canvas gate to read. */
interface GoldLogEntry {
  readonly surface: string
  readonly event: string
}

export function GoldApp({ chips }: { chips?: React.ReactNode }) {
  const [pressed, setPressed] = useState(false)
  const [goldView, setGoldView] = useState<SurfaceView>('dom')
  const [silverView, setSilverView] = useState<SurfaceView>('dom')
  const [adopted, setAdopted] = useState(false)
  const [second, setSecond] = useState(false)
  const [companion, setCompanion] = useState(true)
  // The cases the shared-canvas gate drives that are not part of the
  // ordinary demo: a post-processing pipeline, two deliberately unnamed
  // Surfaces, and a second Canvas claiming an id that is already taken.
  const [post, setPost] = useState(false)
  const [unnamed, setUnnamed] = useState(false)
  const [duplicateCanvas, setDuplicateCanvas] = useState(false)
  // Controlled, not uncontrolled: the two copies of a source are separate
  // React renders of the same element, so only state held ABOVE the Surface
  // is the same text in both. An uncontrolled input keeps two values and
  // the handoff looks like it ate the user's typing.
  const [text, setText] = useState('munari')
  const [plateView, setPlateView] = useState<SurfaceView>('dom')
  const [plateHead, setPlateHead] = useState(true)
  const [platePresented, setPlatePresented] = useState<SurfaceView>('dom')
  const [goldPresented, setGoldPresented] = useState<SurfaceView>('dom')
  const [silverPresented, setSilverPresented] = useState<SurfaceView>('dom')
  const pair = useAdoptedPair()

  const gold = <GoldButton pressed={pressed} onPress={() => setPressed((value) => !value)} />
  const silver = (
    <Card
      label="Silver"
      mark="data-silver-card"
      field={
        <input
          data-silver-field
          value={text}
          onChange={(event) => setText(event.target.value)}
          // `pointerEvents="content"` makes the source root clear glass, and
          // `pointer-events` inherits: what is meant to be touchable inside
          // it says so. This is the authoring rule, demonstrated.
          style={{ width: 120, font: '14px system-ui, sans-serif', pointerEvents: 'auto' }}
        />
      }
    />
  )
  const bronze = <Card label="Bronze twin" mark="data-bronze-card" />

  // The gate reads the protocol's own answers rather than guessing from
  // pixels: which renderer holds each Surface, and in what order.
  const log = useRef<GoldLogEntry[]>([])
  useEffect(() => {
    window.__gold = { log: log.current }
  }, [])
  const record = (surface: string, event: string) => {
    log.current.push({ surface, event })
  }

  const adoptedSource = pair ? (second ? pair[1] : pair[0]) : undefined
  // One prop or the other, never both: `source` renders a copy and `adopt`
  // moves the live element, and a Surface handed both has no answer for
  // which of the two the page copy is. Spread rather than branched at the
  // element so the swap does not remount the Surface mid-crossing.
  const goldContent: SurfaceContentProps = adopted
    ? adoptedSource
      ? { adopt: adoptedSource }
      : {}
    : { source: gold }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        alignContent: 'center',
        gap: 20,
        background: '#15120c',
      }}
    >
      <header data-gold-heading>
        <span>Surface acceptance</span>
        <strong>Gold</strong>
        <p>Lift, replace, and combine live DOM matter in one shared canvas.</p>
      </header>
      <Surface
        name="gold-button"
        canvas="gold"
        view={goldView}
        {...goldContent}
        onPresentedViewChange={(view) => {
          setGoldPresented(view)
          record('gold', `presented:${view}`)
        }}
        onMotionComplete={(view) => record('gold', `motion:${view}`)}
        onReady={() => record('gold', 'ready')}
      >
        <Surface.DOM>{adopted ? null : gold}</Surface.DOM>
        <Surface.WebGL
          name="gold-default-material"
          alpha="source"
          pointerEvents="geometry"
          onPointerDown={() => record('gold', 'hit')}
        />
      </Surface>

      <Surface
        name="silver-card"
        canvas="gold"
        view={silverView}
        source={silver}
        onPresentedViewChange={(view) => {
          setSilverPresented(view)
          record('silver', `presented:${view}`)
        }}
        onMotionComplete={(view) => record('silver', `motion:${view}`)}
        onReady={() => record('silver', 'ready')}
      >
        <Surface.DOM>{silver}</Surface.DOM>
        <Surface.WebGL
          alpha="source"
          pointerEvents="content"
          onPointerDown={() => record('silver', 'hit')}
          // Authored writes, stated here and nowhere else. A warm-up draws
          // with all three off and has to hand them back exactly — the
          // stencil ref included, since it is read by the pass that keeps
          // the flag.
          material={
            <meshBasicMaterial
              transparent
              toneMapped={false}
              depthWrite
              stencilWrite
              stencilRef={7}
            />
          }
        />
      </Surface>

      <Surface
        name="plate"
        canvas="gold"
        view={plateView}
        onPresentedViewChange={(view) => {
          setPlatePresented(view)
          record('plate', `presented:${view}`)
        }}
        onReady={() => record('plate', 'ready')}
      >
        {plateHead ? (
          <Surface.Part name="head" source={<PlateHead />}>
            <Surface.DOM>
              <PlateHead />
            </Surface.DOM>
            <Surface.WebGL alpha="source" pointerEvents="none" />
          </Surface.Part>
        ) : null}
        <Surface.Part name="body" source={<PlateBody />}>
          <Surface.DOM>
            <PlateBody />
          </Surface.DOM>
          <Surface.WebGL alpha="source" pointerEvents="none">
            <Surface.Anchor name="stud" offset={0.02}>
              <mesh name="plate-stud">
                <sphereGeometry args={[0.06, 12, 12]} />
                <meshBasicMaterial color="#c0392b" />
              </mesh>
            </Surface.Anchor>
          </Surface.WebGL>
        </Surface.Part>
      </Surface>

      {/* No `view`: a Twin, which never releases its page copy. It is the
          sibling whose pixels must survive both handoffs above. */}
      {companion ? (
        <Surface name="bronze-twin" canvas="gold" source={bronze}>
          <Surface.DOM style={{ opacity: 0.6 }}>{bronze}</Surface.DOM>
          <Surface.WebGL alpha="source" pointerEvents="none" />
        </Surface>
      ) : null}

      {/* Two Surfaces with no name at all, in one Canvas. Nothing
          distinguishes them but their declaration, which is exactly the
          case a name-keyed registry lost: the second commit replaced the
          first one's entry and its content went blank. */}
      {unnamed ? (
        <>
          <Surface canvas="gold" source={<div data-gold-unnamed="a">unnamed A</div>} />
          <Surface canvas="gold" source={<div data-gold-unnamed="b">unnamed B</div>} />
        </>
      ) : null}

      <div
        data-gold-controls
        style={{ display: 'flex', gap: 8, font: '13px system-ui, sans-serif' }}
      >
        <button
          type="button"
          data-gold-lift
          onClick={() => setGoldView((view) => (view === 'dom' ? 'webgl' : 'dom'))}
        >
          {goldView === 'dom' ? 'Lift gold' : 'Land gold'}
        </button>
        <button
          type="button"
          data-silver-lift
          onClick={() => setSilverView((view) => (view === 'dom' ? 'webgl' : 'dom'))}
        >
          {silverView === 'dom' ? 'Lift silver' : 'Land silver'}
        </button>
        <button type="button" data-gold-adopt onClick={() => setAdopted((value) => !value)}>
          {adopted ? 'Use React source' : 'Use adopted source'}
        </button>
        <button
          type="button"
          data-gold-replace
          disabled={!adopted}
          onClick={() => setSecond((value) => !value)}
        >
          Replace source
        </button>
        <button
          type="button"
          data-plate-lift
          onClick={() => setPlateView((view) => (view === 'dom' ? 'webgl' : 'dom'))}
        >
          {plateView === 'dom' ? 'Lift plate' : 'Land plate'}
        </button>
        <button type="button" data-plate-head-toggle onClick={() => setPlateHead((value) => !value)}>
          {plateHead ? 'Drop plate head' : 'Add plate head'}
        </button>
        <button type="button" data-gold-companion onClick={() => setCompanion((value) => !value)}>
          {companion ? 'Unmount twin' : 'Mount twin'}
        </button>
        <button type="button" data-gold-post onClick={() => setPost((value) => !value)}>
          {post ? 'Direct render' : 'Post-process'}
        </button>
        <button type="button" data-gold-unnamed-toggle onClick={() => setUnnamed((v) => !v)}>
          {unnamed ? 'Drop unnamed pair' : 'Add unnamed pair'}
        </button>
        <button
          type="button"
          data-gold-duplicate-canvas
          onClick={() => setDuplicateCanvas((value) => !value)}
        >
          {duplicateCanvas ? 'Drop duplicate Canvas' : 'Add duplicate Canvas'}
        </button>
        <span
          data-gold-state
          data-gold-presented={goldPresented}
          data-silver-presented={silverPresented}
          data-plate-presented={platePresented}
        >
          gold {goldPresented} / silver {silverPresented} / plate {platePresented}
        </span>
      </div>

      <SurfaceCanvas
        pointerMode="surfaces"
        id="gold"
        gl={{ alpha: true, stencil: true }}
        frameloop="demand"
        camera={{ position: [0, 0, 5], fov: 45 }}
        style={{ position: 'fixed', inset: 0 }}
        fallback={<div data-gold-fallback>The renderer is unavailable.</div>}
        onCreated={(state) => {
          state.gl.setClearAlpha(0)
          window.__r3f = state
        }}
      >
        <ambientLight intensity={1.4} />
        <directionalLight position={[3, 4, 6]} intensity={2.2} />
        <Occluder />
        {post ? <PostComposite /> : null}
      </SurfaceCanvas>

      {/* A second Canvas under an id that is already taken. The library
          faults rather than guessing, and neither host loses its runtime —
          the one below is off screen and only has to exist. */}
      {duplicateCanvas ? (
        <SurfaceCanvas
          pointerMode="surfaces"
          id="gold"
          frameloop="demand"
          style={{ position: 'fixed', left: -400, top: -400, width: 64, height: 64 }}
        >
          {/* Canvas-side content proves this Canvas kept its own outward
              registry and renderer bridge. Sharing the first Canvas's host
              made the duplicate report a fault but silently dropped this
              source, which is still a lost runtime. */}
          <Surface source={<div data-gold-duplicate-source>duplicate host</div>} />
        </SurfaceCanvas>
      ) : null}
      {chips}
    </main>
  )
}
