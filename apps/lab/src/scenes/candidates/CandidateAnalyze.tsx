// Candidate 5 — the block that is being read.
//
// Press Analyze and something walks the article a block at a time. The
// block currently under the reader turns to glass: a thin sheet, slightly
// lifted, gently curved, with a read head travelling down it and colour
// splitting along the glyph edges where the sheet bends. When the reader
// moves on, the block goes back to being an ordinary paragraph.
//
// The dispersion is driven by the sheet's OWN curvature, not by a timer.
// That matters: a flat wash over the whole block is a filter, and a filter
// tells you a filter is running. Bending the sheet and splitting colour
// where it bends says which part of the block is under the reader right
// now, which is the only thing this state has to communicate. The colour
// is two hues rather than a spectrum, and it only appears under the read
// head — see the shader's note on why the rainbow went.
//
// The paragraph is a lift, not a Twin — for the length of the read, the
// canvas holds that block. It goes back afterwards, and the article's
// layout never moves, because the page copy keeps its box the whole time.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, useSurfaceChrome, useSurfaceHandle, useSurfaceTexture } from '@petepetrash/munari'
import { textureSlot } from '../../lib/uniforms'
import { LIGHT, PRISM_FRAG, PRISM_VERT } from './candidateShaders'
import { useOwnUniforms, worldBoxOf, type WorldBox } from './candidateStage'
import { analyzeTuning } from './candidateTuning'

const BLOCKS = [
  {
    id: 'intro',
    title: 'Abitacolo',
    body:
      'A bed, a desk, a bookshelf and a ladder, drawn as one cage of steel rod. ' +
      'It weighs fifty-one kilograms and it is meant to be re-arranged by the ' +
      'child who sleeps in it.',
    finding: 'Primary claim: furniture as an armature, not as objects.',
  },
  {
    id: 'method',
    title: 'Method',
    body:
      'Nothing in it is finished in the sense a cabinet is finished. Every ' +
      'surface is a grid, so every surface is an attachment point, and the ' +
      'design ends where the occupant begins.',
    finding: 'Method: under-specification used deliberately.',
  },
  {
    id: 'result',
    title: 'What happened',
    body:
      'It stayed in production for forty years without a revision, which is ' +
      'unusual for furniture aimed at children and much more unusual for ' +
      'furniture aimed at their parents.',
    finding: 'Evidence: longevity, cited without a source.',
  },
] as const

/** How long the reader spends on one block. */

function PrismMaterial({ on, onFaded }: { on: boolean; onFaded: () => void }) {
  const texture = useSurfaceTexture()
  const { chrome, width, height } = useSurfaceChrome()
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      uTime: { value: 0 },
      uOn: { value: 0 },
      // 6px of lift. Enough that the shadowless sheet still reads as being
      // off the page through parallax alone when the reader scrolls.
      uLift: { value: analyzeTuning.lift },
      // 1.6px of ripple. The dispersion below is proportional to the
      // sheet's slope, so this number sets the rainbow's strength as much
      // as uPrism does — they are one knob wearing two names, and the
      // wave is the one to reach for first because it is also the shape.
      uWave: { value: analyzeTuning.wave },
      uScan: { value: 1 },
      uScanWidth: { value: analyzeTuning.scanWidth },
      uDisperse: { value: analyzeTuning.disperse },
      // Raised, because the colour is now gated by the scan band and only
      // reaches full strength on the few glyph rows under it.
      uPrism: { value: analyzeTuning.prism },
      uGlow: { value: analyzeTuning.glow },
      uEdgeGain: { value: analyzeTuning.edgeGain },
      // The two ends of the split. A cold blue and a soft amber, both well
      // off saturation — a duotone at full chroma is a rainbow with two
      // colours in it.
      uCool: { value: new THREE.Color('#5fa8e8') },
      uWarm: { value: new THREE.Color('#e8a55f') },
      // Warm, and about a fifth the strength of the specular. This is the
      // "something is lit behind the page" term; past ~0.2 it stops being
      // backlight and starts being a highlighter.
      uBacklight: { value: new THREE.Color('#ffcf8a') },
      uBackGain: { value: analyzeTuning.backGain },
      uLightDir: { value: new THREE.Vector3(...LIGHT) },
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
  uniforms.uTexel.value.set(1 / Math.max(width, 1), 1 / Math.max(height, 1))

  const faded = useRef(false)
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30)
    uniforms.uTime.value += dt
    uniforms.uLift.value = analyzeTuning.lift
    uniforms.uWave.value = analyzeTuning.wave
    uniforms.uScanWidth.value = analyzeTuning.scanWidth
    uniforms.uDisperse.value = analyzeTuning.disperse
    uniforms.uPrism.value = analyzeTuning.prism
    uniforms.uGlow.value = analyzeTuning.glow
    uniforms.uEdgeGain.value = analyzeTuning.edgeGain
    uniforms.uBackGain.value = analyzeTuning.backGain
    const target = on ? 1 : 0
    uniforms.uOn.value += (target - uniforms.uOn.value) * (1 - Math.exp(-dt / 0.13))
    // uv.y = 1 is the top of the block, so the read head starts at 1 and
    // runs down. It resets on arrival rather than on departure, which is
    // why a re-analysed block starts from its top again.
    if (on) {
      uniforms.uScan.value -= dt / (analyzeTuning.dwellMs / 1000)
      if (uniforms.uScan.value < -0.2) uniforms.uScan.value = 1.2
      faded.current = false
    } else {
      uniforms.uScan.value = 1.2
      // The pixels go back to the page only after the glass has actually
      // cleared. Dropping on the state change instead would swap a sheet
      // that is still visibly bent for a flat paragraph, in one frame.
      if (!faded.current && uniforms.uOn.value < 0.01) {
        faded.current = true
        onFaded()
      }
    }
  })

  return (
    <shaderMaterial
      ref={material}
      key={texture.uuid}
      uniforms={uniforms}
      vertexShader={PRISM_VERT}
      fragmentShader={PRISM_FRAG}
      transparent
      premultipliedAlpha
      depthWrite={false}
      toneMapped={false}
    />
  )
}

function AnalyzedBlock({
  id,
  title,
  body,
  active,
}: {
  id: string
  title: string
  body: string
  active: boolean
}) {
  const surface = useSurfaceHandle(`analyze-${id}`)
  const [renderIn, setRenderIn] = useState<'page' | 'canvas'>('page')
  const holder = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<[number, number] | null>(null)
  const [box, setBox] = useState<WorldBox | null>(null)

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

  useEffect(() => {
    if (active) setRenderIn('canvas')
  }, [active])

  const content = (
    <section className="cand-block">
      <h3>{title}</h3>
      <p>{body}</p>
    </section>
  )

  return (
    <div ref={holder} className="cand-block-holder" data-active={active || undefined}>
      {size ? (
        <Surface.Root surface={surface} timing={{ settleMs: 0, durationMs: 1 }} inScene={renderIn === 'canvas'}>
<Surface.HTML size={size} resolution={2}>{content}</Surface.HTML>

          {box && (
            <Surface.Mesh
              placement="manual"
              alpha="source"
              frustumCulled={false}
              position={[box.x, box.y, 0]}
              pointerEvents="content"
              // The sheet's curvature is the effect, so the vertex spacing
              // is the effect's resolution: 64×40 puts one every ~7px on a
              // 430px block, comfortably inside the wave's period.
              geometry={<planeGeometry args={[size[0], size[1], 64, 40]} />}
              material={<PrismMaterial on={active} onFaded={() => setRenderIn('page')} />}
            />
          )}
        </Surface.Root>
      ) : (
        content
      )}
    </div>
  )
}

export function CandidateAnalyze() {
  const [reading, setReading] = useState(-1)
  const [found, setFound] = useState<string[]>([])
  const timer = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setReading(-1)
  }, [])

  useEffect(() => stop, [stop])

  const run = useCallback(() => {
    setFound([])
    setReading(0)
    let i = 0
    const step = () => {
      // Read the block BEFORE the updater closes over anything. React calls
      // a functional update during the render that consumes it, not at the
      // call site, and under StrictMode it calls it twice — so an updater
      // that dereferences a `let` the caller is about to advance reads the
      // next index, or one past the end.
      const finding = BLOCKS[i].finding
      setFound((f) => [...f, finding])
      i += 1
      if (i >= BLOCKS.length) {
        setReading(-1)
        timer.current = null
        return
      }
      setReading(i)
      timer.current = window.setTimeout(step, analyzeTuning.dwellMs)
    }
    timer.current = window.setTimeout(step, analyzeTuning.dwellMs)
  }, [])

  const running = reading >= 0

  return (
    <div className="cand-page cand-page--split">
      <article className="cand-article">
        {BLOCKS.map((b, i) => (
          <AnalyzedBlock key={b.id} id={b.id} title={b.title} body={b.body} active={reading === i} />
        ))}
      </article>

      <aside className="cand-agent">
        <h2>Reader</h2>
        <button type="button" className="cand-btn cand-btn--primary" onClick={running ? stop : run}>
          {running ? 'Stop' : 'Analyze'}
        </button>
        <ol className="cand-findings">
          {found.map((f) => (
            <li key={f}>{f}</li>
          ))}
          {running && <li className="cand-findings__live">reading…</li>}
        </ol>
      </aside>
    </div>
  )
}
