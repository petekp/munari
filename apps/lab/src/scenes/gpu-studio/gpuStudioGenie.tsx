// Wave 1 Genie warp panel for Munari GPU Studio — pure `@petepetrash/munari/gpu`
// `Surface.deform(...)` + `genieWarp` (`genieLaw.ts`) + analytic spring (`zero Three.js`).

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Surface,
  requestGpuFrame,
  type SurfaceFrameContext,
  type SurfacePresentation,
} from '@petepetrash/munari/gpu'
import { createSpring, type SpringConfig } from '../../behaviors/spring'
import { GENIE_DEFAULTS, genieWarp, type GenieParams } from '../genie/genieLaw'

const GENIE_WINDOW_SIZE: readonly [number, number] = [340, 220]
const GENIE_SPRING: SpringConfig = {
  stiffness: 185,
  damping: 24,
  mass: 1,
  precision: 0.002,
  velocityPrecision: 0.01,
}

export interface GenieDebugSnapshot {
  readonly minimized: boolean
  readonly progress: number
  readonly settled: boolean
}

interface GeniePanelProps {
  readonly canvasId: string
  readonly onPresChange: (p: SurfacePresentation) => void
  readonly debugRef: React.MutableRefObject<(() => GenieDebugSnapshot) | null>
  readonly toggleRef: React.MutableRefObject<(() => void) | null>
}

export function GeniePanel({ canvasId, onPresChange, debugRef, toggleRef }: GeniePanelProps) {
  const [minimized, setMinimized] = useState(false)
  const [note, setNote] = useState('Funnel stays live DOM')
  const [pinned, setPinned] = useState(true)
  const deskRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLButtonElement>(null)
  const spring = useMemo(() => createSpring(0, GENIE_SPRING), [])
  const progressRef = useRef(0)
  const settledRef = useRef(true)
  const lastAppliedRef = useRef<{
    readonly t: number
    readonly geo: unknown
    readonly dockX: number
    readonly dockY: number
    readonly slotHalf: number
  } | null>(null)

  useEffect(() => {
    spring.setTarget(minimized ? 1 : 0)
    settledRef.current = false
    requestGpuFrame(canvasId)
  }, [minimized, spring, canvasId])

  useEffect(() => {
    debugRef.current = () => ({
      minimized,
      progress: progressRef.current,
      settled: settledRef.current,
    })
    toggleRef.current = () => setMinimized((v) => !v)
    return () => {
      debugRef.current = null
      toggleRef.current = null
    }
  }, [minimized, debugRef, toggleRef])

  const handleFrame = useMemo(
    () => (ctx: SurfaceFrameContext) => {
      const active = spring.step(ctx.dtMs)
      const t = Math.min(1, Math.max(0, spring.get().value))
      progressRef.current = t
      settledRef.current = !active

      const [w, h] = GENIE_WINDOW_SIZE
      let dockX = 112
      let dockY = -230
      let slotHalf = 34
      if (ctx.pageRect && dockRef.current) {
        const dr = dockRef.current.getBoundingClientRect()
        const wr = ctx.pageRect
        dockX = dr.left + dr.width / 2 - (wr.left + wr.width / 2)
        dockY = wr.top + wr.height / 2 - (dr.top + dr.height / 2)
        slotHalf = Math.max(20, dr.width * 0.4)
      }
      const prev = lastAppliedRef.current
      if (
        !active &&
        prev &&
        prev.geo === ctx.geometry &&
        Math.abs(t - prev.t) < 1e-5 &&
        Math.abs(dockX - prev.dockX) < 0.25 &&
        Math.abs(dockY - prev.dockY) < 0.25 &&
        Math.abs(slotHalf - prev.slotHalf) < 0.25
      ) {
        return false
      }
      lastAppliedRef.current = { t, geo: ctx.geometry, dockX, dockY, slotHalf }
      const params: GenieParams = {
        ...GENIE_DEFAULTS,
        w,
        h,
        dockX,
        dockY,
        slotHalf,
      }
      ctx.deform((lx, ly) => {
        const u = lx / w + 0.5
        const vTopDown = 0.5 - ly / h
        const warped = genieWarp(u, vTopDown, t, params)
        return { x: warped.x, y: warped.y, z: 0 }
      })
      return active
    },
    [spring],
  )

  return (
    <div className="gpu-studio-stage">
      <div className="gpu-studio-controls">
        <button
          type="button"
          data-testid="genie-toggle"
          className="gpu-studio-btn"
          onClick={() => setMinimized((v) => !v)}
        >
          {minimized ? 'Restore window' : 'Minimize window'}
        </button>
        <span data-testid="genie-state">{minimized ? 'minimized' : 'open'}</span>
      </div>

      <div ref={deskRef} className="gpu-genie-desk">
        <Surface
          canvasId={canvasId}
          inScene
          size={GENIE_WINDOW_SIZE}
          segments={[16, 48]}
          pointerEvents={minimized ? 'none' : 'geometry'}
          onFrame={handleFrame}
          onPresentationChange={onPresChange}
        >
          <div className="gpu-genie-window" data-testid="genie-window">
            <div className="gpu-genie-titlebar">
              <span>Genie Warp Sheet</span>
              <button
                type="button"
                data-testid="genie-minimize-btn"
                className="gpu-studio-btn"
                onClick={() => setMinimized((v) => !v)}
              >
                {minimized ? 'Open' : 'Minimize'}
              </button>
            </div>
            <input
              data-testid="genie-note"
              className="gpu-flight-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Genie window note"
            />
            <label className="gpu-genie-check">
              <input
                data-testid="genie-pin"
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              <span>Keep dock target live</span>
            </label>
          </div>
        </Surface>

        <div className="gpu-genie-dock-row">
          <button
            ref={dockRef}
            type="button"
            data-testid="genie-dock"
            className="gpu-genie-dock"
            aria-pressed={minimized}
            onClick={() => setMinimized((v) => !v)}
          >
            <span>Dock</span>
            <span>{minimized ? 'Restore' : 'Slot'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
