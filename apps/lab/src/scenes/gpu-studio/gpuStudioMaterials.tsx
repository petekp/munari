// Materials & backdrop gallery panel for Munari GPU Studio — extracted from
// `GpuStudio.tsx` so finish cards, custom manifests, `bleed` glow, and pass-2
// backdrop refraction live in a clean leaf panel.

import { useCallback, useMemo } from 'react'
import {
  Surface,
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
  roughness: 0.18,
  metalness: 0,
  transmission: { amount: 0.65, thickness: 18, dispersion: 0.25 },
  coat: { amount: 0.8, roughness: 0.08 },
  text: 'lit',
}

interface MaterialsPanelProps {
  readonly canvasId: string
  readonly onPresChange: (p: SurfacePresentation) => void
}

export function MaterialsPanel({ canvasId, onPresChange }: MaterialsPanelProps) {
  const foilUniforms = useMemo(() => ({ tilt: [0.38, -0.24] as const, intensity: 0.55, phase: 0.35 }), [])
  const glassUniforms = useMemo(
    () => ({ tint: [0.72, 0.9, 1.0] as const, amount: 0.78, shift: [0.012, 0.004] as const, highlight: 0.16 }),
    [],
  )

  const handleBackdropFrame = useCallback((ctx: SurfaceFrameContext) => {
    if (!ctx.pageRect) return
    ctx.setPose({ ...ctx.basePose, z: -12 })
  }, [])

  const handleGlassFrame = useCallback((ctx: SurfaceFrameContext) => {
    if (!ctx.pageRect) return
    ctx.setPose({ ...ctx.basePose, z: 24 })
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
            <div className="gpu-glass-card" data-testid="backdrop-glass">
              <strong>Glass Refract</strong>
              <span>@group(2)</span>
            </div>
          </Surface>
        </div>
      </div>
    </div>
  )
}
