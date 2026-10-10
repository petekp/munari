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
// capture does or ever comes to do with an active selection. useElementCapture
// parks a copy of the live paragraph there: a DOM clone with its computed
// styles inlined, pinned to the live paragraph's measured size. The user
// selects only the live one. The mesh overlays the live paragraph and
// samples the copy, and the two agree glyph for glyph because the copy is
// rebuilt when the paragraph's size, the page's styles or its fonts change.
//
// (The black strikethrough this arrangement was first blamed for —
// 2026-08-20 — turned out to be shader NaN, not the capture: see the
// pow() rule in selectionNodes.ts. The texture was clean all along.)
//
// This scene grew up on the candidates bench and graduated off it; its
// PixelPerfect and worldBoxOf still come from candidateStage.tsx.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SurfaceCanvas, useElementCapture, useCaptureFrame, useCaptureStatus, type CaptureHandle } from '@petepetrash/munari'
import { texture, uniform, uniformArray } from 'three/tsl'
import { FOV, PixelPerfect, worldBoxOf, type WorldBox } from '../candidates/candidateStage'
import { LIGHT, createBubbleMaterial, createGleamMaterial, type BubbleValues } from './selectionNodes'
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

interface BeadProps {
  bead: React.RefObject<BeadState>
  capture: CaptureHandle
  size: readonly [number, number]
  position: readonly [number, number, number]
  visible: boolean
}

// The bead, then its gleam over it: selectionNodes.ts says why they are two draws.
function Bead({ bead, capture, size, position, visible }: BeadProps) {
  const frames = useCaptureFrame(capture)
  // An empty sRGB texture stands in until the first frame. The node's
  // colour space decides the sampler at compile, so it must match the
  // capture's.
  const [blank] = useState(() => {
    const texture = new THREE.Texture()
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  })
  const [map] = useState(() => texture(blank))
  const values = useMemo<BubbleValues>(
    () => ({
      size: uniform(new THREE.Vector2(1, 1)),
      t: uniform(0),
      rects: uniformArray(Array.from({ length: MAX_RECTS }, () => new THREE.Vector4()), 'vec4'),
      rectCount: uniform(0, 'int'),
      // Line boxes are square; the bead is not. The corner radius is half a
      // line height, which is what turns a run of rectangles into something
      // that could hold a liquid.
      corner: uniform(selectionTuning.corner),
      edge: uniform(selectionTuning.edge),
      height: uniform(selectionTuning.height),
      weld: uniform(selectionTuning.weld),
      caustic: uniform(selectionTuning.caustic),
      // 0.03 = the words under a strip sit ~3% closer to its centre than
      // the page put them. Past ~0.12 the strip stops agreeing with the
      // line it came from and the eye reads two texts.
      magnify: uniform(selectionTuning.magnify),
      refract: uniform(selectionTuning.refract),
      ior: uniform(selectionTuning.ior),
      // Red leaves the rim at (1 − disperse) of the bend and blue at
      // (1 + disperse), so the fringe is 2·disperse of the bend wide.
      disperse: uniform(selectionTuning.disperse),
      frost: uniform(selectionTuning.frost),
      shadowOffset: uniform(new THREE.Vector2(selectionTuning.shadowX, selectionTuning.shadowY)),
      shadowSoft: uniform(selectionTuning.shadowSoft),
      shadowAlpha: uniform(selectionTuning.shadowAlpha),
      lightDir: uniform(new THREE.Vector3(...LIGHT)),
      lightPos: uniform(new THREE.Vector3()),
      follow: uniform(selectionTuning.follow),
      // A cold body, because the paper is warm. Tinting toward the page's
      // own hue would make the glass disappear into it.
      tint: uniform(new THREE.Color('#7cc0ff')),
      tintGain: uniform(selectionTuning.tintGain),
      reflect: uniform(selectionTuning.reflect),
      // Top-of-strip brightening and bottom-of-strip shading, as a
      // fraction. This is the term that gives a strip thickness — without
      // it the body is evenly tinted and reads as a coloured highlighter.
      depth: uniform(selectionTuning.depth),
      spec: uniform(selectionTuning.spec),
      specPow: uniform(selectionTuning.specPow),
      specOp: uniform(selectionTuning.specOpacity),
      sheenPow: uniform(selectionTuning.sheenPow),
      sheenOp: uniform(selectionTuning.sheenOpacity),
      rimPow: uniform(selectionTuning.rimPow),
      // The broad sheen across the whole top. Kept well under the tight
      // specular: raise it and the glass turns to frosted plastic.
      sheen: uniform(selectionTuning.sheen),
      rim: uniform(selectionTuning.rim),
    }),
    [],
  )
  const material = useMemo(() => createBubbleMaterial(map, values), [map, values])
  useEffect(() => () => material.dispose(), [material])
  const gleam = useMemo(() => createGleamMaterial(values), [values])
  useEffect(() => () => gleam.dispose(), [gleam])
  useEffect(() => () => blank.dispose(), [blank])

  useFrame((_, delta) => {
    const frame = frames.get()
    map.value = frame?.texture ?? blank
    if (frame) values.size.value.set(frame.width, frame.height)
    const b = bead.current
    // One time constant for growing and shrinking, so a bead that is
    // re-dragged mid-fade never snaps.
    const k = 1 - Math.exp(-Math.min(delta, 1 / 30) / 0.055)
    b.on += (b.target - b.on) * k
    values.t.value = b.on
    values.rectCount.value = b.count
    // SAFETY: the array was built above from MAX_RECTS Vector4s.
    const rects = values.rects.array as THREE.Vector4[]
    for (let i = 0; i < MAX_RECTS; i++) rects[i].copy(b.rects[i])
    const k2 = selectionTuning
    values.corner.value = k2.corner
    values.edge.value = k2.edge
    values.height.value = k2.height
    values.weld.value = k2.weld
    values.caustic.value = k2.caustic
    values.magnify.value = k2.magnify
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
    values.refract.value = k2.refract * bodyK
    values.ior.value = k2.ior
    values.disperse.value = k2.disperse
    values.frost.value = k2.frost
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
    values.shadowOffset.value.set(
      (k2.shadowX * (1 - k2.follow) + (dx / dl) * mag * k2.follow) * bodyK,
      (k2.shadowY * (1 - k2.follow) + (dy / dl) * mag * k2.follow) * bodyK,
    )
    values.shadowSoft.value = k2.shadowSoft
    values.shadowAlpha.value = k2.shadowAlpha
    values.tintGain.value = k2.tintGain
    values.reflect.value = k2.reflect
    values.depth.value = k2.depth
    values.spec.value = k2.spec
    values.specPow.value = k2.specPow
    values.specOp.value = k2.specOpacity
    values.sheen.value = k2.sheen
    values.sheenPow.value = k2.sheenPow
    values.sheenOp.value = k2.sheenOpacity
    values.rim.value = k2.rim
    values.rimPow.value = k2.rimPow
    values.lightPos.value.set(b.light.x, b.light.y, k2.lightZ)
    values.follow.value = k2.follow
    const az = (k2.lightAz * Math.PI) / 180
    const el = (k2.lightEl * Math.PI) / 180
    values.lightDir.value.set(
      Math.cos(el) * Math.cos(az),
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
    )
  })

  return (
    <>
      <mesh visible={visible} position={position} frustumCulled={false}>
        <planeGeometry args={size} />
        <primitive object={material} attach="material" />
      </mesh>
      <mesh visible={visible} position={position} frustumCulled={false} renderOrder={1}>
        <planeGeometry args={size} />
        <primitive object={gleam} attach="material" />
      </mesh>
    </>
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
  const capture = useElementCapture({ resolution: 6 })
  const captureStatus = useCaptureStatus(capture)
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

  // The selection is read from the live paragraph and expressed in the
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
        {/* The paragraph the user reads and selects. The capture samples a
            clone of it, so its selection can never reach the capture. */}
        <div ref={element => { live.current = element; capture.ref(element) }}>{prose}</div>

      </div>
      <SurfaceCanvas
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0, zIndex: 40 }}
        gl={{ alpha: true, antialias: false, depth: false }}
        // No dpr clamp: PixelPerfect owns render density and follows the
        // live devicePixelRatio, browser zoom included.
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => {
          // The page under the canvas IS the background; a cleared opaque
          // frame would hide the paragraph the bead is drawn over.
          state.gl.setClearAlpha(0)
          window.__r3f = state
        }}
      >
        <PixelPerfect />
        {size && box && (
          <Bead
            bead={bead}
            capture={capture}
            size={[size[0], size[1]]}
            position={[box.x, box.y, 0]}
            visible={captureStatus.status === 'ready'}
          />
        )}
      </SurfaceCanvas>
      <SelectionTweaks />
    </div>
  )
}

// Frameloop is 'always': the bead has its own clock and the scene does not
// claim demand, so it gives up the zero-paint property the gated scenes
// hold. A presenter-scoped animation claim is the missing piece.
export function SelectionApp() {
  return <div className="sel-app"><SelectionPage /></div>
}
