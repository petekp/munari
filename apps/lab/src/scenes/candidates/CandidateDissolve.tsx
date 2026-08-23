// Candidate 4 — the figure that comes apart and puts itself back together
// somewhere else.
//
// Click the figure and it stops being a figure: every few pixels becomes
// a loose grain, the grains swirl across the gap, and they settle into the
// empty slot on the other side as a figure again — real, ordinary DOM,
// selectable and focusable the moment it lands.
//
// The two slots hold DIFFERENT figures — a cold circle on the left, a
// warm triangle on the right, drawn in the same hand as the genie desk's
// icons — so what crosses the gap visibly becomes something else on the
// way. Each cloud carries its own colour toward the other figure's as it
// flies, which means at the middle of the crossing the two clouds are the
// same colour and the handoff between them has nothing to show.
//
// Two clouds, not one. A material can only reach the texture of the
// Surface it belongs to, so there is no single presenter that could hold
// both the figure it is leaving and the one it is becoming. The crossing is
// staged instead as two presenters overlapping in the middle: the origin's
// grains fly out and fade, the destination's grains fly in from where the
// origin was and sharpen. They share one path and one clock, and their two
// fades are exact complements, so the amount of figure on screen is constant
// through the whole crossing rather than dipping or doubling at the seam.
//
// The claim to check: the landing is not an animation that ENDS at the
// figure, it is the figure. Grain home positions are exactly where the DOM put
// them, so at t = 1 the cloud is bit-identical to the element underneath
// it and the swap to `view: 'dom'` has nothing to hide.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, useSurfaceTexture, useSurfaceView } from '@petepetrash/munari'
import { textureSlot } from '../../lib/uniforms'
import { buildCloud, grainSize, type CloudSpec } from './candidateCloud'
import { CLOUD_FRAG, CLOUD_VERT } from './candidateShaders'
import {
  PhaseDrive,
  easeInOutCubic,
  useOwnUniforms,
  usePhase,
  worldBoxOf,
  type Phase,
  type WorldBox,
} from './candidateStage'
import { dissolveTuning } from './candidateTuning'

const CARD_W = 180
const CARD_H = 180
// Grain pitch, in px. 1.7px is a little under the figures' stroke width,
// so an outline survives as several grains rather than dissolving into
// one — which is what keeps the cloud readable as the figure it came from
// for the first third of the flight. 106×106 is 11,236 grains per cloud,
// 22,472 for the crossing, which a 2021 laptop draws in under 1ms.
const SPEC: CloudSpec = { width: CARD_W, height: CARD_H, cols: 106, rows: 106 }

// The two figures' key colours, and what each cloud's grains travel toward.
const COLD = '#3f7fb8'
const WARM = '#c8663a'

function CloudMaterial({
  phase,
  travel,
  reverse,
  flare,
}: {
  phase: React.RefObject<Phase>
  travel: number
  reverse: boolean
  /** The colour this cloud's grains pass through mid-flight. */
  flare: string
}) {
  const texture = useSurfaceTexture()
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      uT: { value: 0 },
      uTravel: { value: new THREE.Vector3(travel, 0, 0) },
      // Lateral wander. At 34px the cloud is visibly a cloud without any
      // grain travelling far enough to be read as a separate object.
      uSwirl: { value: dissolveTuning.swirl },
      uBulge: { value: dissolveTuning.bulge },
      uTwist: { value: dissolveTuning.twist },
      // Fraction of the flight spent handing out start times. Without the
      // stagger every grain arrives on the same frame and the landing is a
      // shutter rather than a settling.
      uStagger: { value: dissolveTuning.stagger },
      // Exactly one texel-block. The grains are square at rest, so at this
      // size they tile the tile with no gap — see the shader's note.
      uGrain: { value: grainSize(SPEC) },
      // The grain's footprint in uv, for the shader's landing resolve.
      uPitchUv: { value: new THREE.Vector2(1 / SPEC.cols, 1 / SPEC.rows) },
      uReverse: { value: reverse ? 1 : 0 },
      uFade: { value: 1 },
      // Near zero. The figures are mostly pale field, and at the old 0.22
      // the two overlapping clouds saturated to a white blob mid-crossing
      // (2026-08-20) — the flare colour, not added light, carries the
      // flight now.
      uSpark: { value: dissolveTuning.spark },
      uFlare: { value: new THREE.Color(flare) },
      // How far toward the other figure's colour a grain gets at the top of
      // its arc. High on purpose: the tiles carry almost no ink, so the
      // flare hue is the only thing that keeps the mid-crossing cloud from
      // reading as white. The outline still survives — 0.85 leaves 15% of
      // the grain's own colour, and the stroke is 3px against a pale field.
      uFlareGain: { value: dissolveTuning.flareGain },
    }),
    [travel, reverse, flare],
  )
  uniforms.tMap.value = texture
  const material = useOwnUniforms(uniforms)

  useFrame(() => {
    const t = phase.current.t
    uniforms.uT.value = t
    uniforms.uSwirl.value = dissolveTuning.swirl
    uniforms.uBulge.value = dissolveTuning.bulge
    uniforms.uTwist.value = dissolveTuning.twist
    uniforms.uStagger.value = dissolveTuning.stagger
    uniforms.uSpark.value = dissolveTuning.spark
    uniforms.uFlareGain.value = dissolveTuning.flareGain
    // Exact complements. The earlier pair overlapped by eyeball and left a
    // window near t = 0.5 where both clouds were near-opaque, which is what
    // made the landing look like a cut. One weight, used both ways, cannot
    // have that window.
    const w = easeInOutCubic(Math.min(1, Math.max(0, (t - 0.26) / 0.48)))
    uniforms.uFade.value = reverse ? w : 1 - w
  })

  return (
    <shaderMaterial
      ref={material}
      key={texture.uuid}
      uniforms={uniforms}
      vertexShader={CLOUD_VERT}
      fragmentShader={CLOUD_FRAG}
      transparent
      premultipliedAlpha
      depthWrite={false}
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  )
}

function CloudGeometry() {
  const geometry = useMemo(() => buildCloud(SPEC), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <primitive object={geometry} attach="geometry" />
}

type Slot = 'left' | 'right'

export function CandidateDissolve() {
  const [slot, setSlot] = useState<Slot>('left')
  const [flying, setFlying] = useState(false)
  const [edits, setEdits] = useState(0)
  const origin = useSurfaceView('dissolve-origin')
  const arrival = useSurfaceView('dissolve-arrival')
  const phase = usePhase()
  const runId = useRef(0)
  const holders = useRef<Record<Slot, HTMLDivElement | null>>({ left: null, right: null })
  const [boxes, setBoxes] = useState<Record<Slot, WorldBox | null>>({ left: null, right: null })

  // Both presenters are placed manually, so both need a pose. Measured from
  // the slots themselves: the layout centers them and the gap the cloud
  // crosses is whatever the viewport made it, not a number written here.
  useLayoutEffect(() => {
    const measure = () =>
      setBoxes({ left: worldBoxOf(holders.current.left), right: worldBoxOf(holders.current.right) })
    void document.fonts.ready.then(measure)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const send = useCallback(() => {
    if (flying) return
    runId.current += 1
    phase.current.t = 0
    phase.current.running = true
    setFlying(true)
    origin.show('webgl')
    arrival.show('webgl')
  }, [arrival, flying, origin, phase])

  const land = useCallback(() => {
    setSlot((s) => (s === 'left' ? 'right' : 'left'))
    setFlying(false)
    // The destination becomes page DOM; the origin gives its pixels back to
    // a slot that is now empty, which is why its own view goes home too.
    arrival.show('dom')
    origin.show('dom')
  }, [arrival, origin])

  const bump = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEdits((n) => n + 1)
  }

  // One figure per slot, not one figure that moves. The left is a cold
  // circle and the right a warm triangle, so the crossing has something to
  // be about. Geometry is the genie desk's own: circle r 8.8 and the
  // round-joined triangle, in a 20-unit viewBox.
  const cards = {
    left: (
      <article className="cand-shape cand-shape--cold" style={{ width: CARD_W, height: CARD_H }}>
        <svg viewBox="0 0 20 20" aria-hidden>
          <circle className="cand-shape__base" cx="10" cy="10" r="8.8" />
          <circle className="cand-shape__line" cx="10" cy="10" r="8.8" />
        </svg>
        <footer>
          <button type="button" onClick={bump}>
            cerchio · {edits}
          </button>
        </footer>
      </article>
    ),
    right: (
      <article className="cand-shape cand-shape--warm" style={{ width: CARD_W, height: CARD_H }}>
        <svg viewBox="0 0 20 20" aria-hidden>
          <path className="cand-shape__base" d="M10 0.9 L19.2 18.6 L0.8 18.6 Z" />
          <path className="cand-shape__line" d="M10 0.9 L19.2 18.6 L0.8 18.6 Z" />
        </svg>
        <footer>
          <button type="button" onClick={bump}>
            triangolo · {edits}
          </button>
        </footer>
      </article>
    ),
  }

  // Origin → destination, in world px. Zero until both slots are measured,
  // which is also the condition the meshes are gated on.
  const gap = boxes.left && boxes.right ? boxes.right.x - boxes.left.x : 0
  const travel = slot === 'left' ? gap : -gap

  return (
    <div className="cand-page cand-page--center">
      <div className="cand-slots">
        {(['left', 'right'] as const).map((side) => {
          const holds = slot === side
          const isOrigin = holds
          const piece = isOrigin ? origin : arrival
          const box = boxes[side]
          const card = cards[side]
          // While a flight is running BOTH slots carry a presenter: the one
          // the figure is leaving and the one it is arriving at.
          const showSurface = holds || flying
          return (
            <div
              key={side}
              ref={(el) => {
                holders.current[side] = el
              }}
              className="cand-slot"
              data-empty={(!holds && !flying) || undefined}
            >
              {showSurface ? (
                <Surface
                  surface={piece.surface}
                  view={piece.view}
                  timing={{ settleMs: 0, durationMs: 1 }}
                  size={[CARD_W, CARD_H]}
                  source={card}
                >
                  <Surface.DOM>
                    <div
                      className="cand-slot__hit"
                      onClick={holds && !flying ? send : undefined}
                      role={holds && !flying ? 'button' : undefined}
                      tabIndex={holds && !flying ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (holds && !flying && (e.key === 'Enter' || e.key === ' ')) send()
                      }}
                    >
                      {card}
                    </div>
                  </Surface.DOM>
                  {piece.mounted && flying && box && (
                    <Surface.WebGL
                      key={runId.current}
                      placement="manual"
                      alpha="source"
                      frustumCulled={false}
                      pointerEvents="none"
                      position={[box.x, box.y, 0]}
                      geometry={<CloudGeometry />}
                      material={
                        <CloudMaterial
                          phase={phase}
                          travel={isOrigin ? travel : -travel}
                          reverse={!isOrigin}
                          flare={side === 'left' ? WARM : COLD}
                        />
                      }
                    >
                      {/* One clock for both clouds, hung on the origin so a
                          second `PhaseDrive` cannot double-advance it. */}
                      {isOrigin && (
                        <PhaseDrive phase={phase} durationMs={dissolveTuning.flightMs} onDone={land} />
                      )}
                    </Surface.WebGL>
                  )}
                </Surface>
              ) : (
                <div className="cand-slot__empty">drop</div>
              )}
            </div>
          )
        })}
      </div>
      <p className="cand-hint">
        Click the figure. It comes apart into its own pixels, changes colour
        on the way across, and resolves back to full resolution on the other
        side — the counter keeps counting.
      </p>
    </div>
  )
}
