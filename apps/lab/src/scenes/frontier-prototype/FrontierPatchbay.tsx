// Variant D: Crossed 3D Surface.Anchor patchbay with recessed hex sockets,
// tilted 3D anodized plug barrels, and paint-generation-locked reflow.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Surface,
  SurfaceCanvas,
  useSurfaceAnchorRects,
  useSurfacePaintedSize,
  useSurfaceStatus,
  useCaptureSupport,
} from '@petepetrash/munari'
import { Button, Tag } from '../../components/system'
import {
  ALL_PORTS,
  FrontierPatchbayBoard,
  SOURCE_SHORT_LABEL,
  type PatchView,
  type SourcePortId,
  type TargetPortId,
} from './FrontierPatchbayBoard'
import {
  createBraidedCordMaterial,
  createCordShadowMaterial,
  createJackMetalMaterial,
  createPreallocatedTube,
  updateCableTubeGeometry,
} from './frontierPatchbayNodes'
import {
  FrontierCanvasTelemetry,
  FrontierPixelCamera,
  retainActiveSurface,
  stageBoxOf,
  useReducedMotion,
} from './frontierStage'

const noRaycast = () => {}
const TMP_SHADOW_A = new THREE.Vector3()
const TMP_SHADOW_B = new THREE.Vector3()

// Crossed default topology (1->2, 2->3, 3->1) so 3D cords arch over one another with parallax!
const DEFAULT_PATCHES: readonly PatchView[] = [
  { id: 'cord-cobalt', from: 'port:dom-alpha', to: 'port:snell-rim', color: '#0c2cb8' },
  { id: 'cord-coral', from: 'port:bg-capture', to: 'port:demand-pass', color: '#d6281c' },
  { id: 'cord-emerald', from: 'port:anchor-uv', to: 'port:sdf-bevel', color: '#0a6e46' },
]

interface CordPhysics {
  pos0: THREE.Vector3
  pos1: THREE.Vector3
  initialized: boolean
  sagOffset: number
  sagVel: number
  swayOffset: number
  swayVel: number
}

function stepCordSpring(
  p: CordPhysics,
  tx0: number,
  ty0: number,
  tx1: number,
  ty1: number,
  dt: number,
  reducedMotion: boolean,
): boolean {
  if (reducedMotion || !p.initialized) {
    p.pos0.set(tx0, ty0, 16)
    p.pos1.set(tx1, ty1, 16)
    p.initialized = true
    p.sagOffset = 0
    p.sagVel = 0
    p.swayOffset = 0
    p.swayVel = 0
    return false
  }

  let active = false
  const d0 = Math.hypot(tx0 - p.pos0.x, ty0 - p.pos0.y)
  const d1 = Math.hypot(tx1 - p.pos1.x, ty1 - p.pos1.y)
  if (d0 > 0.35 || d1 > 0.35) {
    p.pos0.x = THREE.MathUtils.damp(p.pos0.x, tx0, 20, dt)
    p.pos0.y = THREE.MathUtils.damp(p.pos0.y, ty0, 20, dt)
    p.pos1.x = THREE.MathUtils.damp(p.pos1.x, tx1, 20, dt)
    p.pos1.y = THREE.MathUtils.damp(p.pos1.y, ty1, 20, dt)
    p.sagVel += Math.min(60, (d0 + d1) * 1.1)
    active = true
  } else {
    p.pos0.set(tx0, ty0, 16)
    p.pos1.set(tx1, ty1, 16)
  }

  p.sagVel += (-125 * p.sagOffset - 12.5 * p.sagVel) * dt
  p.sagOffset += p.sagVel * dt
  p.swayVel += (-105 * p.swayOffset - 11.5 * p.swayVel) * dt
  p.swayOffset += p.swayVel * dt

  const movingSpring =
    Math.abs(p.sagOffset) > 0.18 ||
    Math.abs(p.sagVel) > 0.6 ||
    Math.abs(p.swayOffset) > 0.18 ||
    Math.abs(p.swayVel) > 0.6

  if (!movingSpring) {
    p.sagOffset = 0
    p.sagVel = 0
    p.swayOffset = 0
    p.swayVel = 0
  }
  return active || movingSpring
}

function SinglePatchCord({
  patch,
  index,
  paintedW,
  paintedH,
  rects,
  visible,
  pluckNonce,
  pulseRef,
  reducedMotion,
  shadowMaterial,
  plugGeo,
  bootGeo,
}: {
  readonly patch: PatchView
  readonly index: number
  readonly paintedW: number
  readonly paintedH: number
  readonly rects: ReturnType<typeof useSurfaceAnchorRects>
  readonly visible: boolean
  readonly pluckNonce: number
  readonly pulseRef: { readonly current: number }
  readonly reducedMotion: boolean
  readonly shadowMaterial: THREE.Material
  readonly plugGeo: THREE.BufferGeometry
  readonly bootGeo: THREE.BufferGeometry
}) {
  const invalidate = useThree((s) => s.invalidate)
  const cordGeo = useMemo(() => createPreallocatedTube(4.2), [])
  const shadowGeo = useMemo(() => createPreallocatedTube(6.0), [])
  const built = useMemo(() => createBraidedCordMaterial(patch.color), [patch.color])
  const barrelMat = useMemo(() => createJackMetalMaterial(patch.color), [patch.color])
  const bootMat = useMemo(() => createJackMetalMaterial('#1e2127'), [])

  const plugStartRef = useRef<THREE.Group>(null)
  const plugEndRef = useRef<THREE.Group>(null)
  const physRef = useRef<CordPhysics>({
    pos0: new THREE.Vector3(),
    pos1: new THREE.Vector3(),
    initialized: false,
    sagOffset: 0,
    sagVel: 0,
    swayOffset: 0,
    swayVel: 0,
  })
  const prevPluckRef = useRef(pluckNonce)
  const needsWriteRef = useRef(true)

  useEffect(
    () => () => {
      cordGeo.dispose()
      shadowGeo.dispose()
      built.material.dispose()
      barrelMat.dispose()
      bootMat.dispose()
    },
    [cordGeo, shadowGeo, built, barrelMat, bootMat],
  )

  useEffect(() => {
    if (pluckNonce !== prevPluckRef.current) {
      prevPluckRef.current = pluckNonce
      if (!reducedMotion) {
        physRef.current.sagVel += 220 + index * 45
        physRef.current.swayVel += (index % 2 === 0 ? 1 : -1) * 160
      }
      needsWriteRef.current = true
      invalidate()
    }
  }, [pluckNonce, index, reducedMotion, invalidate])

  useEffect(() => {
    needsWriteRef.current = true
    invalidate()
  }, [rects, paintedW, paintedH, patch.from, patch.to, invalidate])

  useFrame((_, delta) => {
    if (!rects) return
    const fromRect = rects[patch.from]
    const toRect = rects[patch.to]
    if (!fromRect || !toRect) return

    const bw = paintedW
    const bh = paintedH
    const tx0 = ((fromRect.uMin + fromRect.uMax) * 0.5 - 0.5) * bw
    const ty0 = ((fromRect.vMin + fromRect.vMax) * 0.5 - 0.5) * bh
    const tx1 = ((toRect.uMin + toRect.uMax) * 0.5 - 0.5) * bw
    const ty1 = ((toRect.vMin + toRect.vMax) * 0.5 - 0.5) * bh

    const p = physRef.current
    const active = stepCordSpring(p, tx0, ty0, tx1, ty1, Math.min(delta, 0.035), reducedMotion)
    built.pulseUniform.value = pulseRef.current
    const pulsing = pulseRef.current > 0

    if (active || pulsing || needsWriteRef.current) {
      const span = Math.hypot(p.pos1.x - p.pos0.x, p.pos1.y - p.pos0.y)
      const baseSag = Math.min(54, 18 + span * 0.065 + index * 5) + p.sagOffset
      // Distinct Z arch heights (38, 58, 78 px) so crossing cords clear each other cleanly in depth
      const liftZ = 38 + index * 20
      updateCableTubeGeometry(cordGeo, p.pos0, p.pos1, baseSag, p.swayOffset, liftZ, 4.2)

      const s0 = TMP_SHADOW_A.set(p.pos0.x + 10, p.pos0.y - 14, 1.0)
      const s1 = TMP_SHADOW_B.set(p.pos1.x + 10, p.pos1.y - 14, 1.0)
      updateCableTubeGeometry(shadowGeo, s0, s1, baseSag + liftZ * 0.32, p.swayOffset + liftZ * 0.18, 0.4, 6.2)

      // Tilt 3D anodized plug barrels ~20 deg toward partner port so 3D side profile reads clearly
      const dirX = Math.max(-1, Math.min(1, (p.pos1.x - p.pos0.x) / Math.max(span, 1)))
      if (plugStartRef.current) {
        plugStartRef.current.position.set(p.pos0.x, p.pos0.y, 0)
        plugStartRef.current.rotation.set(0.24, dirX * 0.34, 0)
      }
      if (plugEndRef.current) {
        plugEndRef.current.position.set(p.pos1.x, p.pos1.y, 0)
        plugEndRef.current.rotation.set(0.24, -dirX * 0.34, 0)
      }

      needsWriteRef.current = false
      if (active || pulsing) invalidate()
    }
  })

  return (
    <group visible={visible}>
      <mesh geometry={shadowGeo} material={shadowMaterial} renderOrder={2} raycast={noRaycast} />
      <mesh geometry={cordGeo} material={built.material} renderOrder={5} raycast={noRaycast} />

      <group ref={plugStartRef}>
        <mesh position={[0, 0, 8]} rotation={[Math.PI * 0.5, 0, 0]} geometry={plugGeo} material={barrelMat} renderOrder={4} raycast={noRaycast} />
        <mesh position={[0, 0, 15]} rotation={[Math.PI * 0.5, 0, 0]} geometry={bootGeo} material={bootMat} renderOrder={4} raycast={noRaycast} />
      </group>

      <group ref={plugEndRef}>
        <mesh position={[0, 0, 8]} rotation={[Math.PI * 0.5, 0, 0]} geometry={plugGeo} material={barrelMat} renderOrder={4} raycast={noRaycast} />
        <mesh position={[0, 0, 15]} rotation={[Math.PI * 0.5, 0, 0]} geometry={bootGeo} material={bootMat} renderOrder={4} raycast={noRaycast} />
      </group>
    </group>
  )
}

function PatchbayHardwareChildren({
  fallbackSize,
  patches,
  visible,
  pluckNonce,
  pulseRef,
  reducedMotion,
}: {
  readonly fallbackSize: readonly [number, number]
  readonly patches: readonly PatchView[]
  readonly visible: boolean
  readonly pluckNonce: number
  readonly pulseRef: { readonly current: number }
  readonly reducedMotion: boolean
}) {
  const painted = useSurfacePaintedSize()
  const [pw, ph] = painted()
  const paintedSize: readonly [number, number] = [
    Math.max(280, pw || fallbackSize[0]),
    Math.max(240, ph || fallbackSize[1]),
  ]
  const rects = useSurfaceAnchorRects(ALL_PORTS)
  const hexNutMat = useMemo(() => createJackMetalMaterial('#9aa0ab'), [])
  const boreMat = useMemo(() => createJackMetalMaterial('#14161a'), [])
  const shadowMat = useMemo(createCordShadowMaterial, [])

  const hexNutGeo = useMemo(() => new THREE.CylinderGeometry(9.2, 9.8, 3.5, 6), [])
  const boreGeo = useMemo(() => new THREE.CylinderGeometry(4.6, 4.6, 4.2, 16), [])
  const plugGeo = useMemo(() => new THREE.CylinderGeometry(5.6, 6.2, 12, 18), [])
  const bootGeo = useMemo(() => new THREE.CylinderGeometry(4.4, 5.2, 6, 16), [])

  useEffect(
    () => () => {
      hexNutMat.dispose()
      boreMat.dispose()
      shadowMat.dispose()
      hexNutGeo.dispose()
      boreGeo.dispose()
      plugGeo.dispose()
      bootGeo.dispose()
    },
    [hexNutMat, boreMat, shadowMat, hexNutGeo, boreGeo, plugGeo, bootGeo],
  )

  const [bw, bh] = paintedSize

  return (
    <group visible={visible && rects !== null}>
      {rects &&
        ALL_PORTS.map((portId) => {
          const r = rects[portId]
          if (!r) return null
          const x = ((r.uMin + r.uMax) * 0.5 - 0.5) * bw
          const y = ((r.vMin + r.vMax) * 0.5 - 0.5) * bh
          return (
            <group key={portId} position={[x, y, 0]}>
              <mesh position={[0, 0, 1.8]} rotation={[Math.PI * 0.5, 0, 0]} geometry={hexNutGeo} material={hexNutMat} renderOrder={3} raycast={noRaycast} />
              <mesh position={[0, 0, 2.2]} rotation={[Math.PI * 0.5, 0, 0]} geometry={boreGeo} material={boreMat} renderOrder={3} raycast={noRaycast} />
            </group>
          )
        })}

      {patches.map((patch, idx) => (
        <SinglePatchCord
          key={patch.id}
          patch={patch}
          index={idx}
          paintedW={bw}
          paintedH={bh}
          rects={rects}
          visible={visible && rects !== null}
          pluckNonce={pluckNonce}
          pulseRef={pulseRef}
          reducedMotion={reducedMotion}
          shadowMaterial={shadowMat}
          plugGeo={plugGeo}
          bootGeo={bootGeo}
        />
      ))}
    </group>
  )
}

function PatchbayMeshWithSync({
  fallbackSize,
  patches,
  visible,
  pluckNonce,
  pulseRef,
  reducedMotion,
}: {
  readonly fallbackSize: readonly [number, number]
  readonly patches: readonly PatchView[]
  readonly visible: boolean
  readonly pluckNonce: number
  readonly pulseRef: { readonly current: number }
  readonly reducedMotion: boolean
}) {
  const [w, h] = fallbackSize

  return (
    <Surface.Mesh
      placement="manual"
      pointerRoute="relay"
      renderOrder={1}
      geometry={<planeGeometry args={[w, h]} />}
    >
      <PatchbayHardwareChildren
        fallbackSize={fallbackSize}
        patches={patches}
        visible={visible}
        pluckNonce={pluckNonce}
        pulseRef={pulseRef}
        reducedMotion={reducedMotion}
      />
    </Surface.Mesh>
  )
}

function PatchbaySceneRig({
  slotRef,
  boardSize,
  patches,
  pluckNonce,
  pulseNonce,
  reducedMotion,
}: {
  readonly slotRef: { readonly current: HTMLDivElement | null }
  readonly boardSize: readonly [number, number]
  readonly patches: readonly PatchView[]
  readonly pluckNonce: number
  readonly pulseNonce: number
  readonly reducedMotion: boolean
}) {
  const status = useSurfaceStatus()
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const groupRef = useRef<THREE.Group>(null)
  const pulseRef = useRef(0)
  const prevPulseNonceRef = useRef(pulseNonce)

  useEffect(() => {
    if (status.presentation === 'scene') return retainActiveSurface()
    return undefined
  }, [status.presentation])

  useEffect(() => {
    if (pulseNonce !== prevPulseNonceRef.current) {
      prevPulseNonceRef.current = pulseNonce
      if (!reducedMotion) {
        pulseRef.current = 0.01
        invalidate()
      }
    }
  }, [pulseNonce, reducedMotion, invalidate])

  useEffect(() => {
    invalidate()
  }, [boardSize, invalidate])

  useFrame((_, delta) => {
    const group = groupRef.current
    const box = stageBoxOf(slotRef.current, gl.domElement)
    if (!group || !box) return
    group.position.set(box.x, box.y, 0)

    if (pulseRef.current > 0) {
      if (reducedMotion) {
        pulseRef.current = 0
      } else {
        pulseRef.current += Math.min(delta, 0.05) * 1.55
        if (pulseRef.current >= 1.15) pulseRef.current = 0
        else invalidate()
      }
    }
  })

  return (
    <group ref={groupRef}>
      <PatchbayMeshWithSync
        fallbackSize={boardSize}
        patches={patches}
        visible={status.presentation === 'scene'}
        pluckNonce={pluckNonce}
        pulseRef={pulseRef}
        reducedMotion={reducedMotion}
      />
    </group>
  )
}

export function FrontierPatchbay() {
  const supported = useCaptureSupport()
  const reducedMotion = useReducedMotion()
  const canvasId = useId()

  const [columns, setColumns] = useState<'wide' | 'split'>('wide')
  const [expandedNotes, setExpandedNotes] = useState(false)
  const [armedSource, setArmedSource] = useState<SourcePortId | null>(null)
  const [patches, setPatches] = useState<readonly PatchView[]>(DEFAULT_PATCHES)
  const [pluckNonce, setPluckNonce] = useState(0)
  const [pulseNonce, setPulseNonce] = useState(0)
  const [boardSize, setBoardSize] = useState<readonly [number, number]>([920, 410])

  const slotRef = useRef<HTMLDivElement>(null)
  const liveBoardRef = useRef<HTMLDivElement>(null)

  // Observe the live board element (which moves into captureRoot) so reflow updates size accurately!
  useLayoutEffect(() => {
    const slot = slotRef.current
    const board = liveBoardRef.current
    if (!slot || !board) return
    const measure = () => {
      const w = Math.max(290, Math.round(slot.clientWidth))
      const h = Math.max(300, Math.round(board.offsetHeight))
      setBoardSize((prev) => (prev[0] === w && prev[1] === h ? prev : [w, h]))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(slot)
    ro.observe(board)
    return () => ro.disconnect()
  }, [columns, expandedNotes, patches])

  const handleTargetClick = useCallback(
    (target: TargetPortId) => {
      const source = armedSource ?? 'port:dom-alpha'
      setPatches((prev) =>
        prev.map((item) => (item.from === source ? { ...item, to: target } : item)),
      )
      setArmedSource(null)
      setPluckNonce((n) => n + 1)
      setPulseNonce((n) => n + 1)
    },
    [armedSource],
  )

  const rotateRouting = () => {
    setPatches((prev) => {
      const targets = prev.map((p) => p.to)
      return prev.map((p, idx) => ({
        ...p,
        to: targets[(idx + 1) % targets.length] ?? p.to,
      }))
    })
    setPluckNonce((n) => n + 1)
    setPulseNonce((n) => n + 1)
  }

  return (
    <div className="frontier-bench">
      <div className="frontier-toolbar m-ui">
        <div className="frontier-controls-group" role="group" aria-label="Patchbay actions">
          <Button
            compact
            variant={columns === 'wide' ? 'solid' : 'outline'}
            onClick={() => setColumns((c) => (c === 'wide' ? 'split' : 'wide'))}
          >
            {columns === 'wide' ? 'Wide chassis' : 'Compact reflow'}
          </Button>
          <Button
            compact
            variant={expandedNotes ? 'solid' : 'outline'}
            onClick={() => setExpandedNotes((v) => !v)}
          >
            {expandedNotes ? 'Compact notes' : 'Expand inline prose'}
          </Button>
          <Button compact variant="outline" onClick={rotateRouting}>
            Cross-rotate cords
          </Button>
          <Button compact variant="outline" onClick={() => setPluckNonce((n) => n + 1)}>
            Pluck cords
          </Button>
          <Button compact variant="outline" onClick={() => setPulseNonce((n) => n + 1)}>
            Signal pulse
          </Button>
        </div>

        <Tag>
          {armedSource
            ? `Armed ${SOURCE_SHORT_LABEL[armedSource]} · click any Bank B input`
            : 'Click an Out jack then an In jack to re-patch'}
        </Tag>
      </div>

      <div className="frontier-stage-wrap frontier-patchbay-stage">
        <div
          ref={slotRef}
          className={`frontier-patchbay-slot frontier-patchbay-slot--${columns}`}
          style={{ minHeight: boardSize[1] }}
        >
          <Surface.Root canvasId={canvasId} inScene={supported}>
            <Surface.HTML size={boardSize} live>
              <div style={{ width: boardSize[0] }}>
                <FrontierPatchbayBoard
                  boardRef={liveBoardRef}
                  columns={columns}
                  expandedNotes={expandedNotes}
                  armedSource={armedSource}
                  patches={patches}
                  onArmSource={(id) => setArmedSource((cur) => (cur === id ? null : id))}
                  onSelectTarget={handleTargetClick}
                />
              </div>
            </Surface.HTML>
            <Surface.Scene>
              <PatchbaySceneRig
                slotRef={slotRef}
                boardSize={boardSize}
                patches={patches}
                pluckNonce={pluckNonce}
                pulseNonce={pulseNonce}
                reducedMotion={reducedMotion}
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
