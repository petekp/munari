import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pixelGridSnap } from '@munari/core'
import {
  MicroCanvas,
  MicroSurface,
  type MicroSurfaceFrameCtx,
} from '../engine/reactHost'
import { createManifestDriver } from '../engine/manifest'
import { backdropGlassManifest } from '../materials/backdropGlass.material.gen'
import { flightCardManifest } from '../materials/flight.material.gen'

export interface OverlapProbeApi {
  readonly ready: boolean
}

declare global {
  interface Window {
    __overlapMicro?: OverlapProbeApi
  }
}

export function OverlapSlice() {
  const [sceneCount, setSceneCount] = useState(0)
  const presentedRef = useRef({ a: false, b: false })
  const driver = useMemo(() => createManifestDriver(flightCardManifest), [])

  const onFrameA = useCallback(
    (ctx: MicroSurfaceFrameCtx) => {
      ctx.setPose({ x: -90, y: 0, z: 40, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 })
      driver.writeUniforms(ctx.material, {
        aeroDir: [1, 0],
        aeroAmt: 0,
        aeroReach: 160,
        gloss: 0.0,
      })
    },
    [driver],
  )

  const onFrameB = useCallback(
    (ctx: MicroSurfaceFrameCtx) => {
      ctx.setPose({ x: 90, y: 20, z: 60, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 })
      driver.writeUniforms(ctx.material, {
        aeroDir: [0.7, 0.7],
        aeroAmt: 0,
        aeroReach: 160,
        gloss: 0.3,
      })
    },
    [driver],
  )

  const markPresented = useCallback((key: 'a' | 'b', p: 'page' | 'scene' | 'none') => {
    presentedRef.current[key] = p === 'scene'
    setSceneCount((presentedRef.current.a ? 1 : 0) + (presentedRef.current.b ? 1 : 0))
  }, [])

  useEffect(() => {
    window.__overlapMicro = { ready: sceneCount === 2 }
  }, [sceneCount])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgb(40, 101, 180)' }}>
      <MicroCanvas
        frameloop="demand"
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 20 }}
      />
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
        <MicroSurface
          inScene
          exclusive={false}
          placement="manual"
          size={[320, 220]}
          materialFactory={driver.factory}
          onFrame={onFrameA}
          onPresentationChange={(p) => markPresented('a', p)}
        >
          <div
            style={{
              width: 320,
              height: 220,
              background: 'rgba(220, 80, 40, 0.55)',
              color: '#fff',
              padding: 16,
              font: '600 18px/1.3 sans-serif',
            }}
          >
            Card A
          </div>
        </MicroSurface>
        <MicroSurface
          inScene
          exclusive={false}
          placement="manual"
          size={[320, 220]}
          materialFactory={driver.factory}
          onFrame={onFrameB}
          onPresentationChange={(p) => markPresented('b', p)}
        >
          <div
            style={{
              width: 320,
              height: 220,
              background: 'rgba(40, 180, 100, 0.55)',
              color: '#fff',
              padding: 16,
              font: '600 18px/1.3 sans-serif',
            }}
          >
            Card B
          </div>
        </MicroSurface>
      </div>
    </div>
  )
}

function HairlineCardContent() {
  return (
    <div style={{ width: 301, height: 121, background: '#000000', position: 'relative' }}>
      <div style={{ position: 'absolute', left: 24, right: 24, top: 30, height: 0.5, background: '#ffffff' }} />
      <div style={{ position: 'absolute', left: 24, right: 24, top: 60, height: 1, background: '#ffffff' }} />
    </div>
  )
}

export function Dpr2SnapSlice() {
  const [sceneCount, setSceneCount] = useState(0)
  const presentedRef = useRef({ raw: false, snapped: false })
  const driver = useMemo(() => createManifestDriver(flightCardManifest), [])

  const onFrameRaw = useCallback(
    (ctx: MicroSurfaceFrameCtx) => {
      ctx.setPose({ x: -200.25, y: 0.25, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 })
      driver.writeUniforms(ctx.material, { aeroDir: [1, 0], aeroAmt: 0, aeroReach: 160, gloss: 0 })
    },
    [driver],
  )

  const onFrameSnapped = useCallback(
    (ctx: MicroSurfaceFrameCtx) => {
      const baseX = 200.25
      const baseY = 0.25
      const dpr = ctx.viewport.dpr || 2
      const texelsX = Math.round(301 * dpr)
      const texelsY = Math.round(121 * dpr)
      const snap = pixelGridSnap({
        x: baseX,
        y: baseY,
        width: 301,
        height: 121,
        mag: 1,
        viewW: ctx.viewport.width,
        viewH: ctx.viewport.height,
        dpr,
        density: dpr,
        texelsX,
        texelsY,
      })
      ctx.setPose({
        x: baseX + snap.dx,
        y: baseY + snap.dy,
        z: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        sx: snap.sx,
        sy: snap.sy,
        sz: 1,
      })
      driver.writeUniforms(ctx.material, { aeroDir: [1, 0], aeroAmt: 0, aeroReach: 160, gloss: 0 })
    },
    [driver],
  )

  const markPresented = useCallback((key: 'raw' | 'snapped', p: 'page' | 'scene' | 'none') => {
    presentedRef.current[key] = p === 'scene'
    setSceneCount((presentedRef.current.raw ? 1 : 0) + (presentedRef.current.snapped ? 1 : 0))
  }, [])

  useEffect(() => {
    window.__overlapMicro = { ready: sceneCount === 2 }
  }, [sceneCount])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000000' }}>
      <MicroCanvas
        frameloop="demand"
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 20 }}
      />
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
        <MicroSurface
          inScene
          exclusive={false}
          placement="manual"
          resolution={2}
          size={[301, 121]}
          materialFactory={driver.factory}
          onFrame={onFrameRaw}
          onPresentationChange={(p) => markPresented('raw', p)}
        >
          <HairlineCardContent />
        </MicroSurface>
        <MicroSurface
          inScene
          exclusive={false}
          placement="manual"
          resolution={2}
          size={[301, 121]}
          materialFactory={driver.factory}
          onFrame={onFrameSnapped}
          onPresentationChange={(p) => markPresented('snapped', p)}
        >
          <HairlineCardContent />
        </MicroSurface>
      </div>
    </div>
  )
}

export function GlassBackdropSlice() {
  const [sceneCount, setSceneCount] = useState(0)
  const presentedRef = useRef({ base: false, glass: false })
  const baseDriver = useMemo(() => createManifestDriver(flightCardManifest), [])
  const glassDriver = useMemo(() => createManifestDriver(backdropGlassManifest), [])

  const onFrameBase = useCallback(
    (ctx: MicroSurfaceFrameCtx) => {
      ctx.setPose({ x: -120, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 })
      baseDriver.writeUniforms(ctx.material, { aeroDir: [1, 0], aeroAmt: 0, aeroReach: 160, gloss: 0 })
    },
    [baseDriver],
  )

  const onFrameGlass = useCallback(
    (ctx: MicroSurfaceFrameCtx) => {
      ctx.setPose({ x: 0, y: 0, z: 50, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 })
      glassDriver.writeUniforms(ctx.material, {
        tint: [1, 1, 1],
        amount: 0,
        shift: [-0.14, 0],
        highlight: 0,
      })
    },
    [glassDriver],
  )

  const markPresented = useCallback((key: 'base' | 'glass', p: 'page' | 'scene' | 'none') => {
    presentedRef.current[key] = p === 'scene'
    setSceneCount((presentedRef.current.base ? 1 : 0) + (presentedRef.current.glass ? 1 : 0))
  }, [])

  useEffect(() => {
    window.__overlapMicro = { ready: sceneCount === 2 }
  }, [sceneCount])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgb(40, 101, 180)' }}>
      <MicroCanvas
        frameloop="demand"
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 20 }}
      />
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
        <MicroSurface
          inScene
          exclusive={false}
          placement="manual"
          size={[440, 240]}
          materialFactory={baseDriver.factory}
          onFrame={onFrameBase}
          onPresentationChange={(p) => markPresented('base', p)}
        >
          <div style={{ width: 440, height: 240, display: 'flex' }}>
            <div style={{ flex: 1, background: 'rgb(200, 80, 40)' }} />
            <div style={{ flex: 1, background: 'rgb(40, 101, 180)' }} />
          </div>
        </MicroSurface>
        <MicroSurface
          inScene
          exclusive={false}
          placement="manual"
          size={[220, 160]}
          materialFactory={glassDriver.factory}
          onFrame={onFrameGlass}
          onPresentationChange={(p) => markPresented('glass', p)}
        >
          <div style={{ width: 220, height: 160, background: 'transparent' }} />
        </MicroSurface>
      </div>
    </div>
  )
}
