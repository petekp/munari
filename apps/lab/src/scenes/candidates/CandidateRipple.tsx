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
import {
  LIGHT,
  RIPPLE_FRAG,
  RIPPLE_MAX_WAVES,
  RIPPLE_SHADOW_FRAG,
  RIPPLE_SHADOW_VERT,
  RIPPLE_VERT,
} from './candidateShaders'
import { useLift, useOwnUniforms, type WorldBox } from './candidateStage'
import { rippleTuning } from './candidateTuning'

// The press's tuned numbers live in rippleTuning; the committed defaults
// carry the reasoning (which lifts read as growth, which bends shred).

/** One press: where the finger landed (content px) and its own 0→1 clock. */
interface RippleWave {
  origin: THREE.Vector2
  t: number
}

// Nearest device pixel, in CSS px.
function snap(v: number): number {
  const dpr = window.devicePixelRatio || 1
  return Math.round(v * dpr) / dpr
}

// Both materials render the same field, so both carry the same wave slots.
function waveUniforms() {
  return {
    uWaveOrigin: {
      value: Array.from({ length: RIPPLE_MAX_WAVES }, () => new THREE.Vector2()),
    },
    uWaveT: { value: new Float32Array(RIPPLE_MAX_WAVES).fill(1) },
    uWaveCount: { value: 0 },
    uLift: { value: rippleTuning.lift },
    uBend: { value: rippleTuning.bend },
    uWaveLen: { value: 60 },
    uFlap: { value: rippleTuning.flapCycles * 2 * Math.PI },
    uSettle: { value: rippleTuning.settle },
    uTail: { value: rippleTuning.tail },
  }
}

function writeWaveUniforms(
  uniforms: ReturnType<typeof waveUniforms>,
  waves: RippleWave[],
  width: number,
  height: number,
) {
  uniforms.uWaveCount.value = Math.min(waves.length, RIPPLE_MAX_WAVES)
  for (let i = 0; i < RIPPLE_MAX_WAVES; i++) {
    const wave = waves[i]
    uniforms.uWaveT.value[i] = wave ? Math.min(wave.t, 1) : 1
    if (wave) uniforms.uWaveOrigin.value[i].copy(wave.origin)
  }
  uniforms.uLift.value = rippleTuning.lift
  uniforms.uBend.value = rippleTuning.bend
  uniforms.uFlap.value = rippleTuning.flapCycles * 2 * Math.PI
  uniforms.uSettle.value = rippleTuning.settle
  uniforms.uTail.value = rippleTuning.tail
  uniforms.uWaveLen.value = Math.max(rippleTuning.waveSpan * 0.5 * Math.hypot(width, height), 30)
}

function RippleMaterial({ waves }: { waves: React.RefObject<RippleWave[]> }) {
  const texture = useSurfaceTexture()
  const { chrome, width, height } = useSurfaceChrome()
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      uSize: { value: new THREE.Vector2(1, 1) },
      ...waveUniforms(),
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
    writeWaveUniforms(uniforms, waves.current, width, height)
    uniforms.uShadeGain.value = rippleTuning.shadeGain
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
 * The shadow the raised control casts — the same wave field, projected
 * along the light onto the page plane. It is a second mesh rather than a
 * page-side pseudo element because the pseudo could only fade a fixed
 * blob: this one spreads where the sheet lifts, hugs the pinned point,
 * and is gone at t = 1 because the height it derives from is.
 */
function RippleShadow({ waves, size }: { waves: React.RefObject<RippleWave[]>; size: [number, number] }) {
  const { width, height } = useSurfaceChrome()
  const uniforms = useMemo(
    () => ({
      uSize: { value: new THREE.Vector2(1, 1) },
      ...waveUniforms(),
      uLightDir: { value: new THREE.Vector3(...LIGHT) },
      uShadowAlpha: { value: rippleTuning.shadowAlpha },
      uShadowSoft: { value: rippleTuning.shadowSoft },
    }),
    [],
  )
  const material = useOwnUniforms(uniforms)
  uniforms.uSize.value.set(width, height)
  useFrame(() => {
    writeWaveUniforms(uniforms, waves.current, width, height)
    uniforms.uShadowAlpha.value = rippleTuning.shadowAlpha
    uniforms.uShadowSoft.value = rippleTuning.shadowSoft
  })

  return (
    // Under the control (renderOrder), out of the pointer's way (raycast):
    // a hit on this mesh would bubble into the parent's relay handlers
    // with the shadow's own uv, and the click would land beside itself.
    <mesh renderOrder={-1} raycast={() => null} frustumCulled={false}>
      <planeGeometry args={[size[0], size[1], 64, 32]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={RIPPLE_SHADOW_VERT}
        fragmentShader={RIPPLE_SHADOW_FRAG}
        transparent
        premultipliedAlpha
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

/**
 * Advance every wave on one clock and hand the pixels back when the last
 * one lands. Mounted with the mesh and keyed with it, so a fresh session
 * gets a fresh drive.
 */
function WaveDrive({
  waves,
  onDone,
}: {
  waves: React.RefObject<RippleWave[]>
  onDone: () => void
}) {
  const done = useRef(false)
  useFrame((_, delta) => {
    if (done.current) return
    const list = waves.current
    if (list.length === 0) return
    // Clamped: a tab that was backgrounded hands back a delta of seconds,
    // and an effect that "already finished" while nobody was looking is a
    // piece of the page that vanishes on return.
    const step = (Math.min(delta, 1 / 30) * 1000) / rippleTuning.durationMs
    for (const wave of list) wave.t += step
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].t >= 1) list.splice(i, 1)
    }
    if (list.length === 0) {
      done.current = true
      onDone()
    }
  })
  return null
}

/**
 * One control that can be pressed.
 *
 * The same element is rendered twice — once into the page, once into the
 * parked capture — from one `content` node, which is what lets the copy
 * that hears the click be either one without the handler caring.
 */
function RippleTarget({ name, content }: { name: string; content: React.ReactNode }) {
  const lift = useLift(name)
  const holder = useRef<HTMLDivElement>(null)
  const waves = useRef<RippleWave[]>([])
  const down = useRef<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState<[number, number] | null>(null)
  const [box, setBox] = useState<WorldBox | null>(null)
  const runId = useRef(0)

  // Measured rather than authored, then quantized: text sizes these
  // controls and grid centering places them, so their boxes come out
  // fractional, and a texel that doesn't land on a device pixel smears an
  // 11px label everywhere. SIZES go to whole CSS px because that is the
  // capture pipeline's own grain — core's setSize rounds its box, so a
  // fractional size silently rasterizes at a not-quite-integer density.
  // Ceil, never round: the capture must not be smaller than the content,
  // or the copy reflows. The ≤1px overhang captures transparent. POSITION
  // (in fire below) goes to the device grid instead — on a dpr-2 display
  // a half-pixel CSS position IS a whole device pixel, and rounding it to
  // whole CSS px moved the mesh a full device pixel off the DOM it lands
  // back into: the 1px jump at the swap.
  useLayoutEffect(() => {
    const el = holder.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0) setSize([Math.ceil(r.width), Math.ceil(r.height)])
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
      const wave: RippleWave = {
        origin: new THREE.Vector2(clientX - r.left, clientY - r.top),
        t: 0,
      }
      if (waves.current.length === 0) {
        // A fresh session: new clock, new mesh, a re-read of where the
        // control stands. Whole-px size, device-px position — see the
        // measure comment above.
        const w = Math.ceil(r.width)
        const h = Math.ceil(r.height)
        const left = snap(r.left)
        const top = snap(r.top)
        setBox({
          x: left + w / 2 - window.innerWidth / 2,
          y: window.innerHeight / 2 - (top + h / 2),
          w,
          h,
        })
        runId.current += 1
      } else if (waves.current.length >= RIPPLE_MAX_WAVES) {
        waves.current.shift()
      }
      waves.current.push(wave)
      lift.lift()
    },
    [lift],
  )

  // The lift fires on RELEASE, never on the down edge. A press that begins
  // on the page copy has to finish there: lifting on pointerdown hid the
  // copy one frame later, the up landed on the canvas with no open relay,
  // and the click activated nothing — checkbox, segment and counter all
  // went dead (2026-08-20). On release the native click completes on the
  // still-visible page copy first; the swap happens frames later.
  const onDown = useCallback((e: { clientX: number; clientY: number }) => {
    down.current = { x: e.clientX, y: e.clientY }
  }, [])

  const onUp = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const d = down.current
      down.current = null
      if (!d) return
      // 5px of travel is a drag — a selection in progress, left alone.
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) fire(e.clientX, e.clientY)
    },
    [fire],
  )

  // The parked copy is portaled from THIS component, so relayed synthetic
  // events dispatched into it bubble back here through the React tree —
  // carrying parked-copy coordinates near the viewport origin. A mid-flight
  // press then reads as a 500px drag and the travel guard eats the wave.
  // Only events whose DOM target is really inside the holder are the page
  // copy's own; the mesh path below calls onDown/onUp directly.
  const onHolderDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.target instanceof Node && e.currentTarget.contains(e.target)) onDown(e)
    },
    [onDown],
  )
  const onHolderUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.target instanceof Node && e.currentTarget.contains(e.target)) onUp(e)
    },
    [onUp],
  )

  return (
    <div ref={holder} className="cand-target" onPointerDown={onHolderDown} onPointerUp={onHolderUp}>
      {size ? (
        <Surface
          surface={lift.surface}
          view={lift.view}
          timing={{ settleMs: 0, durationMs: 1 }}
          size={size}
          // Resolution stays 'auto', which seeds at the display's own
          // density — NOT pinned to 2. A pinned tier always carries a
          // mipmap chain, and trilinear at a nominal 1:1 blends in the
          // box-filtered half-res mip on any fractional LOD, which reads
          // as an 11px label going soft while standing still. The auto
          // tier above 0.5 has no mips: bilinear on a grid-aligned quad
          // is point sampling.
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
              // Mid-flight presses arrive on the mesh, not the holder — the
              // kernel relays them to the parked copy (that press still
              // counts), and the same tap logic adds its wave.
              onPointerDown={(e) => onDown(e.nativeEvent)}
              onPointerUp={(e) => onUp(e.nativeEvent)}
              // 64×32 puts a vertex every ~2px across a 120px button. The
              // crest's wavelength is now a fraction of the control rather
              // than a fixed 46px, so this is oversampled at every size —
              // and it costs 4k triangles for the length of one press.
              geometry={<planeGeometry args={[size[0], size[1], 64, 32]} />}
              material={<RippleMaterial waves={waves} />}
            >
              <RippleShadow waves={waves} size={size} />
              <WaveDrive waves={waves} onDone={lift.drop} />
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
  // Controlled, not defaultValue: the field renders as TWO DOM inputs (page
  // copy and parked capture copy), and focus follows the hold across them.
  // An uncontrolled value typed into one copy never reaches the other —
  // React state is the only value-sync path between the twins.
  const [workspace, setWorkspace] = useState('Munari')
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
        {/* Only the input lifts. The label is the page introducing the
            control, not part of the control — and wrapping keeps the
            native behavior where clicking the words focuses the field. */}
        <label className="cand-field">
          <span>Workspace name</span>
          <RippleTarget
            name="ripple-field"
            content={
              <input
                className="cand-input"
                type="text"
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
              />
            }
          />
        </label>
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
