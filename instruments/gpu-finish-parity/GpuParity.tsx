// WebGPU (`@petepetrash/munari/gpu`) harness for the side-by-side finish parity probe.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Surface,
  SurfaceCanvas,
  createSurfaceLight,
  getGpuHostStats,
  requestGpuFrame,
  type SurfaceFinish,
} from '@petepetrash/munari/gpu'
import type { FinishPreset } from '../../registry/finishes/finishes'
import {
  GLASS_PRESETS,
  OPAQUE_PRESETS,
  PARITY_CSS,
  PARITY_FINISHES,
  PARITY_INKS,
  PARITY_KEY_PARAMS,
  PARITY_PRESETS,
  type ParityRigKind,
  cardMarkupCopy,
} from './parityData'

interface PerfSummary {
  readonly samples: number
  readonly medianMs: number
  readonly p95Ms: number
  readonly maxMs: number
  readonly gpuPassSamples: number
  readonly gpuPassMs: number | null
  readonly gpuPassP95Ms: number | null
  readonly idleRenders: number
}

declare global {
  interface Window {
    __parityReady?: boolean
    __parityErrors?: readonly string[]
    __parityBoxes?: () => readonly { readonly id: string; readonly left: number; readonly top: number; readonly width: number; readonly height: number }[]
    __parityPerfSweep?: () => Promise<PerfSummary>
  }
}

function readRig(): ParityRigKind {
  const q = new URLSearchParams(window.location.search).get('rig')
  return q === 'point' ? 'point' : 'softbox'
}

const TOTAL_SURFACES = PARITY_PRESETS.length + 1

function ParityCardDom({ preset }: { readonly preset: FinishPreset }) {
  const copy = cardMarkupCopy(preset)
  const ink = PARITY_INKS[preset]
  return (
    <div className="parity-card" style={{ color: ink.ink }}>
      <div>
        <div className="parity-title">{copy.title}</div>
        <div className="parity-sub" style={{ color: ink.quietInk }}>{copy.detail}</div>
      </div>
      <div className="parity-footer" style={{ color: ink.quietInk }}>
        <span>THREE</span>
        <span>PARITY</span>
      </div>
    </div>
  )
}

function ParityBackdropDom() {
  return (
    <div className="parity-backdrop">
      <div className="parity-stripe" style={{ background: '#e85d04' }}>EMBER #E85D04</div>
      <div className="parity-stripe" style={{ background: '#00b4d8' }}>CYAN #00B4D8</div>
      <div className="parity-stripe" style={{ background: '#1e293b' }}>SLATE #1E293B</div>
    </div>
  )
}

function GpuParityApp() {
  const canvasId = useId()
  const rig = useMemo(readRig, [])
  const sceneSetRef = useRef(new Set<string>())
  const rendererRef = useRef<Parameters<NonNullable<Parameters<typeof SurfaceCanvas>[0]['onReady']>>[0] | null>(null)
  const [allScene, setAllScene] = useState(false)

  const keyLight = useMemo(
    () =>
      createSurfaceLight({
        x: PARITY_KEY_PARAMS.x,
        y: PARITY_KEY_PARAMS.y,
        z: PARITY_KEY_PARAMS.z,
        brightness: PARITY_KEY_PARAMS.brightness,
        size: rig === 'softbox' ? PARITY_KEY_PARAMS.softboxSize : undefined,
      }),
    [rig],
  )

  const markPresentation = useCallback((id: string, pres: string) => {
    if (pres === 'scene') sceneSetRef.current.add(id)
    else sceneSetRef.current.delete(id)
    setAllScene(sceneSetRef.current.size >= TOTAL_SURFACES)
  }, [])

  useEffect(() => {
    window.__parityBoxes = () =>
      [...document.querySelectorAll('[data-parity-card]')].map((el) => {
        const r = el.getBoundingClientRect()
        return {
          id: el.getAttribute('data-parity-card') ?? '',
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        }
      })

    window.__parityPerfSweep = async () => {
      const durations: number[] = []
      const gpuDurations: number[] = []
      const origRaf = window.requestAnimationFrame.bind(window)
      let currentFrameMs = 0
      window.requestAnimationFrame = (cb) =>
        origRaf((ts) => {
          const before = getGpuHostStats(canvasId).renderCount
          const t0 = performance.now()
          cb(ts)
          const dt = performance.now() - t0
          if (getGpuHostStats(canvasId).renderCount > before) {
            currentFrameMs = dt
          }
        })

      try {
        for (let i = 0; i < 34; i++) {
          currentFrameMs = -1
          keyLight.set({ x: 320 + i * 12, y: 200 + Math.sin(i * 0.4) * 80 })
          requestGpuFrame(canvasId)
          await new Promise<void>((resolve) => origRaf(() => resolve()))
          if (currentFrameMs >= 0 && i >= 4) durations.push(currentFrameMs)
          const gpuSample = rendererRef.current?.lastGpuPassMs?.()
          if (gpuSample !== null && gpuSample !== undefined && i >= 4) gpuDurations.push(gpuSample)
        }
      } finally {
        keyLight.set({ x: PARITY_KEY_PARAMS.x, y: PARITY_KEY_PARAMS.y })
        requestGpuFrame(canvasId)
        window.requestAnimationFrame = origRaf
      }

      await new Promise<void>((resolve) => origRaf(() => resolve()))
      await new Promise<void>((resolve) => origRaf(() => resolve()))
      const sorted = [...durations].sort((a, b) => a - b)
      const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))] ?? 0
      const sortedGpu = [...gpuDurations].sort((a, b) => a - b)
      const qGpu = (p: number) =>
        sortedGpu.length > 0 ? (sortedGpu[Math.min(sortedGpu.length - 1, Math.round(p * (sortedGpu.length - 1)))] ?? null) : null
      const r0 = getGpuHostStats(canvasId).renderCount
      await new Promise((resolve) => setTimeout(resolve, 400))
      const r1 = getGpuHostStats(canvasId).renderCount
      window.__parityErrors = [...(rendererRef.current?.validationErrors ?? [])]
      return {
        samples: sorted.length,
        medianMs: q(0.5),
        p95Ms: q(0.95),
        maxMs: sorted[sorted.length - 1] ?? 0,
        gpuPassSamples: sortedGpu.length,
        gpuPassMs: qGpu(0.5) ?? rendererRef.current?.lastGpuPassMs?.() ?? null,
        gpuPassP95Ms: qGpu(0.95),
        idleRenders: r1 - r0,
      }
    }
  }, [canvasId, keyLight])

  useEffect(() => {
    if (!allScene) {
      window.__parityReady = false
      return
    }
    let alive = true
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (alive) {
            window.__parityErrors = [...(rendererRef.current?.validationErrors ?? [])]
            window.__parityReady = true
          }
        })
      })
    })
    return () => {
      alive = false
    }
  }, [allScene])

  const cardFinish = (preset: FinishPreset): SurfaceFinish => ({
    ...PARITY_FINISHES[preset],
    text: 'lit',
  })

  return (
    <div className="parity-page">
      <style>{PARITY_CSS}</style>
      <SurfaceCanvas
        id={canvasId}
        pointerMode="surfaces"
        frameloop="demand"
        fov={42}
        lighting={{ key: keyLight }}
        onReady={(r) => {
          rendererRef.current = r
        }}
        style={{ position: 'fixed', inset: 0, zIndex: 10 }}
      />

      <div className="parity-row">
        {OPAQUE_PRESETS.map((preset) => (
          <div key={preset} className="parity-slot" data-parity-card={preset}>
            <Surface
              canvasId={canvasId}
              inScene
              size={[210, 150]}
              finish={cardFinish(preset)}
              onPresentationChange={(p) => markPresentation(preset, p)}
            >
              <ParityCardDom preset={preset} />
            </Surface>
          </div>
        ))}
      </div>

      <div className="parity-glass-row">
        <div className="parity-backdrop-slot">
          <Surface
            canvasId={canvasId}
            inScene
            size={[716, 106]}
            onPresentationChange={(p) => markPresentation('backdrop', p)}
          >
            <ParityBackdropDom />
          </Surface>
        </div>

        {GLASS_PRESETS.map((preset) => (
          <div key={preset} className="parity-slot" data-parity-card={preset}>
            <Surface
              canvasId={canvasId}
              inScene
              size={[210, 150]}
              finish={cardFinish(preset)}
              onPresentationChange={(p) => markPresentation(preset, p)}
            >
              <ParityCardDom preset={preset} />
            </Surface>
          </div>
        ))}
      </div>
    </div>
  )
}

const rootEl = document.getElementById('root')
if (rootEl) createRoot(rootEl).render(<GpuParityApp />)
