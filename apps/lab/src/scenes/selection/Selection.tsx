// Selection — the chosen words, as a bead of glass.
//
// Select any run of text. Each selected LINE lifts off the page inside its
// own strip of glass: magnified about that strip's own centre, refracted
// and split into colour at the rim so the words at the boundary bend into
// the edge instead of being cut by it, lit from the same direction as
// every other candidate, and casting a real shadow back down onto the
// paragraph it came out of.
//
// The magnify anchors on each line's own strip — see the shader's note. A
// single welded blob magnified about a shared centroid made every word on
// every line jump the moment a new line was added. The strips' SHAPE does
// weld (a smooth-min, so multi-line selections read as one liquid body);
// only the lens centres stay per-line.
//
// The paragraph the user selects is NOT the paragraph the canvas samples.
// The capture source lives inside a parked capture canvas, so the page
// selection can never be part of the captured subtree, whatever the
// capture does or ever comes to do with an active selection. The Surface's
// page copy is parked off-flow and never selectable; the paragraph the
// user actually touches is plain DOM standing in front of it at the same
// measured width. The mesh overlays the visible one and samples the
// parked one; they agree glyph for glyph because they are the same React
// element at the same width behind the same `document.fonts.ready`.
//
// (The black strikethrough this arrangement was first blamed for —
// 2026-08-20 — turned out to be shader NaN, not the capture: see the
// pow() rule in selectionShaders.ts. The texture was clean all along.)
//
// This scene grew up on the candidates bench and graduated off it. The
// stage helpers still come from there: PixelPerfect, worldBoxOf and
// useOwnUniforms are the bench's, not this scene's, and duplicating them
// would be the fourth copy in the lab (candidates/README.md, gaps 6 and 7).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, SurfaceCanvas, useSurface, useSurfaceChrome, useSurfaceTexture } from '@petepetrash/munari'
import { textureSlot } from '../../lib/uniforms'
import { PixelPerfect, useOwnUniforms, worldBoxOf, type WorldBox } from '../candidates/candidateStage'
import { BUBBLE_FRAG, BUBBLE_VERT, LIGHT } from './selectionShaders'
import { selectionTuning } from './selectionTuning'
import { SelectionTweaks } from './selectionTweaks'
import './selection.css'

/** Client rects a selection may span before the bead stops growing. */
const MAX_RECTS = 8

/** What the page half measured, read by the scene half every frame. */
export interface BeadState {
  rects: THREE.Vector4[]
  count: number
  /** √(selection area), px — the size cue the optics scale by. */
  len: number
  /** Area-weighted centre of the selection, content px. */
  cx: number
  cy: number
  /** The pointer, in content px — the cursor light's position. */
  light: THREE.Vector2
  /** 1 while a selection exists, eased toward 0 when it collapses. */
  on: number
  target: number
}

function BubbleMaterial({ bead }: { bead: React.RefObject<BeadState> }) {
  const texture = useSurfaceTexture()
  const { width, height } = useSurfaceChrome()
  const uniforms = useMemo(
    () => ({
      tMap: textureSlot(),
      uSize: { value: new THREE.Vector2(1, 1) },
      uT: { value: 0 },
      uRects: { value: Array.from({ length: MAX_RECTS }, () => new THREE.Vector4()) },
      uRectCount: { value: 0 },
      // Line boxes are square; the bead is not. The corner radius is half a
      // line height, which is what turns a run of rectangles into something
      // that could hold a liquid.
      uCorner: { value: selectionTuning.corner },
      uEdge: { value: selectionTuning.edge },
      uHeight: { value: selectionTuning.height },
      uWeld: { value: selectionTuning.weld },
      uCaustic: { value: selectionTuning.caustic },
      // 0.06 = the words under a strip sit ~6% closer to its centre than
      // the page put them. Past ~0.12 the strip stops agreeing with the
      // line it came from and the eye reads two texts.
      uMagnify: { value: selectionTuning.magnify },
      uRefract: { value: selectionTuning.refract },
      uIor: { value: selectionTuning.ior },
      // How far apart red and blue leave the rim, as a fraction of the
      // bend. 0.16 of a 6.5px bend is about a pixel of fringe — the width
      // at which the eye calls it glass rather than a printing error.
      uDisperse: { value: selectionTuning.disperse },
      uFrost: { value: selectionTuning.frost },
      uShadowOffset: { value: new THREE.Vector2(selectionTuning.shadowX, selectionTuning.shadowY) },
      uShadowSoft: { value: selectionTuning.shadowSoft },
      uShadowAlpha: { value: selectionTuning.shadowAlpha },
      uLightDir: { value: new THREE.Vector3(...LIGHT) },
      uLightPos: { value: new THREE.Vector3() },
      uFollow: { value: selectionTuning.follow },
      // A cold body, because the paper is warm. Tinting toward the page's
      // own hue would make the glass disappear into it.
      uTint: { value: new THREE.Color('#7cc0ff') },
      uTintGain: { value: selectionTuning.tintGain },
      uReflect: { value: selectionTuning.reflect },
      // Top-of-strip brightening and bottom-of-strip shading, as a
      // fraction. This is the term that gives a strip thickness — without
      // it the body is evenly tinted and reads as a coloured highlighter.
      uDepth: { value: selectionTuning.depth },
      uSpec: { value: selectionTuning.spec },
      uSpecPow: { value: selectionTuning.specPow },
      uSpecOp: { value: selectionTuning.specOpacity },
      uSheenPow: { value: selectionTuning.sheenPow },
      uSheenOp: { value: selectionTuning.sheenOpacity },
      uRimPow: { value: selectionTuning.rimPow },
      // The broad sheen across the whole top. Kept well under the tight
      // specular: raise it and the glass turns to frosted plastic.
      uSheen: { value: selectionTuning.sheen },
      uRim: { value: selectionTuning.rim },
    }),
    [],
  )
  uniforms.tMap.value = texture
  const material = useOwnUniforms(uniforms)
  uniforms.uSize.value.set(width, height)

  useFrame((_, delta) => {
    const b = bead.current
    // One time constant for growing and shrinking, so a bead that is
    // re-dragged mid-fade never snaps.
    const k = 1 - Math.exp(-Math.min(delta, 1 / 30) / 0.055)
    b.on += (b.target - b.on) * k
    uniforms.uT.value = b.on
    uniforms.uRectCount.value = b.count
    for (let i = 0; i < MAX_RECTS; i++) uniforms.uRects.value[i].copy(b.rects[i])
    const k2 = selectionTuning
    uniforms.uCorner.value = k2.corner
    uniforms.uEdge.value = k2.edge
    uniforms.uHeight.value = k2.height
    uniforms.uWeld.value = k2.weld
    uniforms.uCaustic.value = k2.caustic
    uniforms.uMagnify.value = k2.magnify
    // Bend follows body size: a bend that reads as glass on a
    // paragraph-sized body folds a single thin line into ringing, because
    // a thin strip is all rim. Saturates at the tuned value once the body
    // reaches bodyPx. The shadow throw below rides the same law.
    //
    // But √area is the size of the WHOLE selection, and that is only a
    // size cue to the degree the strips are one body. Unwelded, each line
    // is its own bead that knows nothing of its neighbours — this file's
    // founding law — so the total area says nothing about any single
    // strip, and adding a line below must not change how the line above
    // bends. So the area law fades in with the weld: at weld 0 the bend
    // and the throw are the tuned values whole, at weldFull they scale.
    const weldK = Math.min(k2.weld / Math.max(k2.weldFull, 1e-3), 1)
    const areaK = Math.min(b.len / Math.max(k2.bodyPx, 1), 1)
    const bodyK = 1 - weldK * (1 - areaK)
    uniforms.uRefract.value = k2.refract * bodyK
    uniforms.uIor.value = k2.ior
    uniforms.uDisperse.value = k2.disperse
    uniforms.uFrost.value = k2.frost
    // The shadow's throw is similar triangles from the point light: a body
    // of height H under a light lightZ above the page lands its rim
    // H·d/lightZ away, so the shadow tucks under the glass when the cursor
    // is overhead and stretches as the light goes grazing. Capped at 3H —
    // past ~70° incidence a real room also dims the light, which the shade
    // alpha does not model, and an undimmed 30px-flung shadow reads as
    // detached. The same √area law that scales the bend scales the throw:
    // a thin line is a thin lens and throws like one. follow blends toward
    // the static knob pair, which is the throw at follow 0.
    const dx = b.cx - b.light.x
    const dy = b.cy - b.light.y
    const dl = Math.hypot(dx, dy) || 1
    const mag = Math.min((dl / Math.max(k2.lightZ, 1)) * k2.height, 3 * k2.height)
    uniforms.uShadowOffset.value.set(
      (k2.shadowX * (1 - k2.follow) + (dx / dl) * mag * k2.follow) * bodyK,
      (k2.shadowY * (1 - k2.follow) + (dy / dl) * mag * k2.follow) * bodyK,
    )
    uniforms.uShadowSoft.value = k2.shadowSoft
    uniforms.uShadowAlpha.value = k2.shadowAlpha
    uniforms.uTintGain.value = k2.tintGain
    uniforms.uReflect.value = k2.reflect
    uniforms.uDepth.value = k2.depth
    uniforms.uSpec.value = k2.spec
    uniforms.uSpecPow.value = k2.specPow
    uniforms.uSpecOp.value = k2.specOpacity
    uniforms.uSheen.value = k2.sheen
    uniforms.uSheenPow.value = k2.sheenPow
    uniforms.uSheenOp.value = k2.sheenOpacity
    uniforms.uRim.value = k2.rim
    uniforms.uRimPow.value = k2.rimPow
    uniforms.uLightPos.value.set(b.light.x, b.light.y, k2.lightZ)
    uniforms.uFollow.value = k2.follow
    const az = (k2.lightAz * Math.PI) / 180
    const el = (k2.lightEl * Math.PI) / 180
    uniforms.uLightDir.value.set(
      Math.cos(el) * Math.cos(az),
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
    )
  })

  return (
    <shaderMaterial
      ref={material}
      key={texture.uuid}
      uniforms={uniforms}
      vertexShader={BUBBLE_VERT}
      fragmentShader={BUBBLE_FRAG}
      transparent
      premultipliedAlpha
      depthWrite={false}
      toneMapped={false}
    />
  )
}

// Two flowing paragraphs, not hand-broken lines: the strips are per LINE
// BOX, so the scene has to produce line boxes the author did not choose in
// order to show that a selection dragged through four of them leaves the
// first three exactly where they were.
const PROSE = [
  'Anyone who uses a properly designed object feels the presence of an artist who has worked for him, bettering his living conditions and encouraging him to develop his taste and sense of beauty.',
  'The designer of today re-establishes the long-lost contact between art and the public, between living people and art as a living thing. Instead of pictures for the drawing-room, electric gadgets for the kitchen. There should be no such thing as art divorced from life.',
]

function SelectionPage() {
  const surface = useSurface('selection-prose')
  const holder = useRef<HTMLDivElement>(null)
  const live = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<[number, number] | null>(null)
  const [box, setBox] = useState<WorldBox | null>(null)
  const bead = useRef<BeadState>({
    rects: Array.from({ length: MAX_RECTS }, () => new THREE.Vector4()),
    count: 0,
    len: 0,
    cx: 0,
    cy: 0,
    light: new THREE.Vector2(),
    on: 0,
    target: 0,
  })

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

  // The selection is read from the page copy and expressed in the
  // paragraph's own content coordinates, which are the texture's
  // coordinates too — so nothing here has to know where on screen the
  // paragraph currently is.
  useEffect(() => {
    const read = () => {
      const b = bead.current
      const sel = document.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        b.target = 0
        return
      }
      const range = sel.getRangeAt(0)
      const el2 = live.current
      if (!el2 || !el2.contains(range.commonAncestorContainer)) {
        b.target = 0
        return
      }
      const host = el2.getBoundingClientRect()
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1)
      if (rects.length === 0) {
        b.target = 0
        return
      }
      const n = Math.min(rects.length, MAX_RECTS)
      let area = 0
      let cx = 0
      let cy = 0
      // Pad ±2 so a strip clears its glyphs' descenders — but only on the
      // edges that face the page. Adjacent line boxes tile exactly, and
      // padding interior seams overlapped every pair of strips by 4px:
      // overlapping boxes are one connected body under any union, so the
      // lines stayed welded with the weld knob at zero (2026-08-21).
      let prevRawBot = -1e9
      let prevBot = 0
      for (let i = 0; i < n; i++) {
        const r = rects[i]
        const rawTop = r.top - host.top
        const rawBot = rawTop + r.height
        const top = rawTop - prevRawBot < 1 ? prevBot : rawTop - 2
        const nextTop = i + 1 < n ? rects[i + 1].top - host.top : 1e9
        const bot = nextTop - rawBot < 1 ? rawBot : rawBot + 2
        b.rects[i].set(r.left - host.left - 2, top, r.width + 4, bot - top)
        prevRawBot = rawBot
        prevBot = bot
        const a = b.rects[i].z * b.rects[i].w
        area += a
        cx += (b.rects[i].x + b.rects[i].z / 2) * a
        cy += (b.rects[i].y + b.rects[i].w / 2) * a
      }
      b.count = n
      b.len = Math.sqrt(area)
      b.cx = cx / Math.max(area, 1)
      b.cy = cy / Math.max(area, 1)
      b.target = 1
    }
    document.addEventListener('selectionchange', read)
    return () => document.removeEventListener('selectionchange', read)
  }, [])

  // The cursor light, in the paragraph's content coordinates — the same
  // space the rects are in, so the shader needs no transform of its own.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const el = live.current
      if (!el) return
      const r = el.getBoundingClientRect()
      bead.current.light.set(e.clientX - r.left, e.clientY - r.top)
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [])

  const prose = (
    <div className="sel-prose">
      <h2>Design as Art</h2>
      {PROSE.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  )

  return (
    <div className="sel-page">
      <div ref={holder} className="sel-prose-holder">
        {/* The copy the user reads and selects. Plain DOM, outside the
            Surface, so its selection can never reach the capture. */}
        <div ref={live}>{prose}</div>
        {size ? (
          <Surface
            surface={surface}
            size={size}
            // Pinned at the tier ladder's top: always-sharp interior text
            // up to 300% zoom on a 2x display, no re-rasterize hitch when
            // the zoom crosses a tier boundary. The 4096px long-edge guard
            // would allow ~7.9 on this 520px-wide block.
            resolution={6}
            source={prose}
          >
            {/* The capture source: identical, parked, never selected. The
                width is pinned to the live copy's measurement so both wrap
                on the same words. */}
            <div className="sel-prose-park" style={{ width: size[0] }} aria-hidden>
              <Surface.DOM>{prose}</Surface.DOM>
            </div>
            {box && (
              <Surface.WebGL
                placement="manual"
                alpha="source"
                frustumCulled={false}
                position={[box.x, box.y, 0]}
                // One flat quad. The bump is optics computed in the
                // fragment, not displaced geometry — a lifted mesh makes the
                // screen→content mapping piecewise-projective, and the
                // silhouette steps at every quad seam no matter how fine the
                // tessellation (3px quads still stepped ~2px, 2026-08-21).
                geometry={<planeGeometry args={[size[0], size[1]]} />}
                material={<BubbleMaterial bead={bead} />}
                pointerEvents="none"
              />
            )}
          </Surface>
        ) : null}
      </div>
    </div>
  )
}

// Frameloop is 'always': the bead has its own clock and the scene does not
// claim demand, so it gives up the zero-paint property the gated scenes
// hold. A presenter-scoped animation claim is the missing piece
// (candidates/README.md, gap 9).
export function SelectionApp() {
  return (
    <div className="sel-app">
      <SelectionPage />

      <SurfaceCanvas
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0, zIndex: 40 }}
        gl={{ alpha: true, antialias: true }}
        // No dpr clamp: PixelPerfect owns render density and follows the
        // live devicePixelRatio, browser zoom included.
        camera={{ fov: 42, position: [0, 0, 1000] }}
        onCreated={(state) => {
          // The page under the canvas IS the background; a cleared opaque
          // frame would hide the paragraph the bead is drawn over.
          state.gl.setClearAlpha(0)
          window.__r3f = state
        }}
      >
        <PixelPerfect />
      </SurfaceCanvas>

      <SelectionTweaks />
    </div>
  )
}
