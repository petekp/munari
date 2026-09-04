// The controls scene — one ordinary HTML form that rises into physical matter.
//
// The law: the DOM owns value, focus, semantics and input in both renderers;
// WebGL owns only depth, material and shadow. One Surface carries the complete
// form, while stable anchors stand porcelain, cobalt and brass bodies under the
// exact control pixels from the same successful paint generation.
//
// The fault, 2026-08-30: child meshes under a Surface presenter are separate
// draws. Left mounted during warm-up, they appear before the DOM releases and
// break the transfer identity. This scene keeps them at zero visibility until
// WebGL holds the pixels, and retracts them fully before it asks the DOM back.
//
// Ownership: this module owns the form state, the scene choreography and the
// physical attachments. Surface owns capture, presentation and pointer relay.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Surface,
  SurfaceCanvas,
  useSurfaceSupport,
  useSurfaceAnchorBox,
  useSurfaceHandle,
  useSurfaceState,
  useSurfaceTexture,
  type SurfacePresentation,
} from '@petepetrash/munari'
import {
  CONTROLS_BOARD,
  controlsTuning,
  type ControlMatter,
} from './controlsTuning'
import './controls.css'

interface ControlValues {
  project: string
  material: string
  weight: number
  alerts: boolean
  mode: 'quiet' | 'exact' | 'playful'
  accent: string
  note: string
  saves: number
}

const INITIAL_VALUES: ControlValues = {
  project: 'Direct projections',
  material: 'Porcelain',
  weight: 620,
  alerts: true,
  mode: 'exact',
  accent: '#2148bd',
  note: 'The state stays HTML. Only its physical presence changes.',
  saves: 0,
}

type HardwareKind = 'button' | 'field' | 'select' | 'range' | 'toggle' | 'radio' | 'segment' | 'color'

interface HardwareSpec {
  readonly anchor: string
  readonly kind: HardwareKind
  readonly matter: ControlMatter
}

const HARDWARE: readonly HardwareSpec[] = [
  { anchor: 'field:project', kind: 'field', matter: 'recessed' },
  { anchor: 'select:material', kind: 'select', matter: 'brass' },
  { anchor: 'range:weight', kind: 'range', matter: 'brass' },
  { anchor: 'field:note', kind: 'field', matter: 'recessed' },
  { anchor: 'toggle:alerts', kind: 'toggle', matter: 'cobalt' },
  { anchor: 'radio:quiet', kind: 'radio', matter: 'cobalt' },
  { anchor: 'radio:exact', kind: 'radio', matter: 'cobalt' },
  { anchor: 'radio:playful', kind: 'radio', matter: 'cobalt' },
  { anchor: 'segment:quiet', kind: 'segment', matter: 'porcelain' },
  { anchor: 'segment:exact', kind: 'segment', matter: 'porcelain' },
  { anchor: 'segment:playful', kind: 'segment', matter: 'porcelain' },
  { anchor: 'color:accent', kind: 'color', matter: 'brass' },
  { anchor: 'button:save', kind: 'button', matter: 'cobalt' },
  { anchor: 'button:reset', kind: 'button', matter: 'porcelain' },
]

const noRaycast = () => {}

// ── retained HTML ───────────────────────────────────────────────────────

interface ControlBoardProps {
  copy: 'page' | 'source' | 'fallback'
  values: ControlValues
  setValues: Dispatch<SetStateAction<ControlValues>>
}

function ControlBoard({ copy, values, setValues }: ControlBoardProps) {
  const range = useRef<HTMLInputElement>(null)
  const draggingRange = useRef(false)
  const change = useCallback(
    (next: Partial<ControlValues>) => setValues((current) => ({ ...current, ...next })),
    [setValues],
  )

  const setWeightFromPointer = useCallback(
    (clientX: number) => {
      const box = range.current?.getBoundingClientRect()
      if (!box || box.width <= 0) return
      const unit = THREE.MathUtils.clamp((clientX - box.left) / box.width, 0, 1)
      change({ weight: Math.round(300 + unit * 600) })
    },
    [change],
  )

  const finishRange = useCallback(() => {
    draggingRange.current = false
  }, [])

  return (
    <form
      className="controls-board"
      data-copy={copy}
      style={{ width: CONTROLS_BOARD.width, height: CONTROLS_BOARD.height }}
      onSubmit={(event) => {
        event.preventDefault()
        change({ saves: values.saves + 1 })
      }}
      onPointerMove={(event) => {
        if (!draggingRange.current) return
        if (event.buttons === 0) finishRange()
        else setWeightFromPointer(event.clientX)
      }}
      onPointerUp={finishRange}
      onPointerCancel={finishRange}
    >
      <header className="controls-board__head">
        <div>
          <span className="controls-kicker">HTML specimen 01</span>
          <h2>Live controls, given mass.</h2>
        </div>
        <div className="controls-board__readout" aria-live="polite">
          <span>commits</span>
          <strong>{String(values.saves).padStart(2, '0')}</strong>
        </div>
      </header>

      <div className="controls-board__grid">
        <section className="controls-column" aria-labelledby={`controls-content-${copy}`}>
          <div className="controls-section-head">
            <span id={`controls-content-${copy}`}>Content</span>
            <i>native fields</i>
          </div>

          <label className="controls-field">
            <span>Project</span>
            <input
              data-munari-anchor="field:project"
              value={values.project}
              onChange={(event) => change({ project: event.target.value })}
            />
          </label>

          <label className="controls-field">
            <span>Surface</span>
            <span className="controls-select" data-munari-anchor="select:material">
              <select
                value={values.material}
                onChange={(event) => change({ material: event.target.value })}
              >
                <option>Porcelain</option>
                <option>Cobalt glass</option>
                <option>Brushed brass</option>
                <option>Warm paper</option>
              </select>
              <i aria-hidden>⌄</i>
            </span>
          </label>

          <label className="controls-field controls-field--range">
            <span>
              Weight <b className="controls-range-value">{values.weight}</b>
            </span>
            <input
              ref={range}
              data-munari-anchor="range:weight"
              type="range"
              min="300"
              max="900"
              value={values.weight}
              onChange={(event) => change({ weight: Number(event.target.value) })}
              onPointerDown={(event) => {
                draggingRange.current = true
                setWeightFromPointer(event.clientX)
              }}
            />
          </label>

          <label className="controls-field controls-field--note">
            <span>Inscription</span>
            <textarea
              data-munari-anchor="field:note"
              value={values.note}
              onChange={(event) => change({ note: event.target.value })}
            />
          </label>
        </section>

        <section className="controls-column" aria-labelledby={`controls-behavior-${copy}`}>
          <div className="controls-section-head">
            <span id={`controls-behavior-${copy}`}>Behavior</span>
            <i>same state, both renderers</i>
          </div>

          <label className="controls-check-row">
            <input
              data-munari-anchor="toggle:alerts"
              type="checkbox"
              checked={values.alerts}
              onChange={(event) => change({ alerts: event.target.checked })}
            />
            <span>
              <strong>Signal on completion</strong>
              <small>A real checkbox under the porcelain.</small>
            </span>
          </label>

          <fieldset className="controls-radios">
            <legend>Response</legend>
            {(['quiet', 'exact', 'playful'] as const).map((mode) => (
              <label key={mode}>
                <input
                  data-munari-anchor={`radio:${mode}`}
                  type="radio"
                  name={`controls-response-${copy}`}
                  value={mode}
                  checked={values.mode === mode}
                  onChange={() => change({ mode })}
                />
                <span>{mode}</span>
              </label>
            ))}
          </fieldset>

          <div className="controls-field">
            <span>Cadence</span>
            <div className="controls-segments" role="group" aria-label="Cadence">
              {(['quiet', 'exact', 'playful'] as const).map((mode) => (
                <button
                  key={mode}
                  data-munari-anchor={`segment:${mode}`}
                  type="button"
                  data-on={values.mode === mode || undefined}
                  aria-pressed={values.mode === mode}
                  onClick={() => change({ mode })}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <label className="controls-color-row">
            <span>
              <strong>Signal color</strong>
              <small>{values.accent.toUpperCase()}</small>
            </span>
            <input
              data-munari-anchor="color:accent"
              type="color"
              value={values.accent}
              onChange={(event) => change({ accent: event.target.value })}
            />
          </label>
        </section>
      </div>

      <footer className="controls-board__foot">
        <p>
          <i style={{ background: values.accent }} />
          {values.alerts ? `${values.material} · ${values.mode}` : 'Signal muted'}
        </p>
        <div>
          <button
            data-munari-anchor="button:reset"
            type="button"
            className="controls-button controls-button--quiet"
            onClick={() => setValues(INITIAL_VALUES)}
          >
            Reset
          </button>
          <button
            data-munari-anchor="button:save"
            type="submit"
            className="controls-button controls-button--primary"
          >
            Commit specimen
          </button>
        </div>
      </footer>
    </form>
  )
}

// ── texture-faced hardware ─────────────────────────────────────────────

interface HardwareMaterials {
  porcelain: THREE.MeshPhysicalMaterial
  cobalt: THREE.MeshPhysicalMaterial
  brass: THREE.MeshStandardMaterial
  recessed: THREE.MeshPhysicalMaterial
}

function useHardwareMaterials(): HardwareMaterials {
  const materials = useMemo<HardwareMaterials>(
    () => ({
      porcelain: new THREE.MeshPhysicalMaterial({
        color: controlsTuning.porcelainEdge,
        roughness: 0.2,
        metalness: 0.02,
        clearcoat: 0.85,
        clearcoatRoughness: 0.16,
      }),
      cobalt: new THREE.MeshPhysicalMaterial({
        color: controlsTuning.cobaltEdge,
        roughness: 0.17,
        metalness: 0.08,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
      }),
      brass: new THREE.MeshStandardMaterial({
        color: controlsTuning.brassEdge,
        roughness: 0.2,
        metalness: 0.72,
      }),
      recessed: new THREE.MeshPhysicalMaterial({
        color: controlsTuning.porcelain,
        roughness: 0.34,
        metalness: 0,
        clearcoat: 0.45,
        clearcoatRoughness: 0.28,
      }),
    }),
    [],
  )
  useEffect(
    () => () => {
      materials.porcelain.dispose()
      materials.cobalt.dispose()
      materials.brass.dispose()
      materials.recessed.dispose()
    },
    [materials],
  )
  return materials
}

function useCaptureCapMaterial(texture: THREE.Texture | null) {
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        premultipliedAlpha: true,
        toneMapped: false,
        alphaTest: 0.003,
      }),
    [],
  )
  useLayoutEffect(() => {
    const hadMap = material.map !== null
    material.map = texture
    if (hadMap !== (texture !== null)) material.needsUpdate = true
  }, [material, texture])
  useEffect(() => () => material.dispose(), [material])
  return material
}

function roundedRectGeometry(width: number, height: number, radius: number) {
  const x = width / 2
  const y = height / 2
  const r = Math.min(radius, x, y)
  const shape = new THREE.Shape()
  shape.moveTo(-x + r, -y)
  shape.lineTo(x - r, -y)
  shape.quadraticCurveTo(x, -y, x, -y + r)
  shape.lineTo(x, y - r)
  shape.quadraticCurveTo(x, y, x - r, y)
  shape.lineTo(-x + r, y)
  shape.quadraticCurveTo(-x, y, -x, y - r)
  shape.lineTo(-x, -y + r)
  shape.quadraticCurveTo(-x, -y, -x + r, -y)
  return new THREE.ShapeGeometry(shape, 8)
}

function aimCapAtAnchor(geometry: THREE.BufferGeometry, box: NonNullable<ReturnType<typeof useSurfaceAnchorBox>>) {
  const positions = geometry.getAttribute('position')
  const uvs = geometry.getAttribute('uv')
  const centerU = (box.uv.uMin + box.uv.uMax) / 2
  const centerV = (box.uv.vMin + box.uv.vMax) / 2
  const spanU = box.uv.uMax - box.uv.uMin
  const spanV = box.uv.vMax - box.uv.vMin
  for (let i = 0; i < positions.count; i++) {
    uvs.setXY(
      i,
      centerU + (positions.getX(i) / box.width) * spanU,
      centerV + (positions.getY(i) / box.height) * spanV,
    )
  }
  uvs.needsUpdate = true
}

function PhysicalPiece({
  spec,
  amount,
  capMaterial,
  materials,
}: {
  spec: HardwareSpec
  amount: React.RefObject<number>
  capMaterial: THREE.Material
  materials: HardwareMaterials
}) {
  const box = useSurfaceAnchorBox()
  const group = useRef<THREE.Group>(null)
  const width = box?.width ?? 0
  const height = box?.height ?? 0
  const depth = controlsTuning.depth[spec.matter]
  const round = spec.kind === 'radio' || spec.kind === 'color'
  const capRadius = Math.min(width, height) * (round ? 0.5 : 0.17)
  const edgeRadius = Math.min(capRadius, depth * 0.44)
  const geometry = useMemo(
    () => (width > 0 && height > 0 ? roundedRectGeometry(width, height, capRadius) : null),
    [width, height, capRadius],
  )

  useEffect(() => () => geometry?.dispose(), [geometry])
  useLayoutEffect(() => {
    if (geometry && box) aimCapAtAnchor(geometry, box)
  }, [geometry, box])

  useFrame(() => {
    const node = group.current
    if (!node) return
    const value = amount.current
    node.visible = value > 0.003
    node.scale.z = Math.max(value, 0.001)
  })

  if (!box || !geometry || width <= 0 || height <= 0) return null
  return (
    <group ref={group} visible={false}>
      <RoundedBox
        args={[width, height, depth]}
        radius={edgeRadius}
        smoothness={5}
        position={[0, 0, depth / 2]}
        material={materials[spec.matter]}
        castShadow
        receiveShadow
        raycast={noRaycast}
      />
      <mesh
        geometry={geometry}
        material={capMaterial}
        position={[0, 0, depth + 0.00045]}
        raycast={noRaycast}
      />
    </group>
  )
}

function MatterStage({ active, onRetracted }: { active: boolean; onRetracted: () => void }) {
  const texture = useSurfaceTexture()
  const materials = useHardwareMaterials()
  const capMaterial = useCaptureCapMaterial(texture)
  const amount = useRef(0)
  const receiver = useRef<THREE.Mesh>(null)
  const shadow = useRef<THREE.ShadowMaterial>(null)
  const rose = useRef(false)
  const announced = useRef(false)

  useFrame((_, delta) => {
    const target = active ? 1 : 0
    const next = THREE.MathUtils.damp(
      amount.current,
      target,
      controlsTuning.riseDamping,
      Math.min(delta, 1 / 30),
    )
    amount.current = Math.abs(next - target) < 0.001 ? target : next
    if (target === 1) {
      rose.current = true
      announced.current = false
    }
    if (receiver.current) receiver.current.visible = amount.current > 0.003
    if (shadow.current) shadow.current.opacity = controlsTuning.shadowOpacity * amount.current
    if (target === 0 && amount.current === 0 && rose.current && !announced.current) {
      announced.current = true
      rose.current = false
      onRetracted()
    }
  })

  return (
    <>
      <mesh ref={receiver} position={[0, 0, 0.0002]} receiveShadow raycast={noRaycast} visible={false}>
        <planeGeometry args={[1, 1]} />
        <shadowMaterial ref={shadow} color={controlsTuning.shadow} transparent opacity={0} />
      </mesh>
      {HARDWARE.map((spec) => (
        <Surface.Anchor key={spec.anchor} name={spec.anchor}>
          <PhysicalPiece
            spec={spec}
            amount={amount}
            capMaterial={capMaterial}
            materials={materials}
          />
        </Surface.Anchor>
      ))}
    </>
  )
}

function ControlsLights() {
  const key = useRef<THREE.DirectionalLight>(null)
  useLayoutEffect(() => {
    const light = key.current
    if (!light) return
    const parent = light.parent
    light.target.position.set(0, 0, 4)
    parent?.add(light.target)
    light.shadow.mapSize.set(2048, 2048)
    light.shadow.bias = -0.0002
    light.shadow.normalBias = 0.012
    light.shadow.radius = 3
    light.shadow.blurSamples = 12
    light.shadow.camera.near = 0.1
    light.shadow.camera.far = 10
    light.shadow.camera.left = -2
    light.shadow.camera.right = 2
    light.shadow.camera.top = 2
    light.shadow.camera.bottom = -2
    light.shadow.camera.updateProjectionMatrix()
    return () => {
      if (light.target.parent === parent) parent?.remove(light.target)
    }
  }, [])
  return (
    <>
      <hemisphereLight args={['#fffaf0', '#33477d', 1.45]} />
      <directionalLight ref={key} castShadow position={[-2.4, 3.1, 6]} intensity={3.4} color="#fff4dd" />
      <pointLight position={[2.2, -1.6, 5.2]} intensity={4.5} color="#5579e8" distance={7} />
    </>
  )
}

// ── page and handoff ───────────────────────────────────────────────────

function ModeControl({
  supported,
  wantsMatter,
  presented,
  changing,
  onToggle,
}: {
  supported: boolean
  wantsMatter: boolean
  presented: SurfacePresentation
  changing: boolean
  onToggle: () => void
}) {
  const status = !supported
    ? 'ordinary DOM fallback'
    : changing
      ? wantsMatter
        ? 'giving the pixels depth'
        : 'returning them to the page'
      : presented === 'canvas'
        ? 'live WebGL matter'
        : 'ordinary live DOM'
  return (
    <div className="controls-mode">
      <button type="button" disabled={!supported} aria-pressed={wantsMatter} onClick={onToggle}>
        <span aria-hidden data-on={wantsMatter || undefined} />
        {wantsMatter ? 'Return to HTML' : 'Make physical'}
      </button>
      <p>
        <i data-on={presented === 'canvas' || undefined} />
        {status}
      </p>
    </div>
  )
}

export function ControlsApp() {
  const supported = useSurfaceSupport()
  const surface = useSurfaceHandle('controls-board')
  const state = useSurfaceState(surface)
  const [values, setValues] = useState<ControlValues>(INITIAL_VALUES)
  const [wantsMatter, setWantsMatter] = useState(false)

  const toggleMatter = useCallback(() => {
    if (!state.supported) return
    if (wantsMatter) {
      setWantsMatter(false)
    } else {
      setWantsMatter(true)
    }
  }, [state.supported, wantsMatter])

  const fallbackBoard = <ControlBoard copy="fallback" values={values} setValues={setValues} />
  const sourceBoard = <ControlBoard copy="source" values={values} setValues={setValues} />
  const pageBoard = <ControlBoard copy="page" values={values} setValues={setValues} />

  return (
    <div className="controls-page">
      {supported && (
        <SurfaceCanvas
          id="controls"
          pointerMode="surfaces"
          shadows="variance"
          frameloop="always"
          style={{ position: 'fixed', inset: 0, zIndex: 30 }}
          gl={{ alpha: true, antialias: true }}
          dpr={[1, 2]}
          camera={{ position: [0, 0, 5], fov: 38, near: 0.1, far: 20 }}
          onCreated={(state) => {
            state.gl.setClearAlpha(0)
            window.__r3f = state
          }}
        >
          <ControlsLights />
        </SurfaceCanvas>
      )}

      <main className="controls-layout">
        <aside className="controls-intro">
          <span className="controls-kicker">candidate / controls</span>
          <h1>What if HTML controls had weight?</h1>
          <p>
            Type, drag, select and Tab through the form. The state never leaves the DOM.
            The other renderer adds only the part a stylesheet cannot: real depth, reflected
            light and a shadow cast by the control itself.
          </p>
          <ModeControl
            supported={supported}
            wantsMatter={wantsMatter}
            presented={state.presented}
            changing={state.isChanging || (state.presented === 'canvas' && !wantsMatter)}
            onToggle={toggleMatter}
          />
        </aside>

        <div className="controls-board-place">
          {supported ? (
            <Surface
              surface={surface}
              canvas="controls"
              source={sourceBoard}
              renderIn={wantsMatter ? 'canvas' : 'page'}
              timing={{ settleMs: 220, durationMs: 360 }}
            >
              <Surface.DOM>{pageBoard}</Surface.DOM>
              <Surface.Mesh
                  name="controls-board-surface"
                  alpha="source"
                  pointerEvents="geometry"
                  frustumCulled={false}
                >
                  <MatterStage
                    active={wantsMatter && state.presented === 'canvas'}
                    onRetracted={() => undefined}
                  />
                </Surface.Mesh>
            </Surface>
          ) : (
            fallbackBoard
          )}
        </div>
      </main>
    </div>
  )
}
