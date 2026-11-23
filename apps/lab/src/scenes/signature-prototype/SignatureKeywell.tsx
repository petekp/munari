// Prototype 03 (`SignatureKeywell`): Backlit Polycarbonate Keycap Matrix.
//
// Promotes a 4x3 studio macro deck + live OLED `<input>` into a sculpted
// double-shot polycarbonate keywell where every lit keycap bounces real-time
// colored light onto the facing 48-degree bevels of its dark smoked neighbors
// across the 14 px CNC moat — with accessible roving-tabindex spatial arrow
// navigation and damped mechanical travel settling to `0 fps` at rest.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Surface,
  SurfaceCanvas,
  useSurfaceNodes,
  useSurfaceRefresh,
  useSurfaceStatus,
  useCaptureSupport,
} from '@petepetrash/munari'
import { Button } from '../../components/system'
import {
  FrontierCanvasTelemetry,
  FrontierPixelCamera,
  retainActiveSurface,
  useReducedMotion,
} from '../frontier-prototype/frontierStage'
import {
  CHORD_PRESET,
  INITIAL_KEYS,
  SOLO_CENTER_PRESET,
  TRIAD_PRESET,
  findSpatialCandidate,
  isArrowKey,
} from './signatureKeywellLaw'
import {
  KEYWELL_H,
  KEYWELL_W,
  KEY_COLS,
  KEY_COUNT,
  KEY_ROWS,
  createKeywellMaterial,
  createKeywellShadowMaterial,
  createKeywellUniforms,
  type KeywellUniforms,
} from './signatureKeywellNodes'
import './signatureKeywell.css'

const noRaycast = () => {}

interface KeyBtnStyle extends CSSProperties {
  readonly '--key-led'?: string
}

function KeywellMaterialSlot({ uniforms }: { readonly uniforms: KeywellUniforms }) {
  const surface = useSurfaceNodes()
  const material = useMemo(() => createKeywellMaterial(surface, uniforms), [surface, uniforms])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}

function KeywellScenePresenter({
  litFlags,
  focusedIdx,
  travelRef,
  fitScale,
  syncKey,
  wakeRef,
}: {
  readonly litFlags: readonly boolean[]
  readonly focusedIdx: number
  readonly travelRef: { readonly current: Float32Array }
  readonly fitScale: number
  readonly syncKey: string
  readonly wakeRef: { current: (() => void) | null }
}) {
  const status = useSurfaceStatus()
  const refreshSurface = useSurfaceRefresh()
  const invalidate = useThree((s) => s.invalidate)
  const uniforms = useMemo(createKeywellUniforms, [])
  const shadowMat = useMemo(createKeywellShadowMaterial, [])
  const tmpColor = useMemo(() => new THREE.Color(), [])
  const prevSyncRef = useRef(syncKey)

  useEffect(() => () => shadowMat.dispose(), [shadowMat])

  const syncUniforms = useCallback(() => {
    uniforms.focusedIndex.value = focusedIdx
    for (let k = 0; k < KEY_COUNT; k++) {
      const spec = INITIAL_KEYS[k]!
      const travel = travelRef.current[k] ?? 0
      const lit = Boolean(litFlags[k])
      tmpColor.set(spec.ledHex)
      const intensity = lit ? 1.0 + travel * 0.28 : travel * 0.35
      uniforms.keyGlow[k]!.value.set(tmpColor.r, tmpColor.g, tmpColor.b, intensity)
      uniforms.keyTravel[k]!.value = travel
    }
    invalidate()
  }, [focusedIdx, invalidate, litFlags, tmpColor, travelRef, uniforms])

  useEffect(() => {
    wakeRef.current = syncUniforms
    return () => {
      wakeRef.current = null
    }
  }, [syncUniforms, wakeRef])

  useEffect(() => {
    if (status.presentation === 'scene') return retainActiveSurface()
    return undefined
  }, [status.presentation])

  useLayoutEffect(() => {
    syncUniforms()
  }, [syncUniforms, fitScale])

  useEffect(() => {
    if (prevSyncRef.current !== syncKey) {
      prevSyncRef.current = syncKey
      refreshSurface()
    }
  }, [refreshSurface, syncKey])

  return (
    <group position={[0, 8, 0]} scale={fitScale}>
      <mesh
        position={[0, -14, -2]}
        scale={[KEYWELL_W + 68, KEYWELL_H + 64, 1]}
        renderOrder={-1}
        raycast={noRaycast}
        material={shadowMat}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      <Surface.Mesh
        placement="manual"
        alpha="source"
        geometry={<planeGeometry args={[KEYWELL_W, KEYWELL_H]} />}
        material={<KeywellMaterialSlot uniforms={uniforms} />}
      />
    </group>
  )
}

function KeywellDeckHtml({
  macroInputId,
  litFlags,
  macros,
  focusedIdx,
  onChangeMacro,
  onKeyPressStart,
  onToggleKey,
  onFocusKey,
  onGridKeyDown,
}: {
  readonly macroInputId: string
  readonly litFlags: readonly boolean[]
  readonly macros: readonly string[]
  readonly focusedIdx: number
  readonly onChangeMacro: (idx: number, next: string) => void
  readonly onKeyPressStart: (idx: number) => void
  readonly onToggleKey: (idx: number) => void
  readonly onFocusKey: (idx: number) => void
  readonly onGridKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}) {
  const focusedSpec = INITIAL_KEYS[focusedIdx] ?? INITIAL_KEYS[5]!
  const focusedMacro = macros[focusedIdx] ?? focusedSpec.defaultMacro
  const focusedLit = Boolean(litFlags[focusedIdx])

  return (
    <div className="sk-deck-root">
      <div className="sk-oled-strip">
        <div className="sk-oled-left">
          <span className="sk-oled-kicker">CNC KEYWELL · POLYCARBONATE BOUNCE</span>
          <span className="sk-oled-active">
            <span
              className="sk-oled-led"
              style={{
                background: focusedLit ? focusedSpec.ledHex : '#475569',
                boxShadow: focusedLit ? `0 0 8px ${focusedSpec.ledHex}` : 'none',
              }}
            />
            <span>
              KEY {focusedSpec.num} · {focusedSpec.code}
            </span>
          </span>
        </div>

        <div className="sk-oled-field">
          <label htmlFor={macroInputId} className="sk-oled-label">
            CAP LEGEND ✎
          </label>
          <input
            id={macroInputId}
            type="text"
            className="sk-macro-input"
            maxLength={13}
            value={focusedMacro}
            onChange={(e) => onChangeMacro(focusedIdx, e.target.value)}
          />
        </div>
      </div>

      <div
        className="sk-matrix-grid"
        role="grid"
        aria-label="Backlit macro keycap matrix"
        onKeyDown={onGridKeyDown}
      >
        {Array.from({ length: KEY_ROWS }, (_, row) => (
          <div key={row} className="sk-matrix-row" role="row">
            {Array.from({ length: KEY_COLS }, (__, col) => {
              const idx = row * KEY_COLS + col
              const spec = INITIAL_KEYS[idx]!
              const isLit = Boolean(litFlags[idx])
              const btnStyle: KeyBtnStyle = { '--key-led': spec.ledHex }
              return (
                <div key={spec.index} className="sk-matrix-cell" role="gridcell">
                  <button
                    type="button"
                    className="sk-key-btn"
                    style={btnStyle}
                    data-key-index={idx}
                    tabIndex={focusedIdx === idx ? 0 : -1}
                    aria-pressed={isLit}
                    aria-label={`Key ${spec.num} ${spec.code}: ${macros[idx] ?? spec.defaultMacro}`}
                    onFocus={() => onFocusKey(idx)}
                    onPointerDown={() => onKeyPressStart(idx)}
                    onClick={() => onToggleKey(idx)}
                  >
                    <span className="sk-key-top">
                      <span className="sk-key-num">{spec.num}</span>
                      <span className="sk-key-code">{spec.code}</span>
                    </span>
                    <span className="sk-key-macro">{macros[idx] ?? spec.defaultMacro}</span>
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="sk-chin-label" aria-hidden="true">
        <span>ANODIZED 6061-T6 · DOUBLE-SHOT PC</span>
        <span>ARROW KEYS NAVIGATE · CLICK TO LATCH LED</span>
      </div>
    </div>
  )
}

export function SignatureKeywell() {
  const supported = useCaptureSupport()
  const reducedMotion = useReducedMotion()
  const canvasId = useId()
  const macroInputId = useId()

  const [litFlags, setLitFlags] = useState<readonly boolean[]>(TRIAD_PRESET)
  const [macros, setMacros] = useState<readonly string[]>(() =>
    INITIAL_KEYS.map((k) => k.defaultMacro),
  )
  const [focusedIdx, setFocusedIdx] = useState(5)
  const [fitScale, setFitScale] = useState(1)

  const stageRef = useRef<HTMLDivElement>(null)
  const travelRef = useRef<Float32Array>(new Float32Array(KEY_COUNT))
  const targetTravelRef = useRef<Float32Array>(new Float32Array(KEY_COUNT))
  const heldIdxRef = useRef<number | null>(null)
  const wakeRef = useRef<(() => void) | null>(null)
  const springRafRef = useRef<number>(0)

  const stepSprings = useCallback(() => {
    let active = false
    const cur = travelRef.current
    const tgt = targetTravelRef.current
    for (let k = 0; k < KEY_COUNT; k++) {
      const c = cur[k] ?? 0
      const t = tgt[k] ?? 0
      const diff = t - c
      if (Math.abs(diff) > 0.008) {
        cur[k] = c + diff * 0.34
        active = true
      } else {
        cur[k] = t
        if (t > 0.5 && heldIdxRef.current !== k) {
          tgt[k] = 0
          active = true
        }
      }
    }
    wakeRef.current?.()
    if (active) {
      springRafRef.current = requestAnimationFrame(stepSprings)
    } else {
      springRafRef.current = 0
    }
  }, [])

  useEffect(() => {
    const releaseHold = () => {
      const held = heldIdxRef.current
      if (held !== null) {
        heldIdxRef.current = null
        targetTravelRef.current[held] = 0
        if (!springRafRef.current) {
          springRafRef.current = requestAnimationFrame(stepSprings)
        }
      }
    }
    window.addEventListener('pointerup', releaseHold)
    window.addEventListener('pointercancel', releaseHold)
    window.addEventListener('keyup', releaseHold)
    return () => {
      window.removeEventListener('pointerup', releaseHold)
      window.removeEventListener('pointercancel', releaseHold)
      window.removeEventListener('keyup', releaseHold)
      if (springRafRef.current) cancelAnimationFrame(springRafRef.current)
    }
  }, [stepSprings])

  const triggerKeyImpulse = useCallback(
    (idx: number, hold = false) => {
      setFocusedIdx(idx)
      if (reducedMotion) return
      if (hold) heldIdxRef.current = idx
      targetTravelRef.current[idx] = 1
      if (!springRafRef.current) {
        springRafRef.current = requestAnimationFrame(stepSprings)
      }
    },
    [reducedMotion, stepSprings],
  )

  const toggleKey = useCallback((idx: number) => {
    setFocusedIdx(idx)
    setLitFlags((prev) => prev.map((v, i) => (i === idx ? !v : v)))
  }, [])

  const onGridKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === ' ' || event.key === 'Enter') {
        const path0 = event.nativeEvent.composedPath()[0]
        if (path0 instanceof HTMLElement && path0.dataset.keyIndex !== undefined) {
          triggerKeyImpulse(Number(path0.dataset.keyIndex), false)
        }
        return
      }

      if (!isArrowKey(event.key)) return
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return
      }

      const innermost = event.nativeEvent.composedPath()[0]
      if (!(innermost instanceof HTMLElement)) return
      if (innermost.matches(':read-write, select, input[type="range"], [role="slider"]')) {
        return
      }
      if (innermost.dataset.keyIndex === undefined) return

      const nextEl = findSpatialCandidate(event.currentTarget, innermost, event.key)
      if (!nextEl) return

      event.preventDefault()
      const nextIdx = Number(nextEl.dataset.keyIndex)
      setFocusedIdx(nextIdx)
      nextEl.tabIndex = 0
      innermost.tabIndex = -1
      nextEl.focus({ preventScroll: supported })
    },
    [supported, triggerKeyImpulse],
  )

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const measure = () => {
      const r = stage.getBoundingClientRect()
      const s = Math.min(
        1.04,
        Math.max(0.50, Math.min((r.width - 24) / KEYWELL_W, (r.height - 76) / KEYWELL_H)),
      )
      setFitScale((prev) => (Math.abs(prev - s) < 0.01 ? prev : s))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])

  const litCount = litFlags.filter(Boolean).length
  const isSolo = litCount === 1 && Boolean(litFlags[5])
  const isTriad = litCount === 3 && Boolean(litFlags[1]) && Boolean(litFlags[5]) && Boolean(litFlags[11])
  const syncKey = `${focusedIdx}:${litFlags.map(Number).join('')}:${macros.join('|')}`

  return (
    <div className="sig-bench">
      <div className="sig-toolbar m-ui">
        <div className="sig-controls-group">
          <Button
            compact
            variant={isTriad ? 'solid' : 'outline'}
            onClick={() => setLitFlags(TRIAD_PRESET)}
          >
            Triad bounce (3 lit)
          </Button>
          <Button
            compact
            variant={isSolo ? 'solid' : 'outline'}
            onClick={() => {
              setFocusedIdx(5)
              setLitFlags(SOLO_CENTER_PRESET)
            }}
          >
            Solo center (06 DLY)
          </Button>
          <Button
            compact
            variant={litCount >= 5 ? 'solid' : 'outline'}
            onClick={() => setLitFlags(CHORD_PRESET)}
          >
            Polychrome chord (6 lit)
          </Button>
          <Button
            compact
            variant={litCount === 0 ? 'solid' : 'outline'}
            onClick={() => setLitFlags(Array.from({ length: KEY_COUNT }, () => false))}
          >
            Blackout (0 lit)
          </Button>
        </div>
      </div>

      <div ref={stageRef} className="sig-stage-wrap sk-bench-stage">
        <div
          className={supported ? 'sk-slot--scene' : 'sk-degraded-sizer'}
          style={
            !supported
              ? {
                  width: `${Math.round(KEYWELL_W * fitScale)}px`,
                  height: `${Math.round(KEYWELL_H * fitScale)}px`,
                }
              : undefined
          }
        >
          <div
            className={supported ? undefined : 'sk-slot--degraded'}
            style={
              !supported
                ? {
                    width: `${KEYWELL_W}px`,
                    height: `${KEYWELL_H}px`,
                    transform: `scale(${fitScale})`,
                    transformOrigin: 'top left',
                  }
                : undefined
            }
          >
            <Surface.Root canvasId={canvasId} inScene={supported}>
              <Surface.HTML size={[KEYWELL_W, KEYWELL_H]}>
                <KeywellDeckHtml
                  macroInputId={macroInputId}
                  litFlags={litFlags}
                  macros={macros}
                  focusedIdx={focusedIdx}
                  onChangeMacro={(idx, next) =>
                    setMacros((prev) => prev.map((m, i) => (i === idx ? next : m)))
                  }
                  onKeyPressStart={(idx) => triggerKeyImpulse(idx, true)}
                  onToggleKey={toggleKey}
                  onFocusKey={setFocusedIdx}
                  onGridKeyDown={onGridKeyDown}
                />
              </Surface.HTML>
              <Surface.Scene>
                <KeywellScenePresenter
                  litFlags={litFlags}
                  focusedIdx={focusedIdx}
                  travelRef={travelRef}
                  fitScale={fitScale}
                  syncKey={syncKey}
                  wakeRef={wakeRef}
                />
              </Surface.Scene>
            </Surface.Root>
          </div>
        </div>

        <span className="sk-stage-caption">
          Click any keycap to latch its LED and bounce color onto adjacent dark bevels · edit active legend in OLED field
        </span>

        {supported && (
          <SurfaceCanvas
            id={canvasId}
            frameloop="demand"
            pointerMode="surfaces"
            gl={{ alpha: true, antialias: true, depth: false }}
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
