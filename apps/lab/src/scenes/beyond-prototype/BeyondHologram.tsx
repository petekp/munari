// Variant 03 (`BeyondHologram`): Wave-optics Bragg diffraction grating &
// cylindrical lenticular stereo credential.
//
// Presents a 3D-tiltable interactive HTML security pass (`<Surface>`) coupled with
// a detached `<CaptureContent live>` lenticular twin. Tilting left vs. right
// optically decodes between Channel A (gate assignment) and Channel B (vault PIN)
// across simulated 3 px cylindrical ridges while fields and buttons remain live.

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
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { texture } from 'three/tsl'
import {
  CaptureContent,
  Surface,
  SurfaceCanvas,
  useCaptureFrame,
  useCaptureHandle,
  useSurfaceNodes,
  useSurfaceRefresh,
  useSurfaceStatus,
  useCaptureSupport,
  type CaptureHandle,
} from '@petepetrash/munari'
import { Button, Slider } from '../../components/system'
import {
  FrontierCanvasTelemetry,
  FrontierPixelCamera,
  retainActiveSurface,
  useReducedMotion,
} from '../frontier-prototype/frontierStage'
import {
  HOLO_H,
  HOLO_W,
  LENTICULAR_RECT,
  createHologramMaterial,
  createHologramShadowMaterial,
  createHologramUniforms,
  type HologramUniforms,
} from './beyondHologramNodes'
import './beyondHologram.css'

const noRaycast = () => {}

interface ClearanceSpec {
  readonly id: string
  readonly tier: string
  readonly gate: string
  readonly accent: string
}

const CLEARANCES: readonly ClearanceSpec[] = [
  { id: 'atelier', tier: 'LEVEL 04 · ATELIER', gate: 'STAGE 02 · NORTH', accent: '#49e6ff' },
  { id: 'foundry', tier: 'LEVEL 05 · FOUNDRY', gate: 'VAULT B · OPTICS', accent: '#ff9c3b' },
  { id: 'director', tier: 'OMEGA · KEYHOLDER', gate: 'CORE LAB · ALL', accent: '#b884ff' },
]

function createTwinPlaceholder(): THREE.DataTexture {
  const data = new Uint8Array([16, 22, 30, 255])
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function HologramMaterialSlot({
  twinCapture,
  uniforms,
}: {
  readonly twinCapture: CaptureHandle
  readonly uniforms: HologramUniforms
}) {
  const surface = useSurfaceNodes()
  const twinFrames = useCaptureFrame(twinCapture)
  const [placeholder] = useState(createTwinPlaceholder)
  const [twinMap] = useState(() => texture(placeholder))

  const material = useMemo(
    () => createHologramMaterial(surface, twinMap, uniforms),
    [surface, twinMap, uniforms],
  )

  useEffect(
    () => () => {
      material.dispose()
      placeholder.dispose()
    },
    [material, placeholder],
  )

  useFrame(() => {
    const latest = twinFrames.get()
    if (latest) {
      twinMap.value = latest.texture
      uniforms.twinReady.value = 1
    } else {
      twinMap.value = placeholder
      uniforms.twinReady.value = 0
    }
  })

  return <primitive object={material} attach="material" />
}

function HologramScenePresenter({
  twinCapture,
  tiltXDeg,
  tiltYDeg,
  fitScale,
  syncKey,
}: {
  readonly twinCapture: CaptureHandle
  readonly tiltXDeg: number
  readonly tiltYDeg: number
  readonly fitScale: number
  readonly syncKey: string
}) {
  const status = useSurfaceStatus()
  const refreshSurface = useSurfaceRefresh()
  const invalidate = useThree((s) => s.invalidate)
  const uniforms = useMemo(createHologramUniforms, [])
  const shadowMat = useMemo(createHologramShadowMaterial, [])
  const prevSyncRef = useRef(syncKey)

  useEffect(() => () => shadowMat.dispose(), [shadowMat])

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

  const rx = (tiltXDeg * Math.PI) / 180
  const ry = (tiltYDeg * Math.PI) / 180

  useLayoutEffect(() => {
    uniforms.tiltVec.value.set(ry, rx)
    invalidate()
  }, [rx, ry, fitScale, uniforms, invalidate])

  return (
    <group scale={fitScale}>
      <mesh
        position={[-tiltYDeg * 0.7, -18 + tiltXDeg * 0.6, -42]}
        scale={[HOLO_W * 1.16, HOLO_H * 1.18, 1]}
        renderOrder={-1}
        raycast={noRaycast}
        material={shadowMat}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>

      <group rotation={[rx, ry, 0]}>
        <Surface.Mesh
          placement="manual"
          alpha="source"
          frustumCulled={false}
          geometry={<planeGeometry args={[HOLO_W, HOLO_H, 1, 1]} />}
          material={<HologramMaterialSlot twinCapture={twinCapture} uniforms={uniforms} />}
        />
      </group>
    </group>
  )
}

function HologramTwinWindow({
  clearance,
  pinCode,
}: {
  readonly clearance: ClearanceSpec
  readonly pinCode: number
}) {
  return (
    <div
      className="bh-twin-root"
      style={{ width: `${LENTICULAR_RECT.w}px`, height: `${LENTICULAR_RECT.h}px` }}
    >
      <div className="bh-lent-kicker">CHANNEL B · RIGHT-TILT OPTICAL DECODE</div>
      <div className="bh-lent-value bh-lent-value--pin">
        <span>VAULT PIN {pinCode}-X</span>
        <span className="bh-lent-badge">UNLOCKED · {clearance.id.toUpperCase()}</span>
      </div>
    </div>
  )
}

function HologramPassHtml({
  supported,
  bearerInputId,
  bearer,
  clearance,
  pinCode,
  onChangeBearer,
  onCycleClearance,
  onMintPin,
}: {
  readonly supported: boolean
  readonly bearerInputId: string
  readonly bearer: string
  readonly clearance: ClearanceSpec
  readonly pinCode: number
  readonly onChangeBearer: (next: string) => void
  readonly onCycleClearance: () => void
  readonly onMintPin: () => void
}) {
  return (
    <div
      className={`bh-card-root${!supported ? ' bh-card-root--fallback' : ''}`}
      style={{ width: `${HOLO_W}px`, height: `${HOLO_H}px` }}
    >
      <div className="bh-card-main">
        <div className="bh-top-meta">
          <span className="bh-serial">MUNARI SECURITY CREDENTIAL · MN-089</span>
          <span className="bh-tier-pill" style={{ color: clearance.accent }}>
            {clearance.tier}
          </span>
        </div>

        <div className="bh-bearer-block">
          <label htmlFor={bearerInputId} className="bh-label">
            BEARER IDENTITY (EDITABLE ON 3D PASS)
          </label>
          <input
            id={bearerInputId}
            type="text"
            className="bh-bearer-input"
            maxLength={22}
            value={bearer}
            onChange={(e) => onChangeBearer(e.target.value)}
          />
        </div>

        <div className="bh-lenticular-slot">
          <div className="bh-lent-kicker">CHANNEL A · TILT RIGHT TO DECODE VAULT PIN</div>
          <div className="bh-lent-value">
            <span>{clearance.gate}</span>
            <span className="bh-lent-sub">TOKEN #{pinCode.toString().slice(0, 2)}··</span>
          </div>
        </div>

        <div className="bh-actions-row">
          <button type="button" className="bh-card-btn" onClick={onCycleClearance}>
            Cycle Clearance
          </button>
          <button type="button" className="bh-card-btn bh-card-btn--accent" onClick={onMintPin}>
            Mint New PIN
          </button>
        </div>
      </div>

      {/* Right-hand holographic foil ribbon (`x = 358..416`) & precision vector kinetigram seal */}
      <div className="bh-foil-column" aria-hidden="true">
        <div className="bh-seal-emblem">
          <svg className="bh-seal-svg" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
            <circle cx="20" cy="20" r="11" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M20 5v30M5 20h30M9.5 9.5l21 21M30.5 9.5l-21 21" stroke="currentColor" strokeWidth="0.9" />
            <circle cx="20" cy="20" r="3.5" fill="currentColor" />
          </svg>
        </div>
        <div className="bh-ribbon-microtext">BRAGG · GRATING · 540NM</div>
      </div>
    </div>
  )
}

export function BeyondHologram() {
  const supported = useCaptureSupport()
  const reducedMotion = useReducedMotion()
  const canvasId = useId()
  const bearerInputId = useId()
  const twinCapture = useCaptureHandle()

  const [tiltYDeg, setTiltYDeg] = useState(-18)
  const [tiltXDeg, setTiltXDeg] = useState(9)
  const [bearer, setBearer] = useState('PETE PETRASH')
  const [clearanceIdx, setClearanceIdx] = useState(0)
  const [pinCode, setPinCode] = useState(8842)
  const [fitScale, setFitScale] = useState(1)
  const [announcement, setAnnouncement] = useState('')

  const stageRef = useRef<HTMLDivElement>(null)
  const glideRef = useRef<number>(0)

  const cancelGlide = useCallback(() => {
    if (glideRef.current) {
      cancelAnimationFrame(glideRef.current)
      glideRef.current = 0
    }
  }, [])

  useEffect(() => cancelGlide, [cancelGlide])

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const measure = () => {
      const r = el.getBoundingClientRect()
      const s = Math.min(
        1.12,
        Math.max(0.64, Math.min((r.width - 28) / HOLO_W, (r.height - 56) / HOLO_H)),
      )
      setFitScale((prev) => (Math.abs(prev - s) < 0.01 ? prev : s))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const animateTilt = useCallback(
    (targetY: number, targetX: number, label: string) => {
      cancelGlide()
      setAnnouncement(label)
      if (reducedMotion) {
        setTiltYDeg(targetY)
        setTiltXDeg(targetX)
        return
      }
      const fromY = tiltYDeg
      const fromX = tiltXDeg
      const t0 = performance.now()
      const dur = 260
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / dur)
        const ease = 1 - Math.pow(1 - t, 3)
        setTiltYDeg(fromY + (targetY - fromY) * ease)
        setTiltXDeg(fromX + (targetX - fromX) * ease)
        if (t < 1) glideRef.current = requestAnimationFrame(step)
        else glideRef.current = 0
      }
      glideRef.current = requestAnimationFrame(step)
    },
    [cancelGlide, reducedMotion, tiltXDeg, tiltYDeg],
  )

  // Capture-phase listener ignoring untrusted relayed Surface events (`clientX <= 468`)
  // and held button presses so hovering/clicking the right half of the pass stays true
  const onStagePointerMoveCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (reducedMotion || !event.nativeEvent.isTrusted || event.buttons !== 0) return
    if (event.pointerType === 'touch') return
    const el = stageRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    cancelGlide()
    const nx = ((event.clientX - r.left) / r.width - 0.5) * 2
    const ny = ((event.clientY - r.top) / r.height - 0.5) * 2
    setTiltYDeg(Math.round(Math.max(-24, Math.min(24, nx * 24)) * 2) / 2)
    setTiltXDeg(Math.round(Math.max(-16, Math.min(16, -ny * 15)) * 2) / 2)
  }

  const onTiltKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 12 : 6
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setTiltYDeg((v) => Math.max(-24, v - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setTiltYDeg((v) => Math.min(24, v + step))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setTiltXDeg((v) => Math.max(-16, v - step))
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setTiltXDeg((v) => Math.min(16, v + step))
    }
  }

  const clearance = CLEARANCES[clearanceIdx % CLEARANCES.length] ?? CLEARANCES[0]!
  const syncKey = `${bearer}:${clearance.id}:${pinCode}`

  return (
    <div className="beyond-bench">
      <div className="beyond-toolbar m-ui">
        <div className="beyond-controls-group">
          <Button
            compact
            variant={tiltYDeg < -6 ? 'solid' : 'outline'}
            onClick={() => animateTilt(-18, 9, 'Tilted left: Lenticular Channel A active')}
          >
            Tilt left · Gate (Ch A)
          </Button>
          <Button
            compact
            variant={Math.abs(tiltYDeg) <= 6 ? 'solid' : 'outline'}
            onClick={() => animateTilt(0, 4, 'Centered on lenticular ridge transition')}
          >
            0° Lenticular ridge
          </Button>
          <Button
            compact
            variant={tiltYDeg > 6 ? 'solid' : 'outline'}
            onClick={() => animateTilt(19, -7, 'Tilted right: Decoded Vault PIN (Ch B)')}
          >
            Tilt right · Vault PIN (Ch B)
          </Button>
        </div>

        <div className="beyond-slider-wrap">
          <Slider
            label="Stereo tilt"
            min={-24}
            max={24}
            step={1}
            unit="°"
            value={Math.round(tiltYDeg)}
            onChange={(v) => {
              cancelGlide()
              setTiltYDeg(v)
            }}
          />
        </div>
      </div>

      {supported && (
        <CaptureContent
          capture={twinCapture}
          size={[LENTICULAR_RECT.w, LENTICULAR_RECT.h]}
          live
        >
          <HologramTwinWindow clearance={clearance} pinCode={pinCode} />
        </CaptureContent>
      )}

      <div
        ref={stageRef}
        className="beyond-stage-wrap bh-velvet-stage"
        onPointerMoveCapture={onStagePointerMoveCapture}
      >
        <div className="beyond-sr-only" aria-live="polite">
          {announcement}
        </div>

        <div className="bh-stage-hud">
          <button
            type="button"
            className="bh-tilt-handle"
            aria-label="Holographic tilt angle control. Move pointer or use arrow keys."
            onKeyDown={onTiltKeyDown}
          >
            ◈ {tiltYDeg > 5 ? 'Ch B · Vault PIN' : tiltYDeg < -5 ? 'Ch A · Stage Gate' : 'Stereo Ridge'} ({Math.round(tiltYDeg)}°)
          </button>
        </div>

        <div
          className={supported ? 'bh-page-slot bh-page-slot--scene' : 'bh-page-slot bh-page-slot--degraded'}
          style={!supported ? { transform: `scale(${fitScale})`, transformOrigin: 'center center' } : undefined}
        >
          <Surface.Root canvasId={canvasId} inScene={supported}>
            <Surface.HTML size={[HOLO_W, HOLO_H]}>
              <HologramPassHtml
                supported={supported}
                bearerInputId={bearerInputId}
                bearer={bearer}
                clearance={clearance}
                pinCode={pinCode}
                onChangeBearer={setBearer}
                onCycleClearance={() => setClearanceIdx((i) => (i + 1) % CLEARANCES.length)}
                onMintPin={() => setPinCode((p) => ((p + 1373) % 9000) + 1000)}
              />
            </Surface.HTML>
            <Surface.Scene>
              <HologramScenePresenter
                twinCapture={twinCapture}
                tiltXDeg={tiltXDeg}
                tiltYDeg={tiltYDeg}
                fitScale={fitScale}
                syncKey={syncKey}
              />
            </Surface.Scene>
          </Surface.Root>

          {!supported && (
            <div className="bh-fallback-twin">
              <HologramTwinWindow clearance={clearance} pinCode={pinCode} />
            </div>
          )}
        </div>

        {supported && (
          <SurfaceCanvas
            id={canvasId}
            frameloop="demand"
            pointerMode="surfaces"
            gl={{ alpha: true, antialias: true, depth: false }}
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
