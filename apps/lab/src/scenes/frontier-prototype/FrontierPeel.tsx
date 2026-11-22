// Variant C: Choreographed peel-to-inspect limiter card & blueprint code backplate.
//
// Left zone holds the tactile Acoustic Limiter controls; right zone of the slate
// blueprint backplate holds live syntax-colored JSX and uncovered `Copy JSX` / `Step dB`
// controls so both layers stay simultaneously visible and clickable at 54% peel.

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
import {
  Surface,
  SurfaceCanvas,
  deformSurfaceGeometry,
  useSurfaceNodes,
  useSurfaceStatus,
  useSurfaceSupport,
} from '@petepetrash/munari'
import { Button, Slider, Tag } from '../../components/system'
import { evaluatePeelPoint, peelCreaseLine } from './frontierPeelLaw'
import {
  PEEL_SHADOW_PAD,
  createPeelCardMaterial,
  createPeelShadowMaterial,
  createPeelUniforms,
  type PeelUniforms,
} from './frontierPeelNodes'
import {
  FrontierCanvasTelemetry,
  FrontierPixelCamera,
  retainActiveSurface,
  stageBoxOf,
  useReducedMotion,
} from './frontierStage'

const noRaycast = () => {}

function frontOnlyRaycast(
  this: THREE.Mesh,
  raycaster: THREE.Raycaster,
  intersects: THREE.Intersection[],
): void {
  const mat = this.material
  if (mat instanceof THREE.Material && mat.side === THREE.DoubleSide) {
    mat.side = THREE.FrontSide
    try {
      THREE.Mesh.prototype.raycast.call(this, raycaster, intersects)
    } finally {
      mat.side = THREE.DoubleSide
    }
    return
  }
  THREE.Mesh.prototype.raycast.call(this, raycaster, intersects)
}

type AccentKey = 'cobalt' | 'coral' | 'emerald'

const METER_STEPS = [-22, -19, -16, -13, -11, -9, -7, -5, -3, -1] as const

function PeelMaterialSlot({ uniforms }: { readonly uniforms: PeelUniforms }) {
  const surface = useSurfaceNodes()
  const material = useMemo(() => createPeelCardMaterial(surface, uniforms), [surface, uniforms])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}

function PeelSceneRig({
  slotRef,
  handleRef,
  cardSize,
  peelTargetRef,
  angleTargetRef,
  reducedMotion,
  wakeRef,
}: {
  readonly slotRef: { readonly current: HTMLDivElement | null }
  readonly handleRef: { readonly current: HTMLButtonElement | null }
  readonly cardSize: readonly [number, number]
  readonly peelTargetRef: { readonly current: number }
  readonly angleTargetRef: { readonly current: number }
  readonly reducedMotion: boolean
  readonly wakeRef: { current: (() => void) | null }
}) {
  const status = useSurfaceStatus()
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)

  const groupRef = useRef<THREE.Group>(null)
  const shadowRef = useRef<THREE.Mesh>(null)
  const geoRef = useRef<THREE.PlaneGeometry>(null)
  const currentPeelRef = useRef(peelTargetRef.current)
  const currentAngleRef = useRef(angleTargetRef.current)
  const lastSizeKeyRef = useRef('')

  const uniforms = useMemo(createPeelUniforms, [])
  const shadowMat = useMemo(() => createPeelShadowMaterial(uniforms), [uniforms])

  useEffect(() => () => shadowMat.dispose(), [shadowMat])

  useEffect(() => {
    wakeRef.current = () => invalidate()
    return () => {
      wakeRef.current = null
    }
  }, [invalidate, wakeRef])

  useEffect(() => {
    if (status.presentation === 'scene') return retainActiveSurface()
    return undefined
  }, [status.presentation])

  useEffect(() => {
    lastSizeKeyRef.current = ''
    invalidate()
  }, [cardSize, invalidate])

  useFrame((_, delta) => {
    const group = groupRef.current
    const geo = geoRef.current
    const shadowMesh = shadowRef.current
    const box = stageBoxOf(slotRef.current, gl.domElement)
    if (!group || !geo || !box) return

    group.position.set(box.x, box.y, 0)

    const w = Math.max(260, cardSize[0])
    const h = Math.max(240, cardSize[1])
    const sizeKey = `${w}x${h}`

    const dt = Math.min(delta, 0.05)
    const nextPeel = reducedMotion
      ? peelTargetRef.current
      : THREE.MathUtils.damp(currentPeelRef.current, peelTargetRef.current, 15, dt)
    const nextAngle = reducedMotion
      ? angleTargetRef.current
      : THREE.MathUtils.damp(currentAngleRef.current, angleTargetRef.current, 15, dt)

    const moving =
      Math.abs(nextPeel - peelTargetRef.current) > 0.0007 ||
      Math.abs(nextAngle - angleTargetRef.current) > 0.0007

    currentPeelRef.current = moving ? nextPeel : peelTargetRef.current
    currentAngleRef.current = moving ? nextAngle : angleTargetRef.current

    if (moving || lastSizeKeyRef.current !== sizeKey) {
      const radiusPx = Math.max(28, Math.min(44, w * 0.068))
      const params = {
        width: w,
        height: h,
        amount: currentPeelRef.current,
        angleRad: currentAngleRef.current,
        radiusPx,
      }
      deformSurfaceGeometry(geo, [w, h], (x, y) => evaluatePeelPoint(x, y, params))
      const crease = peelCreaseLine(params)
      uniforms.cardSize.value.set(w, h)
      uniforms.peelNormal.value.set(crease.nx, crease.ny)
      uniforms.lineDist.value = crease.lineDist
      uniforms.radiusPx.value = radiusPx
      uniforms.peelAmount.value = currentPeelRef.current
      if (shadowMesh) {
        shadowMesh.scale.set(w + PEEL_SHADOW_PAD * 2, h + PEEL_SHADOW_PAD * 2, 1)
      }
      // Position the native DOM drag handle right along the live fold crest
      const btn = handleRef.current
      if (btn) {
        const handleX = Math.max(44, Math.min(w - 44, w * (0.94 - currentPeelRef.current * 0.68)))
        const handleY = Math.max(44, Math.min(h - 76, h * (0.62 - currentPeelRef.current * 0.24)))
        btn.style.left = `${handleX}px`
        btn.style.top = `${handleY}px`
      }
      lastSizeKeyRef.current = sizeKey
      if (moving) invalidate()
    }
  })

  return (
    <group ref={groupRef}>
      <mesh
        ref={shadowRef}
        position={[0, 0, -0.5]}
        renderOrder={0}
        raycast={noRaycast}
        visible={status.presentation === 'scene'}
        material={shadowMat}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>

      <Surface.Mesh
        placement="manual"
        pointerRoute="relay"
        renderOrder={2}
        raycast={frontOnlyRaycast}
        geometry={<planeGeometry ref={geoRef} args={[1, 1, 64, 48]} />}
        material={<PeelMaterialSlot uniforms={uniforms} />}
      />
    </group>
  )
}

export function FrontierPeel() {
  const supported = useSurfaceSupport()
  const reducedMotion = useReducedMotion()
  const canvasId = useId()
  const titleFieldId = useId()
  const gainGroupId = useId()

  const [cardTitle, setCardTitle] = useState('Master Limiter')
  const [accent, setAccent] = useState<AccentKey>('cobalt')
  const [thresholdDb, setThresholdDb] = useState(-6)
  const [peelPct, setPeelPct] = useState(54)
  const [copied, setCopied] = useState(false)
  const [lastChangedProp, setLastChangedProp] = useState<'title' | 'accent' | 'threshold'>('threshold')
  const [cardSize, setCardSize] = useState<readonly [number, number]>([640, 368])

  const slotRef = useRef<HTMLDivElement>(null)
  const cardInnerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const peelTargetRef = useRef(0.54)
  const angleTargetRef = useRef(0.46)
  const wakeRef = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    const slot = slotRef.current
    const card = cardInnerRef.current
    if (!slot || !card) return
    const measure = () => {
      const w = Math.max(280, Math.round(slot.clientWidth))
      const h = Math.max(336, Math.round(card.offsetHeight))
      setCardSize((prev) => (prev[0] === w && prev[1] === h ? prev : [w, h]))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(slot)
    ro.observe(card)
    return () => ro.disconnect()
  }, [])

  const applyPeel = useCallback((pct: number, angle = 0.46) => {
    const clamped = Math.max(0, Math.min(88, Math.round(pct)))
    setPeelPct(clamped)
    peelTargetRef.current = clamped / 100
    angleTargetRef.current = angle
    wakeRef.current?.()
  }, [])

  const onHandlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onHandlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const slot = slotRef.current
    if (!slot || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const r = slot.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    const dxFromRight = Math.max(0, r.right - event.clientX)
    const dyFromBottom = Math.max(0, r.bottom - event.clientY)
    const pull = Math.max(0, Math.min(0.88, (dxFromRight * 0.82 + dyFromBottom * 0.42) / (r.width * 0.85)))
    const angle = Math.max(0.28, Math.min(0.85, Math.atan2(dyFromBottom + 36, dxFromRight + 48)))
    peelTargetRef.current = pull
    angleTargetRef.current = angle
    wakeRef.current?.()
  }

  const onHandlePointerUp = () => {
    setPeelPct(Math.round(peelTargetRef.current * 100))
  }

  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 12 : 5
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      applyPeel(peelPct + step)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      applyPeel(peelPct - step)
    }
  }

  const liveJsx = `<LimiterCard
  title="${cardTitle}"
  accent="${accent}"
  thresholdDb={${thresholdDb}}
/>`

  const copyJsx = () => {
    void navigator.clipboard?.writeText(liveJsx).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  const cycleThreshold = () => {
    const order: readonly number[] = [-12, -9, -6, -3, -1]
    const next = order[(order.indexOf(thresholdDb) + 1) % order.length] ?? -6
    setThresholdDb(next)
    setLastChangedProp('threshold')
  }

  return (
    <div className="frontier-bench">
      <div className="frontier-toolbar m-ui">
        <div className="frontier-controls-group" role="group" aria-label="Peel presets">
          <Button compact variant={peelPct === 0 ? 'solid' : 'outline'} onClick={() => applyPeel(0)}>
            Flat (0%)
          </Button>
          <Button compact variant={peelPct === 54 ? 'solid' : 'outline'} onClick={() => applyPeel(54)}>
            Split inspect (54%)
          </Button>
          <Button compact variant={peelPct === 80 ? 'solid' : 'outline'} onClick={() => applyPeel(80)}>
            Deep peel (80%)
          </Button>
        </div>

        <div className="frontier-slider-inline">
          <Slider
            label="Peel"
            value={peelPct}
            min={0}
            max={88}
            step={1}
            unit="%"
            onChange={(val) => applyPeel(val)}
          />
        </div>

        <Tag>Front controls and revealed JSX stay clickable together</Tag>
      </div>

      <div className="frontier-stage-wrap frontier-peel-stage">
        <div
          ref={slotRef}
          className={`frontier-peel-deck${!supported ? ' frontier-peel-deck--stacked' : ''}`}
          style={supported ? { minHeight: cardSize[1] } : undefined}
        >
          {/* Blueprint code & state backplate: right-aligned so 54% peel exposes live JSX + buttons */}
          <div className="frontier-peel-backplate">
            <div className="frontier-peel-back-expose">
              <div className="frontier-peel-back-actions">
                <button type="button" className="frontier-back-btn" onClick={cycleThreshold}>
                  Step dB ({thresholdDb})
                </button>
                <button type="button" className="frontier-back-btn frontier-back-btn--solid" onClick={copyJsx}>
                  {copied ? 'Copied JSX' : 'Copy JSX'}
                </button>
              </div>

              <pre className="frontier-peel-pre" aria-label="Live component JSX">
                <code>
                  {'<LimiterCard\n'}
                  <span data-flash={lastChangedProp === 'title' || undefined}>{`  title="${cardTitle}"\n`}</span>
                  <span data-flash={lastChangedProp === 'accent' || undefined}>{`  accent="${accent}"\n`}</span>
                  <span data-flash={lastChangedProp === 'threshold' || undefined}>{`  thresholdDb={${thresholdDb}}\n`}</span>
                  {'/>'}
                </code>
              </pre>

              <p className="frontier-peel-back-note">
                Live DOM backplate · Click <b>Step dB</b> or <b>Copy JSX</b> right through the peeled corner.
              </p>
            </div>
          </div>

          {/* Native viewport-space peel fold handle above SurfaceCanvas */}
          {supported && (
            <button
              ref={handleRef}
              type="button"
              className="frontier-peel-fold-grip"
              aria-label="Drag or use arrow keys to peel card"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onLostPointerCapture={onHandlePointerUp}
              onKeyDown={onHandleKeyDown}
            >
              ⇄ Peel
            </button>
          )}

          {/* Front UI card deformed in 3D via deformSurfaceGeometry */}
          <div className="frontier-peel-front-slot" data-in-scene={supported || undefined}>
            <Surface.Root canvasId={canvasId} inScene={supported}>
              <Surface.HTML size={cardSize} live>
                <div
                  ref={cardInnerRef}
                  className="frontier-peel-card"
                  data-accent={accent}
                  style={{ width: cardSize[0] }}
                >
                  <div className="frontier-peel-left-zone">
                    <div className="frontier-peel-head-row">
                      <span className="frontier-peel-badge">Ch 01 · Peak limiter</span>
                      <span className="frontier-peel-db-readout">{thresholdDb}.0 dB</span>
                    </div>

                    <div className="frontier-peel-meter" aria-hidden="true">
                      {METER_STEPS.map((stepDb) => (
                        <span
                          key={stepDb}
                          className="frontier-meter-bar"
                          data-lit={stepDb <= thresholdDb || undefined}
                        />
                      ))}
                    </div>

                    <label htmlFor={titleFieldId} className="frontier-peel-field">
                      <span className="m-label">Channel label</span>
                      <input
                        id={titleFieldId}
                        className="m-input frontier-peel-input"
                        value={cardTitle}
                        onChange={(e) => {
                          setCardTitle(e.target.value)
                          setLastChangedProp('title')
                        }}
                      />
                    </label>

                    <div className="frontier-peel-field">
                      <span id={gainGroupId} className="m-label">Ceiling threshold</span>
                      <div className="frontier-peel-accents" role="group" aria-labelledby={gainGroupId}>
                        {([-12, -9, -6, -3, -1] as const).map((db) => (
                          <button
                            key={db}
                            type="button"
                            className="frontier-accent-chip"
                            aria-pressed={thresholdDb === db}
                            onClick={() => {
                              setThresholdDb(db)
                              setLastChangedProp('threshold')
                            }}
                          >
                            {db} dB
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="frontier-peel-field">
                      <span className="m-label">Anodized bus</span>
                      <div className="frontier-peel-accents" role="group" aria-label="Accent color">
                        {(['cobalt', 'coral', 'emerald'] as const).map((key) => (
                          <button
                            key={key}
                            type="button"
                            className="frontier-accent-chip"
                            aria-pressed={accent === key}
                            onClick={() => {
                              setAccent(key)
                              setLastChangedProp('accent')
                            }}
                          >
                            {key}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </Surface.HTML>
              <Surface.Scene>
                <PeelSceneRig
                  slotRef={slotRef}
                  handleRef={handleRef}
                  cardSize={cardSize}
                  peelTargetRef={peelTargetRef}
                  angleTargetRef={angleTargetRef}
                  reducedMotion={reducedMotion}
                  wakeRef={wakeRef}
                />
              </Surface.Scene>
            </Surface.Root>
          </div>
        </div>

        {supported && (
          <SurfaceCanvas
            id={canvasId}
            frameloop="demand"
            pointerMode="surfaces"
            gl={{ alpha: true, antialias: true, depth: true }}
            onCreated={({ gl }) => gl.setClearAlpha(0)}
            className="frontier-overlay-canvas"
          >
            <FrontierPixelCamera />
            <FrontierCanvasTelemetry />
          </SurfaceCanvas>
        )}
      </div>
    </div>
  )
}
