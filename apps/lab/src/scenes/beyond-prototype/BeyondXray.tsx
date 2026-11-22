// Variant 02 (`BeyondXray`): Dual-reality fluoroscopic PCB cutaway loupe.
//
// Pairs a native in-place Braun/TE billing console with a subsurface FR-4 PCB
// `<Surface>`. Supplying an aperture-filtered `raycast` on `<Surface.Mesh>` routes
// clicks *inside* the crystal lens to internal hardware DIP switches while letting
// clicks *outside* the lens operate the consumer HTML controls natively.

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
  useSurfaceNodes,
  useSurfaceRefresh,
  useSurfaceStatus,
  useSurfaceSupport,
} from '@petepetrash/munari'
import { Button } from '../../components/system'
import {
  FrontierCanvasTelemetry,
  FrontierPixelCamera,
  retainActiveSurface,
  useReducedMotion,
} from '../frontier-prototype/frontierStage'
import {
  BeyondXrayOuterConsole,
  BeyondXrayPcbLayer,
  XRAY_TIERS,
  type XrayDipKey,
  type XrayDipState,
  type XrayTierId,
} from './BeyondXrayLayers'
import {
  createXrayMaterial,
  createXrayUniforms,
  type XrayUniforms,
} from './beyondXrayNodes'
import './beyondXray.css'

type XrayZoneId = 'dip' | 'asic' | 'oled'

interface LoupePose {
  readonly u: number
  readonly v: number
}

function measureAnchorPose(unitEl: HTMLElement | null, zone: XrayZoneId): LoupePose | null {
  if (!unitEl) return null
  const target = unitEl.querySelector(`[data-xray-anchor="${zone}"]`)
  if (!(target instanceof HTMLElement)) return null
  const ur = unitEl.getBoundingClientRect()
  const tr = target.getBoundingClientRect()
  if (ur.width <= 0 || ur.height <= 0) return null
  return {
    u: Math.max(0.16, Math.min(0.84, (tr.left + tr.width * 0.5 - ur.left) / ur.width)),
    v: Math.max(0.14, Math.min(0.86, (tr.top + tr.height * 0.5 - ur.top) / ur.height)),
  }
}

function XrayMaterialSlot({ uniforms }: { readonly uniforms: XrayUniforms }) {
  const surface = useSurfaceNodes()
  const material = useMemo(() => createXrayMaterial(surface, uniforms), [surface, uniforms])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}

function XrayScenePresenter({
  unitElRef,
  loupeRef,
  loupeRadiusPx,
  syncKey,
  wakeRef,
}: {
  readonly unitElRef: { readonly current: HTMLDivElement | null }
  readonly loupeRef: { readonly current: LoupePose }
  readonly loupeRadiusPx: number
  readonly syncKey: string
  readonly wakeRef: { current: (() => void) | null }
}) {
  const status = useSurfaceStatus()
  const refreshSurface = useSurfaceRefresh()
  const invalidate = useThree((s) => s.invalidate)
  const uniforms = useMemo(createXrayUniforms, [])
  const prevSyncRef = useRef(syncKey)

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
    if (prevSyncRef.current !== syncKey) {
      prevSyncRef.current = syncKey
      refreshSurface()
    }
  }, [syncKey, refreshSurface])

  useEffect(() => {
    uniforms.loupeRadiusPx.value = loupeRadiusPx
    invalidate()
  }, [loupeRadiusPx, uniforms, invalidate])

  const syncUniformsFromDom = useCallback(() => {
    const el = unitElRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    uniforms.panelSize.value.set(r.width, r.height)
    uniforms.loupeCenterCss.value.set(loupeRef.current.u * r.width, loupeRef.current.v * r.height)
  }, [loupeRef, uniforms, unitElRef])

  useFrame(syncUniformsFromDom)

  const apertureRaycast = useMemo<THREE.Object3D['raycast']>(
    () =>
      function (this: THREE.Mesh, raycaster, intersects) {
        syncUniformsFromDom()
        const localHits: THREE.Intersection[] = []
        THREE.Mesh.prototype.raycast.call(this, raycaster, localHits)
        const size = uniforms.panelSize.value
        const center = uniforms.loupeCenterCss.value
        const glassR = Math.max(24, uniforms.loupeRadiusPx.value - 13)
        for (const hit of localHits) {
          if (!hit.uv) continue
          const px = hit.uv.x * size.x
          const py = (1 - hit.uv.y) * size.y
          if (Math.hypot(px - center.x, py - center.y) <= glassR) {
            intersects.push(hit)
          }
        }
      },
    [syncUniformsFromDom, uniforms],
  )

  return (
    <Surface.Mesh
      placement="match-dom"
      pointerRoute="relay"
      renderOrder={2}
      raycast={apertureRaycast}
      material={<XrayMaterialSlot uniforms={uniforms} />}
    />
  )
}

export function BeyondXray() {
  const supported = useSurfaceSupport()
  const reducedMotion = useReducedMotion()
  const canvasId = useId()

  const [tierId, setTierId] = useState<XrayTierId>('studio')
  const [channels, setChannels] = useState(4)
  const [operator, setOperator] = useState('PETE-LAB-09')
  const [commits, setCommits] = useState(1)
  const [dips, setDips] = useState<XrayDipState>({
    staffHalfOff: false,
    turboClock: true,
    waiveBusFee: false,
    rawHexMode: false,
  })
  const [unitSize, setUnitSize] = useState<readonly [number, number]>([700, 428])
  const [loupeRadius, setLoupeRadius] = useState(124)
  const [announcement, setAnnouncement] = useState('')

  const unitRef = useRef<HTMLDivElement>(null)
  const handleBtnRef = useRef<HTMLButtonElement>(null)
  const activeZoneRef = useRef<XrayZoneId | null>('dip')
  const loupePoseRef = useRef<LoupePose>({ u: 0.77, v: 0.65 })
  const dragRef = useRef<{ px: number; py: number; u0: number; v0: number } | null>(null)
  const glideRafRef = useRef<number>(0)
  const wakeCanvasRef = useRef<(() => void) | null>(null)

  const cancelGlide = useCallback(() => {
    if (glideRafRef.current) {
      cancelAnimationFrame(glideRafRef.current)
      glideRafRef.current = 0
    }
  }, [])

  useEffect(() => cancelGlide, [cancelGlide])

  // Position the machined jeweler's-loupe stem at +42 deg outside the bottom-right rim
  // (or bottom-left when near the right wall) so it never covers bezel highlights or text above
  const syncHandlePosition = useCallback(
    (pose: LoupePose, radius: number, size: readonly [number, number]) => {
      loupePoseRef.current = pose
      const btn = handleBtnRef.current
      if (btn) {
        const cx = pose.u * size[0]
        const cy = pose.v * size[1]
        const placeLeft = cx + radius + 54 > size[0]
        const dirX = placeLeft ? -0.74 : 0.74
        const stemDist = radius + 18
        const hx = Math.max(48, Math.min(Math.max(48, size[0] - 48), cx + dirX * stemDist))
        const hy = Math.max(24, Math.min(Math.max(24, size[1] - 18), cy + 0.67 * stemDist))
        btn.style.left = `${hx}px`
        btn.style.top = `${hy}px`
      }
      wakeCanvasRef.current?.()
    },
    [],
  )

  useLayoutEffect(() => {
    const el = unitRef.current
    if (!el) return undefined
    const measure = () => {
      const r = el.getBoundingClientRect()
      const nw = Math.max(1, Math.round(r.width))
      const nh = Math.max(1, Math.round(r.height))
      const rad = nw < 520 ? 102 : 124
      setUnitSize((prev) => (prev[0] === nw && prev[1] === nh ? prev : [nw, nh]))
      setLoupeRadius(rad)
      const anchored = activeZoneRef.current ? measureAnchorPose(el, activeZoneRef.current) : null
      syncHandlePosition(anchored ?? loupePoseRef.current, rad, [nw, nh])
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [syncHandlePosition])

  const jumpLoupeToZone = useCallback(
    (zone: XrayZoneId, zoneLabel: string) => {
      cancelGlide()
      activeZoneRef.current = zone
      const target = measureAnchorPose(unitRef.current, zone) ?? loupePoseRef.current
      setAnnouncement(`X-Ray loupe moved over ${zoneLabel}`)
      if (reducedMotion) {
        syncHandlePosition(target, loupeRadius, unitSize)
        return
      }
      const from = loupePoseRef.current
      const t0 = performance.now()
      const dur = 240
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / dur)
        const ease = 1 - Math.pow(1 - t, 3)
        syncHandlePosition(
          { u: from.u + (target.u - from.u) * ease, v: from.v + (target.v - from.v) * ease },
          loupeRadius,
          unitSize,
        )
        if (t < 1) glideRafRef.current = requestAnimationFrame(step)
        else glideRafRef.current = 0
      }
      glideRafRef.current = requestAnimationFrame(step)
    },
    [cancelGlide, loupeRadius, reducedMotion, syncHandlePosition, unitSize],
  )

  const beginDrag = (target: HTMLElement, pointerId: number, clientX: number, clientY: number) => {
    cancelGlide()
    activeZoneRef.current = null
    target.setPointerCapture(pointerId)
    dragRef.current = {
      px: clientX,
      py: clientY,
      u0: loupePoseRef.current.u,
      v0: loupePoseRef.current.v,
    }
  }

  const moveDrag = (clientX: number, clientY: number) => {
    const start = dragRef.current
    if (!start) return
    const w = Math.max(1, unitSize[0])
    const h = Math.max(1, unitSize[1])
    const nu = Math.max(0.16, Math.min(0.84, start.u0 + (clientX - start.px) / w))
    const nv = Math.max(0.14, Math.min(0.86, start.v0 + (clientY - start.py) / h))
    syncHandlePosition({ u: nu, v: nv }, loupeRadius, unitSize)
  }

  // Allow grabbing the 13 px machined bezel ring directly in addition to the stem button!
  const onUnitPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.nativeEvent.isTrusted || !supported) return
    if (event.target instanceof Element && event.target.closest('.bx-loupe-handle')) return
    const el = unitRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const lx = loupePoseRef.current.u * r.width
    const ly = loupePoseRef.current.v * r.height
    const dist = Math.hypot(event.clientX - r.left - lx, event.clientY - r.top - ly)
    if (dist >= loupeRadius - 15 && dist <= loupeRadius + 8) {
      event.stopPropagation()
      beginDrag(event.currentTarget, event.pointerId, event.clientX, event.clientY)
    }
  }

  const onUnitPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    moveDrag(event.clientX, event.clientY)
  }

  const onUnitLostCapture = () => {
    dragRef.current = null
  }

  const onHandlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.currentTarget.classList.add('bx-loupe-handle--dragging')
    beginDrag(event.currentTarget, event.pointerId, event.clientX, event.clientY)
  }

  const onHandlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    moveDrag(event.clientX, event.clientY)
  }

  const onHandleLostCapture = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.classList.remove('bx-loupe-handle--dragging')
    dragRef.current = null
  }

  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const du = (event.shiftKey ? 48 : 20) / Math.max(1, unitSize[0])
    const dv = (event.shiftKey ? 48 : 20) / Math.max(1, unitSize[1])
    const cur = loupePoseRef.current
    activeZoneRef.current = null
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      syncHandlePosition({ u: Math.max(0.16, cur.u - du), v: cur.v }, loupeRadius, unitSize)
      setAnnouncement('Loupe moved left')
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      syncHandlePosition({ u: Math.min(0.84, cur.u + du), v: cur.v }, loupeRadius, unitSize)
      setAnnouncement('Loupe moved right')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      syncHandlePosition({ u: cur.u, v: Math.max(0.14, cur.v - dv) }, loupeRadius, unitSize)
      setAnnouncement('Loupe moved up')
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      syncHandlePosition({ u: cur.u, v: Math.min(0.86, cur.v + dv) }, loupeRadius, unitSize)
      setAnnouncement('Loupe moved down')
    }
  }

  const ensureDipVisibleOnFocus = useCallback(() => {
    const target = measureAnchorPose(unitRef.current, 'dip')
    if (!target) return
    const dx = (loupePoseRef.current.u - target.u) * unitSize[0]
    const dy = (loupePoseRef.current.v - target.v) * unitSize[1]
    if (Math.hypot(dx, dy) > (loupeRadius - 13) * 0.55) {
      jumpLoupeToZone('dip', 'hardware DIP switch bank')
    }
  }, [jumpLoupeToZone, loupeRadius, unitSize])

  const toggleDip = useCallback((key: XrayDipKey) => {
    setDips((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const tier = XRAY_TIERS.find((t) => t.id === tierId) ?? XRAY_TIERS[1]!
  const syncKey = `${tierId}:${channels}:${commits}:${dips.staffHalfOff ? 1 : 0}:${dips.turboClock ? 1 : 0}:${dips.waiveBusFee ? 1 : 0}:${dips.rawHexMode ? 1 : 0}:${unitSize[0]}x${unitSize[1]}`

  return (
    <div className="beyond-bench">
      <div className="beyond-toolbar m-ui">
        <div className="beyond-controls-group">
          <Button
            compact
            variant="outline"
            onClick={() => jumpLoupeToZone('dip', 'hardware DIP switch bank')}
          >
            Inspect DIP switches
          </Button>
          <Button
            compact
            variant="outline"
            onClick={() => jumpLoupeToZone('asic', 'ARM-M7 ASIC bus traces')}
          >
            Inspect ASIC bus
          </Button>
          <Button
            compact
            variant="outline"
            onClick={() => jumpLoupeToZone('oled', 'OLED SPI ribbon connector')}
          >
            Inspect OLED ribbon
          </Button>
        </div>
        <span className="bx-toolbar-hint">
          Click <b>inside</b> the lens to flip PCB DIP switches; click <b>outside</b> for console HTML
        </span>
      </div>

      <div className="beyond-stage-wrap bx-bench-mat">
        <div className="beyond-sr-only" aria-live="polite">
          {announcement}
        </div>

        <div
          ref={unitRef}
          className="bx-unit-frame"
          onPointerDownCapture={onUnitPointerDownCapture}
          onPointerMove={onUnitPointerMove}
          onLostPointerCapture={onUnitLostCapture}
        >
          <BeyondXrayOuterConsole
            tier={tier}
            channels={channels}
            operator={operator}
            commits={commits}
            dips={dips}
            onSelectTier={setTierId}
            onStepChannels={(d) => setChannels((c) => Math.max(1, Math.min(16, c + d)))}
            onChangeOperator={setOperator}
            onCommit={() => setCommits((n) => n + 1)}
          />

          <div className={supported ? 'bx-pcb-slot' : 'bx-pcb-slot bx-pcb-slot--fallback'}>
            <Surface.Root canvasId={canvasId} inScene={supported}>
              <Surface.HTML size={unitSize} pageClassName="bx-surface-page">
                <BeyondXrayPcbLayer
                  supported={supported}
                  size={unitSize}
                  tier={tier}
                  channels={channels}
                  commits={commits}
                  dips={dips}
                  onToggleDip={toggleDip}
                  onFocusDip={ensureDipVisibleOnFocus}
                />
              </Surface.HTML>
              <Surface.Scene>
                <XrayScenePresenter
                  unitElRef={unitRef}
                  loupeRef={loupePoseRef}
                  loupeRadiusPx={loupeRadius}
                  syncKey={syncKey}
                  wakeRef={wakeCanvasRef}
                />
              </Surface.Scene>
            </Surface.Root>
          </div>

          {supported && (
            <button
              ref={handleBtnRef}
              type="button"
              className="bx-loupe-handle"
              aria-label="X-Ray loupe stem handle. Drag bezel or stem, or use arrow keys to inspect circuitry."
              onKeyDown={onHandleKeyDown}
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onLostPointerCapture={onHandleLostCapture}
            >
              ✥ Loupe
            </button>
          )}
        </div>

        {supported && (
          <SurfaceCanvas
            id={canvasId}
            frameloop="demand"
            pointerMode="surfaces"
            gl={{ alpha: true, antialias: false, depth: false }}
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
