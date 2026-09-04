// Candidate 7 — three ways for a row to stop existing.
//
// Flight already has one: a card crumples in the hand. These are the same
// gesture given three different materials, so the question the scene is
// actually asking can be answered by looking rather than by arguing —
// which of these reads as DELETED, at list speed, on a 46px row?
//
//   melt      the row loses its bottom edge first and runs, glyphs
//             stretching with the sheet because the vertices carry the
//             texture with them. Soft, slow to read, reversible-looking.
//   shatter   the row is split into loose quads before anything moves, so
//             every piece keeps its shape and only its pose changes. The
//             crack starts at the button that was pressed. Loud, fast,
//             unambiguously destructive.
//   peel      the row winds onto a roll from its free edge, then the roll
//             lets go of its hinge and drops. Reuses the dropdown's curl
//             law exactly; the only difference is which edge is anchored
//             and that this one falls afterwards.
//
// All three are on the same clock and the same list, so they are being
// compared rather than admired. The row is removed from React state only
// when the effect ends, and the list reflows then — never during, because
// a list that closes its gap while the row is still visibly present is
// the one artifact every delete animation on the web has.
//
// None of the three fades out. Each one is given the exact distance from
// its own top edge to the bottom of the viewport, measured at the click,
// and travels all of it. A fade halfway down says the row was a picture
// that stopped being drawn; leaving the screen says it was a thing on the
// page that went somewhere. That measurement is per-row and per-click,
// because a row near the bottom of a tall window has much less to cross
// than the first row of the list.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, useSurfaceChrome, useSurfaceHandle, useSurfaceTexture } from '@petepetrash/munari'
import { textureSlot } from '../../lib/uniforms'
import { plainAttribute } from '../../lib/geometry'
import { buildShards } from './candidateShards'
import { curlSample, unrolledLength } from './candidateCurlLaw'
import {
  LIGHT,
  MELT_FRAG,
  MELT_VERT,
  SHATTER_FRAG,
  SHATTER_VERT,
  SHEET_FRAG,
  SHEET_VERT,
} from './candidateShaders'
import {
  PhaseDrive,
  useOwnUniforms,
  usePhase,
  worldBoxOf,
  type Phase,
  type WorldBox,
} from './candidateStage'
import { deleteTuning } from './candidateTuning'

const VARIANTS = ['melt', 'shatter', 'peel'] as const
type Variant = (typeof VARIANTS)[number]

// Each variant runs until its material is off the bottom of the window, so
// the durations in deleteTuning are travel times, not fade times. Melt is
// the slowest because a liquid that clears the screen in half a second is
// a wipe; shatter the fastest because thrown pieces should outrun the eye.
const DURATION_KEY = {
  melt: 'meltMs',
  shatter: 'shatterMs',
  peel: 'peelMs',
} as const satisfies Record<Variant, keyof typeof deleteTuning>

const ROWS = [
  { id: 'r1', title: 'Falkland lamp', sub: 'Danese Milano · 1964' },
  { id: 'r2', title: 'Abitacolo', sub: 'Robots · 1971' },
  { id: 'r3', title: 'Illegible book', sub: 'Self-published · 1949' },
  { id: 'r4', title: 'Zizì', sub: 'Pirelli · 1952' },
  { id: 'r5', title: 'Cubo ashtray', sub: 'Danese Milano · 1957' },
] as const

// ── melt ─────────────────────────────────────────────────────────────────

function MeltMaterial({ phase, exit }: { phase: React.RefObject<Phase>; exit: number }) {
  const texture = useSurfaceTexture()
  const { chrome, width, height } = useSurfaceChrome()
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      uT: { value: 0 },
      uSize: { value: new THREE.Vector2(1, 1) },
      // Overwritten every render from the prop; the bag is memoized and
      // this literal is only what the material is born with.
      uExit: { value: 0 },
      // Sideways travel of a rivulet as it snakes, in px. Above ~14 the
      // streams cross each other and the row reads as being shredded
      // rather than running.
      uWaver: { value: deleteTuning.waver },
      // Rivulets across the row. Five over a 430px row puts a stream every
      // ~86px, which is wide enough that the gaps between them open before
      // the row is off the list — the moment the sheet stops being a sheet.
      uStreams: { value: deleteTuning.streams },
      // How completely a column gives up its own x for its stream's. Full
      // gathering pulls the row into five hard threads and loses the ink;
      // 0.82 keeps enough spread that the glyphs stay in the liquid.
      uGather: { value: deleteTuning.gather },
      uMunariRadii: { value: new THREE.Vector4(0, 0, 0, 0) },
      uMunariSize: { value: new THREE.Vector2(1, 1) },
    }),
    [],
  )
  uniforms.tMap.value = texture
  const material = useOwnUniforms(uniforms)
  const radii = chrome?.radii ?? [0, 0, 0, 0]
  uniforms.uMunariRadii.value.set(radii[0], radii[1], radii[2], radii[3])
  uniforms.uMunariSize.value.set(width, height)
  uniforms.uSize.value.set(width, height)
  uniforms.uExit.value = exit
  useFrame(() => {
    uniforms.uT.value = phase.current.t
    uniforms.uWaver.value = deleteTuning.waver
    uniforms.uStreams.value = deleteTuning.streams
    uniforms.uGather.value = deleteTuning.gather
  })
  return (
    <shaderMaterial
      ref={material}
      key={texture.uuid}
      uniforms={uniforms}
      vertexShader={MELT_VERT}
      fragmentShader={MELT_FRAG}
      transparent
      premultipliedAlpha
      depthWrite={false}
      toneMapped={false}
    />
  )
}

// ── shatter ──────────────────────────────────────────────────────────────

function ShatterMaterial({
  phase,
  origin,
  exit,
}: {
  phase: React.RefObject<Phase>
  origin: React.RefObject<THREE.Vector2>
  exit: number
}) {
  const texture = useSurfaceTexture()
  const { width, height } = useSurfaceChrome()
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      uT: { value: 0 },
      uOrigin: { value: new THREE.Vector2() },
      uSpan: { value: 1 },
      uSpread: { value: deleteTuning.spread },
      // Toward the camera. Without it the break is flat and reads as a
      // sliding puzzle; with it the shards pass over the rows below and
      // the row is unmistakably in front of the list, not part of it.
      uPop: { value: deleteTuning.pop },
      uSpin: { value: deleteTuning.spin },
      // Enough to carry the far shards past the bottom edge within the
      // effect's own duration, so nothing has to be faded away.
      // Overwritten every render from the prop, like uExit above.
      uGravity: { value: 0 },
      // Radial, away from the press. This is what makes the break have a
      // direction — a row that bursts evenly reads as an explosion effect
      // rather than as something that was struck at a point.
      uKick: { value: deleteTuning.kick },
    }),
    [],
  )
  uniforms.tMap.value = texture
  const material = useOwnUniforms(uniforms)
  uniforms.uSpan.value = Math.hypot(width, height)
  useFrame(() => {
    uniforms.uT.value = phase.current.t
    uniforms.uOrigin.value.copy(origin.current)
    uniforms.uSpread.value = deleteTuning.spread
    uniforms.uPop.value = deleteTuning.pop
    uniforms.uSpin.value = deleteTuning.spin
    uniforms.uKick.value = deleteTuning.kick
    uniforms.uGravity.value = exit * deleteTuning.gravity
  })
  return (
    <shaderMaterial
      ref={material}
      key={texture.uuid}
      uniforms={uniforms}
      vertexShader={SHATTER_VERT}
      fragmentShader={SHATTER_FRAG}
      transparent
      premultipliedAlpha
      depthWrite={false}
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  )
}

function ShardGeometry({ width, height }: { width: number; height: number }) {
  const geometry = useMemo(
    // 40×7 over a 430×46 row: shards of about 11×7px. Finer than the first
    // pass, which broke a row into pieces you could count. Below ~8px the
    // pieces stop carrying legible ink and the break turns to confetti.
    () => buildShards({ width, height, cols: 40, rows: 7 }),
    [width, height],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  return <primitive object={geometry} attach="geometry" />
}

// ── peel ─────────────────────────────────────────────────────────────────


function PeelMaterial() {
  const texture = useSurfaceTexture()
  const { chrome, width, height } = useSurfaceChrome()
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      uLightDir: { value: new THREE.Vector3(...LIGHT) },
      uBackColor: { value: new THREE.Color('#e6e3d4') },
      uShade: { value: deleteTuning.peelShade },
      // Constant. The roll leaves through the bottom of the window under
      // its own fall, so there is nothing here for a fade to cover.
      uOpacity: { value: 1 },
      uMunariRadii: { value: new THREE.Vector4(0, 0, 0, 0) },
      uMunariSize: { value: new THREE.Vector2(1, 1) },
    }),
    [],
  )
  uniforms.tMap.value = texture
  const material = useOwnUniforms(uniforms)
  const radii = chrome?.radii ?? [0, 0, 0, 0]
  uniforms.uMunariRadii.value.set(radii[0], radii[1], radii[2], radii[3])
  uniforms.uMunariSize.value.set(width, height)
  useFrame(() => {
    uniforms.uShade.value = deleteTuning.peelShade
  })
  return (
    <shaderMaterial
      ref={material}
      key={texture.uuid}
      uniforms={uniforms}
      vertexShader={SHEET_VERT}
      fragmentShader={SHEET_FRAG}
      transparent
      premultipliedAlpha
      // Depth is the only occlusion between the turns of the roll, exactly
      // as on the dropdown's sheet: without it the coil's ~7 wound plies
      // blend into one grey brick and the roll stops reading as a roll
      // (2026-08-20).
      depthWrite
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  )
}

/**
 * The peel, written onto real vertices.
 *
 * Two stages in one pass: wind the sheet onto a roll from its free edge,
 * then let the hinge go and drop the whole thing. The drop is applied to
 * the same vertices rather than to the mesh's transform so that one CPU
 * loop is the single source of where this row is — which keeps the raycast
 * honest for the frames when the row can still be clicked.
 */
function PeelDrive({
  phase,
  geoRef,
  width,
  height,
  exit,
}: {
  phase: React.RefObject<Phase>
  geoRef: React.RefObject<THREE.PlaneGeometry | null>
  width: number
  height: number
  exit: number
}) {
  useFrame(() => {
    const geometry = geoRef.current
    if (!geometry) return
    const pos = plainAttribute(geometry, 'position')
    const nrm = plainAttribute(geometry, 'normal')
    const uv = plainAttribute(geometry, 'uv')
    if (!pos || !nrm || !uv) return

    const t = phase.current.t
    // The roll runs out first, the fall starts before it finishes, and the
    // overlap is what stops the row hanging motionless for a beat. The
    // roll must actually REACH 1 — a peel that stops at 0.9 leaves a strip
    // of flat row hanging off the hinge.
    const roll = Math.min(1, t / 0.55)
    const drop = Math.max(0, (t - 0.4) / 0.6)
    const flat = unrolledLength(1 - roll, width)
    const tilt = drop * drop * 1.15
    const fall = drop * drop * exit
    const ca = Math.cos(tilt)
    const sa = Math.sin(tilt)
    const hingeX = -width / 2

    for (let i = 0; i < pos.count; i++) {
      // Arc length from the anchored LEFT edge; the free edge is the right.
      const s = uv.getX(i) * width
      const c = curlSample(s, flat, width, deleteTuning.peelRadius, deleteTuning.peelPly)
      const x = hingeX + c.along
      const y = (uv.getY(i) - 0.5) * height
      const z = c.lift
      const nx = c.normalAlong
      const nz = c.normalLift

      // Swing about the hinge, in the x/y plane, then fall.
      const dx = x - hingeX
      pos.setXYZ(i, hingeX + dx * ca, dx * sa + y - fall, z)
      nrm.setXYZ(i, nx * ca, nx * sa, nz)
    }
    pos.needsUpdate = true
    nrm.needsUpdate = true
    geometry.boundingSphere = null
  })
  return null
}

// ── the row ──────────────────────────────────────────────────────────────

function DeleteRow({
  id,
  title,
  sub,
  variant,
  onGone,
}: {
  id: string
  title: string
  sub: string
  variant: Variant
  onGone: (id: string) => void
}) {
  const surface = useSurfaceHandle(`delete-${id}`)
  const holder = useRef<HTMLLIElement>(null)
  const phase = usePhase()
  const origin = useRef(new THREE.Vector2())
  const geoRef = useRef<THREE.PlaneGeometry>(null)
  const [size, setSize] = useState<[number, number] | null>(null)
  const [box, setBox] = useState<WorldBox | null>(null)
  const [dying, setDying] = useState(false)
  // How far this row has to travel to be off the bottom of the window,
  // from its own position at the moment it was clicked.
  const [exit, setExit] = useState(1200)

  useLayoutEffect(() => {
    const el = holder.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0) {
        setSize([r.width, r.height])
        setBox(worldBoxOf(el))
      }
    }
    void document.fonts.ready.then(measure)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const kill = useCallback(
    (e: React.MouseEvent) => {
      const el = holder.current
      if (!el || dying) return
      const r = el.getBoundingClientRect()
      // The break starts where the hand was. In local mesh px, which is
      // what the shard shader compares its centres against.
      origin.current.set(e.clientX - (r.left + r.width / 2), r.top + r.height / 2 - e.clientY)
      setBox(worldBoxOf(el))
      // A margin of one row past the edge, so a shard that is still
      // tumbling has cleared the window rather than grazed it.
      setExit(window.innerHeight - r.top + r.height * 2)
      phase.current.t = 0
      phase.current.running = true
      setDying(true)
    },
    [dying, phase],
  )

  const done = useCallback(() => {
    onGone(id)
  }, [id, onGone])

  const row = (
    <div className="cand-row">
      <span className="cand-row__title">{title}</span>
      <span className="cand-row__sub">{sub}</span>
      <button type="button" className="cand-row__x" onClick={kill} aria-label={`Delete ${title}`}>
        ×
      </button>
    </div>
  )

  const w = size?.[0] ?? 1
  const h = size?.[1] ?? 1

  return (
    <li ref={holder} className="cand-row-holder" data-dying={dying || undefined}>
      {size ? (
        <Surface
          surface={surface}
          renderIn={dying ? 'canvas' : 'page'}
          timing={{ settleMs: 0, durationMs: 1 }}
          size={size}
          source={row}
        >
          <Surface.DOM />
          {box && (
            <Surface.Mesh
              placement="manual"
              alpha="source"
              frustumCulled={false}
              pointerEvents="none"
              position={[box.x, box.y, 0]}
              geometry={
                variant === 'shatter' ? (
                  <ShardGeometry width={w} height={h} />
                ) : variant === 'peel' ? (
                  // The roll's tightest curvature is 1/9px, so the sheet
                  // needs a vertex every ~2px along the axis it winds on.
                  <planeGeometry ref={geoRef} args={[w, h, Math.round(w / 2), 2]} />
                ) : (
                  // The melt gathers per column and stretches along the
                  // fall, so it needs both axes. 160 columns is a vertex
                  // every ~2.7px, fine enough that the boundary between two
                  // rivulets is a curve rather than a staircase; 40 rows is
                  // what keeps the stretched glyphs from shearing.
                  <planeGeometry args={[w, h, 160, 40]} />
                )
              }
              material={
                variant === 'shatter' ? (
                  <ShatterMaterial phase={phase} origin={origin} exit={exit} />
                ) : variant === 'peel' ? (
                  <PeelMaterial />
                ) : (
                  <MeltMaterial phase={phase} exit={exit} />
                )
              }
            >
              {variant === 'peel' && (
                <PeelDrive phase={phase} geoRef={geoRef} width={w} height={h} exit={exit} />
              )}
              <PhaseDrive phase={phase} durationMs={deleteTuning[DURATION_KEY[variant]]} onDone={done} />
            </Surface.Mesh>
          )}
        </Surface>
      ) : (
        row
      )}
    </li>
  )
}

export function CandidateDelete() {
  const [variant, setVariant] = useState<Variant>('shatter')
  const [rows, setRows] = useState(() => ROWS.map((r) => r.id))
  const gone = useCallback((id: string) => setRows((rs) => rs.filter((r) => r !== id)), [])
  const reset = useCallback(() => setRows(ROWS.map((r) => r.id)), [])

  return (
    <div className="cand-page cand-page--center">
      <section className="cand-card cand-card--list">
        <header>
          <h2>Catalogue</h2>
          <div className="cand-segment" role="group" aria-label="delete style">
            {VARIANTS.map((v) => (
              <button key={v} type="button" data-on={variant === v || undefined} onClick={() => setVariant(v)}>
                {v}
              </button>
            ))}
          </div>
        </header>
        <ul className="cand-rows">
          {rows.map((id) => {
            const r = ROWS.find((x) => x.id === id)
            if (!r) return null
            return (
              <DeleteRow key={id} id={id} title={r.title} sub={r.sub} variant={variant} onGone={gone} />
            )
          })}
        </ul>
        {/* Always mounted, disabled at rest: a button that appears when the
            first row dies reflows the card under the effect. */}
        <button
          type="button"
          className="cand-btn cand-btn--small"
          onClick={reset}
          disabled={rows.length === ROWS.length}
        >
          Restore all
        </button>
      </section>
    </div>
  )
}
