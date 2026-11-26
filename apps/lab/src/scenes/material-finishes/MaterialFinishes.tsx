// Material finishes prototype — five physical finishes on Surfaces holding
// real UI cards, each with its text lit with the body or laid over it unlit,
// under a choice of studio light rigs, flat or tilting toward the pointer
// (?scene=material-finishes&finish=<id>&look=<id>&text=lit|unlit
// &light=softbox|studio-point|room&tilt=none|pointer). With
// &compare=<finish id> the page shows each look of a finish that has
// several side by side instead.
//
// This is shortlist item 1 of docs/materials-research.md §5. A flat card
// under an orthographic view shows a coat, sheen or anisotropic highlight as
// one even tint, so the key light stands a few hundred CSS px over the
// cards, dragged or swept across them under a perspective camera.

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { SurfaceCanvas, useCaptureSupport, type SurfaceCanvasId } from '@petepetrash/munari'
import { Button, Status, Tag } from '../../components/system'
import { showChrome } from '../../bareMode'
import { sceneUrl } from '../../captureMode'
import { MaterialFinishesCompare } from './MaterialFinishesCompare'
import { FinishCard, pagePointer } from './MaterialFinishesSurface'
import { createStudioLights, createStudioScene, lightsOf, type StudioLights } from './materialFinishesStudio'
import { MaterialFinishesTweaks } from './MaterialFinishesTweaks'
import {
  applyLook,
  applyStudio,
  FINISH_LOOKS,
  hasLookChoice,
  FINISH_ORDER,
  isFinishId,
  isLightRig,
  LIGHT_RIGS,
  liveFinish,
  lookOf,
  notifyFinishTuning,
  startStudio,
  studio,
  subscribeFinishTuning,
  type CardTilt,
  type EnvironmentKind,
  type FinishId,
  type FinishLook,
  type LightRig,
  type TextLighting,
} from './materialFinishesTuning'
import './materialFinishes.css'

// RoomEnvironment is the bench's environment (docs/materials-research.md
// §2 method); 0.04 is the PMREM blur three's examples bake it with. The
// studio bakes sharper, so a coat at roughness 0.02 shows its strips' edges.
const ROOM_BLUR = 0.04
const STUDIO_BLUR = 0.01
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
  readonly look: string
  readonly text: TextLighting
  readonly light: LightRig
  readonly tilt: CardTilt
}

function readParams(): SceneParams {
  const params = new URLSearchParams(window.location.search)
  const finish = params.get('finish')
  const light = params.get('light')
  const finishId = isFinishId(finish) ? finish : 'lacquer'
  return {
    finish: finishId,
    look: lookOf(finishId, params.get('look')).id,
    text: params.get('text') === 'lit' ? 'lit' : 'unlit',
    light: isLightRig(light) ? light : 'softbox',
    tilt: params.get('tilt') === 'pointer' ? 'pointer' : 'none',
  }
}

function writeParams({ finish, look, text, light, tilt }: SceneParams): void {
  const params = new URLSearchParams(window.location.search)
  params.set('scene', 'material-finishes')
  params.set('finish', finish)
  params.set('look', look)
  params.set('text', text)
  params.set('light', light)
  params.set('tilt', tilt)
  window.history.replaceState(null, '', `?${params.toString()}`)
}

function compareUrl(finish: FinishId, text: TextLighting, light: LightRig): string {
  return `?${new URLSearchParams({ scene: 'material-finishes', compare: finish, text, light })}`
}

function StudioEnvironment({ rig, environment }: { readonly rig: LightRig; readonly environment: EnvironmentKind }) {
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
      if (rig === 'room') {
        const room = new RoomEnvironment()
        baked = generator.fromScene(room, ROOM_BLUR)
        room.dispose()
      } else {
        const built = createStudioScene(environment)
        baked = generator.fromScene(built.scene, STUDIO_BLUR)
        built.dispose()
      }
      generator.dispose()
      scene.environment = baked.texture
      invalidate()
    })
    return () => {
      cancelled = true
      scene.environment = null
      baked?.dispose()
    }
  }, [gl, scene, invalidate, rig, environment])
  return null
}

function TuningInvalidator() {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => subscribeFinishTuning(() => invalidate()), [invalidate])
  return null
}

/** Track the pointer for tilting cards, and draw a frame whenever it moves. */
function PointerTracker() {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      pagePointer.position = { x: event.clientX, y: event.clientY }
      invalidate()
    }
    const leave = () => {
      pagePointer.position = null
      invalidate()
    }
    window.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)
    return () => {
      window.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
      pagePointer.position = null
    }
  }, [invalidate])
  return null
}

interface CardsProps {
  readonly canvasId: SurfaceCanvasId
  readonly inScene: boolean
  readonly look: FinishLook
  readonly text: TextLighting
  readonly tilt: CardTilt
  readonly lights: StudioLights
}

function Cards({ canvasId, inScene, look, text, tilt, lights }: CardsProps) {
  const [bag, setBag] = useState(0)
  const [name, setName] = useState('Morning take, room 2')
  const [saved, setSaved] = useState<string | null>(null)
  const [gain, setGain] = useState<'low' | 'mid' | 'high'>('mid')
  const hasCrackle = useSyncExternalStore(subscribeFinishTuning, () => liveFinish.crackle > 0)
  const card = { canvasId, inScene, detail: look.finish.detail, hasCrackle, text, tilt, lights }

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
  const [compare] = useState(() => new URLSearchParams(window.location.search).get('compare'))
  if (isFinishId(compare) && hasLookChoice(compare)) return <MaterialFinishesCompare finish={compare} onReady={onReady} />
  return <MaterialFinishesScene onReady={onReady} />
}

function MaterialFinishesScene({ onReady }: { readonly onReady?: () => void }) {
  const supported = useCaptureSupport()
  const canvasId = useId()
  const initial = useState(() => {
    const params = readParams()
    // Before the first render, so the light handle draws at the start.
    startStudio(params.light, lookOf(params.finish, params.look))
    return params
  })[0]
  const [finish, setFinish] = useState<FinishId>(initial.finish)
  const [lookId, setLookId] = useState(initial.look)
  const look = lookOf(finish, lookId)
  const [text, setText] = useState<TextLighting>(initial.text)
  const [rig, setRig] = useState<LightRig>(initial.light)
  const [tilt, setTilt] = useState<CardTilt>(initial.tilt)
  const [inScene, setInScene] = useState(true)
  const [sweeping, setSweeping] = useState(false)
  const [lights] = useState(createStudioLights)
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
    const first = lookOf(initial.finish, initial.look)
    applyLook(first)
    applyStudio(initial.light, first)
  }, [initial.finish, initial.look, initial.light])

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

  const current: SceneParams = { finish, look: look.id, text, light: rig, tilt }
  const showLook = (next: FinishLook) => {
    applyLook(next)
    applyStudio(rig, next)
  }
  const selectFinish = (next: FinishId) => {
    const first = lookOf(next, null)
    setFinish(next)
    setLookId(first.id)
    showLook(first)
    writeParams({ ...current, finish: next, look: first.id })
  }
  const selectLook = (next: FinishLook) => {
    setLookId(next.id)
    showLook(next)
    writeParams({ ...current, look: next.id })
  }
  const selectText = (next: TextLighting) => {
    setText(next)
    writeParams({ ...current, text: next })
  }
  const selectRig = (next: LightRig) => {
    setRig(next)
    applyStudio(next, look)
    writeParams({ ...current, light: next })
  }
  const selectTilt = (next: CardTilt) => {
    setTilt(next)
    writeParams({ ...current, tilt: next })
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
    <div ref={pageRef} className="mf-page" data-finish={finish} data-look={look.id} data-text={text}>
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
          <StudioEnvironment rig={rig} environment={look.environment} />
          <TuningInvalidator />
          {tilt === 'pointer' && <PointerTracker />}
          {lightsOf(rig, lights).map((light) => (
            <primitive key={light.uuid} object={light} />
          ))}
        </SurfaceCanvas>
      )}

      {showChrome && (
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
        <div className="mf-pills" role="group" aria-label="Light">
          {LIGHT_RIGS.map((item) => (
            <Button key={item.id} compact variant={rig === item.id ? 'solid' : 'outline'} aria-pressed={rig === item.id} onClick={() => selectRig(item.id)}>
              {item.label}
            </Button>
          ))}
        </div>
        <div className="mf-pills" role="group" aria-label="Tilt">
          <Button compact variant={tilt === 'none' ? 'solid' : 'outline'} aria-pressed={tilt === 'none'} onClick={() => selectTilt('none')}>
            Flat
          </Button>
          <Button compact variant={tilt === 'pointer' ? 'solid' : 'outline'} aria-pressed={tilt === 'pointer'} onClick={() => selectTilt('pointer')}>
            Tilt to pointer
          </Button>
        </div>
      </header>
      )}

      <Cards canvasId={canvasId} inScene={showsScene} look={look} text={text} tilt={tilt} lights={lights} />

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

      {showChrome && (
      <footer className="mf-hud">
        {hasLookChoice(finish) && (
          <>
            <div className="mf-pills" role="group" aria-label="Look">
              {FINISH_LOOKS[finish].map((item) => (
                <Button key={item.id} compact variant={look.id === item.id ? 'solid' : 'outline'} aria-pressed={look.id === item.id} onClick={() => selectLook(item)}>
                  {item.label}
                </Button>
              ))}
            </div>
            <a className="mf-compare-link" href={compareUrl(finish, text, rig)}>
              Compare looks
            </a>
          </>
        )}
        <Button compact variant={sweeping ? 'solid' : 'outline'} aria-pressed={sweeping} disabled={!showsScene} onClick={() => setSweeping((on) => !on)}>
          {sweeping ? 'Stop sweep' : 'Sweep light'}
        </Button>
        <Button compact variant="outline" disabled={!supported} onClick={() => setInScene((on) => !on)}>
          {inScene ? 'Show page HTML' : 'Show finish'}
        </Button>
        <Status status={showsScene ? 'live' : 'fallback'}>{showsScene ? 'Finish on Surfaces' : 'Page HTML'}</Status>
        <Tag>Drag the light</Tag>
      </footer>
      )}

      {showChrome && <MaterialFinishesTweaks look={look} rig={rig} />}
    </div>
  )
}
