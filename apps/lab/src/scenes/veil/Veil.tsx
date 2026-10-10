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
// it up. What the band draws is a COPY: useElementCapture clones the
// live article, with its computed styles inlined, into the capture's
// parked source, giving the band a texture of paint that is identical
// to the page by construction.
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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import {
  useElementCapture,
  useCaptureFrame,
  useCaptureStatus,
  type CaptureHandle,
  SurfaceCanvas,
} from '@petepetrash/munari'
import { cameraDistance } from '@petepetrash/munari/advanced'
import { VEIL_DEFAULTS, veilReturn, veilStrip } from './veilLaw'
import { createVeilBand, createVeilBlur, createVeilCopy } from './veilNodes'
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

// ── the article (rendered once; the capture parks a clone for paint) ─────

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

// The demand loop's alarm clock: a scroll moves the window, late fonts
// change the article's paint, and neither produces a frame on its own
// under frameloop='demand'. The page scrolls in its own container, and
// element scrolls never reach a window listener — the document capture
// phase is the one place that hears them all.
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
  capture: CaptureHandle
  painted: boolean
  content: { w: number; h: number }
  scroller: React.RefObject<HTMLDivElement | null>
  slab: React.RefObject<HTMLDivElement | null>
  /** The live article's root — read synchronously in useFrame for the
   *  generation gate (see the useFrame comment below). Different purpose
   *  from `content`: that's this component's last-committed React state,
   *  which during a drag trails what `sheet` measures right now. */
  sheet: React.RefObject<HTMLDivElement | null>
}

function makeRt(w: number, h: number) {
  // HalfFloat linear, mipmapped on write: the mips are what turn the
  // 13-tap comb into a gaussian at every density (veilBias in
  // veilNodes.ts), and averaging is only honest in linear premultiplied.
  return new THREE.RenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  })
}


function VeilBand({ capture, painted, content, scroller, slab, sheet }: BandProps) {
  const frames = useCaptureFrame(capture)
  const texture = frames.get()?.texture ?? null
  const paintedSize = (): readonly [number, number] => { const frame = frames.get(); return frame ? [frame.width, frame.height] : [0, 0] }
  const gl = useThree((s) => s.gl)
  // Fiber types the renderer as WebGLRenderer; SurfaceCanvas supplies a
  // WebGPURenderer, which is what takes a RenderTarget.
  if (!(gl instanceof WebGPURenderer)) throw new Error('The veil needs the WebGPURenderer from SurfaceCanvas')
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
    // The texture nodes' stand-in until the frame loop points each at its
    // real source, before any pass draws.
    const placeholder = new THREE.Texture()
    const quad = (material: THREE.Material) => {
      const scene = new THREE.Scene()
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
      mesh.frustumCulled = false
      scene.add(mesh)
      return scene
    }
    const copy = createVeilCopy(placeholder)
    const blur = createVeilBlur(placeholder)
    return {
      placeholder,
      copy: { ...copy, scene: quad(copy.material) },
      blur: { ...blur, scene: quad(blur.material) },
      band: createVeilBand(placeholder),
      // passMaterial ignores the camera, but WebGPURenderer calls
      // updateProjectionMatrix on it, which the base Camera lacks.
      camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    }
  }, [])
  useEffect(
    () => () => {
      for (const scene of [passes.copy.scene, passes.blur.scene]) {
        scene.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose()
        })
      }
      passes.copy.material.dispose()
      passes.blur.material.dispose()
      passes.band.material.dispose()
      passes.placeholder.dispose()
    },
    [passes],
  )
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
    // band's texture delivers on a separate, delayed one (resize observer
    // -> source.setSize -> requestPaint -> compositor onpaint -> texture
    // upload).
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
    // capture's requested size — which is whatever box the capture
    // pipeline had actually caught up to as of that paint.
    const liveW = sheet.current?.offsetWidth ?? content.w
    const liveH = sheet.current?.offsetHeight ?? content.h
    const [pw, ph] = paintedSize()
    const matched = pw > 0 && pw === liveW && ph === liveH
    const gate = stepGate(matched, matchedSinceRef)

    const cu = passes.copy
    cu.map.value = texture
    // The box the PIXELS were replayed at, never the box the page has
    // this frame: the raster only ever holds what paintedSize() says it
    // holds, and sampling it by any other box reads the wrong texels off
    // the same texture memory. Correct at every frame regardless of the
    // gate below — the fragment shader has no idea the gate exists, only
    // the scene does.
    cu.content.value.set(pw, ph)
    cu.strip.value.set(strip.top, strip.height)
    cu.size.value.set(size.width, size.height)
    cu.windowY.value = ty
    gl.setRenderTarget(rts.window)
    gl.render(passes.copy.scene, passes.camera)

    const bu = passes.blur
    bu.map.value = rts.window.texture
    bu.profile.strip.value.set(strip.top, strip.height)
    bu.profile.size.value.set(size.width, size.height)
    bu.profile.dpr.value = dpr
    gl.setRenderTarget(rts.strip)
    gl.render(passes.blur.scene, passes.camera)
    gl.setRenderTarget(null)

    // The band samples the strip RT through a node whose value is
    // written here every frame. The strip RT is recreated on width
    // change, and a band left sampling the DISPOSED old strip texture —
    // which three re-initializes as an empty texture — fades in honest,
    // invisible, alpha-zero fragments (observed as the veil vanishing on
    // window resize, 2026-08-08).
    const band = passes.band
    band.map.value = rts.strip.texture
    band.profile.strip.value.set(strip.top, strip.height)
    band.profile.size.value.set(size.width, size.height)
    band.profile.dpr.value = dpr
    band.gate.value = gate

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
      <primitive object={passes.band.material} attach="material" />
    </mesh>
  )
}

// ── the page ────────────────────────────────────────────────────────────

export function VeilApp() {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const pageRef = useRef<HTMLDivElement | null>(null)
  const slabRef = useRef<HTMLDivElement | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const capture = useElementCapture()
  const attachSheet = useCallback((element: HTMLDivElement | null) => { sheetRef.current = element; capture.ref(element) }, [capture])
  const painted = useCaptureStatus(capture).status === 'ready'

  // The band must be told the article's size: the page's layout is the truth,
  // and the observer keeps it true through resizes and late font loads.
  useLayoutEffect(() => {
    let frame = 0
    let observer: ResizeObserver | null = null
    const attach = () => {
      const el = sheetRef.current
      if (!el) return
      const measure = () => {
        const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight)
        setDims(current => current?.w === w && current.h === h ? current : { w, h })
      }
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
      <div ref={attachSheet}><VeilSheet /></div>

        {/* The slab rides the scroller: the compositor moves it with the
            article around it, which is the whole hold fix. Its frame
            only chooses which article rows the window covers. */}
        <div className="veil-slab" ref={slabRef} style={{ height: WINDOW_H }}>
          <SurfaceCanvas
            pointerMode="surfaces"
            id="veil"
            gl={{ alpha: true, antialias: false, depth: false }}
            frameloop={painted ? 'demand' : 'always'}
            dpr={[1, 2]}
            camera={{ fov: FOV, position: [0, 0, 1000] }}
            onCreated={(state) => state.gl.setClearAlpha(0)}
          >
            <PixelPerfect />
            <WakeOn />
            {dims && <VeilBand capture={capture} painted={painted} content={dims} scroller={pageRef} slab={slabRef} sheet={sheetRef} />}
          </SurfaceCanvas>
        </div>

    </div>
  )
}
