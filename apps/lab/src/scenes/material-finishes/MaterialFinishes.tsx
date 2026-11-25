// Material finishes prototype — five physical finishes on Surfaces holding
// real UI cards, each with its text lit with the body or laid over it unlit
// (?scene=material-finishes&finish=<id>&text=lit|unlit).
//
// This is shortlist item 1 of docs/materials-research.md §5. A flat card
// under an orthographic view shows a coat, sheen or anisotropic highlight as
// one even tint, so the light is a point light a few hundred CSS px over the
// cards, dragged or swept across them under a perspective camera.

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { SurfaceCanvas, useCaptureSupport, type SurfaceCanvasId } from '@petepetrash/munari'
import { Button, Status, Tag } from '../../components/system'
import { sceneUrl } from '../../captureMode'
import { FinishCard } from './MaterialFinishesSurface'
import { MaterialFinishesTweaks } from './MaterialFinishesTweaks'
import {
  applyFinish,
  FINISH_ORDER,
  isFinishId,
  liveFinish,
  notifyFinishTuning,
  studio,
  subscribeFinishTuning,
  type FinishId,
  type TextLighting,
} from './materialFinishesTuning'
import './materialFinishes.css'

// RoomEnvironment is the bench's environment (docs/materials-research.md
// §2 method); 0.04 is the PMREM blur three's examples bake it with.
const ROOM_BLUR = 0.04
// One sweep crosses the cards in this many ms, slow enough to watch a
// highlight travel.
const SWEEP_MS = 3600
const KEY_STEP = 0.02

function keyDelta(key: string): readonly [number, number] | null {
  switch (key) {
    case 'ArrowLeft': return [-KEY_STEP, 0]
    case 'ArrowRight': return [KEY_STEP, 0]
    case 'ArrowUp': return [0, -KEY_STEP]
    case 'ArrowDown': return [0, KEY_STEP]
    default: return null
  }
}

interface SceneParams {
  readonly finish: FinishId
  readonly text: TextLighting
}

function readParams(): SceneParams {
  const params = new URLSearchParams(window.location.search)
  const finish = params.get('finish')
  return {
    finish: isFinishId(finish) ? finish : 'lacquer',
    text: params.get('text') === 'lit' ? 'lit' : 'unlit',
  }
}

function writeParams(finish: FinishId, text: TextLighting): void {
  const params = new URLSearchParams(window.location.search)
  params.set('scene', 'material-finishes')
  params.set('finish', finish)
  params.set('text', text)
  window.history.replaceState(null, '', `?${params.toString()}`)
}

function StudioEnvironment() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    if (!(gl instanceof WebGPURenderer)) throw new Error('The material finishes environment needs the WebGPURenderer from SurfaceCanvas')
    let cancelled = false
    let baked: THREE.RenderTarget | null = null
    void gl.init().then(() => {
      if (cancelled) return
      const generator = new PMREMGenerator(gl)
      const room = new RoomEnvironment()
      baked = generator.fromScene(room, ROOM_BLUR)
      room.dispose()
      generator.dispose()
      scene.environment = baked.texture
      invalidate()
    })
    return () => {
      cancelled = true
      scene.environment = null
      baked?.dispose()
    }
  }, [gl, scene, invalidate])
  return null
}

function TuningInvalidator() {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => subscribeFinishTuning(() => invalidate()), [invalidate])
  return null
}

interface CardsProps {
  readonly canvasId: SurfaceCanvasId
  readonly inScene: boolean
  readonly text: TextLighting
  readonly light: THREE.PointLight
}

function Cards({ canvasId, inScene, text, light }: CardsProps) {
  const [bag, setBag] = useState(0)
  const [name, setName] = useState('Morning take, room 2')
  const [saved, setSaved] = useState<string | null>(null)
  const [gain, setGain] = useState<'low' | 'mid' | 'high'>('mid')
  const card = { canvasId, inScene, text, light }

  return (
    <main className="mf-cards">
      <FinishCard {...card} className="mf-product">
        <p className="mf-label">Field recorder</p>
        <h2 className="mf-title">FR-2 Portable</h2>
        <p className="mf-body">
          Two balanced inputs, 32-bit float capture and a case that survives the bag. Small type stays legible at 12 px.
        </p>
        <p className="mf-fine">Ships in 3–5 days · 2-year warranty</p>
        <div className="mf-row">
          <span className="mf-price">$649</span>
          <button type="button" className="mf-button mf-button--solid" onClick={() => setBag((n) => n + 1)}>
            {bag === 0 ? 'Add to bag' : `In bag: ${bag}`}
          </button>
        </div>
      </FinishCard>

      <FinishCard {...card} className="mf-form">
        <label className="mf-label" htmlFor="mf-session-name">Session name</label>
        <input
          id="mf-session-name"
          className="mf-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="mf-row">
          <span className="mf-fine" data-testid="mf-saved">{saved === null ? 'Not saved' : `Saved “${saved}”`}</span>
          <button type="button" className="mf-button" onClick={() => setSaved(name)}>Save</button>
        </div>
      </FinishCard>

      <FinishCard {...card} className="mf-control">
        <p className="mf-label">Input gain</p>
        <div className="mf-segments" role="group" aria-label="Input gain">
          {(['low', 'mid', 'high'] as const).map((level) => (
            <button
              key={level}
              type="button"
              className="mf-segment"
              aria-pressed={gain === level}
              onClick={() => setGain(level)}
            >
              {level}
            </button>
          ))}
        </div>
        <p className="mf-readout">{gain === 'low' ? '−12 dB' : gain === 'mid' ? '0 dB' : '+12 dB'}</p>
      </FinishCard>
    </main>
  )
}

export function MaterialFinishesApp({ onReady }: { readonly onReady?: () => void }) {
  const supported = useCaptureSupport()
  const canvasId = useId()
  const initial = useState(readParams)[0]
  const [finish, setFinish] = useState<FinishId>(initial.finish)
  const [text, setText] = useState<TextLighting>(initial.text)
  const [inScene, setInScene] = useState(true)
  const [sweeping, setSweeping] = useState(false)
  const [light] = useState(() => new THREE.PointLight('#fffaf2', 0, 0, 2))
  const handleRef = useRef<HTMLButtonElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)

  // The page copy of a card paints the live body color, so "Show page HTML"
  // compares against the finish being tuned.
  useEffect(() => {
    const paintBody = () => pageRef.current?.style.setProperty('--mf-body', liveFinish.color)
    paintBody()
    return subscribeFinishTuning(paintBody)
  }, [])

  useEffect(() => {
    applyFinish(initial.finish)
  }, [initial.finish])

  useEffect(() => {
    let alive = true
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (alive) requestAnimationFrame(() => onReady?.())
    })
    return () => {
      alive = false
    }
  }, [onReady])

  const moveLight = useCallback((x: number, y: number) => {
    studio.lightX = Math.min(Math.max(x, 0), 1)
    studio.lightY = Math.min(Math.max(y, 0), 1)
    const handle = handleRef.current
    if (handle) {
      handle.style.left = `${studio.lightX * 100}%`
      handle.style.top = `${studio.lightY * 100}%`
    }
    notifyFinishTuning()
  }, [])

  useEffect(() => {
    if (!sweeping) return
    const start = performance.now()
    let frame = requestAnimationFrame(function step(now) {
      const t = ((now - start) % SWEEP_MS) / SWEEP_MS
      // A cosine ease out and back, so the light dwells at each end.
      moveLight(0.08 + 0.84 * (0.5 - 0.5 * Math.cos(t * 2 * Math.PI)), studio.lightY)
      frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [sweeping, moveLight])

  const selectFinish = (next: FinishId) => {
    setFinish(next)
    applyFinish(next)
    writeParams(next, text)
  }
  const selectText = (next: TextLighting) => {
    setText(next)
    writeParams(finish, next)
  }

  const onHandlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setSweeping(false)
  }
  const onHandlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    moveLight(event.clientX / window.innerWidth, event.clientY / window.innerHeight)
  }
  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = keyDelta(event.key)
    if (!delta) return
    event.preventDefault()
    moveLight(studio.lightX + delta[0], studio.lightY + delta[1])
  }

  const showsScene = supported && inScene

  return (
    <div ref={pageRef} className="mf-page" data-finish={finish} data-text={text}>
      {supported && (
        <SurfaceCanvas
          id={canvasId}
          pointerMode="surfaces"
          frameloop="demand"
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: false, depth: false }}
          onCreated={({ gl }) => gl.setClearAlpha(0)}
          style={{ position: 'fixed', inset: 0, zIndex: 10 }}
        >
          <StudioEnvironment />
          <TuningInvalidator />
          <primitive object={light} />
        </SurfaceCanvas>
      )}

      <header className="mf-header">
        <a href={sceneUrl('home')} className="mf-wordmark">
          munari <span className="mf-wordmark-note">· material finishes</span>
        </a>
        <nav className="mf-pills" aria-label="Finish">
          {FINISH_ORDER.map((item) => (
            <Button
              key={item.id}
              compact
              variant={finish === item.id ? 'solid' : 'outline'}
              aria-pressed={finish === item.id}
              onClick={() => selectFinish(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </nav>
        <div className="mf-pills" role="group" aria-label="Text lighting">
          <Button compact variant={text === 'unlit' ? 'solid' : 'outline'} aria-pressed={text === 'unlit'} onClick={() => selectText('unlit')}>
            Unlit text
          </Button>
          <Button compact variant={text === 'lit' ? 'solid' : 'outline'} aria-pressed={text === 'lit'} onClick={() => selectText('lit')}>
            Lit text
          </Button>
        </div>
      </header>

      <Cards canvasId={canvasId} inScene={showsScene} text={text} light={light} />

      {supported && (
        <button
          ref={handleRef}
          type="button"
          className="mf-light-handle"
          style={{ left: `${studio.lightX * 100}%`, top: `${studio.lightY * 100}%` }}
          aria-label="Studio light. Drag or use the arrow keys to move it over the cards."
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onKeyDown={onHandleKeyDown}
        >
          <span className="mf-light-dot" aria-hidden />
        </button>
      )}

      <footer className="mf-hud">
        <Button compact variant={sweeping ? 'solid' : 'outline'} aria-pressed={sweeping} disabled={!showsScene} onClick={() => setSweeping((on) => !on)}>
          {sweeping ? 'Stop sweep' : 'Sweep light'}
        </Button>
        <Button compact variant="outline" disabled={!supported} onClick={() => setInScene((on) => !on)}>
          {inScene ? 'Show page HTML' : 'Show finish'}
        </Button>
        <Status status={showsScene ? 'live' : 'fallback'}>{showsScene ? 'Finish on Surfaces' : 'Page HTML'}</Status>
        <Tag>Drag the light</Tag>
      </footer>

      <MaterialFinishesTweaks finish={finish} />
    </div>
  )
}
