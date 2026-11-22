// Soft-polymer visual language prototype — three variants of Munari containers
// casting coherent global-light soft shadows at 0 fps idle (?scene=polymer-prototype&variant=A|B|C).

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { supportsSurfaces, SurfaceCanvas, useSurfaceSupport } from '@petepetrash/munari'
import { captureEngine } from '@petepetrash/munari/advanced'
import { Button, Status, Tag } from '../../components/system'
import { sceneUrl } from '../../captureMode'
import { PolymerCanvasTelemetry } from './PolymerPrototypeSurface'
import { PolymerPrototypeTweaks } from './PolymerPrototypeTweaks'
import {
  notifyPolymerTuning,
  polymerTelemetry,
  polymerTuning,
  subscribePolymerTuning,
  type PolymerVariantId,
} from './polymerPrototypeTuning'
import { VariantA, VariantB, VariantC } from './PolymerPrototypeVariants'
import './polymerPrototype.css'

// Auto-install snapDOM when opened in unflagged browsers (e.g. IDE webviews, Safari, Firefox)
// without `?capture=auto`, while leaving native HTML-in-canvas untouched in Chrome 157+.
if (!supportsSurfaces()) {
  const { enableSnapdomCapture } = await import('@petepetrash/munari/snapdom')
  enableSnapdomCapture({ isolatedTextInputs: '[data-munari-capture-region]' })
}

interface VariantMeta {
  readonly id: PolymerVariantId
  readonly label: string
}

const VARIANTS: readonly VariantMeta[] = [
  { id: 'A', label: 'A (Editorial plates)' },
  { id: 'B', label: 'B (Modular console)' },
  { id: 'C', label: 'C (Translucent membranes)' },
]

function readVariant(): PolymerVariantId {
  const v = new URLSearchParams(window.location.search).get('variant')
  if (v === 'B' || v === 'C') return v
  return 'A'
}

function describeLightZone(u: number, v: number): string {
  const horiz = u < 0.36 ? 'left' : u > 0.64 ? 'right' : 'center'
  const vert = v < 0.33 ? 'top' : v > 0.66 ? 'low' : 'mid'
  return `Global light moved ${vert} ${horiz}`
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

function PrototypeSwitcher({
  current,
  onSelect,
}: {
  readonly current: PolymerVariantId
  readonly onSelect: (next: PolymerVariantId) => void
}) {
  const idx = VARIANTS.findIndex((v) => v.id === current)
  const active = VARIANTS[idx] ?? VARIANTS[0]

  const step = useCallback(
    (delta: number) => {
      const nextIdx = (idx + delta + VARIANTS.length) % VARIANTS.length
      const next = VARIANTS[nextIdx]
      if (next) onSelect(next.id)
    },
    [idx, onSelect],
  )

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        step(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        step(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  if (process.env.NODE_ENV === 'production') return null

  return (
    <aside className="poly-switcher" aria-label="Prototype variant switcher">
      <button type="button" className="poly-switcher-arrow" aria-label="Previous variant" onClick={() => step(-1)}>
        ←
      </button>
      <span className="poly-switcher-label m-ui">
        <b>PROTOTYPE</b> · {active.label}
      </span>
      <button type="button" className="poly-switcher-arrow" aria-label="Next variant" onClick={() => step(1)}>
        →
      </button>
    </aside>
  )
}

function TelemetryHud({
  polymerOn,
  onTogglePolymer,
  onSelectPresetPos,
}: {
  readonly polymerOn: boolean
  readonly onTogglePolymer: () => void
  readonly onSelectPresetPos: (u: number, v: number) => void
}) {
  const [, setTick] = useState(0)
  const settleTimer = useRef<number | null>(null)
  const activeFlag = useRef(false)

  useEffect(() => {
    Object.assign(window, { __polymerPerf: polymerTelemetry })
    // Update React HUD only on idle <-> active edges, never per drag frame!
    const wake = () => {
      if (!activeFlag.current) {
        activeFlag.current = true
        setTick((n) => n + 1)
      }
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(() => {
        activeFlag.current = false
        polymerTelemetry.rendersLastSecond = 0
        setTick((n) => n + 1)
      }, 650)
    }
    const unsub = subscribePolymerTuning(wake)
    const bootTimer = window.setTimeout(() => setTick((n) => n + 1), 500)
    return () => {
      unsub()
      window.clearTimeout(bootTimer)
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
    }
  }, [])

  const active = activeFlag.current || polymerTelemetry.rendersLastSecond > 0

  return (
    <div className="poly-hud m-ui" role="region" aria-label="Polymer prototype controls and telemetry">
      <div className="poly-hud-left">
        <Button compact variant={polymerOn ? 'solid' : 'outline'} onClick={onTogglePolymer}>
          {polymerOn ? '3D Polymer: On' : 'Flat 2D Baseline'}
        </Button>
        <span className="poly-sun-presets" role="group" aria-label="Light position presets">
          <Button compact variant="outline" onClick={() => onSelectPresetPos(0.16, 0.032)}>
            Morning left
          </Button>
          <Button compact variant="outline" onClick={() => onSelectPresetPos(0.5, 0.028)}>
            Overhead noon
          </Button>
          <Button compact variant="outline" onClick={() => onSelectPresetPos(0.84, 0.032)}>
            Evening right
          </Button>
        </span>
      </div>

      <div className="poly-hud-metrics">
        <Status status={active ? 'fallback' : 'live'}>
          {active ? 'Rendering interaction' : '0 fps · GPU idle'}
        </Status>
        <Tag>Engine: {captureEngine().name}</Tag>
        <Tag>Surfaces: {polymerTelemetry.activeSurfaces}</Tag>
        <Tag>DPR: {polymerTelemetry.dpr.toFixed(2)}</Tag>
      </div>
    </div>
  )
}

export function PolymerPrototypeApp({ onReady }: { readonly onReady?: () => void }) {
  const supported = useSurfaceSupport()
  const canvasId = useId()
  const [variant, setVariant] = useState<PolymerVariantId>(readVariant)
  const [polymerEnabled, setPolymerEnabled] = useState(true)
  const [maxDpr, setMaxDpr] = useState(() => (window.innerWidth < 680 ? 1.5 : polymerTuning.maxDpr))
  const [announcement, setAnnouncement] = useState('')

  const stageRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const announceTimer = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    const ready = document.fonts?.ready ?? Promise.resolve()
    void ready.then(() => {
      if (alive) requestAnimationFrame(() => onReady?.())
    })
    return () => {
      alive = false
    }
  }, [onReady])

  const syncHandleDom = useCallback((u: number, v: number) => {
    const btn = handleRef.current
    if (!btn) return
    btn.style.left = `${u * 100}%`
    btn.style.top = `${v * 100}%`
  }, [])

  const announce = useCallback((u: number, v: number) => {
    setAnnouncement(describeLightZone(u, v))
    if (announceTimer.current !== null) window.clearTimeout(announceTimer.current)
    announceTimer.current = window.setTimeout(() => setAnnouncement(''), 1000)
  }, [])

  const setLightUV = useCallback(
    (u: number, v: number, shouldAnnounce = false) => {
      polymerTuning.lightU = u
      polymerTuning.lightV = v
      syncHandleDom(u, v)
      notifyPolymerTuning()
      if (shouldAnnounce) announce(u, v)
    },
    [announce, syncHandleDom],
  )

  const moveLightToCss = useCallback(
    (localX: number, localY: number, shouldAnnounce = false) => {
      const stage = stageRef.current
      if (!stage) return
      const w = Math.max(stage.clientWidth, 1)
      const h = Math.max(stage.clientHeight, 1)
      const clampedX = Math.max(24, Math.min(localX, w - 24))
      const clampedY = Math.max(18, Math.min(localY, h - 24))
      setLightUV(clampedX / w, clampedY / h, shouldAnnounce)
    },
    [setLightUV],
  )

  const onHandlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const btn = handleRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    dragOffset.current = {
      x: event.clientX - (rect.left + rect.width * 0.5),
      y: event.clientY - (rect.top + rect.height * 0.5),
    }
    btn.setPointerCapture(event.pointerId)
    btn.classList.add('dragging')
  }

  const onHandlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const btn = handleRef.current
    const stage = stageRef.current
    if (!btn || !stage || !btn.hasPointerCapture(event.pointerId)) return
    const stageRect = stage.getBoundingClientRect()
    moveLightToCss(
      event.clientX - stageRect.left - dragOffset.current.x,
      event.clientY - stageRect.top - dragOffset.current.y,
    )
  }

  const onHandleLostCapture = () => {
    const btn = handleRef.current
    if (btn?.classList.contains('dragging')) {
      btn.classList.remove('dragging')
      announce(polymerTuning.lightU, polymerTuning.lightV)
    }
  }

  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const stage = stageRef.current
    if (!stage) return
    const stepPx = 22
    let dx = 0
    let dy = 0
    if (event.key === 'ArrowLeft') dx = -stepPx
    else if (event.key === 'ArrowRight') dx = stepPx
    else if (event.key === 'ArrowUp') dy = -stepPx
    else if (event.key === 'ArrowDown') dy = stepPx
    else return
    event.preventDefault()
    moveLightToCss(
      polymerTuning.lightU * stage.clientWidth + dx,
      polymerTuning.lightV * stage.clientHeight + dy,
      true,
    )
  }

  const selectVariant = useCallback((next: PolymerVariantId) => {
    setVariant(next)
    const params = new URLSearchParams(window.location.search)
    params.set('scene', 'polymer-prototype')
    params.set('variant', next)
    window.history.replaceState(null, '', `?${params.toString()}`)
    requestAnimationFrame(() => notifyPolymerTuning())
  }, [])

  const engineName = captureEngine().name
  const inScene = supported && polymerEnabled

  return (
    <div className="poly-page">
      <div className="poly-sr-only" aria-live="polite">
        {announcement}
      </div>

      <header className="poly-header">
        <a href={sceneUrl('home')} className="poly-wordmark">
          munari <span className="m-small m-quiet">· polymer visual study</span>
        </a>
        <nav aria-label="Prototype variants" className="poly-top-tabs m-ui">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              className="poly-variant-pill"
              data-active={variant === v.id || undefined}
              onClick={() => selectVariant(v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="poly-shell">
        <TelemetryHud
          polymerOn={polymerEnabled}
          onTogglePolymer={() => setPolymerEnabled((v) => !v)}
          onSelectPresetPos={(u, v) => setLightUV(u, v, true)}
        />

        <div key={engineName} ref={stageRef} className="poly-stage-root">
          <div className="poly-light-rail" aria-hidden />

          {supported && (
            <SurfaceCanvas
              id={canvasId}
              pointerMode="surfaces"
              frameloop="demand"
              dpr={[1, maxDpr]}
              gl={{ alpha: true, antialias: false, depth: false }}
              onCreated={({ gl }) => gl.setClearAlpha(0)}
              style={{ position: 'absolute', inset: 0, zIndex: 10 }}
            >
              <PolymerCanvasTelemetry />
            </SurfaceCanvas>
          )}

          <button
            ref={handleRef}
            type="button"
            className="poly-sun-handle"
            style={{ left: `${polymerTuning.lightU * 100}%`, top: `${polymerTuning.lightV * 100}%` }}
            aria-label="Global light source handle. Drag or use arrow keys to aim polymer shadows."
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onLostPointerCapture={onHandleLostCapture}
            onKeyDown={onHandleKeyDown}
          >
            <span className="poly-sun-dot" aria-hidden />
            <span className="m-small">Studio light</span>
          </button>

          <main className="poly-main">
            {variant === 'A' && <VariantA canvasId={canvasId} inScene={inScene} />}
            {variant === 'B' && <VariantB canvasId={canvasId} inScene={inScene} />}
            {variant === 'C' && <VariantC canvasId={canvasId} inScene={inScene} />}
          </main>
        </div>
      </div>

      <PolymerPrototypeTweaks onDprChange={setMaxDpr} />
      <PrototypeSwitcher current={variant} onSelect={selectVariant} />
    </div>
  )
}
