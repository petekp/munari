// Frontier rendering prototypes — five gallery-framed DOM + WebGPU rendering
// directions on `?scene=frontier-prototype&variant=cmdk|letterpress|peel|patchbay|bounce`.
//
// Uses a single Munari `<Bar>` shell so each stage claims ~78% of the viewport,
// mounting one demand-driven SurfaceCanvas at a time (`0 fps` at rest).

import { useCallback, useEffect, useState } from 'react'
import { CaptureEngineStatus } from '../../components/CaptureEngineStatus'
import { Bar, Status } from '../../components/system'
import { sceneUrl } from '../../captureMode'
import './frontierPrototype.css'
import { FrontierBounce } from './FrontierBounce'
import { FrontierCmdk } from './FrontierCmdk'
import { FrontierLetterpress } from './FrontierLetterpress'
import { FrontierPatchbay } from './FrontierPatchbay'
import { FrontierPeel } from './FrontierPeel'
import {
  frontierTelemetry,
  resetFrontierFrameCounters,
  subscribeFrontierHud,
  type FrontierVariantId,
} from './frontierStage'

interface VariantEntry {
  readonly id: FrontierVariantId
  readonly num: string
  readonly shortLabel: string
  readonly title: string
  readonly instruction: string
}

const VARIANTS: readonly VariantEntry[] = [
  {
    id: 'cmdk',
    num: '01',
    shortLabel: 'Cmd+K',
    title: 'Refractive Cmd+K',
    instruction: 'Drag the 30 px acrylic collar across the color bands, or filter commands while prose stays selectable.',
  },
  {
    id: 'letterpress',
    num: '02',
    shortLabel: 'Letterpress',
    title: 'Letterpress & foil',
    instruction: 'Click the gold-foil headline to edit it in place, or drag across body prose to test native selection.',
  },
  {
    id: 'peel',
    num: '03',
    shortLabel: 'Peel',
    title: 'Peel to inspect',
    instruction: 'Drag the fold grip or adjust peel: click Limiter chips on the left and Copy JSX through the peeled right.',
  },
  {
    id: 'patchbay',
    num: '04',
    shortLabel: 'Patchbay',
    title: '3D anchor patchbay',
    instruction: 'Cross-patch Out to In jacks, pluck the braided cords, or reflow prose to see frame-locked anchors.',
  },
  {
    id: 'bounce',
    num: '05',
    shortLabel: 'Bounce',
    title: 'Lateral light bounce',
    instruction: 'Drag the specimen toward any glass pane, or click folders and finishes.',
  },
]

function StaticMunariMark() {
  return (
    <svg className="frontier-logo-svg" aria-hidden="true" viewBox="80 58 855 154">
      <path fill="#66cda8" d="M143.6,116.2 L136.4,118.6 L129.9,124.3 L123,140.3 L122.2,138.7 L122.2,118.9 L121.2,117.6 L83.5,117.6 L94.8,118.9 L94.9,203.2 L83.5,203.7 L83.5,204.6 L130.2,204.6 L122.2,203.2 L122.2,162.9 L125.3,136.9 L132.8,124 L140,121.3 L145.7,124.3 L148.4,136.9 L148.5,203.2 L140.9,203.7 L140.9,204.6 L184,204.6 L175.6,203.2 L175.6,162.9 L179.1,136 L184.9,125.6 L193.8,121.3 L200.5,127 L202.2,144.9 L202.1,203.2 L193.8,203.7 L193.8,204.6 L240.5,204.6 L229.3,203.2 L229,139.6 L224.7,125.2 L216.3,117.9 L198.3,115.9 L185.1,122.5 L178.2,134.2 L175.9,143.6 L173.5,129.7 L166.9,120.5 L156.2,116 Z" />
      <path fill="#f5a53f" d="M303.4,118 L288.2,121.4 L280.8,127 L286.5,136.9 L274.4,178.1 L274.5,188.9 L282.1,199.7 L300.8,205.3 L314.2,202.7 L328.6,192.9 L333.9,200.8 L351.9,206.3 L365.3,203.5 L376.5,194.3 L378.3,184.4 L376.1,182.3 L370.3,185.3 L383.5,136.9 L383.4,126.1 L374.3,118.5 L352.8,118.7 L339.3,123 L335.3,129.7 L340.6,139.6 L330.8,171.9 L325,179.4 L318.3,178.1 L328.9,137.8 L328.9,126.1 L320.5,118.7 Z" />
      <path fill="#b47deb" d="M456.4,117.8 L453.7,119.8 L449.3,136 L432.7,175.4 L431.8,185.3 L442.9,197.1 L448.3,197.1 L459.9,184.2 L489.5,161.6 L498.5,158 L501.5,162.9 L500.5,185.3 L503.5,194.3 L514.7,199.3 L521.8,195.4 L525,189.8 L519.6,174.5 L520.5,145.8 L520.3,138.7 L511.1,132 L503,131.1 L489.5,139.3 L461.7,160.5 L471.9,139.6 L473.6,128.8 L468.9,120.4 L461.7,117.7 Z" />
      <path fill="#52c7f2" d="M602.1,117.6 L601.2,134.3 L585,134.7 L583.9,136 L583.9,204.6 L619.1,204.4 L619.5,171 L635.8,171 L635.8,204.5 L670.2,204.6 L670.9,135.1 L654.1,134.6 L653.7,118 Z M619.5,136.9 L635.8,136.9 L635.8,151.2 L619.5,151.2 Z" />
      <path fill="#66c94e" d="M783.4,115.9 L771.7,122.3 L766.3,130.3 L763.6,117.8 L736.3,117.6 L736.3,204.6 L769,204.6 L769.5,165.6 L772.1,153.9 L780.7,146.6 L798.6,145.4 L799.1,118 L795,115.9 Z" />
      <path fill="#f2695c" d="M878.8,117.8 L890.9,118.9 L890.9,203.2 L879.7,203.7 L879.7,204.6 L929.1,204.6 L917.9,203.2 L917.8,118 Z M904,61.3 A16.2,16.2 0 1,0 904.1,93.7 A16.2,16.2 0 1,0 904,61.3 Z" />
    </svg>
  )
}

function readVariant(): FrontierVariantId {
  const raw = new URLSearchParams(window.location.search).get('variant')
  if (raw === 'letterpress' || raw === 'B') return 'letterpress'
  if (raw === 'peel' || raw === 'C') return 'peel'
  if (raw === 'patchbay' || raw === 'D') return 'patchbay'
  if (raw === 'bounce' || raw === 'E') return 'bounce'
  return 'cmdk'
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

function FrontierTelemetryReadout() {
  const [, setTick] = useState(0)
  useEffect(() => subscribeFrontierHud(() => setTick((n) => n + 1)), [])
  const active = frontierTelemetry.rendersLastSecond > 0
  return (
    <span className="frontier-bar-telemetry">
      <CaptureEngineStatus />
      <Status status={active ? 'fallback' : 'live'}>
        {active ? `${frontierTelemetry.rendersLastSecond} f/s` : '0 fps'}
      </Status>
    </span>
  )
}

function DesktopSwitcherStrip({
  current,
  onSelect,
}: {
  readonly current: FrontierVariantId
  readonly onSelect: (next: FrontierVariantId) => void
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
      if (event.defaultPrevented || isEditableTarget(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
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
    <aside className="frontier-switcher" aria-label="Prototype variant switcher">
      <button type="button" className="frontier-switcher-btn" aria-label="Previous prototype" onClick={() => step(-1)}>
        ←
      </button>
      <span className="frontier-switcher-label m-ui">
        <b>{active?.num}</b> · {active?.title}
      </span>
      <button type="button" className="frontier-switcher-btn" aria-label="Next prototype" onClick={() => step(1)}>
        →
      </button>
    </aside>
  )
}

export function FrontierPrototypeApp({ onReady }: { readonly onReady?: () => void }) {
  const [variant, setVariant] = useState<FrontierVariantId>(readVariant)

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

  useEffect(() => {
    const onPop = () => {
      resetFrontierFrameCounters()
      setVariant(readVariant())
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const selectVariant = useCallback((next: FrontierVariantId) => {
    resetFrontierFrameCounters()
    setVariant(next)
    const params = new URLSearchParams(window.location.search)
    params.set('scene', 'frontier-prototype')
    params.set('variant', next)
    window.history.replaceState(null, '', `?${params.toString()}`)
  }, [])

  const meta = VARIANTS.find((v) => v.id === variant) ?? VARIANTS[0]

  return (
    <div className="frontier-page">
      <Bar
        lead={
          <a href={sceneUrl('home')} className="frontier-home-link" aria-label="Munari home">
            <StaticMunariMark />
          </a>
        }
        title={meta?.title ?? 'Frontier'}
        titleTag="h1"
        instruction={meta?.instruction}
        linksLabel="Frontier prototypes"
        links={
          <>
            <span className="frontier-nav-pills" role="group" aria-label="Select prototype">
              {VARIANTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="frontier-nav-pill"
                  aria-current={variant === item.id ? 'page' : undefined}
                  onClick={() => selectVariant(item.id)}
                >
                  <span className="m-readout">{item.num}</span> {item.shortLabel}
                </button>
              ))}
            </span>
            <FrontierTelemetryReadout />
          </>
        }
      />

      <main className="frontier-main">
        {variant === 'cmdk' && <FrontierCmdk key="cmdk" />}
        {variant === 'letterpress' && <FrontierLetterpress key="letterpress" />}
        {variant === 'peel' && <FrontierPeel key="peel" />}
        {variant === 'patchbay' && <FrontierPatchbay key="patchbay" />}
        {variant === 'bounce' && <FrontierBounce key="bounce" />}
      </main>

      <DesktopSwitcherStrip current={variant} onSelect={selectVariant} />
    </div>
  )
}
