// Materials & backdrop gallery panel for Munari GPU Studio — extracted from
// `GpuStudio.tsx` so finish cards, custom manifests, `bleed` glow, and
// pointer-draggable pass-2 backdrop refraction live in a clean leaf panel.

import { useCallback, useEffect, useMemo, useRef, type PointerEvent } from 'react'
import {
  Surface,
  requestGpuFrame,
  type SurfaceFinish,
  type SurfaceFrameContext,
  type SurfacePresentation,
} from '@petepetrash/munari/gpu'
import { bleedGlowManifest } from './materials/bleedGlow.material.gen'
import { foilManifest } from './materials/foil.material.gen'
import { glassRefractManifest } from './materials/glassRefract.material.gen'
import { lacquerLtcManifest } from './materials/lacquerLtc.material.gen'

const LACQUER_FINISH: SurfaceFinish = {
  color: '#7d1924',
  roughness: 0.14,
  metalness: 0,
  coat: { amount: 1, roughness: 0.04 },
  specularIntensity: 0,
  text: 'lit',
  lightGain: 1,
}

const VELVET_FINISH: SurfaceFinish = {
  color: '#1b2247',
  roughness: 0.85,
  metalness: 0,
  sheen: { amount: 0.9, roughness: 0.35, color: '#6b77d4' },
  lightGain: 2.5,
}

const GLASS_FINISH: SurfaceFinish = {
  color: '#dce8f8',
  roughness: 0.46,
  ior: 1.52,
  transmission: { amount: 0.96, thickness: 18, dispersion: 0 },
  edge: { width: 8, rimColor: null },
  environment: 'gradient',
  text: 'lit',
}

interface MaterialsPanelProps {
  readonly canvasId: string
  readonly onPresChange: (p: SurfacePresentation) => void
}

export function MaterialsPanel({ canvasId, onPresChange }: MaterialsPanelProps) {
  const foilUniforms = useMemo(() => ({ tilt: [0.38, -0.24] as const, intensity: 0.55, phase: 0.35 }), [])
  const glassUniforms = useMemo(
    () => ({ tint: [0.88, 0.95, 1.0] as const, amount: 0.34, shift: [0, 0] as const, highlight: 0.24 }),
    [],
  )
  const glassOffsetRef = useRef({ x: 0, y: 0 })
  const perspScaleRef = useRef(1)
  const lastTrustedRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const dragRef = useRef<{ id: number; startX: number; startY: number; ox: number; oy: number } | null>(null)

  const handleBackdropFrame = useCallback((ctx: SurfaceFrameContext) => {
    if (!ctx.pageRect) return
    ctx.setPose({ ...ctx.basePose, z: -12 })
  }, [])

  const handleGlassFrame = useCallback((ctx: SurfaceFrameContext) => {
    if (!ctx.pageRect) return
    const cz = ctx.viewport.cameraZ
    perspScaleRef.current = cz > 24 ? (cz - 24) / cz : 1
    const off = glassOffsetRef.current
    ctx.setPose({ ...ctx.basePose, x: ctx.basePose.x + off.x, y: ctx.basePose.y - off.y, z: 24 })
  }, [])

  useEffect(() => {
    const onDown = (ev: globalThis.PointerEvent) => {
      if (!ev.isTrusted) return
      lastTrustedRef.current = { x: ev.clientX, y: ev.clientY, pointerId: ev.pointerId }
    }
    const onMove = (ev: globalThis.PointerEvent) => {
      if (!ev.isTrusted) return
      lastTrustedRef.current = { x: ev.clientX, y: ev.clientY, pointerId: ev.pointerId }
      const drag = dragRef.current
      if (!drag || ev.pointerId !== drag.id) return
      const scale = perspScaleRef.current
      glassOffsetRef.current = {
        x: Math.max(-140, Math.min(80, drag.ox + (ev.clientX - drag.startX) / scale)),
        y: Math.max(-60, Math.min(60, drag.oy + (ev.clientY - drag.startY) / scale)),
      }
      requestGpuFrame(canvasId)
    }
    const onUp = (ev: globalThis.PointerEvent) => {
      if (!ev.isTrusted) return
      if (dragRef.current?.id === ev.pointerId) dragRef.current = null
    }
    window.addEventListener('pointerdown', onDown, { capture: true, passive: true })
    window.addEventListener('pointermove', onMove, { capture: true, passive: true })
    window.addEventListener('pointerup', onUp, { capture: true })
    window.addEventListener('pointercancel', onUp, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
    }
  }, [canvasId])

  const onGlassDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const start = lastTrustedRef.current
    dragRef.current = {
      id: start?.pointerId ?? e.pointerId,
      startX: start?.x ?? e.clientX,
      startY: start?.y ?? e.clientY,
      ox: glassOffsetRef.current.x,
      oy: glassOffsetRef.current.y,
    }
  }, [])

  return (
    <div className="gpu-studio-stage">
      <div className="gpu-materials-grid">
        <Surface canvasId={canvasId} inScene size={[210, 150]} finish={LACQUER_FINISH} pixelSnap onPresentationChange={onPresChange}>
          <div className="gpu-finish-card" data-testid="finish-lacquer" style={{ color: '#fde8e8' }}>
            <strong>Lacquer Crimson</strong>
            <span>pixelSnap + lit text</span>
          </div>
        </Surface>

        <Surface canvasId={canvasId} inScene size={[210, 150]} finish={VELVET_FINISH}>
          <div className="gpu-finish-card" data-testid="finish-velvet" style={{ color: '#e0e7ff' }}>
            <strong>Velvet Midnight</strong>
            <span>Sheen + 2.5x key gain</span>
          </div>
        </Surface>

        <Surface canvasId={canvasId} inScene size={[210, 150]} finish={GLASS_FINISH}>
          <div className="gpu-finish-card" data-testid="finish-glass" style={{ color: '#0f172a' }}>
            <strong>Glass Frosted</strong>
            <span>Frosted glass finish</span>
          </div>
        </Surface>

        <Surface canvasId={canvasId} inScene size={[210, 150]} material={foilManifest} uniforms={foilUniforms}>
          <div className="gpu-foil-card">
            <strong>Foil Manifest</strong>
            <span>0 TypeGPU runtime</span>
          </div>
        </Surface>

        <Surface canvasId={canvasId} inScene size={[210, 150]} material={lacquerLtcManifest}>
          <div className="gpu-finish-card" data-testid="manifest-lacquer-ltc" style={{ color: '#fde8e8', background: 'transparent' }}>
            <strong>Lacquer LTC</strong>
            <span>Heitz 64x64 rgba16float</span>
          </div>
        </Surface>

        <Surface canvasId={canvasId} inScene size={[210, 150]} bleed={20} material={bleedGlowManifest}>
          <div className="gpu-bleed-card" data-testid="manifest-bleed-glow">
            <strong>Bleed Glow</strong>
            <span>20px uvRect halo</span>
          </div>
        </Surface>
      </div>

      <div className="gpu-backdrop-stage">
        <div className="gpu-backdrop-back">
          <Surface canvasId={canvasId} inScene size={[210, 120]} onFrame={handleBackdropFrame}>
            <div className="gpu-backdrop-card" data-testid="backdrop-source">
              <strong>Backdrop Signal</strong>
              <span className="gpu-backdrop-target" aria-hidden />
              <span>Pass 1 opaque</span>
            </div>
          </Surface>
        </div>
        <div className="gpu-backdrop-front">
          <Surface
            canvasId={canvasId}
            inScene
            size={[170, 120]}
            material={glassRefractManifest}
            uniforms={glassUniforms}
            onFrame={handleGlassFrame}
          >
            <div
              className="gpu-glass-card"
              data-testid="backdrop-glass"
              onPointerDown={onGlassDown}
            >
              <strong>Glass Refract</strong>
              <span>Drag to bend stripes</span>
            </div>
          </Surface>
        </div>
      </div>
    </div>
  )
}
