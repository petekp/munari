// Candidate 1 — the press, felt in the control.
//
// Press any control on the card and the control comes off the page like a
// sticker held down at one point: the press pins the spot under the
// finger, the rest of the control lifts and flaps — waves radiating out
// from the contact point, silhouette and all — and it settles back flat.
// Nothing outside the control's own box moves.
//
// Why this is not a CSS ripple. The ubiquitous version is a scaling,
// fading circle in an `overflow: hidden` box — a shape drawn ON the
// control. Here the control is the thing that moves. The text on a button
// rides the wave; the value in a field rides the wave; a checkbox's tick
// rides the wave. And because the world unit is a CSS pixel, the lift is
// real depth: the free corners grow by the perspective they earn and lean
// toward the viewport's centre, which no transform: scale() produces.
//
// What it costs: the control changes hands for the length of the effect.
// The press that started it is still in progress at handoff, so the click
// that follows arrives through the relay, in the parked copy — which is
// exactly the case `crossingPointer` exists for, and the reason the
// counter under the buttons is worth watching.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, useSurfaceChrome, useSurfaceTexture } from '@petepetrash/munari'
import { textureSlot } from '../../lib/uniforms'
import { LIGHT, RIPPLE_FRAG, RIPPLE_VERT } from './candidateShaders'
import {
  PhaseDrive,
  useLift,
  useOwnUniforms,
  usePhase,
  worldBoxOf,
  type Phase,
  type WorldBox,
} from './candidateStage'
import { rippleTuning } from './candidateTuning'

// The press's tuned numbers live in rippleTuning; the committed defaults
// carry the reasoning (which lifts read as growth, which bends shred).

function RippleMaterial({ phase, origin }: { phase: React.RefObject<Phase>; origin: React.RefObject<THREE.Vector2> }) {
  const texture = useSurfaceTexture()
  const { chrome, width, height } = useSurfaceChrome()
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      uSize: { value: new THREE.Vector2(1, 1) },
      uOrigin: { value: new THREE.Vector2(0, 0) },
      uT: { value: 0 },
      uLift: { value: rippleTuning.lift },
      uBend: { value: rippleTuning.bend },
      uWaveLen: { value: 60 },
      uFlap: { value: rippleTuning.flapCycles * 2 * Math.PI },
      uLightDir: { value: new THREE.Vector3(...LIGHT) },
      // Gain on the balanced lambert term. The wave's steepest face is
      // ~25° off flat here; 0.9 puts its highlight around +0.35 on a white
      // control, which is visible without bleaching the label.
      uShadeGain: { value: rippleTuning.shadeGain },
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
  useFrame(() => {
    uniforms.uT.value = phase.current.t
    uniforms.uOrigin.value.copy(origin.current)
    uniforms.uLift.value = rippleTuning.lift
    uniforms.uBend.value = rippleTuning.bend
    uniforms.uFlap.value = rippleTuning.flapCycles * 2 * Math.PI
    uniforms.uShadeGain.value = rippleTuning.shadeGain
    uniforms.uWaveLen.value = Math.max(rippleTuning.waveSpan * 0.5 * Math.hypot(width, height), 30)
  })

  return (
    <shaderMaterial
      ref={material}
      key={texture.uuid}
      uniforms={uniforms}
      vertexShader={RIPPLE_VERT}
      fragmentShader={RIPPLE_FRAG}
      transparent
      premultipliedAlpha
      depthWrite={false}
      toneMapped={false}
    />
  )
}

/**
 * One control that can be pressed.
 *
 * The same element is rendered twice — once into the page, once into the
 * parked capture — from one `content` node, which is what lets the copy
 * that hears the click be either one without the handler caring.
 */
function RippleTarget({
  name,
  content,
  trigger = 'press',
}: {
  name: string
  content: React.ReactNode
  /**
   * 'press' lifts on pointerdown. 'tap' waits for a pointerup that never
   * travelled — the text field needs this, because lifting on the down
   * edge swaps the input for its parked copy mid-drag and native text
   * selection dies with the element that started it.
   */
  trigger?: 'press' | 'tap'
}) {
  const lift = useLift(name)
  const holder = useRef<HTMLDivElement>(null)
  const phase = usePhase()
  const origin = useRef(new THREE.Vector2())
  const down = useRef<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState<[number, number] | null>(null)
  const [box, setBox] = useState<WorldBox | null>(null)
  const runId = useRef(0)

  // Measured rather than authored: these are text-sized controls, and a
  // hand-written box that disagrees with the layout by a pixel puts the
  // mesh a pixel off the DOM it is replacing — the one artifact this whole
  // library exists to not have.
  useLayoutEffect(() => {
    const el = holder.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0) setSize([r.width, r.height])
    }
    void document.fonts.ready.then(measure)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fire = useCallback(
    (clientX: number, clientY: number) => {
      const el = holder.current
      if (!el) return
      const r = el.getBoundingClientRect()
      origin.current.set(clientX - r.left, clientY - r.top)
      setBox(worldBoxOf(el))
      phase.current.t = 0
      phase.current.running = true
      runId.current += 1
      lift.lift()
    },
    [lift, phase],
  )

  const onDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (trigger === 'press') fire(e.clientX, e.clientY)
      else down.current = { x: e.clientX, y: e.clientY }
    },
    [fire, trigger],
  )

  const onUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = down.current
      down.current = null
      if (trigger !== 'tap' || !d) return
      // 5px of travel is a drag — a selection in progress, left alone.
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) fire(e.clientX, e.clientY)
    },
    [fire, trigger],
  )

  return (
    <div
      ref={holder}
      className="cand-target"
      data-lifted={lift.mounted || undefined}
      onPointerDown={onDown}
      onPointerUp={onUp}
    >
      {size ? (
        <Surface
          surface={lift.surface}
          view={lift.view}
          timing={{ settleMs: 0, durationMs: 1 }}
          size={size}
          // These are 11px uppercase labels and a checkbox tick. At 1× the
          // capture is resampled by the perspective the rise introduces
          // and the segmented control's rules go soft.
          resolution={2}
          source={content}
          onWebGLReleased={lift.released}
        >
          <Surface.DOM>{content}</Surface.DOM>
          {lift.mounted && box && (
            <Surface.WebGL
              key={runId.current}
              placement="manual"
              alpha="source"
              frustumCulled={false}
              position={[box.x, box.y, 0]}
              pointerEvents="content"
              // 64×32 puts a vertex every ~2px across a 120px button. The
              // crest's wavelength is now a fraction of the control rather
              // than a fixed 46px, so this is oversampled at every size —
              // and it costs 4k triangles for the length of one press.
              geometry={<planeGeometry args={[size[0], size[1], 64, 32]} />}
              material={<RippleMaterial phase={phase} origin={origin} />}
            >
              <PhaseDrive
                phase={phase}
                durationMs={rippleTuning.durationMs}
                onDone={lift.drop}
              />
            </Surface.WebGL>
          )}
        </Surface>
      ) : (
        content
      )}
    </div>
  )
}

export function CandidateRipple() {
  const [presses, setPresses] = useState(0)
  const [wifi, setWifi] = useState(true)
  const [mode, setMode] = useState('balanced')
  const onPress = useCallback(() => setPresses((n) => n + 1), [])

  return (
    <div className="cand-page cand-page--center">
      <section className="cand-card cand-card--form">
        <header>
          <h2>Preferences</h2>
          <p>Ordinary controls. Press one.</p>
        </header>

        <RippleTarget
          name="ripple-primary"
          content={
            <button type="button" className="cand-btn cand-btn--primary" onClick={onPress}>
              Save changes
            </button>
          }
        />
        <RippleTarget
          name="ripple-secondary"
          content={
            <button type="button" className="cand-btn" onClick={onPress}>
              Discard
            </button>
          }
        />
        <RippleTarget
          name="ripple-field"
          trigger="tap"
          content={
            <label className="cand-field">
              <span>Workspace name</span>
              <input type="text" defaultValue="Munari" />
            </label>
          }
        />
        <RippleTarget
          name="ripple-toggle"
          content={
            <label className="cand-check">
              <input type="checkbox" checked={wifi} onChange={(e) => setWifi(e.target.checked)} />
              <span>Sync over Wi-Fi only</span>
            </label>
          }
        />
        <RippleTarget
          name="ripple-segment"
          content={
            <div className="cand-segment" role="group">
              {['eco', 'balanced', 'full'].map((m) => (
                <button
                  key={m}
                  type="button"
                  data-on={mode === m || undefined}
                  onClick={() => {
                    setMode(m)
                    onPress()
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          }
        />

        <footer className="cand-readout">
          <span>presses that survived the handoff</span>
          <strong>{presses}</strong>
        </footer>
      </section>
    </div>
  )
}
