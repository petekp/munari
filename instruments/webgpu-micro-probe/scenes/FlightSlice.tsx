import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { paintStats } from '@munari/core'
import {
  MicroCanvas,
  MicroSurface,
  getMicroHostStats,
  simulateMicroDeviceLoss,
  type MicroMaterialFactory,
  type MicroSurfaceFrameCtx,
} from '../engine/reactHost'
import type { MicroMaterial } from '../engine/webgpu'
import {
  mat4FromPositionEulerScale,
  mat4Multiply,
  mat4PerspectiveZeroToOne,
  transformPoint,
} from '../engine/math'
import { FLIGHT_CARD_WGSL } from './flightWgsl'
import './flight.css'

export interface FlightCustomValues {
  readonly aeroDir: readonly [number, number]
  readonly aeroAmt: number
  readonly aeroReach: number
  readonly gloss: number
}

export interface FlightTypeGpuDriver {
  readonly factory: MicroMaterialFactory
  readonly writeUniforms: (material: MicroMaterial, values: FlightCustomValues) => void
}

export interface FlightMicroProbeApi {
  readonly ready: boolean
  lift(): void
  land(): void
  simulateLoss(): boolean
  buttonPoint(role: 'increment' | 'toggle'): { readonly x: number; readonly y: number } | null
  state(): {
    readonly inScene: boolean
    readonly presentation: 'page' | 'scene' | 'none'
    readonly count: number
    readonly note: string
    readonly rendererLosses: number
    readonly cardRect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null
    readonly pageHidden: boolean
  }
  stats(): { readonly renderCount: number; readonly workClaims: number; readonly paints: number }
}

declare global {
  interface Window {
    __flightMicro?: FlightMicroProbeApi
  }
}

export function FlightSlice({ createTypeGpuDriver }: { readonly createTypeGpuDriver?: () => FlightTypeGpuDriver }) {
  const [inScene, setInScene] = useState(false)
  const [presented, setPresented] = useState<'page' | 'scene' | 'none'>('page')
  const [count, setCount] = useState(0)
  const [note, setNote] = useState('initial note')
  const [rendererLosses, setRendererLosses] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)
  const typeGpuDriver = useMemo(() => createTypeGpuDriver?.(), [createTypeGpuDriver])
  const lastPoseRef = useRef<{ x: number; y: number; z: number; rx: number; ry: number; camZ: number; vw: number; vh: number }>({
    x: 0,
    y: 0,
    z: 0,
    rx: 0,
    ry: 0,
    camZ: 1000,
    vw: 1200,
    vh: 860,
  })
  const uniformsRef = useRef(new Float32Array(8))
  const stateRef = useRef({ inScene, presented, count, note, rendererLosses })
  stateRef.current = { inScene, presented, count, note, rendererLosses }

  const onFrame = useCallback((ctx: MicroSurfaceFrameCtx) => {
    const rect = ctx.pageRect
    if (!rect) return
    const baseX = rect.left + rect.width / 2 - ctx.viewport.width / 2
    const baseY = ctx.viewport.height / 2 - (rect.top + rect.height / 2)
    const liftZ = ctx.easedProgress * 110
    const tiltY = ctx.easedProgress * 0.14
    const tiltX = -ctx.easedProgress * 0.08
    lastPoseRef.current = {
      x: baseX,
      y: baseY,
      z: liftZ,
      rx: tiltX,
      ry: tiltY,
      camZ: ctx.viewport.cameraZ,
      vw: ctx.viewport.width,
      vh: ctx.viewport.height,
    }
    ctx.setPose({ x: baseX, y: baseY, z: liftZ, rx: tiltX, ry: tiltY, rz: 0, sx: 1, sy: 1, sz: 1 })
    if (typeGpuDriver) {
      typeGpuDriver.writeUniforms(ctx.material, {
        aeroDir: [0.707, 0.707],
        aeroAmt: ctx.easedProgress * 8,
        aeroReach: 160,
        gloss: ctx.easedProgress * 0.18,
      })
      return
    }
    const u = uniformsRef.current
    // aero: dir=(0.7, 0.7), amt=8*progress, reach=160; gloss=0.18*progress
    u[0] = 0.707
    u[1] = 0.707
    u[2] = ctx.easedProgress * 8
    u[3] = 160
    u[4] = ctx.easedProgress * 0.18
    ctx.setCustomUniforms(u)
  }, [typeGpuDriver])

  const materialOptions = useMemo(
    () => ({
      wgsl: FLIGHT_CARD_WGSL,
      sampleViewFormat: 'rgba8unorm' as const,
      doubleSided: true,
      customUniformFloats: 8,
    }),
    [],
  )

  const materialFactory = typeGpuDriver?.factory

  useEffect(() => {
    window.__flightMicro = {
      ready: true,
      lift: () => setInScene(true),
      land: () => setInScene(false),
      simulateLoss: () => simulateMicroDeviceLoss(),
      buttonPoint: (role) => {
        const card = cardRef.current
        const btn = card?.querySelector(`[data-role="${role}"]`)
        if (!card || !btn) return null
        const cr = card.getBoundingClientRect()
        const br = btn.getBoundingClientRect()
        const cx = br.left + br.width / 2 - cr.left
        const cy = br.top + br.height / 2 - cr.top
        if (stateRef.current.presented !== 'scene') {
          return { x: br.left + br.width / 2, y: br.top + br.height / 2 }
        }
        const p = lastPoseRef.current
        const lx = cx - 300 / 2
        const ly = 170 / 2 - cy
        const model = mat4FromPositionEulerScale(p.x, p.y, p.z, p.rx, p.ry, 0, 1, 1, 1)
        const view = mat4FromPositionEulerScale(0, 0, -p.camZ, 0, 0, 0, 1, 1, 1)
        const proj = mat4PerspectiveZeroToOne(42, p.vw / p.vh, 1, p.camZ * 3)
        const mvp = mat4Multiply(mat4Multiply(proj, view), model)
        const ndc = transformPoint(mvp, lx, ly, 0)
        return {
          x: ((ndc[0] + 1) / 2) * p.vw,
          y: ((1 - ndc[1]) / 2) * p.vh,
        }
      },
      state: () => {
        const card = cardRef.current
        const pageSlot = document.querySelector('[data-micro-page-slot]')
        const r = card?.getBoundingClientRect()
        return {
          inScene: stateRef.current.inScene,
          presentation: stateRef.current.presented,
          count: stateRef.current.count,
          note: stateRef.current.note,
          rendererLosses: stateRef.current.rendererLosses,
          cardRect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null,
          pageHidden: pageSlot instanceof HTMLElement ? pageSlot.style.visibility === 'hidden' : false,
        }
      },
      stats: () => {
        const host = getMicroHostStats()
        const paints = paintStats().reduce((sum, s) => sum + s.paints, 0)
        return { ...host, paints }
      },
    }
    return () => {
      delete window.__flightMicro
    }
  }, [])

  return (
    <div className="flight-page">
      <MicroCanvas
        frameloop="demand"
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0, zIndex: 20 }}
        onRendererLost={() => setRendererLosses((n) => n + 1)}
      />
      <div className="flight-board">
        <MicroSurface
          inScene={inScene}
          size={[300, 170]}
          segments={[12, 12]}
          material={materialOptions}
          materialFactory={materialFactory}
          onFrame={onFrame}
          onPresentationChange={setPresented}
        >
          <div ref={cardRef} className="flight-card" style={{ width: 300, height: 170 }}>
            <div className="flight-card-head">
              <span>Card 05 — Retained DOM</span>
              <span>{presented}</span>
            </div>
            <input
              className="flight-input"
              aria-label="Card note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flight-actions">
              <button
                type="button"
                className="flight-btn"
                data-role="increment"
                onClick={() => setCount((c) => c + 1)}
              >
                Count: {count}
              </button>
              <button
                type="button"
                className="flight-btn flight-btn-primary"
                data-role="toggle"
                onClick={() => setInScene((v) => !v)}
              >
                {inScene ? 'Land' : 'Lift'}
              </button>
            </div>
          </div>
        </MicroSurface>
      </div>
    </div>
  )
}
