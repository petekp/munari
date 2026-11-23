// Variant 01 (`BeyondDieline`): Live HTML packaging dieline -> 3D physical carton.
//
// A single `<Surface>` holds a 696x504 9-panel Swiss industrial packaging net
// with live `<input>` typography, Pantone-style colorway chips, and spec switches
// across Front, Left, Right, Back, Top Lid, Bottom, Tuck Flap, and Dust Flaps.
// `deformSurfaceGeometry` folds all 9 panels into a watertight 360-degree-orbitable
// 3D carton while keeping every face directly interactive.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Surface,
  SurfaceCanvas,
  deformSurfaceGeometry,
  useSurfaceNodes,
  useSurfaceRefresh,
  useSurfaceStatus,
  useCaptureSupport,
} from '@petepetrash/munari'
import { Button, Slider } from '../../components/system'
import {
  FrontierCanvasTelemetry,
  FrontierPixelCamera,
  retainActiveSurface,
  useReducedMotion,
} from '../frontier-prototype/frontierStage'
import {
  DIELINE_H,
  DIELINE_W,
  createDielineCrossGeometry,
  foldDielinePoint,
} from './beyondDielineLaw'
import {
  createDielineMaterial,
  createDielineShadowMaterial,
  createDielineUniforms,
  type DielineUniforms,
} from './beyondDielineNodes'

const noRaycast = () => {}

interface Colorway {
  readonly id: string
  readonly code: string
  readonly hex: string
  readonly ink: string
}

const COLORWAYS: readonly Colorway[] = [
  { id: 'vermilion', code: '021C', hex: '#e84c2b', ink: '#ffffff' },
  { id: 'cobalt', code: '286C', hex: '#215ee6', ink: '#ffffff' },
  { id: 'matcha', code: '347C', hex: '#16965a', ink: '#ffffff' },
  { id: 'carbon', code: '419C', hex: '#1d212b', ink: '#f6f4ee' },
]

const POWER_SPECS = ['USB-C 5V', '110V US', '230V EU'] as const

function DielineMaterialSlot({ uniforms }: { readonly uniforms: DielineUniforms }) {
  const surface = useSurfaceNodes()
  const material = useMemo(() => createDielineMaterial(surface, uniforms), [surface, uniforms])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}

function DielineScenePresenter({
  fold,
  yawDeg,
  pitchDeg,
  fitScale,
  syncKey,
}: {
  readonly fold: number
  readonly yawDeg: number
  readonly pitchDeg: number
  readonly fitScale: number
  readonly syncKey: string
}) {
  const status = useSurfaceStatus()
  const refreshSurface = useSurfaceRefresh()
  const invalidate = useThree((s) => s.invalidate)
  const uniforms = useMemo(createDielineUniforms, [])
  const geometry = useMemo(createDielineCrossGeometry, [])
  const shadowMat = useMemo(() => createDielineShadowMaterial(uniforms), [uniforms])
  const prevSyncRef = useRef(syncKey)

  useEffect(
    () => () => {
      geometry.dispose()
      shadowMat.dispose()
    },
    [geometry, shadowMat],
  )

  useEffect(() => {
    if (status.presentation === 'scene') return retainActiveSurface()
    return undefined
  }, [status.presentation])

  useEffect(() => {
    if (prevSyncRef.current !== syncKey) {
      prevSyncRef.current = syncKey
      refreshSurface()
    }
  }, [syncKey, refreshSurface])

  useLayoutEffect(() => {
    uniforms.foldAmount.value = fold
    deformSurfaceGeometry(geometry, [DIELINE_W, DIELINE_H], (x, y, idx) =>
      foldDielinePoint(x, y, fold, idx),
    )
    geometry.computeVertexNormals()
    const norm = geometry.getAttribute('normal')
    if (norm instanceof THREE.BufferAttribute) norm.needsUpdate = true
    invalidate()
  }, [fold, geometry, uniforms, invalidate])

  useEffect(() => {
    invalidate()
  }, [yawDeg, pitchDeg, fitScale, invalidate])

  const pitchRad = (pitchDeg * Math.PI) / 180
  const yawRad = (yawDeg * Math.PI) / 180

  return (
    <group scale={fitScale}>
      <mesh
        position={[8, -142 * fold, -110]}
        scale={[340, 220, 1]}
        renderOrder={-1}
        raycast={noRaycast}
        material={shadowMat}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>

      <group position={[0, fold * 8, 0]} rotation={[pitchRad, yawRad, 0]}>
        <Surface.Mesh
          placement="manual"
          alpha="source"
          frustumCulled={false}
          geometry={<primitive object={geometry} attach="geometry" />}
          material={<DielineMaterialSlot uniforms={uniforms} />}
        />
      </group>
    </group>
  )
}

function DielineSheetHtml({
  titleInputId,
  productName,
  colorway,
  powerSpec,
  lotNumber,
  sealed,
  onChangeName,
  onSelectColorway,
  onSelectPower,
  onStampLot,
  onToggleSealed,
}: {
  readonly titleInputId: string
  readonly productName: string
  readonly colorway: Colorway
  readonly powerSpec: string
  readonly lotNumber: number
  readonly sealed: boolean
  readonly onChangeName: (next: string) => void
  readonly onSelectColorway: (id: string) => void
  readonly onSelectPower: (spec: string) => void
  readonly onStampLot: () => void
  readonly onToggleSealed: () => void
}) {
  return (
    <div
      className="bd-net-root"
      style={{ width: `${DIELINE_W}px`, height: `${DIELINE_H}px` }}
    >
      {/* Die-cut Kraft Dust Flaps (`dust-left`, `dust-right`) */}
      <div className="bd-panel bd-panel--dust-left" aria-hidden="true">
        <span>FLAP L</span>
      </div>
      <div className="bd-panel bd-panel--dust-right" aria-hidden="true">
        <span>FLAP R</span>
      </div>

      {/* Double-hinged Top Tuck Tongue (`tuck`) */}
      <div className="bd-panel bd-panel--tuck" aria-hidden="true">
        <span>INSERT TUCK TONGUE · 350 GSM</span>
      </div>

      {/* Top Hinged Lid (`top`: 216 x 112) */}
      <div className="bd-panel bd-panel--top" style={{ borderTopColor: colorway.hex }}>
        <div className="bd-top-row">
          <span className="bd-mono-kicker">MUNARI PACKAGING CAD</span>
          <span className="bd-top-dot" style={{ background: colorway.hex }} />
        </div>
        <div className="bd-top-band" style={{ background: colorway.hex, color: colorway.ink }}>
          <span>{productName || 'OP-UNIT'}</span>
          <span>{powerSpec}</span>
        </div>
      </div>

      {/* Left Spine (`left`: 112 x 216) */}
      <div className="bd-panel bd-panel--left">
        <div className="bd-left-stripe" style={{ background: colorway.hex }} />
        <div className="bd-spine-meta">
          <span className="bd-mono-kicker">MODEL REF</span>
          <strong>{productName.slice(0, 14) || 'OP-UNIT'}</strong>
          <span className="bd-spine-pill">{powerSpec}</span>
        </div>
        <div className="bd-barcode" aria-hidden="true" />
      </div>

      {/* Center Front Hero Face (`front`: 216 x 216) */}
      <div className="bd-panel bd-panel--front">
        <div className="bd-front-banner" style={{ background: colorway.hex, color: colorway.ink }}>
          <label htmlFor={titleInputId} className="bd-front-kicker">
            LIVE DOM CARTON · CLICK TO RENAME ✎
          </label>
          <input
            id={titleInputId}
            type="text"
            className="bd-front-input"
            maxLength={18}
            value={productName}
            onChange={(e) => onChangeName(e.target.value)}
          />
        </div>

        <div className="bd-front-body">
          <div className="bd-swatches" role="group" aria-label="Pantone ink swatch">
            {COLORWAYS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="bd-swatch-btn"
                aria-label={c.id}
                aria-pressed={c.id === colorway.id}
                onClick={() => onSelectColorway(c.id)}
              >
                <span className="bd-swatch-fill" style={{ background: c.hex }} />
                <span className="bd-swatch-code">{c.code}</span>
              </button>
            ))}
          </div>

          <button type="button" className="bd-lot-btn" onClick={onStampLot}>
            <span>QC LOT #{lotNumber}</span>
            <b>STAMP ↵</b>
          </button>
        </div>
      </div>

      {/* Right Spec Spine (`right`: 112 x 216) */}
      <div className="bd-panel bd-panel--right">
        <span className="bd-mono-kicker">POWER BUS</span>
        <div className="bd-power-group" role="group" aria-label="Select power bus">
          {POWER_SPECS.map((spec) => (
            <button
              key={spec}
              type="button"
              className="bd-power-btn"
              aria-pressed={powerSpec === spec}
              onClick={() => onSelectPower(spec)}
            >
              {spec}
            </button>
          ))}
        </div>
        <span className="bd-mono-foot">216×216×112</span>
      </div>

      {/* Back Wall (`back`: 216 x 216) — closes the 3D carton across 360-deg orbit */}
      <div className="bd-panel bd-panel--back">
        <div className="bd-back-head">
          <span className="bd-mono-kicker">REAR MANIFEST · 360° LIVE</span>
          <span className="bd-back-code">PMS {colorway.code}</span>
        </div>
        <p className="bd-back-copy">
          One retained DOM sheet folded in 3D via deformSurfaceGeometry. Orbit 180° and toggle
          the factory seal right on the rear face.
        </p>
        <button
          type="button"
          className="bd-seal-btn"
          aria-pressed={sealed}
          onClick={onToggleSealed}
        >
          {sealed ? '■ TAMPER SEAL INTACT' : '□ SEAL BROKEN · RE-SEAL'}
        </button>
      </div>

      {/* Bottom Base (`bottom`: 216 x 112) */}
      <div className="bd-panel bd-panel--bottom">
        <div className="bd-bottom-grid">
          <div>
            <span className="bd-mono-kicker">SUBSTRATE</span>
            <div>HTML-in-canvas · 0 fps</div>
          </div>
          <div className="bd-recycle-mark">100% DOM</div>
        </div>
      </div>
    </div>
  )
}

export function BeyondDieline() {
  const supported = useCaptureSupport()
  const reducedMotion = useReducedMotion()
  const canvasId = useId()
  const titleInputId = useId()

  const [fold, setFold] = useState(0.86)
  const [yawDeg, setYawDeg] = useState(-28)
  const [pitchDeg, setPitchDeg] = useState(20)
  const [productName, setProductName] = useState('MONOLITH OP-1')
  const [colorwayId, setColorwayId] = useState('vermilion')
  const [powerSpec, setPowerSpec] = useState<string>('USB-C 5V')
  const [lotNumber, setLotNumber] = useState(408)
  const [sealed, setSealed] = useState(true)
  const [fitScale, setFitScale] = useState(1)
  const [liveAnnouncement, setLiveAnnouncement] = useState('')

  const stageRef = useRef<HTMLDivElement>(null)
  const orbitDragRef = useRef<{ px: number; py: number; yaw: number; pitch: number } | null>(null)
  const glideRef = useRef<number>(0)

  const cancelGlide = useCallback(() => {
    if (glideRef.current) {
      cancelAnimationFrame(glideRef.current)
      glideRef.current = 0
    }
  }, [])

  useEffect(() => cancelGlide, [cancelGlide])

  const isFoldedBox = fold > 0.5
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const measure = () => {
      const r = stage.getBoundingClientRect()
      const effW = isFoldedBox ? 420 : DIELINE_W
      const s = Math.min(
        1.08,
        Math.max(0.46, Math.min((r.width - 28) / effW, (r.height - 44) / DIELINE_H)),
      )
      setFitScale((prev) => (Math.abs(prev - s) < 0.01 ? prev : s))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [isFoldedBox])

  const animateToPose = useCallback(
    (targetFold: number, targetYaw: number, targetPitch: number, label: string) => {
      cancelGlide()
      setLiveAnnouncement(label)
      if (reducedMotion) {
        setFold(targetFold)
        setYawDeg(targetYaw)
        setPitchDeg(targetPitch)
        return
      }
      const startFold = fold
      const startYaw = yawDeg
      const startPitch = pitchDeg
      const t0 = performance.now()
      const dur = 320
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / dur)
        const ease = 1 - Math.pow(1 - t, 3)
        setFold(startFold + (targetFold - startFold) * ease)
        setYawDeg(startYaw + (targetYaw - startYaw) * ease)
        setPitchDeg(startPitch + (targetPitch - startPitch) * ease)
        if (t < 1) glideRef.current = requestAnimationFrame(tick)
        else glideRef.current = 0
      }
      glideRef.current = requestAnimationFrame(tick)
    },
    [cancelGlide, fold, pitchDeg, reducedMotion, yawDeg],
  )

  const onMatPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.nativeEvent.isTrusted) return
    if (event.target instanceof HTMLCanvasElement) return
    if (event.target instanceof Element && event.target.closest('button, input, label, a')) return
    cancelGlide()
    event.currentTarget.setPointerCapture(event.pointerId)
    orbitDragRef.current = {
      px: event.clientX,
      py: event.clientY,
      yaw: yawDeg,
      pitch: pitchDeg,
    }
  }

  const onMatPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = orbitDragRef.current
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const nextYaw = Math.max(-180, Math.min(180, start.yaw + (event.clientX - start.px) * 0.48))
    const nextPitch = Math.max(-44, Math.min(58, start.pitch + (event.clientY - start.py) * 0.36))
    setYawDeg(Math.round(nextYaw * 2) / 2)
    setPitchDeg(Math.round(nextPitch * 2) / 2)
  }

  const onMatPointerUp = () => {
    orbitDragRef.current = null
  }

  const onOrbitKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 24 : 12
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setYawDeg((y) => Math.max(-180, y - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setYawDeg((y) => Math.min(180, y + step))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setPitchDeg((p) => Math.max(-44, p - step))
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setPitchDeg((p) => Math.min(58, p + step))
    }
  }

  const colorway = COLORWAYS.find((c) => c.id === colorwayId) ?? COLORWAYS[0]!
  const syncKey = `${productName}:${colorwayId}:${powerSpec}:${lotNumber}:${sealed ? 1 : 0}`

  return (
    <div className="beyond-bench">
      <div className="beyond-toolbar m-ui">
        <div className="beyond-controls-group">
          <Button
            compact
            variant={fold < 0.05 ? 'solid' : 'outline'}
            onClick={() => animateToPose(0, 0, 0, 'Unfolded to flat 2D dieline blueprint')}
          >
            Flat dieline (0%)
          </Button>
          <Button
            compact
            variant={fold > 0.4 && fold < 0.96 ? 'solid' : 'outline'}
            onClick={() => animateToPose(0.86, -28, 20, 'Folded to isometric 3D assembly')}
          >
            3D assembly (86%)
          </Button>
          <Button
            compact
            variant={fold >= 0.96 && Math.abs(yawDeg) < 110 ? 'solid' : 'outline'}
            onClick={() => animateToPose(1, 32, 22, 'Closed 3D carton')}
          >
            Closed carton (100%)
          </Button>
          <Button
            compact
            variant={fold >= 0.96 && Math.abs(yawDeg) >= 110 ? 'solid' : 'outline'}
            onClick={() => animateToPose(1, 154, 14, 'Orbited to rear manifest face')}
          >
            Rear manifest (154°)
          </Button>
        </div>

        <div className="beyond-slider-wrap">
          <Slider
            label="Fold crease"
            min={0}
            max={100}
            step={1}
            unit="%"
            value={Math.round(fold * 100)}
            onChange={(v) => {
              cancelGlide()
              const nf = v / 100
              setFold(nf)
              if (nf < 0.04 && Math.abs(yawDeg) < 2) {
                setYawDeg(0)
                setPitchDeg(0)
              }
            }}
          />
        </div>
      </div>

      <div
        ref={stageRef}
        className="beyond-stage-wrap bd-cutting-mat"
        onPointerDown={onMatPointerDown}
        onPointerMove={onMatPointerMove}
        onPointerUp={onMatPointerUp}
        onLostPointerCapture={onMatPointerUp}
      >
        <div className="beyond-sr-only" aria-live="polite">
          {liveAnnouncement}
        </div>

        <div className="bd-mat-hud">
          <button
            type="button"
            className="bd-orbit-grip"
            aria-label="3D carton orbit handle. Use arrow keys to rotate, or drag the cutting mat."
            onKeyDown={onOrbitKeyDown}
          >
            ↻ Orbit {Math.round(yawDeg)}° / {Math.round(pitchDeg)}°
          </button>
          <span className="bd-mat-caption">
            Drag mat to orbit 360° · click swatches or rename directly on the 3D carton
          </span>
        </div>

        <div
          className={supported ? 'bd-page-slot bd-page-slot--scene' : 'bd-page-slot bd-page-slot--degraded'}
          style={!supported ? { transform: `scale(${fitScale})`, transformOrigin: 'center center' } : undefined}
        >
          <Surface.Root canvasId={canvasId} inScene={supported}>
            <Surface.HTML size={[DIELINE_W, DIELINE_H]}>
              <DielineSheetHtml
                titleInputId={titleInputId}
                productName={productName}
                colorway={colorway}
                powerSpec={powerSpec}
                lotNumber={lotNumber}
                sealed={sealed}
                onChangeName={setProductName}
                onSelectColorway={setColorwayId}
                onSelectPower={setPowerSpec}
                onStampLot={() => setLotNumber((n) => n + 1)}
                onToggleSealed={() => setSealed((s) => !s)}
              />
            </Surface.HTML>
            <Surface.Scene>
              <DielineScenePresenter
                fold={fold}
                yawDeg={yawDeg}
                pitchDeg={pitchDeg}
                fitScale={fitScale}
                syncKey={syncKey}
              />
            </Surface.Scene>
          </Surface.Root>
        </div>

        {supported && (
          <SurfaceCanvas
            id={canvasId}
            frameloop="demand"
            pointerMode="surfaces"
            gl={{ alpha: true, antialias: true, depth: true }}
            onCreated={({ gl }) => gl.setClearAlpha(0)}
            className="beyond-overlay-canvas"
          >
            <FrontierPixelCamera />
            <FrontierCanvasTelemetry />
          </SurfaceCanvas>
        )}
      </div>
    </div>
  )
}
