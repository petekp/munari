// Prototype 02 (`SignatureConcertina`): 3D Pleated Concertina Comparison Board.
//
// Folds middle columns of a live 6-stage HTML release pipeline into sunlit/shaded
// 3D accordion pleats via `deformSurfaceGeometry`, pulling `MON · Baseline` and
// `SAT · Candidate` side-by-side so their 3 tabular metric rows align horizontally
// while keeping every flat and angled column clickable and editable at `0 fps` idle.

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
  CONCERTINA_COLUMNS,
  CONCERTINA_H,
  CONCERTINA_W,
  INITIAL_CHECKED_KEYS,
  computeBoardSpanPx,
  createConcertinaGeometry,
  foldConcertinaPoint,
} from './signatureConcertinaLaw'
import {
  createConcertinaMaterial,
  createConcertinaShadowMaterial,
  createConcertinaUniforms,
  type ConcertinaUniforms,
} from './signatureConcertinaNodes'
import './signatureConcertina.css'

const noRaycast = () => {}

function ConcertinaMaterialSlot({ uniforms }: { readonly uniforms: ConcertinaUniforms }) {
  const surface = useSurfaceNodes()
  const material = useMemo(() => createConcertinaMaterial(surface, uniforms), [surface, uniforms])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}

function ConcertinaScenePresenter({
  colPleats,
  yawDeg,
  pitchDeg,
  fitScale,
  syncKey,
}: {
  readonly colPleats: readonly number[]
  readonly yawDeg: number
  readonly pitchDeg: number
  readonly fitScale: number
  readonly syncKey: string
}) {
  const status = useSurfaceStatus()
  const refreshSurface = useSurfaceRefresh()
  const invalidate = useThree((s) => s.invalidate)
  const uniforms = useMemo(createConcertinaUniforms, [])
  const geometry = useMemo(createConcertinaGeometry, [])
  const shadowMat = useMemo(() => createConcertinaShadowMaterial(uniforms), [uniforms])
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
  }, [refreshSurface, syncKey])

  useLayoutEffect(() => {
    const avg = colPleats.reduce((acc, v) => acc + v, 0) / colPleats.length
    const spanPx = computeBoardSpanPx(colPleats)
    uniforms.avgPleat.value = avg
    uniforms.boardSpanRatio.value = spanPx / CONCERTINA_W

    deformSurfaceGeometry(geometry, [CONCERTINA_W, CONCERTINA_H], (x, y, idx) =>
      foldConcertinaPoint(x, y, colPleats, idx),
    )
    geometry.computeVertexNormals()
    const norm = geometry.getAttribute('normal')
    if (norm instanceof THREE.BufferAttribute) norm.needsUpdate = true
    invalidate()
  }, [colPleats, geometry, invalidate, uniforms])

  useEffect(() => {
    invalidate()
  }, [yawDeg, pitchDeg, fitScale, invalidate])

  const pitchRad = (pitchDeg * Math.PI) / 180
  const yawRad = (yawDeg * Math.PI) / 180

  return (
    <group scale={fitScale}>
      <group rotation={[0, yawRad * 0.55, 0]}>
        <mesh
          position={[8, -22, -74]}
          scale={[CONCERTINA_W + 48, CONCERTINA_H + 56, 1]}
          renderOrder={-1}
          raycast={noRaycast}
          material={shadowMat}
        >
          <planeGeometry args={[1, 1]} />
        </mesh>
      </group>

      <group rotation={[pitchRad, yawRad, 0]}>
        <Surface.Mesh
          placement="manual"
          alpha="source"
          frustumCulled={false}
          geometry={<primitive object={geometry} attach="geometry" />}
          material={<ConcertinaMaterialSlot uniforms={uniforms} />}
        />
      </group>
    </group>
  )
}

function ConcertinaBoardHtml({
  collapsedFlags,
  pleatDepth,
  tags,
  checkedSet,
  onToggleColumnFold,
  onChangeTag,
  onToggleTask,
}: {
  readonly collapsedFlags: readonly boolean[]
  readonly pleatDepth: number
  readonly tags: { readonly mon: string; readonly sat: string }
  readonly checkedSet: ReadonlySet<string>
  readonly onToggleColumnFold: (colIdx: number) => void
  readonly onChangeTag: (colId: 'mon' | 'sat', next: string) => void
  readonly onToggleTask: (taskKey: string) => void
}) {
  return (
    <div
      className="sc-board-root"
      style={{ width: `${CONCERTINA_W}px`, height: `${CONCERTINA_H}px` }}
    >
      {CONCERTINA_COLUMNS.map((col, idx) => {
        const isPleated = Boolean(collapsedFlags[idx]) && pleatDepth > 0.08
        const isBookend = idx === 0 || idx === CONCERTINA_COLUMNS.length - 1
        return (
          <section
            key={col.id}
            className={
              isPleated
                ? 'sc-col sc-col--pleated'
                : isBookend
                  ? 'sc-col sc-col--bookend'
                  : 'sc-col'
            }
            aria-label={`${col.day} ${col.title}`}
            onClick={(e) => {
              if (!isPleated) return
              if (e.target instanceof Element && e.target.closest('button, input, label')) return
              onToggleColumnFold(idx)
            }}
          >
            <span className="sc-col-accent" style={{ background: col.accent }} aria-hidden="true" />

            <div className="sc-col-head">
              <button
                type="button"
                className="sc-fold-btn"
                aria-pressed={Boolean(collapsedFlags[idx])}
                title={collapsedFlags[idx] ? `Unfold ${col.day} column` : `Pleat ${col.day} column`}
                onClick={() => onToggleColumnFold(idx)}
              >
                <span>{col.day}</span>
                <span>{isPleated ? '↔ Open' : '▸◄ Fold'}</span>
              </button>

              <h3 className="sc-col-title">{col.title}</h3>

              {col.editableTag ? (
                <input
                  type="text"
                  className="sc-tag-input"
                  maxLength={12}
                  aria-label={`${col.day} release tag`}
                  value={col.id === 'mon' ? tags.mon : tags.sat}
                  onChange={(e) => onChangeTag(col.id === 'mon' ? 'mon' : 'sat', e.target.value)}
                />
              ) : (
                <span className="sc-stage-pill">STAGE 0{idx}</span>
              )}
            </div>

            <div className="sc-diff-stack">
              {col.rows.map((r) => (
                <div
                  key={r.key}
                  className={r.win ? 'sc-diff-row sc-diff-row--win' : 'sc-diff-row'}
                >
                  <span className="sc-diff-key">{r.key}</span>
                  <span className="sc-diff-val">{r.val}</span>
                </div>
              ))}
            </div>

            <div className="sc-checks">
              {col.tasks.map((taskLabel, tIdx) => {
                const taskKey = `${col.id}-${tIdx}`
                return (
                  <label key={taskKey} className="sc-check-label">
                    <input
                      type="checkbox"
                      className="sc-check-input"
                      checked={checkedSet.has(taskKey)}
                      onChange={() => onToggleTask(taskKey)}
                    />
                    <span>{taskLabel}</span>
                  </label>
                )
              })}
            </div>

            <div className="sc-col-foot">
              <span>0{idx + 1}/06</span>
              <span>{isPleated ? `${Math.round(pleatDepth * 100)}% PLEAT` : 'FLAT'}</span>
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function SignatureConcertina() {
  const supported = useCaptureSupport()
  const reducedMotion = useReducedMotion()
  const canvasId = useId()

  const [collapsedFlags, setCollapsedFlags] = useState<readonly boolean[]>([
    false, true, true, true, true, false,
  ])
  const [pleatDepth, setPleatDepth] = useState(0.86)
  const [colPleats, setColPleats] = useState<readonly number[]>([0, 0.86, 0.86, 0.86, 0.86, 0])
  const [yawDeg, setYawDeg] = useState(-9)
  const [pitchDeg, setPitchDeg] = useState(17)
  const [tags, setTags] = useState({ mon: 'v1.0.4', sat: 'v2.0.0-rc3' })
  const [checkedSet, setCheckedSet] = useState<ReadonlySet<string>>(
    () => new Set(INITIAL_CHECKED_KEYS),
  )
  const [fitScale, setFitScale] = useState(1)

  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ px: number; py: number; yaw: number; pitch: number; fromGrip: boolean } | null>(null)
  const animRef = useRef<number>(0)
  const pleatsRef = useRef(colPleats)
  pleatsRef.current = colPleats

  const cancelAnim = useCallback(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current)
      animRef.current = 0
    }
  }, [])

  useEffect(() => cancelAnim, [cancelAnim])

  const animatePleatsAndPose = useCallback(
    (nextFlags: readonly boolean[], nextDepth: number, targetYaw: number, targetPitch: number) => {
      cancelAnim()
      setCollapsedFlags(nextFlags)
      setPleatDepth(nextDepth)
      const targetPleats = nextFlags.map((f) => (f ? nextDepth : 0))

      if (reducedMotion) {
        setColPleats(targetPleats)
        setYawDeg(targetYaw)
        setPitchDeg(targetPitch)
        return
      }

      const startPleats = pleatsRef.current
      const startYaw = yawDeg
      const startPitch = pitchDeg
      const t0 = performance.now()
      const dur = 280
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / dur)
        const ease = 1 - Math.pow(1 - t, 3)
        setColPleats(
          targetPleats.map((tp, i) => (startPleats[i] ?? 0) + (tp - (startPleats[i] ?? 0)) * ease),
        )
        setYawDeg(startYaw + (targetYaw - startYaw) * ease)
        setPitchDeg(startPitch + (targetPitch - startPitch) * ease)
        if (t < 1) animRef.current = requestAnimationFrame(tick)
        else animRef.current = 0
      }
      animRef.current = requestAnimationFrame(tick)
    },
    [cancelAnim, pitchDeg, reducedMotion, yawDeg],
  )

  const toggleColumnFold = useCallback(
    (colIdx: number) => {
      const nextFlags = collapsedFlags.map((f, i) => (i === colIdx ? !f : f))
      const effectiveDepth = pleatDepth < 0.25 ? 0.86 : pleatDepth
      animatePleatsAndPose(nextFlags, effectiveDepth, yawDeg, pitchDeg)
    },
    [animatePleatsAndPose, collapsedFlags, pitchDeg, pleatDepth, yawDeg],
  )

  const currentSpanPx = computeBoardSpanPx(colPleats)
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const measure = () => {
      const r = stage.getBoundingClientRect()
      const effW = supported ? Math.max(430, currentSpanPx + 48) : CONCERTINA_W + 24
      const s = Math.min(
        1.06,
        Math.max(0.42, Math.min((r.width - 20) / effW, (r.height - 64) / CONCERTINA_H)),
      )
      setFitScale((prev) => (Math.abs(prev - s) < 0.01 ? prev : s))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [currentSpanPx, supported])

  const onMatPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.nativeEvent.isTrusted) return
    if (event.target instanceof HTMLCanvasElement) return
    const fromGrip = event.target instanceof Element && Boolean(event.target.closest('.sc-tilt-grip'))
    if (!fromGrip && event.target instanceof Element && event.target.closest('button, input, label, a')) {
      return
    }
    cancelAnim()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { px: event.clientX, py: event.clientY, yaw: yawDeg, pitch: pitchDeg, fromGrip }
  }

  const onMatPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const ny = Math.max(-38, Math.min(38, start.yaw + (event.clientX - start.px) * 0.35))
    const np = Math.max(-18, Math.min(42, start.pitch + (event.clientY - start.py) * 0.3))
    setYawDeg(Math.round(ny * 2) / 2)
    setPitchDeg(Math.round(np * 2) / 2)
  }

  const onMatPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current
    dragRef.current = null
    if (start?.fromGrip && Math.hypot(event.clientX - start.px, event.clientY - start.py) < 4) {
      setYawDeg(-9)
      setPitchDeg(17)
    }
  }

  const onTiltKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 12 : 6
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setYawDeg((y) => Math.max(-38, y - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setYawDeg((y) => Math.min(38, y + step))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setPitchDeg((p) => Math.max(-18, p - step))
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setPitchDeg((p) => Math.min(42, p + step))
    }
  }

  const pleatedCount = collapsedFlags.filter(Boolean).length
  const midOpen = collapsedFlags[1] && !collapsedFlags[2] && collapsedFlags[3]
  const syncKey = `${tags.mon}:${tags.sat}:${collapsedFlags.map(Number).join('')}:${Math.round(pleatDepth * 100)}:${Array.from(checkedSet).sort().join(',')}`

  return (
    <div className="sig-bench">
      <div className="sig-toolbar m-ui">
        <div className="sig-controls-group">
          <Button
            compact
            variant={pleatDepth > 0.5 && pleatedCount === 4 ? 'solid' : 'outline'}
            onClick={() =>
              animatePleatsAndPose([false, true, true, true, true, false], 0.86, -9, 17)
            }
          >
            Compare MON ↔ SAT (86%)
          </Button>
          <Button
            compact
            variant={pleatDepth > 0.5 && midOpen ? 'solid' : 'outline'}
            onClick={() =>
              animatePleatsAndPose([false, true, false, true, true, false], 0.86, -6, 16)
            }
          >
            Inspect WED Shaders
          </Button>
          <Button
            compact
            variant={pleatDepth < 0.08 || pleatedCount === 0 ? 'solid' : 'outline'}
            onClick={() =>
              animatePleatsAndPose([false, false, false, false, false, false], 0, 0, 0)
            }
          >
            Flat 6-column board (0%)
          </Button>
        </div>

        <div className="sig-slider-wrap">
          <Slider
            label="Pleat fold"
            min={0}
            max={100}
            step={1}
            unit="%"
            value={Math.round(pleatDepth * 100)}
            onChange={(v) => {
              cancelAnim()
              const nd = v / 100
              const flags = collapsedFlags.some(Boolean)
                ? collapsedFlags
                : [false, true, true, true, true, false]
              setCollapsedFlags(flags)
              setPleatDepth(nd)
              setColPleats(flags.map((f) => (f ? nd : 0)))
            }}
          />
        </div>
      </div>

      <div
        ref={stageRef}
        className="sig-stage-wrap sc-mat-stage"
        onPointerDown={onMatPointerDown}
        onPointerMove={onMatPointerMove}
        onPointerUp={onMatPointerUp}
        onLostPointerCapture={() => {
          dragRef.current = null
        }}
      >
        <div className="sc-mat-hud">
          <button
            type="button"
            className="sc-tilt-grip"
            aria-label="Concertina view angle handle. Drag or use arrow keys to tilt; click to reset."
            onKeyDown={onTiltKeyDown}
          >
            ↻ Tilt {Math.round(yawDeg)}° / {Math.round(pitchDeg)}°
          </button>
          <span className="sc-mat-caption">
            Click any pleated column header to unfold · drag mat to orbit lighting
          </span>
        </div>

        <div
          className={supported ? 'sc-page-slot--scene' : 'sc-degraded-sizer'}
          style={
            !supported
              ? {
                  width: `${Math.round(CONCERTINA_W * fitScale)}px`,
                  height: `${Math.round(CONCERTINA_H * fitScale)}px`,
                }
              : undefined
          }
        >
          <div
            className={supported ? undefined : 'sc-page-slot--degraded'}
            style={
              !supported
                ? {
                    width: `${CONCERTINA_W}px`,
                    height: `${CONCERTINA_H}px`,
                    transform: `scale(${fitScale})`,
                    transformOrigin: 'top left',
                  }
                : undefined
            }
          >
            <Surface.Root canvasId={canvasId} inScene={supported}>
              <Surface.HTML size={[CONCERTINA_W, CONCERTINA_H]}>
                <ConcertinaBoardHtml
                  collapsedFlags={collapsedFlags}
                  pleatDepth={pleatDepth}
                  tags={tags}
                  checkedSet={checkedSet}
                  onToggleColumnFold={toggleColumnFold}
                  onChangeTag={(colId, next) =>
                    setTags((prev) => ({ ...prev, [colId]: next }))
                  }
                  onToggleTask={(taskKey) =>
                    setCheckedSet((prev) => {
                      const next = new Set(prev)
                      if (next.has(taskKey)) next.delete(taskKey)
                      else next.add(taskKey)
                      return next
                    })
                  }
                />
              </Surface.HTML>
              <Surface.Scene>
                <ConcertinaScenePresenter
                  colPleats={colPleats}
                  yawDeg={yawDeg}
                  pitchDeg={pitchDeg}
                  fitScale={fitScale}
                  syncKey={syncKey}
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
            className="sig-overlay-canvas"
          >
            <FrontierPixelCamera />
            <FrontierCanvasTelemetry />
          </SurfaceCanvas>
        )}
      </div>
    </div>
  )
}
