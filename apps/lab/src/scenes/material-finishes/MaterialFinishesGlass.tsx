// Glass comparison — the four glass presets, each in two tints, over a
// backdrop Surface that the glass bends, under one key light the page drags
// (?scene=material-finishes&compare=glass). With &finish=<id>&count=<n> the
// page shows n cards of one finish over the same backdrop instead, so a
// glass finish's cost can be measured against another finish on the same
// page; &bare hides the captions.
//
// The law: a glass finish shows only what the canvas drew before it, so the
// backdrop is a Surface in the same canvas, and every card draws after it
// (renderOrder 1). The page behind the canvas is never bent.
//
// Ownership: the library builds and lights the glass; this module owns the
// backdrop, the cards and the light handle.

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { useThree } from '@react-three/fiber'
import { WebGPURenderer } from 'three/webgpu'
import { Surface, SurfaceCanvas, useCaptureSupport, type SurfaceCanvasId, type SurfaceFinish, type SurfacePresentation } from '@petepetrash/munari'
import { finishes, inks, type FinishPreset } from './recipe/finishes'
import { keyLight, lightingOf, startStudio, studio } from './materialFinishesTuning'

interface GlassLook {
  readonly preset: FinishPreset
  readonly label: string
  readonly tint: string
  readonly ink: string
}

// Each preset in its own tint and one other, so a tint reads as part of the
// preset and not of one color. Inks by the presets' rule on each tint.
const GLASS_LOOKS: readonly GlassLook[] = [
  { preset: 'glass-clear', label: 'Clear', tint: '#eef4f1', ink: '#15181c' },
  { preset: 'glass-clear', label: 'Clear, bottle green', tint: '#a9d8bd', ink: '#15181c' },
  { preset: 'glass-cobalt', label: 'Tinted, cobalt', tint: '#3d6fd6', ink: '#f5f2ee' },
  { preset: 'glass-cobalt', label: 'Tinted, amber', tint: '#d98a2b', ink: '#15181c' },
  { preset: 'glass-frosted', label: 'Frosted', tint: '#f2f4f6', ink: '#15181c' },
  { preset: 'glass-frosted', label: 'Frosted, rose', tint: '#f0bcc8', ink: '#15181c' },
  { preset: 'glass-crystal', label: 'Crystal', tint: '#f7f7fa', ink: '#15181c' },
  { preset: 'glass-crystal', label: 'Crystal, violet', tint: '#b7a3ea', ink: '#15181c' },
]

const KEY_STEP = 0.02
const MAX_BENCH_CARDS = 12

function isPreset(value: string | null): value is FinishPreset {
  return value !== null && value in finishes
}

interface BenchCard {
  readonly finish: SurfaceFinish
  readonly ink: string
  readonly label: string
}

function readCards(): readonly BenchCard[] {
  const params = new URLSearchParams(window.location.search)
  const finish = params.get('finish')
  if (!isPreset(finish)) {
    return GLASS_LOOKS.map((look) => ({ finish: { ...finishes[look.preset], color: look.tint }, ink: look.ink, label: `${look.label} · ${look.preset} · ${look.tint}` }))
  }
  const count = Math.min(Math.max(Number(params.get('count') ?? 4) || 4, 1), MAX_BENCH_CARDS)
  return Array.from({ length: count }, () => ({ finish: finishes[finish], ink: inks[finish].ink, label: finish }))
}

function recordPresented(presentation: SurfacePresentation) {
  if (presentation === 'scene') (window.__glassPresented ??= []).push(performance.now())
}

type CardStyle = CSSProperties & { readonly '--mfg-ink': string }

function GlassCard({ canvasId, inScene, card, index }: { readonly canvasId: SurfaceCanvasId; readonly inScene: boolean; readonly card: BenchCard; readonly index: number }) {
  const [added, setAdded] = useState(0)
  const style: CardStyle = { '--mfg-ink': card.ink }
  return (
    <figure className="mfg-item">
      <figcaption className="mfg-caption">{card.label}</figcaption>
      <Surface.Root canvasId={canvasId} inScene={inScene} finish={card.finish} onPresentationChange={recordPresented}>
        <Surface.HTML>
          <div className="mfg-card" style={style} data-glass-card={index}>
            <p className="mfg-label">Reading list</p>
            <h2 className="mfg-title">Field notes</h2>
            <p className="mfg-body">Small type stays legible at 13 px, and the button still takes a click.</p>
            <button type="button" className="mfg-button" onClick={() => setAdded((n) => n + 1)}>
              {added === 0 ? 'Save' : `Saved ${added}`}
            </button>
          </div>
        </Surface.HTML>
        <Surface.Scene>
          <Surface.Mesh placement="match-dom" renderOrder={1} />
        </Surface.Scene>
      </Surface.Root>
    </figure>
  )
}

function Backdrop({ canvasId, inScene }: { readonly canvasId: SurfaceCanvasId; readonly inScene: boolean }) {
  return (
    <Surface.Root canvasId={canvasId} inScene={inScene}>
      <Surface.HTML>
        <div className="mfg-backdrop" aria-hidden>
          <div className="mfg-stripes" />
          <span className="mfg-disc mfg-disc--a" />
          <span className="mfg-disc mfg-disc--b" />
          <span className="mfg-disc mfg-disc--c" />
          <p className="mfg-poster mfg-poster--a">HTML, 3D, and Shaders, Unified.</p>
          <p className="mfg-poster mfg-poster--b">Retained text keeps its focus and its input.</p>
          <p className="mfg-poster mfg-poster--c">0123456789 — ABCDEFGHIJKLM</p>
        </div>
      </Surface.HTML>
      <Surface.Scene>
        <Surface.Mesh placement="match-dom" pointerEvents="none" />
      </Surface.Scene>
    </Surface.Root>
  )
}

declare global {
  interface Window {
    /** Mean ms per frame over `batches` batches of `frames` back-to-back frames, timed to the GPU queue. */
    __glassBench?: (frames?: number, batches?: number) => Promise<readonly number[]>
    /** The renderer's texture count and bytes, from three's Info. */
    __glassMemory?: () => { readonly textures: number; readonly texturesSize: number }
    /** performance.now() when each card first presented in the canvas. */
    __glassPresented?: number[]
  }
}

/** Times back-to-back frames for the cost probe. */
function FrameBench() {
  const advance = useThree((state) => state.advance)
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    if (!(gl instanceof WebGPURenderer)) return
    const { backend } = gl
    if (!('device' in backend) || !(backend.device instanceof GPUDevice)) return
    const device = backend.device
    window.__glassBench = async (frames = 30, batches = 8) => {
      const results: number[] = []
      for (let batch = 0; batch < batches; batch++) {
        await device.queue.onSubmittedWorkDone()
        const start = performance.now()
        for (let frame = 0; frame < frames; frame++) advance(performance.now())
        await device.queue.onSubmittedWorkDone()
        results.push((performance.now() - start) / frames)
      }
      return results
    }
    window.__glassMemory = () => ({ textures: gl.info.memory.textures, texturesSize: gl.info.memory.texturesSize })
    return () => {
      delete window.__glassBench
      delete window.__glassMemory
    }
  }, [advance, gl])
  return null
}

function keyDelta(key: string): readonly [number, number] | null {
  switch (key) {
    case 'ArrowLeft': return [-KEY_STEP, 0]
    case 'ArrowRight': return [KEY_STEP, 0]
    case 'ArrowUp': return [0, -KEY_STEP]
    case 'ArrowDown': return [0, KEY_STEP]
    default: return null
  }
}

export function MaterialFinishesGlass({ onReady }: { readonly onReady?: () => void }) {
  const supported = useCaptureSupport()
  const canvasId = useId()
  const [cards] = useState(() => {
    startStudio('point')
    return readCards()
  })
  const bare = new URLSearchParams(window.location.search).has('bare')
  const handleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const release = keyLight.subscribe(({ x, y }) => {
      const handle = handleRef.current
      if (!handle || x === null || y === null) return
      handle.style.left = `${x}px`
      handle.style.top = `${y}px`
    })
    return release
  }, [])

  useEffect(() => {
    let alive = true
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (alive) requestAnimationFrame(() => onReady?.())
    })
    return () => {
      alive = false
    }
  }, [onReady])

  const moveLight = (x: number, y: number) => {
    studio.keyX = Math.min(Math.max(x, 0), 1)
    studio.keyY = Math.min(Math.max(y, 0), 1)
    keyLight.set({ x: studio.keyX * window.innerWidth, y: studio.keyY * window.innerHeight })
  }
  const onHandlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onHandlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) moveLight(event.clientX / window.innerWidth, event.clientY / window.innerHeight)
  }
  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = keyDelta(event.key)
    if (!delta) return
    event.preventDefault()
    moveLight(studio.keyX + delta[0], studio.keyY + delta[1])
  }

  return (
    <div className="mfg-page" data-bare={bare || undefined}>
      {supported && (
        <SurfaceCanvas
          id={canvasId}
          pointerMode="surfaces"
          frameloop="demand"
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: false, depth: false }}
          onCreated={({ gl }) => gl.setClearAlpha(0)}
          style={{ position: 'fixed', inset: 0, zIndex: 10 }}
          lighting={lightingOf(false)}
        >
          <FrameBench />
        </SurfaceCanvas>
      )}
      <Backdrop canvasId={canvasId} inScene={supported} />
      <main className="mfg-grid">
        {cards.map((card, index) => (
          <GlassCard key={index} canvasId={canvasId} inScene={supported} card={card} index={index} />
        ))}
      </main>
      {supported && (
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
    </div>
  )
}
