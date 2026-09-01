// The veil scene — a progressive blur over a page that never stops
// being a page.
//
// One backdrop-filter is one blur strength; a blur that DEEPENS with
// distance is the effect the web has had to fake with stacks of masked
// backdrop layers — and `mask-image` is one of the things HTML-in-canvas
// forbids in a captured subtree. Here the gradient is honest: a band
// at the bottom of the viewport samples the article's own paint and
// blurs it by a per-row radius (veilLaw.ts).
//
// The hold story is the inverse of genie's. The article is real,
// visible, scrolling DOM the entire time — the compositor never gives
// it up. What flies in WebGL is a TWIN: the same component rendered
// from the same controlled props into a parked Surface source, giving
// the band a texture of paint that is identical to the page by
// construction.
//
// WHERE the canvas lives is the part that took three tries. The
// compositor scrolls a flick on its own thread; anything positioned
// against the VIEWPORT that draws content from a main-thread
// `scrollTop` paints a copy one-to-two frames stale, and the fade zone
// shows page and copy at once — so every stale frame reads as doubled
// text. Predicting the scroll only moved the error around. The fix is
// hold, not timing: the canvas sits IN the scrolling layer,
// absolutely positioned at an article coordinate we choose, so the
// compositor moves canvas and article together and the copy can never
// slide against the page around it. The stale scroll value now steers
// only WHERE the window sits — and a smooth blur profile arriving a
// few pixels late is invisible in a way misaligned text never was.
// The window hangs past the viewport bottom (UNDERHANG) so a fast
// downward flick cannot outrun its far edge before the next frame
// catches up.
//
// The overlay never takes pointer events. You scroll, select, and
// click THROUGH the veil, because the thing under it is the page.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Surface,
  SurfaceCanvas,
  useSurfacePaintedSize,
  useSurfaceTexture,
} from '@petepetrash/munari'
import { cameraDistance } from '@petepetrash/munari/advanced'
import { VEIL_DEFAULTS, veilReturn, veilStrip } from './veilLaw'
import {
  VEIL_BAND_FRAG,
  VEIL_BAND_VERT,
  VEIL_COPY_FRAG,
  VEIL_PASS_FRAG,
  VEIL_QUAD_VERT,
} from './veilShaders'
import { textureSlot } from '../../lib/uniforms'
import type { VeilGateEntry } from '../../lib/devGlobals'
import './veil.css'

const FOV = 42
const BAND_H = VEIL_DEFAULTS.height
// How far the window continues below the viewport. During a fast flick
// the compositor is ahead of the scroll value that placed the window,
// and the window's far edge would otherwise surface: at 4px/ms with
// two frames of slack the gap peaks well under this.
const UNDERHANG = 120
const WINDOW_H = BAND_H + UNDERHANG
// How long a frame keeps requesting the next one after a scroll event.
// Momentum scrolling coalesces its events, and a window that moves only
// on the events trails in steps — the tail keeps the loop at vsync
// until the glide is over, then demand resumes.
const GLIDE_MS = 180

// ── the article (rendered twice: on the page, and parked for paint) ─────

function VeilSheet() {
  return (
    <div className="veil-sheet">
      <header className="veil-head">
        <h1>
          mun<em>ari</em>
        </h1>
      </header>
      <article className="veil-article">
        <div className="veil-kicker">progressive blur</div>
        <h2>The veil</h2>
        <p>
          Scroll this page. The bottom of the viewport is a band of blur that
          deepens with depth: sharp at its top edge, dissolved at the bottom,
          and every line of text passes through the whole gradient on its way
          out. The web has one word for blur behind things,{' '}
          <strong>backdrop-filter</strong>, and it comes in exactly one
          strength at a time. A gradient of blur means stacking masked copies
          of the effect and hoping the seams stay hidden.
        </p>
        <p>
          This band is one copy of the page and one pass of arithmetic. The
          article you are reading is captured as a texture, and a shader
          samples it with a blur radius that follows a fixed profile: zero at
          the seam, so the band's top edge is the content to the pixel, then a
          smooth ramp to full radius. The profile is a pure function with its
          own tests; the shader is its twin.
        </p>
        <p>
          The part worth noticing is what did not change. This page is still a
          page. The text under the veil can be selected, the links can be
          clicked, and scrolling is the browser's own scrolling — the blur
          band never takes a pointer event. Scrolling does not even repaint
          the capture: the texture is the whole article, and the band just
          shifts where it reads.
        </p>
        <div className="veil-specimen">
          <h3>specimen — hairlines and figures</h3>
          <table>
            <tbody>
              <tr>
                <td>band depth</td>
                <td>{BAND_H} px</td>
              </tr>
              <tr>
                <td>radius at the seam</td>
                <td>0 px, exactly</td>
              </tr>
              <tr>
                <td>radius at the far edge</td>
                <td>{VEIL_DEFAULTS.maxRadius} px</td>
              </tr>
              <tr>
                <td>ramp</td>
                <td>smoothstep^{VEIL_DEFAULTS.curve}</td>
              </tr>
              <tr>
                <td>kernel</td>
                <td>13 × 13, separable</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Tables are the honest test card for a blur. Hairline rules alias
          first, tabular figures smear second, and a cheap kernel turns both
          into ghosting before body text shows anything. Watch this one cross
          the band.
        </p>
        <p>
          Apple has shipped this gradient for years — the notification shade,
          the now-playing screen, the dock's shelf all dissolve their content
          progressively rather than behind one flat pane. That whole family of
          material behavior was native-only. The point of this scene is that
          the ingredient it needed was never the shader; it was a way to hand
          a shader the page's own paint and keep the page alive underneath.
        </p>
        <p>
          The last lines of this article will spend the longest inside the
          veil, which is the point at which a demo becomes furniture: read to
          the end, and the end arrives through the blur.
        </p>
      </article>
    </div>
  )
}

// ── the camera: 1 world unit = 1 CSS px of the window ───────────────────

function PixelPerfect() {
  // SAFETY: r3f types the store's camera as the base class and hands back a
  // PerspectiveCamera unless the Canvas asks for `orthographic`. This one
  // does not, and could not: fitting the frustum to the viewport is what
  // makes a CSS pixel a world unit, and orthographic has no fov to fit.
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  useEffect(() => {
    camera.fov = FOV
    camera.position.set(0, 0, cameraDistance(size.height, FOV))
    camera.near = 1
    camera.far = camera.position.z * 3
    camera.updateProjectionMatrix()
  }, [camera, size.height])
  return null
}

// The demand loop's alarm clock: a scroll moves the window, late fonts
// change the article's paint, and neither produces a frame on its own
// under frameloop='demand'. The page scrolls in its own container, and
// element scrolls never reach a window listener — the document capture
// phase is the one place that hears them all.
/** How far the return ramp has opened this frame. The raster's box has to
 *  match the live page's before the ramp starts, and any mismatch restarts
 *  it — blending two disagreeing layouts reads as text doubled sideways. */
function stepGate(matched: boolean, matchedSince: RefObject<number | null>): number {
  if (!matched) {
    matchedSince.current = null
  } else if (matchedSince.current === null) {
    matchedSince.current = performance.now()
  }
  return matched && matchedSince.current !== null
    ? veilReturn(performance.now() - matchedSince.current, VEIL_DEFAULTS)
    : 0
}

/** Appends one frame to the dev ring and trims it back to 400. */
function pushGateRecord(
  m: THREE.ShaderMaterial | null,
  facts: Omit<VeilGateEntry, 't' | 'muGate'>,
) {
  const log = (window.__veilGateLog ??= [])
  log.push({
    t: Math.round(performance.now() * 10) / 10,
    ...facts,
    muGate: m ? Math.round((m.uniforms.uGate?.value ?? -1) * 1000) / 1000 : 'no-mat',
  })
  if (log.length > 400) log.splice(0, log.length - 400)
}

function WakeOn() {
  const invalidate = useThree((s) => s.invalidate)
  const lastScroll = useRef(0)
  useEffect(() => {
    const wake = () => {
      lastScroll.current = performance.now()
      invalidate()
    }
    document.addEventListener('scroll', wake, { capture: true, passive: true })
    // A resize reflows the live page in the COMPOSITOR's frame — the same
    // frame the browser lays out the new width, before React or a
    // ResizeObserver callback have said anything about it. The band's
    // generation gate has to be written that same frame too, or the veil
    // keeps blending a stale-generation copy for however long
    // frameloop='demand' goes without a reason to draw. Routing resize
    // through the same `wake` as scroll also buys it the glide tail below
    // — the reason frames keep flowing for the length of a drag, not just
    // at its individual resize events.
    window.addEventListener('resize', wake, { passive: true })
    document.fonts?.ready.then(() => invalidate())
    return () => {
      document.removeEventListener('scroll', wake, { capture: true })
      window.removeEventListener('resize', wake)
    }
  }, [invalidate])
  // Each frame inside the glide window asks for the next one, so the
  // window tracks the scroll at vsync instead of at event cadence.
  useFrame(() => {
    if (performance.now() - lastScroll.current < GLIDE_MS) invalidate()
  })
  return null
}

// ── the band: copy and horizontal passes offscreen, then the quad ───────

interface BandProps {
  painted: boolean
  content: { w: number; h: number }
  scroller: React.RefObject<HTMLDivElement | null>
  slab: React.RefObject<HTMLDivElement | null>
  /** The live twin's root — read synchronously in useFrame for the
   *  generation gate (see the useFrame comment below). Different purpose
   *  from `content`: that's this component's last-committed React state,
   *  which during a drag trails what `sheet` measures right now. */
  sheet: React.RefObject<HTMLDivElement | null>
}

function makeRt(w: number, h: number) {
  // HalfFloat linear, mipmapped on write: the mips are what turn the
  // 13-tap comb into a gaussian at every density (veilLod), and
  // averaging is only honest in linear premultiplied.
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  })
}


function VeilBand({ painted, content, scroller, slab, sheet }: BandProps) {
  const texture = useSurfaceTexture()
  const paintedSize = useSurfacePaintedSize()
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const dpr = gl.getPixelRatio()

  const strip = veilStrip(WINDOW_H, VEIL_DEFAULTS)

  const rts = useMemo(() => {
    const w = Math.ceil(size.width * dpr)
    const h = Math.ceil(strip.height * dpr)
    return { window: makeRt(w, h), strip: makeRt(w, h) }
  }, [size.width, strip.height, dpr])
  useEffect(
    () => () => {
      rts.window.dispose()
      rts.strip.dispose()
    },
    [rts],
  )

  // The offscreen passes: one clip-space quad each, no camera worth
  // naming.
  const passes = useMemo(() => {
    const make = (frag: string, uniforms: Record<string, THREE.IUniform>) => {
      const scene = new THREE.Scene()
      const material = new THREE.ShaderMaterial({
        vertexShader: VEIL_QUAD_VERT,
        fragmentShader: frag,
        uniforms,
      })
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
      quad.frustumCulled = false
      scene.add(quad)
      return { scene, material }
    }
    return {
      copy: make(VEIL_COPY_FRAG, {
        tMap: { value: null },
        uContent: { value: new THREE.Vector2(1, 1) },
        uStrip: { value: new THREE.Vector2(0, 1) },
        uSize: { value: new THREE.Vector2(1, 1) },
        uWindow: { value: 0 },
      }),
      blur: make(VEIL_PASS_FRAG, {
        tWin: { value: null },
        uStrip: { value: new THREE.Vector2(0, 1) },
        uSize: { value: new THREE.Vector2(1, 1) },
        uDpr: { value: 1 },
        uBand: { value: new THREE.Vector2(0, BAND_H) },
        uMaxR: { value: VEIL_DEFAULTS.maxRadius },
        uCurve: { value: VEIL_DEFAULTS.curve },
      }),
      camera: new THREE.Camera(),
    }
  }, [])
  useEffect(
    () => () => {
      passes.copy.material.dispose()
      passes.blur.material.dispose()
    },
    [passes],
  )

  const bandUniforms = useMemo(
    () => ({
      tBlur: textureSlot(),
      uStrip: { value: new THREE.Vector2(0, 1) },
      uSize: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: 1 },
      uBand: { value: new THREE.Vector2(0, BAND_H) },
      uMaxR: { value: VEIL_DEFAULTS.maxRadius },
      uCurve: { value: VEIL_DEFAULTS.curve },
      uFade: { value: VEIL_DEFAULTS.fade },
      uGate: { value: 0 },
    }),
    [],
  )
  const bandMat = useRef<THREE.ShaderMaterial>(null)
  // The frame this band's copy last started agreeing with the live
  // page's own layout generation — null while they disagree. Re-stamped
  // every time a mismatch resolves, so a second resize mid-return
  // restarts the ramp from 0 instead of continuing one that no longer
  // applies to the box now live.
  const matchedSinceRef = useRef<number | null>(null)

  useFrame(() => {
    const el = scroller.current
    const st = el?.scrollTop ?? 0
    const viewH = el?.clientHeight ?? 0
    // The window's article row, snapped to the device grid (a
    // fractional offset puts every texel between two sample points and
    // the band shimmers). Clamped inside the sheet: the slab is an
    // absolutely positioned, transformed box, and one hanging past the
    // article's end would EXTEND the scroller — more room to scroll,
    // a longer slab, forever. The clamp only engages inside the
    // article's blank tail padding, where a shifted window is over
    // empty rows.
    const ty = Math.max(
      0,
      Math.min(Math.round((st + viewH - BAND_H) * dpr) / dpr, content.h - WINDOW_H),
    )
    if (slab.current) slab.current.style.transform = `translate3d(0, ${ty}px, 0)`
    if (!texture || !painted) return

    // The generation gate. During a horizontal resize the live page
    // reflows on the browser's own layout clock; the capture feeding this
    // band's texture delivers on a separate, delayed one (React state ->
    // source.setSize -> requestPaint -> compositor onpaint -> GL upload).
    // Blending the two at partial alpha while they disagree reads as text
    // doubled at a horizontal offset — measured by the veil-resize probe
    // at 2.6-3.0x the noise floor on every mid-drag frame (2026-08-08;
    // the probe was removed 2026-08-15, the number stands).
    //
    // `content` is this component's own last-committed dims — during a
    // drag that is a commit BEHIND the live page, because the resize
    // observer's callback and this frame both race the same rAF. Reading
    // `sheet.current`'s offsetWidth/Height right here, synchronously, is
    // the freshest truth the live page has. The copy is only ever as
    // current as its OWN last completed paint — `paintedSize()`, not the
    // Surface's `size()` — which is whatever box the capture pipeline had
    // actually caught up to as of that paint.
    const liveW = sheet.current?.offsetWidth ?? content.w
    const liveH = sheet.current?.offsetHeight ?? content.h
    const [pw, ph] = paintedSize()
    const matched = pw > 0 && pw === liveW && ph === liveH
    const gate = stepGate(matched, matchedSinceRef)

    const cu = passes.copy.material.uniforms
    cu.tMap.value = texture
    // The box the PIXELS were replayed at, never the box the page has
    // this frame: the raster only ever holds what paintedSize() says it
    // holds, and sampling it by any other box reads the wrong texels off
    // the same texture memory. Correct at every frame regardless of the
    // gate below — the fragment shader has no idea the gate exists, only
    // the scene does.
    cu.uContent.value.set(pw, ph)
    cu.uStrip.value.set(strip.top, strip.height)
    cu.uSize.value.set(size.width, size.height)
    cu.uWindow.value = ty
    gl.setRenderTarget(rts.window)
    gl.render(passes.copy.scene, passes.camera)

    const bu = passes.blur.material.uniforms
    bu.tWin.value = rts.window.texture
    bu.uStrip.value.set(strip.top, strip.height)
    bu.uSize.value.set(size.width, size.height)
    bu.uDpr.value = dpr
    gl.setRenderTarget(rts.strip)
    gl.render(passes.blur.scene, passes.camera)
    gl.setRenderTarget(null)

    // The band's uniforms update through the MATERIAL's entries, same
    // as the pass materials above. The `uniforms` prop is only initial
    // values: r3f copies each entry into the material's own uniforms
    // object at (re)mount ("stable target reference"), so a write to
    // bandUniforms after that reaches nothing the renderer reads.
    // Writing there cost us the resize: the strip RT is recreated on
    // width change, the material kept sampling the DISPOSED old strip
    // texture — which three re-initializes as an empty texture — and
    // the band faded in honest, invisible, alpha-zero fragments
    // (observed as the veil vanishing on window resize, 2026-08-08).
    const m = bandMat.current
    if (m) {
      m.uniforms.tBlur.value = rts.strip.texture
      m.uniforms.uStrip.value.set(strip.top, strip.height)
      m.uniforms.uSize.value.set(size.width, size.height)
      m.uniforms.uDpr.value = dpr
      m.uniforms.uGate.value = gate
    }

    if (import.meta.env.DEV) {
      // Diagnostic ring log for instruments — one record per frame that
      // reached this point, so a probe can see WHICH frames ran and what
      // the gate saw on each, not just the last survivor.
      pushGateRecord(m, {
        pw, ph, liveW, liveH,
        cw: content.w, ch: content.h,
        matched, gate: Math.round(gate * 1000) / 1000,
      })
    }

    // A mismatch (or a still-closing return) must keep frames flowing:
    // the frame after a delayed capture finally lands is the frame that
    // has to notice the re-match and start the ramp, and
    // frameloop='demand' only draws again when something asks. Once the
    // gate is fully open there is nothing left to wait for and demand
    // economy resumes.
    if (gate < 1) invalidate()
  })

  return (
    <mesh visible={painted}>
      <planeGeometry args={[size.width, size.height]} />
      {/* Transparent + premultiplied (decisions.md #5): the fragment
          fades the band in from the seam, and the live page has to show
          through the faded rows — an opaque band would replace them. */}
      <shaderMaterial
        key={texture?.uuid ?? 'none'}
        ref={bandMat}
        uniforms={bandUniforms}
        vertexShader={VEIL_BAND_VERT}
        fragmentShader={VEIL_BAND_FRAG}
        toneMapped={false}
        transparent
        premultipliedAlpha
      />
    </mesh>
  )
}

// ── the page ────────────────────────────────────────────────────────────

export function VeilApp() {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const pageRef = useRef<HTMLDivElement | null>(null)
  const slabRef = useRef<HTMLDivElement | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [painted, setPainted] = useState(false)

  // The twin must be told its size: the page copy's layout is the truth,
  // and the observer keeps it true through resizes and late font loads.
  useLayoutEffect(() => {
    let frame = 0
    let observer: ResizeObserver | null = null
    const attach = () => {
      const pageSheet = document.querySelector('.veil-page .veil-sheet')
      const pageHolder = pageSheet?.parentElement
      const el =
        sheetRef.current ?? (pageHolder instanceof HTMLDivElement ? pageHolder : null)
      if (!el) {
        frame = requestAnimationFrame(attach)
        return
      }
      sheetRef.current = el
      const measure = () =>
        setDims({ w: Math.round(el.offsetWidth), h: Math.round(el.offsetHeight) })
      measure()
      observer = new ResizeObserver(measure)
      observer.observe(el)
    }
    frame = requestAnimationFrame(attach)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [])

  return (
    <div className="veil-page" ref={pageRef}>
      <Surface
        name="veil-sheet"
        canvas="veil"
        source={<VeilSheet />}
        onReady={() => setPainted(true)}
      >
        <Surface.DOM ref={sheetRef}>
          <VeilSheet />
        </Surface.DOM>

        {dims && (
          <Surface.WebGL
            placement="manual"
            frustumCulled={false}
            geometry={<planeGeometry args={[dims.w, dims.h]} />}
            material={<meshBasicMaterial transparent opacity={0} depthWrite={false} />}
          >
            <VeilBand
              painted={painted}
              content={dims}
              scroller={pageRef}
              slab={slabRef}
              sheet={sheetRef}
            />
          </Surface.WebGL>
        )}

        {/* The slab rides the scroller: the compositor moves it with the
            article around it, which is the whole hold fix. Its frame
            only chooses which article rows the window covers. */}
        <div className="veil-slab" ref={slabRef} style={{ height: WINDOW_H }}>
          <SurfaceCanvas
            pointerMode="surfaces"
            id="veil"
            gl={{ alpha: true }}
            frameloop={painted ? 'demand' : 'always'}
            dpr={[1, 2]}
            camera={{ fov: FOV, position: [0, 0, 1000] }}
            onCreated={(state) => state.gl.setClearAlpha(0)}
          >
            <PixelPerfect />
            <WakeOn />
          </SurfaceCanvas>
        </div>
      </Surface>

    </div>
  )
}
