// The optics bench — a proofing sheet, and a kit of glass to study it with.
//
// The claim of the scene, in one sentence: a magnifier on the web has
// always been a magnifier of a SCREENSHOT, and this one is a magnifier of
// the DOCUMENT. Put the loupe over the Aqua sheet's pinstripes and the
// stripes stay square-edged, because the page under the glass is being
// rastered again at the tier the glass asks for, not stretched. Turn the
// pinning off in the readout and you get the other thing — the same
// geometry, the same refraction, over a 1× raster — and the difference is
// the whole demonstration. It measured 2.96× on stripes and 3.34× on
// text, against a total-variation control that stayed at 0.99×
// (docs/spikes/optics-loupe.md).
//
// The sheet is SIX Surfaces, not one. That is forced: a Surface carries
// one resolution tier, so detail under the glass and cheapness beside it
// have to be different paint records. `opticsSheet.ts` is the layout,
// `opticsLod.ts` decides which blocks the glass has claimed, and the
// hysteresis in there is why dragging across a row costs one paint per
// block instead of one per frame.
//
// Two seams are worth knowing about before changing anything here.
//
// The GLASS samples an offscreen re-render of the page, framed to exactly
// the disc the instrument can see (`footprint`). It cannot sample the
// blocks directly — a fragment shader would have to choose among six
// textures per pixel — and the offscreen pass is rendered at the
// instrument's own tier, so it carries the detail the blocks were asked
// for and no more. That is what keeps the sharpness honest: the pass adds
// no pixels, it only collects the ones the browser rastered.
//
// The POINTER goes through the same refraction, forwards. Each block
// installs a raycast that intersects the lens plane, refracts the pointer
// ray with `landOffset` — the literal twin of the GLSL — and claims the
// hit only if the refracted ray lands inside its own rectangle. Exactly
// one block claims any ray, so hover, click, focus and native typing all
// work at the rim where the distortion is worst. No inverse solve exists
// anywhere in this file.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, SurfaceCanvas } from '@petepetrash/munari'
import { cameraDistance, paintStats } from '@petepetrash/munari/advanced'
import {
  apertureOf,
  footprint,
  inAperture,
  landOffset,
  type Disc,
  type LensSpec,
  type Vec3,
} from './opticsLaw'
import { coveredBlocks, holdKey, updateHolds, type Block, type Hold } from './opticsLod'
import {
  CHIP,
  INSTRUMENT,
  KIT,
  collarRange,
  railSlot,
  specFor,
  tierOf,
  type Instrument,
  type InstrumentId,
} from './opticsKit'
import {
  OPTICS_FRAME_FRAG,
  OPTICS_FRAME_VERT,
  OPTICS_LENS_FRAG,
  OPTICS_LENS_VERT,
  OPTICS_METAL_FRAG,
  OPTICS_METAL_VERT,
  SCOPE_RECTS,
} from './opticsShaders'
import {
  BENCH_H,
  RAIL_Y,
  SHEET,
  SPECIMENS,
  WORLD_RECTS,
  worldCenter,
  worldRect,
  type Specimen,
} from './opticsSheet'
import { AquaSheet, Calculator, Ledger, LcdPanel, LunaBar, TypeSpecimen } from './opticsSpecimens'
import { showChrome } from '../../bareMode'
import './optics.css'

const FOV = 42
/** Drop an instrument this close to its cradle and it goes home. */
const CRADLE_SNAP = 96
/** How long a block keeps its tier after the glass leaves it. */
const HOLD_MS = 500
/** Bench colour, which is also what the glass sees past the sheet's edge. */
const BENCH = '#17181b'
const PAPER = '#f4f2ee'
/** Width of the free sheet's frame, and of its corner grips. */
const FRAME = 13

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const NO_HIT: THREE.Object3D['raycast'] = () => {}

/** Where a ray crosses a plane of constant z. The only projection here. */
function planePoint(ray: THREE.Ray, z: number) {
  const t = (z - ray.origin.z) / ray.direction.z
  return { x: ray.origin.x + t * ray.direction.x, y: ray.origin.y + t * ray.direction.y }
}

const CONTENT = new Map<string, ReactNode>(
  Object.entries({
    aqua: <AquaSheet />,
    nokia: <LcdPanel />,
    luna: <LunaBar />,
    calc: <Calculator />,
    type: <TypeSpecimen />,
    ledger: <Ledger />,
  }),
)

// ── shared mutable state ───────────────────────────────────────────────
//
// A dragged instrument moves at pointer rate and a collar turns at
// pointer rate; routing either through React state would re-render six
// Surfaces per pointer move. Everything that changes continuously lives
// in this handle, is read in the frame loop, and reaches React only when
// a DISCRETE thing changes — which block is pinned, what the readout
// says at 8 Hz.

type Drag =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'collar'; prev: number }
  // The free sheet's two extra grips. `resize` remembers the corner the
  // drag is pivoting about — the one diagonally opposite the one you took
  // hold of — so the sheet grows out of that corner and stays put there.
  | { kind: 'resize'; ax: number; ay: number }
  | { kind: 'track' }
  | null

/**
 * One number per instrument. A mapped type over the closed id union rather
 * than an open dictionary, because every key is known at the type level.
 */
type PerInstrument = { [K in InstrumentId]: number }

interface Hand {
  x: number
  y: number
  /** Collar reading per instrument, authoritative. */
  collar: PerInstrument
  /**
   * Half-width and half-height of the free sheet. One pair, not one per
   * instrument, because exactly one instrument has a face you can resize.
   */
  half: [number, number]
  inst: Instrument | null
  spec: LensSpec | null
  /** The disc of page the instrument is reading, world coordinates. */
  disc: Disc | null
  /** Turned angle of the collar, radians, for the mesh. */
  turn: PerInstrument
  /**
   * The live grip. It lives out here rather than inside `useGrab` because
   * taking an instrument off the rail has to ARM a drag in the same
   * gesture — picking something up and moving it is one motion of the
   * hand, and two would be a worse instrument than a real one.
   */
  drag: Drag
  /** Has this instrument cleared its cradle yet? Guards the snap home. */
  leftCradle: boolean
  /**
   * Is the instrument over its own cradle right now, measured on SCREEN?
   * The cradle lies flat at z = 0 and the instrument is held at its
   * standoff, so the two are nowhere near each other in world coordinates
   * even when they are exactly on top of each other to look at. The frame
   * loop, which has the camera, is the only place this can be decided.
   */
  nearHome: boolean
}

/** One number per instrument, seeded from the kit itself. */
function perInstrument(seed: (i: Instrument) => number): PerInstrument {
  const out: Partial<PerInstrument> = {}
  for (const i of KIT) out[i.id] = seed(i)
  // SAFETY: `InstrumentId` is the union of the ids in KIT and the loop above
  // walks KIT itself, so every key of the record is there. `Partial` is what
  // lets it be built up a key at a time.
  return out as PerInstrument
}

function initialHand(): Hand {
  const collar = perInstrument((i) => i.collar.start)
  const turn = perInstrument(() => 0)
  const start = KIT.find((i) => i.sheet)!.sheet!.start
  return {
    x: 0,
    y: 0,
    collar,
    half: [start[0], start[1]],
    inst: null,
    spec: null,
    disc: null,
    turn,
    drag: null,
    leftCradle: false,
    nearHome: false,
  }
}

/**
 * Half-width of the knurled power track along the sheet's bottom edge.
 * A fraction of the sheet, so the track is always a grip you can find,
 * and the same number in the shader and in the pointer path.
 */
const gripOf = (hw: number) => hw * 0.72

// ── the camera ─────────────────────────────────────────────────────────

function PixelPerfect({ onScale }: { onScale: (s: number) => void }) {
  // SAFETY: r3f types the store's camera as the base class and hands back a
  // PerspectiveCamera unless the Canvas asks for `orthographic`. This one
  // does not, and could not: fitting the frustum to the viewport is what
  // makes a CSS pixel a world unit, and orthographic has no fov to fit.
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  useEffect(() => {
    // 1:1 whenever the window is tall enough to hold the bench; below
    // that, dolly out rather than clip the kit off the bottom.
    const fit = Math.max(size.height, BENCH_H)
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(fit, FOV))
    camera.near = 1
    camera.far = camera.position.z * 4
    camera.updateProjectionMatrix()
    onScale(size.height / fit)
  }, [camera, size.height, onScale])
  return null
}

// ── the sheet ──────────────────────────────────────────────────────────

interface SheetProps {
  pinned: string
  pinning: boolean
  tier: number
  hand: React.RefObject<Hand>
}

/**
 * Memoized on purpose. A collar turning at pointer rate must not re-render
 * a Surface; only a change in the pinned SET or the tier may.
 */
const Sheet = memo(function Sheet({ pinned, pinning, tier, hand }: SheetProps) {
  const pinnedSet = useMemo(() => new Set(pinned ? pinned.split(' ') : []), [pinned])
  return (
    <group>
      {/* The paper. Pointer-transparent so a ray that refracts off the
       * edge of every block falls through to nothing rather than hovering
       * the backdrop. */}
      <mesh position={[0, 0, -0.6]} raycast={NO_HIT}>
        <planeGeometry args={[SHEET.w, SHEET.h]} />
        <meshBasicMaterial color={PAPER} />
      </mesh>
      {SPECIMENS.map((b) => (
        <SpecimenSurface
          key={b.id}
          block={b}
          hand={hand}
          resolution={pinning && pinnedSet.has(b.id) ? tier : 'auto'}
        />
      ))}
    </group>
  )
})

function SpecimenSurface({
  block,
  hand,
  resolution,
}: {
  block: Specimen
  hand: React.RefObject<Hand>
  resolution: number | 'auto'
}) {
  const raycast = useLensRaycast(block, hand)
  const [cx, cy] = worldCenter(block)
  return (
    <Surface
      name={block.id}
      size={[block.w, block.h]}
      resolution={resolution}
      source={CONTENT.get(block.id)}
    >
      <Surface.WebGL
        position={[cx, cy, 0]}
        raycast={raycast}
        geometry={<planeGeometry args={[block.w, block.h]} />}
        material={<Surface.LitMaterial emissiveIntensity={1} />}
      />
    </Surface>
  )
}

/**
 * The pointer's half of the optics.
 *
 * Intersect the lens plane; if the ray missed the aperture, this is an
 * ordinary hit on an ordinary plane. If it did not, refract it with the
 * same law the shader uses and ask one question: does the refracted ray
 * land inside THIS block? Every block asks it, so exactly one answers,
 * and a click through the rim reaches the element that is drawn there
 * rather than the element that is under the finger.
 *
 * The plane fallback loses Surface's own corner rejection, which is a
 * real but small difference: a click in a rounded corner hits the block
 * instead of falling through it.
 */
function useLensRaycast(block: Block, hand: React.RefObject<Hand>) {
  return useMemo<THREE.Object3D['raycast']>(() => {
    const rect = worldRect(block)
    return function (this: THREE.Mesh, raycaster, intersects) {
      const h = hand.current
      const spec = h?.spec
      const ray = raycaster.ray
      const plain = () => THREE.Mesh.prototype.raycast.call(this, raycaster, intersects)
      if (!spec || Math.abs(ray.direction.z) < 1e-9) return plain()

      const t = (spec.standoff - ray.origin.z) / ray.direction.z
      if (t <= 0) return plain()
      const lx = ray.origin.x + t * ray.direction.x - h.x
      const ly = ray.origin.y + t * ray.direction.y - h.y
      // Off the glass — disc or rectangle, the law owns the shape — and the
      // ray is an ordinary ray again.
      if (!inAperture(lx, ly, spec)) return plain()

      const dir: Vec3 = [ray.direction.x, ray.direction.y, ray.direction.z]
      const off = landOffset(lx, ly, dir, spec)
      // Inside the aperture and still no landing means the glass swallowed
      // the ray. It must not fall through to a plain hit, or a click would
      // reach a place the glass is not showing.
      if (!off) return

      const wx = h.x + off[0]
      const wy = h.y + off[1]
      const u = (wx - rect.x) / rect.w
      const v = (wy - rect.y) / rect.h
      if (u < 0 || u > 1 || v < 0 || v > 1) return

      intersects.push({
        distance: t + Math.hypot(off[0] - lx, off[1] - ly, spec.standoff),
        point: new THREE.Vector3(wx, wy, 0),
        uv: new THREE.Vector2(u, v),
        object: this,
      })
    }
  }, [block, hand])
}

// ── the instruments ────────────────────────────────────────────────────

function metalUniforms(inst: Instrument, inner: number, outer: number, ribs: number) {
  return {
    uColor: { value: new THREE.Color(inst.metal) },
    uInner: { value: inner },
    uOuter: { value: outer },
    uRibs: { value: ribs },
  }
}

/** Rim, knurled collar and index mark — the parts you actually hold. */
function Body({
  inst,
  onGrab,
  turnOf,
}: {
  inst: Instrument
  onGrab?: (kind: 'move' | 'collar', e: ThreeEvent<PointerEvent>) => void
  turnOf?: () => number
}) {
  const a = inst.aperture
  const collarRef = useRef<THREE.Mesh>(null)
  const rimU = useMemo(() => metalUniforms(inst, a, a + 11, 0), [inst, a])
  const colU = useMemo(() => metalUniforms(inst, a + 11, a + 26, 88), [inst, a])
  useFrame(() => {
    if (collarRef.current && turnOf) collarRef.current.rotation.z = turnOf()
  })
  return (
    <group>
      <mesh onPointerDown={onGrab && ((e) => onGrab('move', e))}>
        <ringGeometry args={[a, a + 11, 128]} />
        <shaderMaterial
          vertexShader={OPTICS_METAL_VERT}
          fragmentShader={OPTICS_METAL_FRAG}
          uniforms={rimU}
        />
      </mesh>
      <mesh ref={collarRef} onPointerDown={onGrab && ((e) => onGrab('collar', e))}>
        <ringGeometry args={[a + 11, a + 26, 128]} />
        <shaderMaterial
          vertexShader={OPTICS_METAL_VERT}
          fragmentShader={OPTICS_METAL_FRAG}
          uniforms={colU}
        />
        {/* The index mark, so a turn is legible. Parented to the collar,
         * which is the only reason the ribs alone are not enough. */}
        <mesh position={[0, a + 18.5, 0.4]} raycast={NO_HIT}>
          <planeGeometry args={[3, 11]} />
          <meshBasicMaterial color="#14151a" />
        </mesh>
      </mesh>
    </group>
  )
}

/**
 * The free sheet's whole mount: one band around the edge, carrying all
 * three grips. Everything that changes — the size, where the power tick
 * sits, how much of the track is still reachable — is a uniform written
 * per frame, so dragging a corner never re-renders React.
 *
 * The track is the interesting one. `collarRange` narrows as the sheet
 * grows, because the corner is what strains the cap, and the dimmed part
 * of the knurl is that number drawn on the instrument itself.
 */
function Frame({
  inst,
  hand,
  onGrab,
}: {
  inst: Instrument
  hand: React.RefObject<Hand>
  onGrab: (e: ThreeEvent<PointerEvent>) => void
}) {
  const mesh = useRef<THREE.Mesh>(null)
  const mat = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(inst.metal) },
      uHalf: { value: new THREE.Vector2() },
      uBand: { value: FRAME },
      uGrip: { value: 1 },
      uTick: { value: 0.5 },
      uTrack: { value: new THREE.Vector2(0, 1) },
    }),
    [inst],
  )

  // Only the band is a grip. A ray through the glass has to reach the page,
  // so this rejects the interior rather than swallowing it — the same box
  // distance field the frame shader discards with.
  const raycast = useMemo<THREE.Object3D['raycast']>(() => {
    return function (this: THREE.Mesh, raycaster, intersects) {
      const h = hand.current
      const ray = raycaster.ray
      if (!h || Math.abs(ray.direction.z) < 1e-9) return
      const t = (inst.standoff - ray.origin.z) / ray.direction.z
      if (t <= 0) return
      const x = ray.origin.x + t * ray.direction.x
      const y = ray.origin.y + t * ray.direction.y
      const dx = Math.abs(x - h.x) - h.half[0]
      const dy = Math.abs(y - h.y) - h.half[1]
      const edge = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)
      if (edge < 0 || edge > FRAME) return
      intersects.push({
        distance: t,
        point: new THREE.Vector3(x, y, inst.standoff),
        object: this,
      })
    }
  }, [hand, inst])

  useFrame(() => {
    const h = hand.current
    if (!h || !mesh.current || !mat.current) return
    const [hw, hh] = h.half
    mesh.current.scale.set(2 * (hw + FRAME), 2 * (hh + FRAME), 1)
    const c = inst.collar
    const live = collarRange(inst, h.half)
    const span = c.max - c.min
    const u = mat.current.uniforms
    u.uHalf.value.set(hw, hh)
    u.uGrip.value = gripOf(hw)
    u.uTick.value = (h.collar[inst.id] - c.min) / span
    u.uTrack.value.set((live.min - c.min) / span, (live.max - c.min) / span)
  })

  return (
    <mesh ref={mesh} raycast={raycast} onPointerDown={onGrab}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={mat}
        vertexShader={OPTICS_FRAME_VERT}
        fragmentShader={OPTICS_FRAME_FRAG}
        uniforms={uniforms}
      />
    </mesh>
  )
}

/**
 * An instrument at rest.
 *
 * Flat on the bench at z = 0, shrunk by `CHIP`. Both parts of that matter:
 * the camera is pixel-calibrated at z = 0 and nowhere else, so a preview
 * standing at its working standoff is pushed outward by perspective and
 * off the bottom of the screen — which is exactly what was happening,
 * measured at every viewport height anyone would use.
 */
function OnRail({ inst, onTake }: { inst: Instrument; onTake: (e: ThreeEvent<PointerEvent>) => void }) {
  const s = inst.sheet
  return (
    <group name={`optics-rail-${inst.id}`} position={[railSlot(inst.id), RAIL_Y, 0]} scale={CHIP}>
      {s ? (
        <mesh onPointerDown={onTake}>
          <planeGeometry args={[2 * (s.start[0] + FRAME), 2 * (s.start[1] + FRAME)]} />
          <meshBasicMaterial color={inst.metal} />
        </mesh>
      ) : null}
      <mesh position={[0, 0, 0.2]} onPointerDown={onTake}>
        {s ? (
          <planeGeometry args={[2 * s.start[0], 2 * s.start[1]]} />
        ) : (
          <circleGeometry args={[inst.aperture, 96]} />
        )}
        <meshBasicMaterial color="#22242a" transparent opacity={0.55} />
      </mesh>
      {s ? null : <Body inst={inst} onGrab={(_, e) => onTake(e)} />}
    </group>
  )
}

/** The empty cradle an instrument came from, and can be dropped back into. */
function Cradle({ inst }: { inst: Instrument }) {
  const reach = inst.sheet ? apertureOf(inst.sheet.start) : inst.aperture
  return (
    <mesh position={[railSlot(inst.id), RAIL_Y, -0.4]} raycast={NO_HIT} scale={CHIP}>
      <ringGeometry args={[reach + 20, reach + 26, 96]} />
      <meshBasicMaterial color="#2a2c32" />
    </mesh>
  )
}

// ── the offscreen pass and the glass ───────────────────────────────────

/**
 * One extra scene render per frame, framed to the disc the instrument can
 * see, at the instrument's own tier — so a 3× loupe over 3×-pinned blocks
 * collects a 3× raster and magnifies nothing. The kit is hidden for the
 * pass, which is the difference between a lens and a feedback loop.
 */
function Pass({
  hand,
  kit,
  rt,
  active,
}: {
  hand: React.RefObject<Hand>
  kit: React.RefObject<THREE.Group | null>
  rt: THREE.WebGLRenderTarget
  active: boolean
}) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const rtCam = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000), [])
  const bench = useMemo(() => new THREE.Color(BENCH), [])
  const keep = useMemo(() => new THREE.Color(), [])

  useFrame(() => {
    const disc = hand.current?.disc
    if (active && disc && kit.current) {
      const half = disc.r + 2
      rtCam.left = -half
      rtCam.right = half
      rtCam.top = half
      rtCam.bottom = -half
      rtCam.position.set(disc.x, disc.y, 1200)
      rtCam.updateProjectionMatrix()
      rtCam.updateMatrixWorld()

      gl.getClearColor(keep)
      const keepAlpha = gl.getClearAlpha()
      kit.current.visible = false
      gl.setClearColor(bench, 1)
      gl.setRenderTarget(rt)
      gl.render(scene, rtCam)
      gl.setRenderTarget(null)
      gl.setClearColor(keep, keepAlpha)
      kit.current.visible = true
    }
    gl.render(scene, camera)
  }, 1)
  return null
}

// ── the bench ──────────────────────────────────────────────────────────

interface BenchProps {
  hand: React.RefObject<Hand>
  handId: InstrumentId | null
  pinning: boolean
  pinnedKey: string
  onTake: (id: InstrumentId, e: ThreeEvent<PointerEvent>) => void
  onPinned: (key: string) => void
  onReading: (r: Reading) => void
}

export interface Reading {
  collar: number
  covered: number
  paints: number
  span: number
  /** What the page was asked for — the sheet moves this, the rest do not. */
  tier: number
  /** Present for the free sheet only: its size, and the powers left to it. */
  size: [number, number] | null
  range: [number, number] | null
}

function Bench({
  hand,
  handId,
  pinning,
  pinnedKey,
  onTake,
  onPinned,
  onReading,
}: BenchProps) {
  const kit = useRef<THREE.Group>(null)
  const lens = useRef<THREE.Group>(null)
  const lensMesh = useRef<THREE.Mesh>(null)
  const lensMat = useRef<THREE.ShaderMaterial>(null)
  const inst = handId ? INSTRUMENT[handId] : null
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const grab = useGrab(hand, handId)
  // The tier the page is asked for. React state, and deliberately: it is
  // the one thing in the frame loop that MUST re-render the Surfaces, and
  // it changes only when the sheet's power crosses a rung.
  const [tier, setTier] = useState(1)
  const turnOf = useCallback(
    () => (handId && hand.current ? hand.current.turn[handId] : 0),
    [hand, handId],
  )

  // Held at the largest footprint any instrument can produce — the
  // reducing glass at its lowest power, doubled for headroom. The
  // offscreen camera's frustum, not the target's size, is what tracks the
  // footprint each frame, so a collar turn never reallocates.
  const rt = useMemo(
    () =>
      new THREE.WebGLRenderTarget(1024, 1024, {
        type: THREE.HalfFloatType,
        depthBuffer: true,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      }),
    [],
  )
  useEffect(() => () => rt.dispose(), [rt])

  const holds = useRef<Hold[]>([])
  const lastKey = useRef('')
  const heat = useRef(new Map<string, { paints: number; ema: number }>())
  const lastSample = useRef(performance.now())
  const lastReading = useRef(0)

  const uniforms = useMemo(
    () => ({
      uPage: { value: rt.texture },
      uFrame: { value: new THREE.Vector4(0, 0, 1, 1) },
      uCamPos: { value: new THREE.Vector3() },
      uCenter: { value: new THREE.Vector2() },
      uAperture: { value: 90 },
      uHalf: { value: new THREE.Vector2() },
      uCurvature: { value: 130 },
      uStandoff: { value: 150 },
      uIor: { value: 1.52 },
      uTint: { value: 0.07 },
      uMode: { value: 0 },
      uRects: { value: Array.from({ length: SCOPE_RECTS }, () => new THREE.Vector4()) },
      uHeat: { value: new Array<number>(SCOPE_RECTS).fill(0) },
    }),
    [rt],
  )

  useFrame(() => {
    const h = hand.current
    if (!h || !inst) {
      holds.current = []
      if (lastKey.current) {
        lastKey.current = ''
        onPinned('')
      }
      // Nothing in hand means no glass in the pointer path either: the
      // blocks' raycast reads `spec` and falls back to a plain plane hit.
      h.spec = null
      h.disc = null
      h.inst = null
      return
    }

    const now = performance.now()
    // The sheet's reachable band moves with its size, so the collar is
    // clamped here, every frame, and not only when it is turned: drag a
    // corner outward past the cap bound and the power comes down with it.
    const half = inst.sheet ? h.half : undefined
    const range = collarRange(inst, half)
    const collar = clamp(h.collar[inst.id], range.min, range.max)
    h.collar[inst.id] = collar
    const spec = specFor(inst, collar, half)
    h.spec = spec
    h.inst = inst

    const want = tierOf(inst, collar)
    if (want !== tier) setTier(want)

    // The disc of page this instrument is reading. Computed once and used
    // three times — offscreen framing, LOD coverage, and the readout —
    // because a framing that disagreed with the coverage would sample a
    // block that was never asked to sharpen.
    const eye = camera.position
    const disc = footprint({ x: h.x, y: h.y }, spec, (lx, ly): Vec3 => {
      const dx = h.x + lx - eye.x
      const dy = h.y + ly - eye.y
      const dz = spec.standoff - eye.z
      const m = Math.hypot(dx, dy, dz)
      return [dx / m, dy / m, dz / m]
    })
    h.disc = disc

    // Tier claims, with the hold that keeps a drag at one paint per block.
    const covered = coveredBlocks(WORLD_RECTS, disc)
    holds.current = updateHolds(holds.current, covered, now, HOLD_MS)
    const key = holdKey(holds.current)
    if (key !== lastKey.current) {
      lastKey.current = key
      onPinned(key)
    }

    // The paint ledger, as a rate. An exponential average with the
    // collar's window as its time constant IS "paints over the last N
    // seconds", and it costs one multiply per block.
    const dt = Math.max((now - lastSample.current) / 1000, 1e-4)
    lastSample.current = now
    const win = inst.mode === 'scope' ? collar : 1
    const alpha = 1 - Math.exp(-dt / win)
    let underGlass = 0
    for (const s of paintStats()) {
      const prev = heat.current.get(s.label) ?? { paints: s.paints, ema: 0 }
      const rate = (s.paints - prev.paints) / dt
      const ema = prev.ema + alpha * (rate - prev.ema)
      heat.current.set(s.label, { paints: s.paints, ema })
      if (covered.includes(s.label)) underGlass += ema
    }

    for (let i = 0; i < SCOPE_RECTS; i++) {
      const b = SPECIMENS[i]
      const slot = uniforms.uRects.value[i]
      if (!b) {
        slot.set(0, 0, 0, 0)
        uniforms.uHeat.value[i] = 0
        continue
      }
      const [cx, cy] = worldCenter(b)
      slot.set(cx, cy, b.w / 2, b.h / 2)
      // Counts, not rates: one paint should be visible, sixteen should
      // saturate, and a log ramp is the only thing that does both.
      const count = (heat.current.get(b.id)?.ema ?? 0) * win
      uniforms.uHeat.value[i] = clamp(Math.log2(1 + count) / Math.log2(17), 0, 1)
    }

    // Uniforms through the material ref. Writing them to the memoized
    // object above leaves the sampler unbound, and a transparent material
    // with alpha 0 renders INVISIBLE rather than black — so the glass
    // silently shows the page behind it and every reading looks plausible
    // (docs/spikes/optics-loupe.md).
    const m = lensMat.current
    if (m) {
      const u = m.uniforms
      u.uPage.value = rt.texture
      u.uFrame.value.set(disc.x, disc.y, disc.r + 2, disc.r + 2)
      u.uCamPos.value.copy(eye)
      u.uCenter.value.set(h.x, h.y)
      u.uAperture.value = spec.aperture
      // (0, 0) is the shader's word for "a disc" — see faceEdge.
      u.uHalf.value.set(half ? half[0] : 0, half ? half[1] : 0)
      u.uCurvature.value = Number.isFinite(spec.curvature) ? spec.curvature : 1e9
      u.uStandoff.value = spec.standoff
      u.uIor.value = spec.ior
      u.uTint.value = inst.tint
      u.uMode.value = inst.mode === 'scope' ? 1 : 0
      u.uRects.value = uniforms.uRects.value
      u.uHeat.value = uniforms.uHeat.value
    }

    if (lens.current) lens.current.position.set(h.x, h.y, spec.standoff)
    // A unit plane scaled to the live size. Rebuilding the geometry every
    // frame would be the same picture at a hundred times the cost.
    if (lensMesh.current && half) lensMesh.current.scale.set(2 * half[0], 2 * half[1], 1)

    // Is it over its own cradle? Both points projected, then measured in
    // screen px, because the two live in different planes.
    const a = new THREE.Vector3(h.x, h.y, spec.standoff).project(camera)
    const b = new THREE.Vector3(railSlot(inst.id), RAIL_Y, 0).project(camera)
    h.nearHome =
      Math.hypot(((a.x - b.x) * size.width) / 2, ((a.y - b.y) * size.height) / 2) < CRADLE_SNAP

    if (now - lastReading.current > 125) {
      lastReading.current = now
      onReading({
        collar,
        covered: covered.length,
        paints: underGlass,
        span: disc.r * 2,
        tier: want,
        size: half ? [half[0] * 2, half[1] * 2] : null,
        range: inst.sheet ? [range.min, range.max] : null,
      })
    }
  })

  return (
    <>
      <Sheet pinned={pinnedKey} pinning={pinning} tier={tier} hand={hand} />
      {KIT.map((i) => (
        <Cradle key={i.id} inst={i} />
      ))}
      <group ref={kit}>
      {KIT.map((i) =>
        i.id === handId ? null : (
          <OnRail key={i.id} inst={i} onTake={(e) => onTake(i.id, e)} />
        ),
      )}
        {inst && (
          <group ref={lens}>
            <mesh ref={lensMesh} raycast={NO_HIT}>
              {inst.sheet ? (
                <planeGeometry args={[1, 1]} />
              ) : (
                <circleGeometry args={[inst.aperture, 160]} />
              )}
              <shaderMaterial
                ref={lensMat}
                vertexShader={OPTICS_LENS_VERT}
                fragmentShader={OPTICS_LENS_FRAG}
                uniforms={uniforms}
                transparent
                premultipliedAlpha
                depthWrite={false}
              />
            </mesh>
            {inst.sheet ? (
              <Frame inst={inst} hand={hand} onGrab={(e) => grab('sheet', e)} />
            ) : (
              <Body inst={inst} onGrab={grab} turnOf={turnOf} />
            )}
          </group>
        )}
      </group>
      <Pass hand={hand} kit={kit} rt={rt} active={!!inst} />
    </>
  )
}

/**
 * Where the free sheet's power track puts the collar for a pointer at
 * world x. Direct: the tick goes where the finger is. Written once because
 * a click on the track and a drag along it must agree exactly.
 */
function setTrack(h: Hand, inst: Instrument, px: number) {
  const c = inst.collar
  const u = clamp(((px - h.x) / gripOf(h.half[0])) * 0.5 + 0.5, 0, 1)
  const live = collarRange(inst, h.half)
  h.collar[inst.id] = clamp(c.min + u * (c.max - c.min), live.min, live.max)
}

/**
 * Two grips, concentric, exactly as a real instrument has them: the rim
 * moves the glass, the knurled collar changes its power. The free sheet
 * has the same two plus a third — its corners resize the face — and all of
 * them rebuild the ray from the pointer rather than trusting an
 * intersection, so a drag stays exact after it has outrun the mesh it
 * started on.
 */
function useGrab(hand: React.RefObject<Hand>, id: InstrumentId | null) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const caster = useMemo(() => new THREE.Raycaster(), [])

  useEffect(() => {
    if (!id) return
    const el = gl.domElement
    const inst = INSTRUMENT[id]
    const move = (e: PointerEvent) => {
      const h = hand.current
      const d = h?.drag
      if (!d) return
      const box = el.getBoundingClientRect()
      caster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - box.left) / box.width) * 2 - 1,
          -((e.clientY - box.top) / box.height) * 2 + 1,
        ),
        camera,
      )
      const p = planePoint(caster.ray, inst.standoff)
      if (d.kind === 'move') {
        h.x = clamp(p.x + d.dx, -SHEET.w, SHEET.w)
        h.y = clamp(p.y + d.dy, RAIL_Y - 60, SHEET.h)
        if (!h.nearHome) h.leftCradle = true
        return
      }
      if (d.kind === 'resize') {
        // The anchored corner does not move; everything else follows from
        // it. Clamping the half-extents rather than the corner is what
        // keeps the anchor exact once the sheet hits a stop.
        const s = inst.sheet!
        const hw = clamp(Math.abs(p.x - d.ax) / 2, s.min[0], s.max[0])
        const hh = clamp(Math.abs(p.y - d.ay) / 2, s.min[1], s.max[1])
        h.half = [hw, hh]
        h.x = d.ax + (p.x < d.ax ? -hw : hw)
        h.y = d.ay + (p.y < d.ay ? -hh : hh)
        return
      }
      if (d.kind === 'track') {
        setTrack(h, inst, p.x)
        return
      }
      let delta = Math.atan2(p.y - h.y, p.x - h.x) - d.prev
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      d.prev += delta
      const c = inst.collar
      // One turn of the collar covers the whole range, clockwise for
      // more — which is the direction every focusing ring turns.
      h.collar[id] = clamp(h.collar[id] - (delta / (Math.PI * 2)) * (c.max - c.min), c.min, c.max)
      h.turn[id] += delta
    }
    const up = () => {
      if (hand.current) hand.current.drag = null
    }
    el.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      el.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [camera, caster, gl, hand, id])

  return useCallback(
    (kind: 'move' | 'collar' | 'sheet', e: ThreeEvent<PointerEvent>) => {
      const h = hand.current
      if (!h || !id) return
      e.stopPropagation()
      const inst = INSTRUMENT[id]
      const p = planePoint(e.ray, inst.standoff)
      if (kind !== 'sheet') {
        h.drag =
          kind === 'move'
            ? { kind, dx: h.x - p.x, dy: h.y - p.y }
            : { kind, prev: Math.atan2(p.y - h.y, p.x - h.x) }
        return
      }
      // One band, three grips, and the zone is read off the geometry rather
      // than out of three meshes — which is also how the shader draws it.
      const lx = p.x - h.x
      const ly = p.y - h.y
      const dx = Math.abs(lx) - h.half[0]
      const dy = Math.abs(ly) - h.half[1]
      if (dx > 0 && dy > 0) {
        h.drag = {
          kind: 'resize',
          ax: h.x - Math.sign(lx) * h.half[0],
          ay: h.y - Math.sign(ly) * h.half[1],
        }
      } else if (ly < 0 && dy > 0 && Math.abs(lx) < gripOf(h.half[0])) {
        h.drag = { kind: 'track' }
        setTrack(h, inst, p.x)
      } else {
        h.drag = { kind: 'move', dx: h.x - p.x, dy: h.y - p.y }
      }
    },
    [hand, id],
  )
}

// ── the page ───────────────────────────────────────────────────────────

export function OpticsApp({ chips }: { chips: ReactNode }) {
  const hand = useRef<Hand>(initialHand())
  const [handId, setHandId] = useState<InstrumentId | null>(null)
  const [pinning, setPinning] = useState(true)
  const [pinnedKey, setPinnedKey] = useState('')
  const [scale, setScale] = useState(1)
  const [reading, setReading] = useState<Reading | null>(null)

  // Taking an instrument arms the move in the same gesture, so lifting it
  // off the rail and carrying it somewhere is one motion of the hand.
  const take = useCallback((id: InstrumentId, e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const h = hand.current
    const p = planePoint(e.ray, INSTRUMENT[id].standoff)
    h.x = p.x
    h.y = p.y
    h.drag = { kind: 'move', dx: 0, dy: 0 }
    h.leftCradle = false
    setHandId(id)
  }, [])

  // Escape puts the instrument down; so does dropping it near its cradle.
  useEffect(() => {
    if (!handId) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHandId(null)
    }
    // Dropping it home only counts once it has actually left home —
    // otherwise a plain click on the rail takes an instrument and puts it
    // straight back, which reads as the click having done nothing.
    const up = () => {
      const h = hand.current
      if (h.leftCradle && h.nearHome) setHandId(null)
    }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerup', up)
    }
  }, [handId])

  const inst = handId ? INSTRUMENT[handId] : null
  const pinnedCount = pinnedKey ? pinnedKey.split(' ').length : 0

  return (
    <div className="opt-page">
      <SurfaceCanvas
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onCreated={(state) => {
          window.__r3f = state
        }}
      >
        <PixelPerfect onScale={setScale} />
        <Bench
          hand={hand}
          handId={handId}
          pinning={pinning}
          pinnedKey={pinnedKey}
          onTake={take}
          onPinned={setPinnedKey}
          onReading={setReading}
        />
      </SurfaceCanvas>

      <div className="opt-hud">
        <h1>
          mun<em>ari</em>
        </h1>
        <p className="sub">optics</p>
        {chips}
      </div>

      <div className="opt-readout">
        <h2>{inst ? inst.name : 'nothing in hand'}</h2>
        <p className="why">{inst ? inst.claim : 'take a piece of glass off the rail'}</p>
        <dl>
          <dt>{inst ? inst.collar.label : 'collar'}</dt>
          <dd>{inst && reading ? inst.collar.format(reading.collar) : '—'}</dd>
          {reading?.size ? (
            <>
              <dt>sheet</dt>
              <dd>{`${Math.round(reading.size[0])} × ${Math.round(reading.size[1])} px`}</dd>
              {/* The cap bound, in words. Grow the sheet and watch both
               * ends close in — the same number the knurl dims. */}
              <dt>can hold</dt>
              <dd>{reading.range ? `${reading.range[0].toFixed(2)}–${reading.range[1].toFixed(2)}×` : '—'}</dd>
            </>
          ) : null}
          <dt>reading</dt>
          <dd>{reading ? `${Math.round(reading.span)} px` : '—'}</dd>
          <dt>page scale</dt>
          <dd data-warn={scale < 0.999 ? '' : undefined}>{scale.toFixed(2)}×</dd>
          <dt>pinned</dt>
          <dd>
            {inst && pinning && reading
              ? `${pinnedCount}/${SPECIMENS.length} at ${reading.tier}×`
              : `0/${SPECIMENS.length}`}
          </dd>
          <dt>paints/s</dt>
          <dd>{reading ? reading.paints.toFixed(1) : '—'}</dd>
        </dl>
        <label className="opt-pin">
          <input
            type="checkbox"
            checked={pinning}
            onChange={(e) => setPinning(e.currentTarget.checked)}
          />
          <span>
            re-raster under the glass
            <small>
              off, the glass magnifies a 1× raster — the same optics over a screenshot.
            </small>
          </span>
        </label>
      </div>

      {showChrome && (
        <div className="opt-footer">
          take a piece of glass off the rack · drag the rim to move it, twist the knurled collar to
          change its power · the free sheet resizes by its corners, and sets its power on the track
          along its bottom edge · the calculator still works through the glass · drop it back in its
          cradle, or press esc
        </div>
      )}
    </div>
  )
}
