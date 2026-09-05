import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import {
  Dial,
  FocusGroup,
  Surface,
  type GroupFocusState,
  useFocusScene,
} from '@petepetrash/munari'
import { paintStats } from '@petepetrash/munari/advanced'
import { arcLayout, type ArcSlot } from './recipe/arcLayout'
import {
  FocusOrbitRig,
  type FocusRigApi,
} from './recipe/FocusOrbitRig'
import { SurfaceProviderProbe } from '../../lib/surfaceProvider'
import {
  buildPanels,
  injectWorkspaceStyles,
  PANEL_W,
  PANEL_H,
  type PanelSpec,
} from './workspaceContent'

// The workspace scene — the spatial workspace: attention is a place.
//
// ~33 real DOM panels on a cylindrical arc around the viewer. The periphery
// stays ambient (perspective compresses it; paint pulses surface changes
// pre-attentively); approaching a panel makes it fully real — caret, focus,
// native typing. The upload-on-paint contract is what makes the paradigm
// affordable: every idle panel is free, so the scene's cost tracks *change*,
// exactly like attention does.
//
// Interaction grammar:
//   double-click a panel  → camera dollies to face it head-on
//   double-click the floor → step back to the room view
//   drag a panel's title bar → reposition it (ray ∩ horizontal plane,
//     MomentumCard's capture idiom — decisions.md #4)
//   click into text and type → it's just the DOM

const W3 = PANEL_W / 200
const H3 = PANEL_H / 200
const COLS = 11
const ROWS = 3
const RADIUS = 7
const SPAN = THREE.MathUtils.degToRad(210)
const ROW_YS = [0.78, 2.36, 3.94]
const LOOK_TARGET = new THREE.Vector3(0, 1.7, 0)
const HOME_POS = new THREE.Vector3(0, 2.0, 3.4)
const HOME_TARGET = new THREE.Vector3(0, 1.6, 0)
const APPROACH_DIST = 3.05 // ≥ OrbitControls minDistance so the tween's end pose survives

// All this lab needs from OrbitControls directly: the drag handlers pause it
// while a panel is being repositioned. Camera mechanics live in FocusOrbitRig.
interface OrbitLike {
  enabled: boolean
}

/**
 * r3f keeps whatever controls a scene installed, and types them as no more
 * than an event dispatcher — the store cannot know which library they came
 * from. This scene needs one switch off them: the one it flips while a drag
 * owns the pointer. So it asks whether that switch is there, which is a real
 * question with a real no (a scene with no controls at all, or with controls
 * that turn off some other way).
 */
function hasEnabledSwitch(
  controls: THREE.EventDispatcher | null,
): controls is THREE.EventDispatcher & OrbitLike {
  if (controls === null || !('enabled' in controls)) return false
  return controls.enabled === true || controls.enabled === false
}

// ---------------------------------------------------------------------------
// One workspace panel: a Surface plus a grab handle. Dragging follows
// MomentumCard's idiom — pointer capture on the handle, all math from
// e.ray ∩ a horizontal plane seated at grab time (decisions.md #4).



function WorkPanel({
  spec,
  slot,
  order,
  rig,
  register,
  demandProbe = false,
}: {
  spec: PanelSpec
  slot: ArcSlot
  order: number
  rig: React.RefObject<FocusRigApi | null>
  register: (id: string, group: THREE.Group | null) => void
  demandProbe?: boolean
}) {
  const group = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => (hasEnabledSwitch(s.controls) ? s.controls : null))
  const drag = useRef<{
    active: boolean
    pointerId: number
    lastX: number
    lastY: number
    angle: number
    radius: number
    controls: OrbitLike | null
  }>({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
    angle: 0,
    radius: 0,
    controls: null,
  })
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState<GroupFocusState>('none')
  const focusScene = useFocusScene()
  // The live source root, for satellite controls that paint into the panel
  // (the dial's readout is real DOM — that's the point).
  const sourceRoot = useRef<HTMLElement | null>(null)
  const [probeWidth, setProbeWidth] = useState(PANEL_W)

  const setGroup = useCallback(
    (g: THREE.Group | null) => {
      group.current = g
      register(spec.id, g)
    },
    [spec.id, register],
  )

  const approachNow = () => {
    const g = group.current
    if (!g || !rig.current) return
    const center = g.getWorldPosition(new THREE.Vector3())
    const facing = g.getWorldDirection(new THREE.Vector3()) // +z = panel front
    rig.current.approach(center, facing)
  }

  const approach = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    approachNow()
  }

  // Drag is a parametric polar mapping from pointer DELTAS, not a plane
  // intersection: screen-x slides the panel around the arc, screen-y pulls
  // it closer / pushes it away. A ray ∩ horizontal-plane version was tried
  // and failed geometrically: upper-row handles sit above eye level, and a
  // downward ray meets an overhead plane receding toward infinity — "pull
  // toward me" read as "fly away". Deltas keep the reference frame static
  // (decisions.md #4's actual point) and behave identically at every row
  // height. Same shape as use1DOF's pointer→coordinate mapping.
  const onHandleDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const g = group.current
    if (!g) return
    gl.domElement.setPointerCapture(e.pointerId)
    if (controls) controls.enabled = false
    const d = drag.current
    d.active = true
    d.pointerId = e.pointerId
    d.controls = controls
    d.lastX = e.nativeEvent.clientX
    d.lastY = e.nativeEvent.clientY
    d.angle = Math.atan2(g.position.x, -g.position.z)
    d.radius = Math.hypot(g.position.x, g.position.z)
  }

  const moveHandle = (clientX: number, clientY: number) => {
    const d = drag.current
    const g = group.current
    if (!d.active || !g) return
    const dx = clientX - d.lastX
    const dy = clientY - d.lastY
    d.lastX = clientX
    d.lastY = clientY
    d.angle += dx * 0.0032
    d.radius = THREE.MathUtils.clamp(d.radius - dy * 0.011, 2.2, 8.6)
    g.position.x = d.radius * Math.sin(d.angle)
    g.position.z = -d.radius * Math.cos(d.angle)
    g.lookAt(camera.position.x, g.position.y, camera.position.z)
  }

  const finishHandle = () => {
    const d = drag.current
    if (!d.active) return
    d.active = false
    if (gl.domElement.hasPointerCapture(d.pointerId)) {
      gl.domElement.releasePointerCapture(d.pointerId)
    }
    d.pointerId = -1
    if (d.controls) d.controls.enabled = true
    d.controls = null
    // The panel (and its satellite dial) came to rest somewhere new.
    focusScene?.syncProxyRects()
  }

  // R3F pointer targets are scene objects, not DOM elements. Capture on the
  // canvas so the drag remains live beyond the small handle, and restore the
  // camera controls from native pointer-up/cancel even when the ray leaves it.
  useEffect(() => {
    const move = (event: PointerEvent) => moveHandle(event.clientX, event.clientY)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finishHandle)
    window.addEventListener('pointercancel', finishHandle)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finishHandle)
      window.removeEventListener('pointercancel', finishHandle)
    }
  })

  useEffect(() => {
    group.current?.lookAt(LOOK_TARGET.x, LOOK_TARGET.y, LOOK_TARGET.z)
  }, [])

  const onHandleMove = (e: ThreeEvent<PointerEvent>) =>
    moveHandle(e.nativeEvent.clientX, e.nativeEvent.clientY)

  return (
    <group position={slot.position} ref={setGroup}>
      <FocusGroup id={spec.id} order={order} objectRef={group} onStateChange={setFocus}>
        <Surface
          name={`workspace-${spec.id}`}
          source={
            <WorkspacePanelSource
              spec={spec}
              sourceRoot={sourceRoot}
              demandProbe={demandProbe}
              setProbeWidth={setProbeWidth}
            />
          }
          size={[demandProbe ? probeWidth : PANEL_W, PANEL_H]}
          onReady={() => {
            const record = window.__domSurfaceDemand
            if (record) record.ready = true
          }}
          >
          <Surface.WebGL
            name={`workspace-${spec.id}`}
            geometry={<planeGeometry args={[demandProbe ? probeWidth / 200 : W3, H3]} />}
            onDoubleClick={approach}
            castShadow
          />
        </Surface>
        {/* Satellite knob: a WebGL leaf in the SAME focus group — Tab flows
            from the panel's last button onto it (the mixed-group
            proof). Its detents paint the panel's readout: physics in the
            scene, consequence in the document. */}
        {spec.dial && (
          <Dial
            position={[W3 / 2 + 0.46, -H3 * 0.12, 0.14]}
            scale={0.72}
            detents={spec.dial.detents}
            initialDetent={spec.dial.initialDetent}
            focusLabel={spec.dial.label}
            valueText={(i) => spec.dial!.values[i]}
            onDetent={(i) => {
              const el = sourceRoot.current?.querySelector('[data-cutoff]')
              if (el) el.textContent = spec.dial!.values[i]
            }}
            castShadow
          />
        )}
        {/* Grab handle: the one part of a panel that is matter, not screen.
            Doubles as the focus lamp — unit selection glows it steady,
            interior engagement brightens it. */}
        <mesh
          position={[0, H3 / 2 + 0.09, 0]}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={finishHandle}
          onPointerOver={() => {
            setHover(true)
            document.body.style.cursor = 'grab'
          }}
          onPointerOut={() => {
            setHover(false)
            document.body.style.cursor = 'auto'
          }}
        >
          <boxGeometry args={[W3 * 0.42, 0.09, 0.045]} />
          <meshStandardMaterial
            color={hover || focus !== 'none' ? '#ff6a38' : '#3a3b40'}
            emissive={focus === 'interior' ? '#ff8a4d' : hover || focus === 'unit' ? '#ff4f17' : '#000000'}
            emissiveIntensity={focus === 'interior' ? 1.15 : hover || focus === 'unit' ? 0.6 : 0}
            roughness={0.4}
          />
        </mesh>
      </FocusGroup>
    </group>
  )
}

// The panel owns live form controls through `dangerouslySetInnerHTML`.
// React replaces those descendants whenever this component renders, even
// when the HTML string is unchanged. FocusScene updates the panel's GL lamp
// when focus moves, so an un-memoized source removed the newly focused
// control one commit later. Stable props mean stable source DOM.
const WorkspacePanelSource = memo(function WorkspacePanelSource({
  spec,
  sourceRoot,
  demandProbe,
  setProbeWidth,
}: {
  spec: PanelSpec
  sourceRoot: React.MutableRefObject<HTMLElement | null>
  demandProbe: boolean
  setProbeWidth: React.Dispatch<React.SetStateAction<number>>
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  const provider = useContext(SurfaceProviderProbe)

  useEffect(() => {
    const root = wrapper.current?.firstElementChild
    if (!(root instanceof HTMLElement)) return
    sourceRoot.current = root
    const cleanup = spec.feed?.(root)
    if (demandProbe) {
      let mutation = false
      window.__domSurfaceDemand = {
        ready: false,
        mutate: () => {
          mutation = !mutation
          root.style.background = mutation ? 'rgb(255, 0, 170)' : 'rgb(0, 220, 255)'
        },
        resize: (next: number) => setProbeWidth(Math.max(120, Math.round(next))),
        readSource: () => {
          const canvas = root.closest('[data-munari-source-host]')?.parentElement
          if (!(canvas instanceof HTMLCanvasElement)) return -1
          const context = canvas.getContext('2d')
          if (!context) return -1
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
          let hash = 2166136261
          for (let i = 0; i < pixels.length; i += 17) {
            hash ^= pixels[i]
            hash = Math.imul(hash, 16777619)
          }
          return hash >>> 0
        },
        readPaints: () =>
          paintStats().find((entry) => entry.label === `workspace-${spec.id}`)?.paints ?? -1,
        readSourceWidth: () => root.closest('[data-munari-source-host]')?.clientWidth ?? -1,
      }
    }
    return () => {
      sourceRoot.current = null
      cleanup?.()
      if (demandProbe) delete window.__domSurfaceDemand
    }
  }, [spec, sourceRoot, demandProbe, setProbeWidth])

  return (
    <div
      ref={wrapper}
      data-surface-provider={provider}
      dangerouslySetInnerHTML={{ __html: spec.html }}
    />
  )
})

// ---------------------------------------------------------------------------

export function Workspace() {
  const rig = useRef<FocusRigApi | null>(null)
  const groups = useRef(new Map<string, THREE.Group>())
  const panels = useMemo(buildPanels, [])
  const demandProbe =
    new URLSearchParams(window.location.search).get('probe') === 'dom-surface-demand'
  const slots = useMemo(
    () => arcLayout({ cols: COLS, rows: ROWS, radius: RADIUS, span: SPAN, rowYs: ROW_YS }),
    [],
  )

  useEffect(() => injectWorkspaceStyles(), [])

  // Keyboard grammar (docs/focus.md × this lab): Tab walks the real controls
  // and crosses to the next panel at an edge. A read-only panel is one unit
  // stop. Enter on a unit is the commitment gesture (zoom in), and Escape's
  // last rung steps home. FocusOrbitRig owns those camera reactions; this
  // scene only supplies poses. Mouse keeps its own grammar: double-click
  // approaches, and pointer focus never moves the camera.

  // Automation hooks: deterministic camera moves for agent-browser runs.
  useEffect(() => {
    const w = window
    w.__workspace = {
      panelIds: panels.map((p) => p.id),
      approach: (id: string) => {
        const g = groups.current.get(id)
        if (!g || !rig.current) return false
        rig.current.approach(
          g.getWorldPosition(new THREE.Vector3()),
          g.getWorldDirection(new THREE.Vector3()),
        )
        return true
      },
      home: () => rig.current?.home(),
      setMotion: (mode: 'animated' | 'instant' | 'auto') => rig.current?.setMotion(mode),
      panelWorldPos: (id: string) => {
        const g = groups.current.get(id)
        return g ? g.getWorldPosition(new THREE.Vector3()).toArray() : null
      },
    }
    return () => {
      delete w.__workspace
    }
  }, [panels])

  const register = useCallback((id: string, g: THREE.Group | null) => {
    if (g) groups.current.set(id, g)
    else groups.current.delete(id)
  }, [])

  return (
    <>
      <fog attach="fog" args={['#0a0b0e', 9, 22]} />
      <ambientLight intensity={0.38} />
      <directionalLight position={[4, 9, 4]} intensity={1.15} castShadow />
      <pointLight position={[0, 4.5, 0]} intensity={26} color="#f2f0ea" distance={14} />
      <pointLight position={[-6, 1.5, 3]} intensity={12} color="#ff8a4d" distance={10} />

      <FocusOrbitRig
        home={{ position: HOME_POS, target: HOME_TARGET }}
        approachDistance={APPROACH_DIST}
        apiRef={rig}
      />

      {/* Floor doubles as the "step back" affordance. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
        receiveShadow
        onDoubleClick={(e) => {
          e.stopPropagation()
          rig.current?.home()
        }}
      >
        <circleGeometry args={[14, 64]} />
        <meshStandardMaterial color="#131418" roughness={0.95} />
      </mesh>

      {panels.map((spec, i) => (
        <WorkPanel
          key={spec.id}
          spec={spec}
          slot={slots[i]}
          // Authored ring order: the roster grid read as designed — top row
          // first, left to right (roster row 0 is the BOTTOM row).
          order={(ROWS - 1 - Math.floor(i / COLS)) * COLS + (i % COLS)}
          rig={rig}
          register={register}
          // Eye-level center: visible in the product camera and static at
          // rest, so its only new frames are the probe's own DOM changes.
          demandProbe={demandProbe && i === 16}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// DOM-side HUD (rendered by App outside the Canvas): the contract, live.
// surfaces / paints-per-second / fps — the "40 live documents, zero cost"
// claim as numbers rather than an assertion.

export function WorkspaceHud() {
  const [line, setLine] = useState('…')

  useEffect(() => {
    let frames = 0
    let raf = 0
    const countFrame = () => {
      frames++
      raf = requestAnimationFrame(countFrame)
    }
    raf = requestAnimationFrame(countFrame)

    let lastPaints = -1
    const interval = window.setInterval(() => {
      const stats = paintStats()
      const total = stats.reduce((sum, s) => sum + s.paints, 0)
      const pps = lastPaints < 0 ? 0 : (total - lastPaints) * 2
      lastPaints = total
      const fps = frames * 2
      frames = 0
      setLine(`${stats.length} surfaces · ${pps} paints/s · ${fps} fps`)
      window.__workspaceHud = {
        surfaces: stats.length,
        paintsPerSec: pps,
        fps,
      }
    }, 500)

    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(interval)
    }
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        right: 18,
        bottom: 16,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
        letterSpacing: '0.04em',
        color: '#ff6a38',
        background: 'rgba(10, 15, 28, 0.72)',
        border: '1px solid rgba(242,240,234,0.16)',
        borderRadius: 8,
        padding: '6px 10px',
        pointerEvents: 'none',
      }}
    >
      {line}
    </div>
  )
}
