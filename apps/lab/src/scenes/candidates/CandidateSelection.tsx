// Candidate 2 — the selection, as a bead of glass.
//
// Select any run of text. Each selected LINE lifts off the page inside its
// own strip of glass: magnified about that strip's own centre, refracted
// and split into colour at the rim so the words at the boundary bend into
// the edge instead of being cut by it, lit from the same direction as
// every other candidate, and casting a real shadow back down onto the
// paragraph it came out of.
//
// One strip per line, independent, is not a stylistic choice — see the
// shader's own note. A single welded blob magnified about a shared
// centroid made every word on every line jump the moment a new line was
// added to the selection.
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
// pow() rule in candidateShaders.ts. The texture was clean all along.)

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, useSurface, useSurfaceChrome, useSurfaceTexture } from '@petepetrash/munari'
import { textureSlot } from '../../lib/uniforms'
import { BUBBLE_FRAG, BUBBLE_VERT, LIGHT } from './candidateShaders'
import { useOwnUniforms, worldBoxOf, type WorldBox } from './candidateStage'
import { selectionTuning } from './candidateTuning'

/** Client rects a selection may span before the bead stops growing. */
const MAX_RECTS = 8

/** What the page half measured, read by the scene half every frame. */
export interface BeadState {
  rects: THREE.Vector4[]
  count: number
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
      // 0.06 = the words under a strip sit ~6% closer to its centre than
      // the page put them. Past ~0.12 the strip stops agreeing with the
      // line it came from and the eye reads two texts.
      uMagnify: { value: selectionTuning.magnify },
      uRefract: { value: selectionTuning.refract },
      // How far apart red and blue leave the rim, as a fraction of the
      // bend. 0.16 of a 6.5px bend is about a pixel of fringe — the width
      // at which the eye calls it glass rather than a printing error.
      uDisperse: { value: selectionTuning.disperse },
      uShadowOffset: { value: new THREE.Vector2(selectionTuning.shadowX, selectionTuning.shadowY) },
      uShadowSoft: { value: selectionTuning.shadowSoft },
      uShadowAlpha: { value: selectionTuning.shadowAlpha },
      uLightDir: { value: new THREE.Vector3(...LIGHT) },
      // A cold body, because the paper is warm. Tinting toward the page's
      // own hue would make the glass disappear into it.
      uTint: { value: new THREE.Color('#7cc0ff') },
      uTintGain: { value: selectionTuning.tintGain },
      // Top-of-strip brightening and bottom-of-strip shading, as a
      // fraction. This is the term that gives a strip thickness — without
      // it the body is evenly tinted and reads as a coloured highlighter.
      uDepth: { value: selectionTuning.depth },
      uSpec: { value: selectionTuning.spec },
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
    uniforms.uMagnify.value = k2.magnify
    uniforms.uRefract.value = k2.refract
    uniforms.uDisperse.value = k2.disperse
    uniforms.uShadowOffset.value.set(k2.shadowX, k2.shadowY)
    uniforms.uShadowSoft.value = k2.shadowSoft
    uniforms.uShadowAlpha.value = k2.shadowAlpha
    uniforms.uTintGain.value = k2.tintGain
    uniforms.uDepth.value = k2.depth
    uniforms.uSpec.value = k2.spec
    uniforms.uSheen.value = k2.sheen
    uniforms.uRim.value = k2.rim
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
  'A designer is a planner with an aesthetic sense. What he plans has a function, and the function is what gives the object its form. There is no such thing as decoration that is added afterwards and improves anything.',
  'Complicating is easy, simplifying is difficult. To complicate, add whatever you like: colours, shapes, ornament. Everyone is capable of complicating. Very few are capable of simplifying.',
]

export function CandidateSelection() {
  const surface = useSurface({ name: 'selection-prose' })
  const holder = useRef<HTMLDivElement>(null)
  const live = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<[number, number] | null>(null)
  const [box, setBox] = useState<WorldBox | null>(null)
  const bead = useRef<BeadState>({
    rects: Array.from({ length: MAX_RECTS }, () => new THREE.Vector4()),
    count: 0,
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
      for (let i = 0; i < n; i++) {
        const r = rects[i]
        // Line boxes are tighter than the glyphs they hold; a strip has to
        // clear the descenders or a selected 'g' pokes out of its own glass.
        b.rects[i].set(r.left - host.left - 2, r.top - host.top - 2, r.width + 4, r.height + 4)
      }
      b.count = n
      b.target = 1
    }
    document.addEventListener('selectionchange', read)
    return () => document.removeEventListener('selectionchange', read)
  }, [])

  const prose = (
    <div className="cand-prose">
      <h2>Design as Art</h2>
      {PROSE.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <p className="cand-prose__note">
        Drag across any of it. The page keeps the paragraph; the bead is the
        only thing the canvas draws.
      </p>
    </div>
  )

  return (
    <div className="cand-page cand-page--center">
      <div ref={holder} className="cand-prose-holder">
        {/* The copy the user reads and selects. Plain DOM, outside the
            Surface, so its selection can never reach the capture. */}
        <div ref={live}>{prose}</div>
        {size ? (
          <Surface
            surface={surface}
            size={size}
            // The bead magnifies. Without the extra texels the words inside
            // it arrive as the page's own raster stretched, which is the
            // exact failure the optics bench exists to name.
            resolution={2.2}
            source={prose}
          >
            {/* The capture source: identical, parked, never selected. The
                width is pinned to the live copy's measurement so both wrap
                on the same words. */}
            <div className="cand-prose-park" style={{ width: size[0] }} aria-hidden>
              <Surface.DOM>{prose}</Surface.DOM>
            </div>
            {box && (
              <Surface.WebGL
                placement="manual"
                alpha="source"
                frustumCulled={false}
                position={[box.x, box.y, 0]}
                // The mesh covers the whole paragraph and draws almost none
                // of it: everything outside the bead's skirt is discarded.
                // 96×64 is the bead's resolution, not the paragraph's — the
                // arc at the rim needs a vertex every ~4px to stay round.
                geometry={<planeGeometry args={[size[0], size[1], 96, 64]} />}
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
