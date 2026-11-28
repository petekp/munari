// Three.js reference harness for the side-by-side finish parity probe.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Surface,
  SurfaceCanvas,
  createSurfaceLight,
  type SurfaceFinish,
} from '@petepetrash/munari'
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

declare global {
  interface Window {
    __parityReady?: boolean
    __parityBoxes?: () => readonly { readonly id: string; readonly left: number; readonly top: number; readonly width: number; readonly height: number }[]
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

function ThreeParityApp() {
  const canvasId = useId()
  const rig = useMemo(readRig, [])
  const sceneSetRef = useRef(new Set<string>())
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

  const markPresentation = useCallback((id: string, pres: string | null) => {
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
  }, [])

  useEffect(() => {
    if (!allScene) {
      window.__parityReady = false
      return
    }
    let alive = true
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (alive) window.__parityReady = true
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
        dpr={2}
        camera={{ fov: 42 }}
        gl={{ alpha: true, antialias: false, depth: false }}
        lighting={{ key: keyLight }}
        onCreated={({ gl }) => gl.setClearAlpha(0)}
        style={{ position: 'fixed', inset: 0, zIndex: 10 }}
      />

      <div className="parity-row">
        {OPAQUE_PRESETS.map((preset) => (
          <div key={preset} className="parity-slot" data-parity-card={preset}>
            <Surface.Root
              canvasId={canvasId}
              inScene
              finish={cardFinish(preset)}
              onPresentationChange={(p) => markPresentation(preset, p)}
            >
              <Surface.HTML>
                <ParityCardDom preset={preset} />
              </Surface.HTML>
              <Surface.Scene>
                <Surface.Mesh placement="match-dom" />
              </Surface.Scene>
            </Surface.Root>
          </div>
        ))}
      </div>

      <div className="parity-glass-row">
        <div className="parity-backdrop-slot">
          <Surface.Root
            canvasId={canvasId}
            inScene
            onPresentationChange={(p) => markPresentation('backdrop', p)}
          >
            <Surface.HTML>
              <ParityBackdropDom />
            </Surface.HTML>
            <Surface.Scene>
              <Surface.Mesh placement="match-dom" renderOrder={0} />
            </Surface.Scene>
          </Surface.Root>
        </div>

        {GLASS_PRESETS.map((preset) => (
          <div key={preset} className="parity-slot" data-parity-card={preset}>
            <Surface.Root
              canvasId={canvasId}
              inScene
              finish={cardFinish(preset)}
              onPresentationChange={(p) => markPresentation(preset, p)}
            >
              <Surface.HTML>
                <ParityCardDom preset={preset} />
              </Surface.HTML>
              <Surface.Scene>
                <Surface.Mesh placement="match-dom" renderOrder={1} />
              </Surface.Scene>
            </Surface.Root>
          </div>
        ))}
      </div>
    </div>
  )
}

const rootEl = document.getElementById('root')
if (rootEl) createRoot(rootEl).render(<ThreeParityApp />)
