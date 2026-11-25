// Polymer container surface — retained HTML wrapped in a demand-driven 3D polymer housing.
//
// The law: HTML owns semantics, text selection, form state, and focus; the 3D
// pass owns only cushion lighting and the ray-projected soft shadow. When
// springs settle and the global light stands still, `frameloop="demand"` stops
// claiming frames (`0 fps` at rest).

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Surface,
  useSurfaceNodes,
  useSurfacePaintedSize,
  useSurfaceStatus,
  type SurfaceCanvasId,
} from '@petepetrash/munari'
import {
  createPhysicalPolymerBodyMaterial,
  createPolymerBodyMaterial,
  createPolymerBodyUniforms,
  createPolymerShadowMaterial,
  createPolymerShadowUniforms,
  SHADOW_PAD_PX,
  STUDIO_LIGHT_BODY_HEIGHT,
  type PolymerBodyUniforms,
  type PolymerShadowUniforms,
} from './polymerPrototypeNodes'
import {
  notifyPolymerHud,
  polymerTelemetry,
  polymerTuning,
  subscribePolymerTuning,
} from './polymerPrototypeTuning'
import { placeStudioLight, usePolymerBody } from './PolymerPrototypeStudioLight'

const noRaycast = () => {}

export interface PolymerContainerProps {
  readonly canvasId: SurfaceCanvasId
  readonly inScene: boolean
  readonly elevationScale?: number
  readonly radiusPx?: number
  readonly tintHex?: string
  readonly opacityOverride?: number
  readonly recessed?: boolean
  readonly pressable?: boolean
  readonly className?: string
  readonly style?: CSSProperties
  readonly children: ReactNode
}

interface SlotMetrics {
  cx: number
  cy: number
  w: number
  h: number
}

function HandBuiltBodySlot({ uniforms }: { readonly uniforms: PolymerBodyUniforms }) {
  const surface = useSurfaceNodes()
  const material = useMemo(() => createPolymerBodyMaterial(surface, uniforms), [surface, uniforms])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}

function PhysicalBodySlot({ uniforms }: { readonly uniforms: PolymerBodyUniforms }) {
  const surface = useSurfaceNodes()
  const material = useMemo(() => createPhysicalPolymerBodyMaterial(surface, uniforms), [surface, uniforms])
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    material.roughness = polymerTuning.roughness
    material.ior = polymerTuning.ior
    material.clearcoat = polymerTuning.clearcoat
    material.clearcoatRoughness = polymerTuning.clearcoatRoughness
    material.sheen = polymerTuning.sheen
    material.sheenRoughness = polymerTuning.sheenRoughness
    // Sheen tint starts at the square root of the base color (docs/materials-research-catalog.md §1, velvet row).
    const base = uniforms.baseColor.value
    material.sheenColor.setRGB(Math.sqrt(base.r), Math.sqrt(base.g), Math.sqrt(base.b))
  })

  return <primitive object={material} attach="material" />
}

function PolymerMaterialSlot({ uniforms }: { readonly uniforms: PolymerBodyUniforms }) {
  const body = usePolymerBody()
  return body === 'physical' ? <PhysicalBodySlot uniforms={uniforms} /> : <HandBuiltBodySlot uniforms={uniforms} />
}

function PolymerShadowSkirt({
  uniforms,
  visible,
}: {
  readonly uniforms: PolymerShadowUniforms
  readonly visible: boolean
}) {
  const painted = useSurfacePaintedSize()
  const skirtRef = useRef<THREE.Mesh>(null)
  const material = useMemo(() => createPolymerShadowMaterial(uniforms), [uniforms])
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    const mesh = skirtRef.current
    if (!mesh) return
    const [pw, ph] = painted()
    const w = Math.max(pw || uniforms.cardSize.value.x, 1)
    const h = Math.max(ph || uniforms.cardSize.value.y, 1)
    mesh.scale.set((w + SHADOW_PAD_PX * 2) / w, (h + SHADOW_PAD_PX * 2) / h, 1)
  })

  return (
    <mesh
      ref={skirtRef}
      position={[0, 0, -0.0006]}
      renderOrder={-1}
      raycast={noRaycast}
      visible={visible}
      material={material}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}

function studioLightCss() {
  const stageEl = document.querySelector<HTMLElement>('.poly-stage-root')
  const sw = Math.max(stageEl?.clientWidth ?? window.innerWidth, 1)
  const sh = Math.max(stageEl?.clientHeight ?? window.innerHeight, 1)
  return { x: polymerTuning.lightU * sw, y: polymerTuning.lightV * sh, z: polymerTuning.lightHeight }
}

function syncUniforms(
  bodyU: PolymerBodyUniforms,
  shadowU: PolymerShadowUniforms,
  metrics: SlotMetrics,
  elev: number,
  options: {
    readonly radiusPx: number | undefined
    readonly tintHex: string | undefined
    readonly opacityOverride: number | undefined
    readonly recessed: boolean
  },
) {
  const { x: lx, y: ly, z: lz } = studioLightCss()
  const radius = options.radiusPx ?? polymerTuning.cornerRadius
  const opacity = options.opacityOverride ?? polymerTuning.bodyOpacity
  const hex = options.tintHex ?? polymerTuning.baseHex

  bodyU.baseColor.value.set(hex)
  bodyU.lightPosCss.value.set(lx, ly, lz)
  bodyU.cardCenterCss.value.set(metrics.cx, metrics.cy)
  bodyU.elevation.value = elev
  bodyU.bevelWidth.value = polymerTuning.bevelWidth
  bodyU.cornerRadius.value = radius
  bodyU.pillow.value = polymerTuning.pillow
  bodyU.bodyOpacity.value = opacity
  bodyU.subsurfaceWrap.value = polymerTuning.subsurfaceWrap
  bodyU.warmth.value = polymerTuning.warmth
  bodyU.specular.value = polymerTuning.specular
  bodyU.shininess.value = Math.max(6, Math.round((1 - polymerTuning.roughness) * 48))
  bodyU.grain.value = polymerTuning.grain
  bodyU.seamInk.value = polymerTuning.seamInk
  bodyU.recessed.value = options.recessed ? 1 : 0

  shadowU.cardSize.value.set(Math.max(metrics.w, 1), Math.max(metrics.h, 1))
  shadowU.lightPosCss.value.set(lx, ly, lz)
  shadowU.cardCenterCss.value.set(metrics.cx, metrics.cy)
  shadowU.elevation.value = options.recessed ? 0 : elev
  shadowU.cornerRadius.value = radius
  shadowU.lightRadius.value = polymerTuning.lightRadius
  shadowU.shadowOpacity.value = options.recessed ? 0 : polymerTuning.shadowOpacity
  shadowU.contactOpacity.value = options.recessed ? 0 : polymerTuning.contactOpacity
  shadowU.bodyOpacity.value = opacity
}

function PolymerMeshController({
  metricsRef,
  elevationScale,
  radiusPx,
  tintHex,
  opacityOverride,
  recessed,
  pressable,
}: {
  readonly metricsRef: { readonly current: SlotMetrics }
  readonly elevationScale: number
  readonly radiusPx: number | undefined
  readonly tintHex: string | undefined
  readonly opacityOverride: number | undefined
  readonly recessed: boolean
  readonly pressable: boolean
}) {
  const status = useSurfaceStatus()
  const invalidate = useThree((s) => s.invalidate)
  const hovered = useRef(false)
  const pressed = useRef(false)
  const currentElev = useRef(polymerTuning.elevation * elevationScale)
  const reducedMotion = useRef(false)
  const meshRef = useRef<THREE.Mesh>(null)

  const bodyUniforms = useMemo(
    () => createPolymerBodyUniforms(tintHex ?? polymerTuning.baseHex, recessed),
    [tintHex, recessed],
  )
  const shadowUniforms = useMemo(() => createPolymerShadowUniforms(), [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotion.current = mq.matches
    const onChange = () => {
      reducedMotion.current = mq.matches
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (status.presentation === 'scene') {
      polymerTelemetry.activeSurfaces += 1
      notifyPolymerHud()
      return () => {
        polymerTelemetry.activeSurfaces = Math.max(0, polymerTelemetry.activeSurfaces - 1)
        notifyPolymerHud()
      }
    }
    return undefined
  }, [status.presentation])

  useFrame((_, delta) => {
    const base = recessed ? 0 : polymerTuning.elevation * elevationScale
    const boost = pressable && hovered.current && !pressed.current ? 2.5 : 0
    const dip = pressable && pressed.current ? base * 0.62 : 0
    const goal = Math.max(0, base + boost - dip)

    if (reducedMotion.current) {
      currentElev.current = goal
    } else {
      const next = THREE.MathUtils.damp(currentElev.current, goal, 18, Math.min(delta, 0.05))
      if (Math.abs(next - goal) > 0.025) {
        currentElev.current = next
        invalidate()
      } else {
        currentElev.current = goal
      }
    }

    syncUniforms(bodyUniforms, shadowUniforms, metricsRef.current, currentElev.current, {
      radiusPx,
      tintHex,
      opacityOverride,
      recessed,
    })

    const mesh = meshRef.current
    if (mesh && polymerTuning.body === 'physical' && status.presentation === 'scene') {
      const light = studioLightCss()
      placeStudioLight(mesh, metricsRef.current, {
        x: light.x,
        y: light.y,
        heightPx: light.z * STUDIO_LIGHT_BODY_HEIGHT,
      })
    }
  })

  return (
    <Surface.Mesh
      ref={meshRef}
      placement="match-dom"
      renderOrder={1}
      material={<PolymerMaterialSlot uniforms={bodyUniforms} />}
      onPointerEnter={() => {
        if (!pressable) return
        hovered.current = true
        invalidate()
      }}
      onPointerLeave={() => {
        if (!pressable) return
        hovered.current = false
        pressed.current = false
        invalidate()
      }}
      onPointerDown={() => {
        if (!pressable) return
        pressed.current = true
        invalidate()
      }}
      onPointerUp={() => {
        if (!pressable) return
        pressed.current = false
        invalidate()
      }}
    >
      <PolymerShadowSkirt
        uniforms={shadowUniforms}
        visible={status.presentation === 'scene' && !recessed}
      />
    </Surface.Mesh>
  )
}

export function PolymerCanvasTelemetry() {
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  const frameTimestamps = useRef<number[]>([])

  useEffect(() => {
    return subscribePolymerTuning(() => invalidate())
  }, [invalidate])

  useFrame(() => {
    const now = performance.now()
    polymerTelemetry.rendersTotal += 1
    polymerTelemetry.dpr = gl.getPixelRatio()
    const stamps = frameTimestamps.current
    const prev = stamps.at(-1)
    if (prev !== undefined) {
      polymerTelemetry.lastFrameMs = Math.min(now - prev, 99.9)
    }
    stamps.push(now)
    while (stamps.length > 0 && now - (stamps[0] ?? now) > 1000) {
      stamps.shift()
    }
    polymerTelemetry.rendersLastSecond = stamps.length
  })

  return null
}

export function PolymerContainer({
  canvasId,
  inScene,
  elevationScale = 1,
  radiusPx,
  tintHex,
  opacityOverride,
  recessed = false,
  pressable = true,
  className = '',
  style,
  children,
}: PolymerContainerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const metricsRef = useRef<SlotMetrics>({ cx: 640, cy: 360, w: 320, h: 160 })

  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      const stage = el.closest('.poly-stage-root')?.getBoundingClientRect()
      const ox = stage?.left ?? 0
      const oy = stage?.top ?? 0
      metricsRef.current = {
        cx: rect.left - ox + rect.width * 0.5,
        cy: rect.top - oy + rect.height * 0.5,
        w: rect.width,
        h: rect.height,
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure, { passive: true })
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [inScene])

  const effectiveRadius = radiusPx ?? polymerTuning.cornerRadius

  return (
    <div ref={wrapperRef} className="poly-slot">
      <Surface.Root canvasId={canvasId} inScene={inScene}>
        <Surface.HTML>
          <div
            className={`poly-content ${inScene ? 'poly-content--scene' : 'poly-content--flat'} ${className}`.trim()}
            style={{
              ...style,
              borderRadius: inScene ? effectiveRadius : 0,
            }}
          >
            {children}
          </div>
        </Surface.HTML>
        <Surface.Scene>
          <PolymerMeshController
            metricsRef={metricsRef}
            elevationScale={elevationScale}
            radiusPx={radiusPx}
            tintHex={tintHex}
            opacityOverride={opacityOverride}
            recessed={recessed}
            pressable={pressable}
          />
        </Surface.Scene>
      </Surface.Root>
    </div>
  )
}
