// Material finishes prototype — seventeen physical finishes on Surfaces holding
// real UI cards, each with its text lit with the body or laid over it unlit,
// under a choice of studio light rigs, flat or tilting toward the pointer
// (?scene=material-finishes&finish=<id>&text=lit|unlit
// &light=softbox|point&tilt=none|pointer&follow=drag|pointer). With
// &compare=<family id> the page shows the presets of one material side by
// side instead.
//
// This is shortlist item 1 of docs/materials-research.md §5. A flat card
// under an orthographic view shows a coat, sheen or anisotropic highlight as
// one even tint, so the key light stands a few hundred CSS px over the
// cards, dragged or swept across them under a perspective camera. The
// finish, lights and environments are the library's: each card's Root takes
// the live finish, and the canvas takes the studio as `lighting`. With
// follow=pointer the key is a createSurfaceLight handle made with
// `follow: 'pointer'`, so the light moves with the mouse and no React render
// runs; under reduced motion it rests where the dragged light stood.

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { SurfaceCanvas, useCaptureSupport, type SurfaceCanvasId, type SurfaceFinish } from '@petepetrash/munari'
import { Button, Status, Tag } from '../../components/system'
import { showChrome } from '../../bareMode'
import { sceneUrl } from '../../captureMode'
import { MaterialFinishesCompare } from './MaterialFinishesCompare'
import { MaterialFinishesGlass } from './MaterialFinishesGlass'
import { familyOf, familyOfFinish } from './materialFinishesFamilies'
import { FinishCard, PointerTracker } from './MaterialFinishesSurface'
import { MaterialFinishesTweaks } from './MaterialFinishesTweaks'
import {
  applyFinish,
  FINISH_ORDER,
  isFinishId,
  isLightRig,
  keyLight,
  LIGHT_RIGS,
  lightingOf,
  liveFinish,
  placeKey,
  startStudio,
  studio,
  subscribeFinishTuning,
  tuningVersion,
  type CardTilt,
  type FinishId,
  type LightRig,
  type TextLighting,
} from './materialFinishesTuning'
import './materialFinishes.css'

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
  readonly light: LightRig
  readonly tilt: CardTilt
  readonly follow: KeyFollow
}

/** Whether the key stays where it is dragged or follows the pointer. */
type KeyFollow = 'drag' | 'pointer'

type PillOptions<T extends string> = readonly (readonly [T, string])[]

const TEXT_PILLS: PillOptions<TextLighting> = [['unlit', 'Unlit text'], ['lit', 'Lit text']]
const RIG_PILLS: PillOptions<LightRig> = LIGHT_RIGS.map((item) => [item.id, item.label] as const)
const TILT_PILLS: PillOptions<CardTilt> = [['none', 'Flat'], ['pointer', 'Tilt to pointer']]
const FOLLOW_PILLS: PillOptions<KeyFollow> = [['drag', 'Drag light'], ['pointer', 'Light follows pointer']]

interface PillsProps<T extends string> {
  readonly label: string
  readonly value: T
  readonly options: PillOptions<T>
  readonly onSelect: (next: T) => void
}

function Pills<T extends string>({ label, value, options, onSelect }: PillsProps<T>) {
  return (
    <div className="mf-pills" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <Button key={id} compact variant={value === id ? 'solid' : 'outline'} aria-pressed={value === id} onClick={() => onSelect(id)}>
          {text}
        </Button>
      ))}
    </div>
  )
}

function readParams(): SceneParams {
  const params = new URLSearchParams(window.location.search)
  const finish = params.get('finish')
  const light = params.get('light')
  return {
    finish: isFinishId(finish) ? finish : 'lacquer-crimson',
    text: params.get('text') === 'lit' ? 'lit' : 'unlit',
    light: isLightRig(light) ? light : 'softbox',
    tilt: params.get('tilt') === 'pointer' ? 'pointer' : 'none',
    follow: params.get('follow') === 'pointer' ? 'pointer' : 'drag',
  }
}

function writeParams({ finish, text, light, tilt, follow }: SceneParams): void {
  const params = new URLSearchParams(window.location.search)
  params.set('scene', 'material-finishes')
  params.set('finish', finish)
  params.set('text', text)
  params.set('light', light)
  params.set('tilt', tilt)
  params.set('follow', follow)
  window.history.replaceState(null, '', `?${params.toString()}`)
}

function compareUrl(family: string, text: TextLighting, light: LightRig): string {
  return `?${new URLSearchParams({ scene: 'material-finishes', compare: family, text, light })}`
}

type OnInkStyle = CSSProperties & { readonly '--mf-on-ink'?: string }

/** Text on a solid ink fill, such as a primary button, reads in the body color. */
function onInkStyle(finish: SurfaceFinish): OnInkStyle {
  return finish.color ? { '--mf-on-ink': finish.color } : {}
}

interface CardsProps {
  readonly canvasId: SurfaceCanvasId
  readonly inScene: boolean
  readonly finish: SurfaceFinish
  readonly tilt: CardTilt
}

function Cards({ canvasId, inScene, finish, tilt }: CardsProps) {
  const [bag, setBag] = useState(0)
  const [name, setName] = useState('Morning take, room 2')
  const [saved, setSaved] = useState<string | null>(null)
  const [gain, setGain] = useState<'low' | 'mid' | 'high'>('mid')
  // Every card on this page wears the live finish.
  const card = { canvasId, inScene, finish, tilt }

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
  if (compare === 'glass') return <MaterialFinishesGlass onReady={onReady} />
  const family = familyOf(compare)
  if (family) return <MaterialFinishesCompare family={family} onReady={onReady} />
  return <MaterialFinishesScene onReady={onReady} />
}

function MaterialFinishesScene({ onReady }: { readonly onReady?: () => void }) {
  const supported = useCaptureSupport()
  const canvasId = useId()
  const initial = useState(() => {
    const params = readParams()
    // Before the first render, so the light handle draws at the start.
    startStudio(params.light)
    applyFinish(params.finish)
    return params
  })[0]
  const [finish, setFinish] = useState<FinishId>(initial.finish)
  const [text, setText] = useState<TextLighting>(initial.text)
  const [rig, setRig] = useState<LightRig>(initial.light)
  const [tilt, setTilt] = useState<CardTilt>(initial.tilt)
  const [follow, setFollow] = useState<KeyFollow>(initial.follow)
  const followsPointer = follow === 'pointer'
  const [inScene, setInScene] = useState(true)
  const [sweeping, setSweeping] = useState(false)
  const handleRef = useRef<HTMLButtonElement>(null)

  useSyncExternalStore(subscribeFinishTuning, tuningVersion)
  const live = liveFinish()
  const worn = useMemo(() => ({ ...live, text }), [live, text])
  // Read each render: a tweak to the rim or the environment re-renders the page.
  const lighting = lightingOf(followsPointer)

  // The handle follows the key, and the key keeps its place in the viewport
  // when the window resizes.
  useEffect(() => {
    const release = keyLight.subscribe(({ x, y }) => {
      const handle = handleRef.current
      if (!handle || x === null || y === null) return
      handle.style.left = `${x}px`
      handle.style.top = `${y}px`
    })
    const resize = () => placeKey(rig)
    window.addEventListener('resize', resize, { passive: true })
    return () => {
      release()
      window.removeEventListener('resize', resize)
    }
  }, [rig])

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
    studio.keyX = Math.min(Math.max(x, 0), 1)
    studio.keyY = Math.min(Math.max(y, 0), 1)
    keyLight.set({ x: studio.keyX * window.innerWidth, y: studio.keyY * window.innerHeight })
  }, [])

  useEffect(() => {
    if (!sweeping) return
    const start = performance.now()
    let frame = requestAnimationFrame(function step(now) {
      const t = ((now - start) % SWEEP_MS) / SWEEP_MS
      // A cosine ease out and back, so the light dwells at each end.
      moveLight(0.08 + 0.84 * (0.5 - 0.5 * Math.cos(t * 2 * Math.PI)), studio.keyY)
      frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [sweeping, moveLight])

  const current: SceneParams = { finish, text, light: rig, tilt, follow }
  const selectFinish = (next: FinishId) => {
    setFinish(next)
    applyFinish(next)
    writeParams({ ...current, finish: next })
  }
  const selectText = (next: TextLighting) => {
    setText(next)
    writeParams({ ...current, text: next })
  }
  const selectRig = (next: LightRig) => {
    setRig(next)
    placeKey(next)
    writeParams({ ...current, light: next })
  }
  const selectTilt = (next: CardTilt) => {
    setTilt(next)
    writeParams({ ...current, tilt: next })
  }
  const selectFollow = (next: KeyFollow) => {
    setFollow(next)
    // Both handles rest where the dragged light stands.
    placeKey(rig)
    if (next === 'pointer') setSweeping(false)
    writeParams({ ...current, follow: next })
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
    moveLight(studio.keyX + delta[0], studio.keyY + delta[1])
  }

  const showsScene = supported && inScene
  const family = familyOfFinish(finish)

  return (
    <div className="mf-page" data-finish={finish} data-text={text} style={onInkStyle(live)}>
      {supported && (
        <SurfaceCanvas
          id={canvasId}
          pointerMode="surfaces"
          frameloop="demand"
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: false, depth: false }}
          onCreated={({ gl }) => gl.setClearAlpha(0)}
          style={{ position: 'fixed', inset: 0, zIndex: 10 }}
          lighting={lighting}
        >
          {tilt === 'pointer' && <PointerTracker />}
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
        <Pills label="Text lighting" value={text} options={TEXT_PILLS} onSelect={selectText} />
        <Pills label="Light" value={rig} options={RIG_PILLS} onSelect={selectRig} />
        <Pills label="Tilt" value={tilt} options={TILT_PILLS} onSelect={selectTilt} />
        <Pills label="Key light" value={follow} options={FOLLOW_PILLS} onSelect={selectFollow} />
      </header>
      )}

      <Cards canvasId={canvasId} inScene={showsScene} finish={worn} tilt={tilt} />

      {supported && !followsPointer && (
        <button
          ref={handleRef}
          type="button"
          className="mf-light-handle"
          style={{ left: `${studio.keyX * 100}%`, top: `${studio.keyY * 100}%` }}
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
        {family && (
          <a className="mf-compare-link" href={compareUrl(family.id, text, rig)}>
            Compare {family.label.toLowerCase()} presets
          </a>
        )}
        <Button compact variant={sweeping ? 'solid' : 'outline'} aria-pressed={sweeping} disabled={!showsScene || followsPointer} onClick={() => setSweeping((on) => !on)}>
          {sweeping ? 'Stop sweep' : 'Sweep light'}
        </Button>
        <Button compact variant="outline" disabled={!supported} onClick={() => setInScene((on) => !on)}>
          {inScene ? 'Show page HTML' : 'Show finish'}
        </Button>
        <Status status={showsScene ? 'live' : 'fallback'}>{showsScene ? 'Finish on Surfaces' : 'Page HTML'}</Status>
        <Tag>{followsPointer ? 'Move the pointer' : 'Drag the light'}</Tag>
      </footer>
      )}

      {showChrome && <MaterialFinishesTweaks finish={finish} rig={rig} />}
    </div>
  )
}
