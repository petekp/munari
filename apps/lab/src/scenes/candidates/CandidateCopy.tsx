// Candidate 6 — copy, as something leaving with you.
//
// Press Copy and a copy of the block is drawn into the cursor: the sheet
// tips, twists, and is pulled through the pointer like cloth through a
// ring, the far corner trailing the near one. The block itself never
// moves. It is still there, still selectable, and at no point in the
// gesture was it not.
//
// That is the reason this candidate is a Twin and every other lift in this
// folder is not. A lift hands the pixels over and hands them back; the page
// copy is hidden in between. Here the page copy must stay visible, because
// the whole meaning of the gesture is that the original stayed. So the
// block the user reads is plain DOM, and the Surface samples an identical
// parked copy: the mesh draws a SECOND presentation, and it is what leaves.
//
// The cursor is tracked for the length of the flight rather than sampled at
// the click. If you move the mouse while it is running, the sheet follows —
// which is the difference between a copy going to the cursor and a copy
// going to where the cursor was.
//
// The block does go blank while the copy is in the air, and comes back out
// of focus and settles. That is a lie about what happened and it is worth
// it: a copy that leaves and changes nothing is a gesture with no
// consequence, and the eye needs the hole to believe the thing in the air
// came from somewhere. The fade is on the visible copy's holder, and the
// parked capture sits outside that holder, where no fade can reach it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SceneSurface, useSurfaceSupport, useSurfaceHandle, useSurfaceChrome, useSurfaceTexture } from '@petepetrash/munari'
import { textureSlot } from '../../lib/uniforms'
import { LIGHT, SUCK_FRAG, SUCK_VERT } from './candidateShaders'
import { tokenize } from './candidateTokens'
import {
  PhaseDrive,
  useOwnUniforms,
  usePhase,
  worldBoxOf,
  type Phase,
  type WorldBox,
} from './candidateStage'
import { copyTuning } from './candidateTuning'


const SNIPPET = `<SurfaceCanvas />

<Surface inScene={selected}>
  <Card />
</Surface>`

// Each run rolls its own shape — twist handedness and sharpness, arc
// height, the bow's direction — so no two copies fly the same road. The
// ranges are bounded to keep it the same gesture: the twist never
// doubles, and the arc never dips below what clears the block.
interface FlightShape {
  twist: number
  arc: number
  sway: THREE.Vector2
}

const rollShape = (): FlightShape => {
  const a = Math.random() * Math.PI * 2
  return {
    twist: (Math.random() < 0.5 ? -1 : 1) * (0.75 + Math.random() * 0.5),
    arc: 0.8 + Math.random() * 0.4,
    sway: new THREE.Vector2(Math.cos(a), Math.sin(a)),
  }
}

function SuckMaterial({
  phase,
  cursor,
  shape,
}: {
  phase: React.RefObject<Phase>
  cursor: React.RefObject<THREE.Vector2>
  shape: React.RefObject<FlightShape>
}) {
  const texture = useSurfaceTexture()
  const { chrome, width, height } = useSurfaceChrome()
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      uCursor: { value: new THREE.Vector2() },
      uT: { value: 0 },
      uSpan: { value: 1 },
      // A little over half a turn. Past ~4 radians the sheet passes edge-on
      // twice and flickers; below ~1.5 it reads as a slide, not a draw-in.
      uTwist: { value: copyTuning.twist },
      // Peak height off the page, mid-flight. The sheet has to pass OVER
      // the block it came from, or the copy looks like it is being filed
      // behind the original rather than taken away from it.
      uArc: { value: copyTuning.arc },
      // Fraction of the flight spent handing out per-vertex start times by
      // distance from the cursor. This is the whole gesture: at 0 the block
      // scales toward a point, which is a transform, not a suction.
      uLag: { value: copyTuning.lag },
      uSway: { value: new THREE.Vector2() },
      // A GLSL uniform left out of this bag reads vec3(0), and
      // normalize(0) is NaN: Metal's clamp resolved the NaN diffuse to its
      // floor, darkening every pixel of the sheet for the whole flight
      // (2026-08-20).
      uLightDir: { value: new THREE.Vector3(...LIGHT) },
      uDiffuse: { value: copyTuning.diffuse },
      uSpecPow: { value: copyTuning.specPow },
      uSpecGain: { value: copyTuning.specGain },
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
  uniforms.uSpan.value = Math.hypot(width, height)

  useFrame(() => {
    uniforms.uT.value = phase.current.t
    uniforms.uCursor.value.copy(cursor.current)
    uniforms.uTwist.value = copyTuning.twist * shape.current.twist
    uniforms.uArc.value = copyTuning.arc * shape.current.arc
    uniforms.uLag.value = copyTuning.lag
    uniforms.uSway.value.copy(shape.current.sway).multiplyScalar(copyTuning.sway)
    uniforms.uDiffuse.value = copyTuning.diffuse
    uniforms.uSpecPow.value = copyTuning.specPow
    uniforms.uSpecGain.value = copyTuning.specGain
  })

  return (
    <shaderMaterial
      ref={material}
      key={texture.uuid}
      uniforms={uniforms}
      vertexShader={SUCK_VERT}
      fragmentShader={SUCK_FRAG}
      transparent
      premultipliedAlpha
      depthWrite={false}
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  )
}

export function CandidateCopy() {
  const supported = useSurfaceSupport()
  const surface = useSurfaceHandle('copy-block')
  const holder = useRef<HTMLDivElement>(null)
  const phase = usePhase()
  const cursor = useRef(new THREE.Vector2())
  const shape = useRef<FlightShape>({ twist: 1, arc: 1, sway: new THREE.Vector2() })
  const [size, setSize] = useState<[number, number] | null>(null)
  const [box, setBox] = useState<WorldBox | null>(null)
  const [flying, setFlying] = useState(false)
  const [gone, setGone] = useState(false)
  const [copies, setCopies] = useState(0)
  const runId = useRef(0)

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
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // The cursor, in the mesh's own local pixels — the same coordinates the
  // vertices are in, so the shader needs no transform of its own.
  const track = useCallback((clientX: number, clientY: number) => {
    const el = holder.current
    if (!el) return
    const r = el.getBoundingClientRect()
    cursor.current.set(clientX - (r.left + r.width / 2), r.top + r.height / 2 - clientY)
  }, [])

  useEffect(() => {
    if (!flying) return
    const move = (e: PointerEvent) => track(e.clientX, e.clientY)
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [flying, track])

  const copy = useCallback(
    (e: React.MouseEvent) => {
      const el = holder.current
      if (!el) return
      // Measured at the click, not at mount: layout shifting above or
      // below moves the block without resizing it, and a pure move fires
      // neither the ResizeObserver nor window resize.
      setBox(worldBoxOf(el))
      shape.current = rollShape()
      track(e.clientX, e.clientY)
      void navigator.clipboard?.writeText(SNIPPET).catch(() => undefined)
      setCopies((n) => n + 1)
      if (!supported) return
      runId.current += 1
      phase.current.t = 0
      phase.current.running = true
      setFlying(true)
      setGone(true)
    },
    [phase, track, supported],
  )

  const block = (
    <pre className="cand-code">
      <code>
        {tokenize(SNIPPET).map((t, i) => (
          // Index keys: the list is a pure function of a constant, so it
          // has no identity to preserve and never reorders.
          <span key={i} data-tok={t.kind}>
            {t.text}
          </span>
        ))}
      </code>
    </pre>
  )

  return (
    <div className="cand-page cand-page--center">
      <div className="cand-code-wrap">
        <div className="cand-code-bar">
          <span>Surface.tsx</span>
          <button type="button" className="cand-btn cand-btn--small" onClick={copy}>
            Copy
          </button>
        </div>
        <div ref={holder} className="cand-code-holder" data-gone={gone || undefined}>
          {block}
        </div>
        {size ? (
          <SceneSurface.Root surface={surface}>
            <SceneSurface.HTML size={size} resolution={2}>{block}</SceneSurface.HTML>
            <SceneSurface.Mesh
                key={runId.current}
                visible={flying && Boolean(box)}
                placement="manual"
                alpha="source"
                frustumCulled={false}
                pointerEvents="none"
                position={[box?.x ?? 0, box?.y ?? 0, 0]}
                // 48×32 across a 420px block: the twist is a rigid
                // rotation about the cursor, so the mesh only needs
                // enough vertices for the per-vertex LAG to look smooth.
                geometry={<planeGeometry args={[size[0], size[1], 48, 32]} />}
                material={<SuckMaterial phase={phase} cursor={cursor} shape={shape} />}
              >
                {flying && <PhaseDrive
                  phase={phase}
                  durationMs={copyTuning.durationMs}
                  onDone={() => {
                    setFlying(false)
                    setGone(false)
                  }}
                />}
              </SceneSurface.Mesh>
          </SceneSurface.Root>
        ) : null}
      </div>
      <p className="cand-hint">
        Copied {copies} {copies === 1 ? 'time' : 'times'}. The block never
        actually left — move the mouse while it runs and the copy follows the
        cursor, then watch the original come back.
      </p>
    </div>
  )
}
