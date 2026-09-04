// The gallery scene — the refraction crossing, over photographs instead of
// a page, and between five items instead of two.
//
// The law: the item you are leaving decides WHERE a drop of glass opens,
// and the item you are arriving at is seen through that drop. Same law as
// the refraction scene. What changes is what the leaving item's field is
// measuring, because a photograph is not ink: read as darkness a photo is
// dark nearly everywhere, the field saturates, and the whole image opens in
// one step. `galleryTuning.apertureDetail` is 1 here, which reads how BUSY
// each patch is instead — a photo's detailed regions open first and its
// flat ones last, the way a page's marks open before its margins.
//
// Two Surfaces for five items, and this is the part worth reading. A
// crossing needs exactly two live documents, so the scene keeps two handles
// and moves items THROUGH them: whichever handle is presented holds the
// item you are looking at, and the other one — a resident source, drawn by
// nothing — already holds the item you are about to cross to. Landing
// leaves the handles where they are and reloads the far one. Nothing is
// ever normalised, so the scrub never snaps under a finger and neither
// handle changes role mid-crossing.
//
// The fault it presses on: a gallery is the case where "just crossfade two
// screenshots" is most tempting and most wrong. The arriving item here has
// a live layout the whole way across — its clock is running, its CTA is a
// real anchor, and the moment the crossing lands you can click it. A
// framebuffer copy could not produce this picture even in principle,
// because the arriving item is drawn nowhere to copy from.
//
// Full screen, and that is not only a layout choice. The stage is the
// viewport, so it resizes, and every place the old fixed stage box was a
// constant is now a measurement: the Surface's size, the plane's size, and
// `uTexel`. The one box that deliberately does NOT follow the window is the
// field's texel grid — see `GALLERY_REF_W` — because those grids live in uv
// and a grid that followed the viewport would make the same photograph open
// in a different order in a different window.
//
// Ownership: this module owns time, layout and the two handles. The sheet
// is `refractionMaterial.tsx`, shape is `refractionLaw.ts`, numbers are
// `galleryTuning.ts`.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Surface,
  SurfaceCanvas,
  useSurfaceHandle,
} from '@petepetrash/munari'
import { cameraDistance } from '@petepetrash/munari/advanced'
import { showChrome } from '../../bareMode'
import { apertureEdge, approachUv, refractionStage, springEase } from '../refraction/refractionLaw'
import {
  RefractionMaterial,
  type RefractionDrive,
} from '../refraction/refractionMaterial'
import { GalleryTweaks } from './GalleryTweaks'
import { galleryTuning as tune, GALLERY_REF_H, GALLERY_REF_W } from './galleryTuning'
import './gallery.css'

const FOV = 42

// ── the items ──────────────────────────────────────────────────────────

interface Item {
  /** Also the scene the CTA links to, and the thumbnail's filename. */
  id: string
  eyebrow: string
  title: string
  blurb: string
  cta: string
}

// The lab's own scenes, photographed. Real 16:9 screencaps rather than
// generated art, because the thing being tested is how the front travels
// over a photograph's actual distribution of detail — flat regions, busy
// regions, and a hard frame edge — and a gradient would have none of it.
const ITEMS: readonly Item[] = [
  {
    id: 'flight',
    eyebrow: 'drag',
    title: 'Flight',
    blurb:
      'A card is dragged off the page, flies as matter in the scene, and ' +
      'lands back into layout. The same element the whole way — nothing is ' +
      'cloned and nothing is screenshotted.',
    cta: 'Open the bench',
  },
  {
    id: 'genie',
    eyebrow: 'dock',
    title: 'Genie',
    blurb:
      'A window folds down into the dock along a curve and comes back out ' +
      'of it. The document keeps painting through the whole fold, so a ' +
      'video playing when it starts is still playing when it lands.',
    cta: 'Watch it fold',
  },
  {
    id: 'knobs',
    eyebrow: 'controls',
    title: 'Knobs',
    blurb:
      'A rail of dials and switches, each one a real form control the ' +
      'browser owns. You drag the glass and the input underneath receives ' +
      'the drag.',
    cta: 'Turn the dials',
  },
  {
    id: 'selection',
    eyebrow: 'text',
    title: 'Selection',
    blurb:
      'Selected text carries a bead of glass along with it. The selection ' +
      'is the browser’s own — highlight it with a mouse, a keyboard, or a ' +
      'double click, and the bead follows.',
    cta: 'Select something',
  },
  {
    id: 'logo',
    eyebrow: 'sketch',
    title: 'Logo',
    blurb:
      'An animated wordmark whose letters can be picked up one at a time. ' +
      'The type stays type — selectable, and still laid out by the ' +
      'browser — while it is in the air.',
    cta: 'Pick up a letter',
  },
]

// ── the shared clock ───────────────────────────────────────────────────

// One epoch for every copy of every item, so the two readouts print the
// SAME string at the same instant. Two independent counters would drift by
// a tick, and a stalled capture would be indistinguishable from ordinary
// drift — the whole liveness claim rests on them agreeing.
const EPOCH = performance.now()

function useTenthSecond(): string {
  const [, bump] = useState(0)
  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [])
  return ((performance.now() - EPOCH) / 1000).toFixed(1)
}

// ── one item ───────────────────────────────────────────────────────────

function Card({
  item,
  ordinal,
  box,
}: {
  item: Item
  ordinal: string
  box: { w: number; h: number }
}) {
  const tick = useTenthSecond()
  return (
    // Sized in style rather than by CSS: the capture root has to declare its
    // own box (docs/authoring.md), and a root that sized itself from a
    // parent would be 0x0 inside the parked source host, which has no
    // parent to inherit from.
    <div className="gallery-card" data-item={item.id} style={{ width: box.w, height: box.h }}>
      <div className="gallery-figure">
        <img src={`/thumbs/${item.id}.jpg`} alt="" draggable={false} />
      </div>

      <div className="gallery-text">
        <div className="gallery-eyebrow">
          <b>{ordinal}</b>
          <span>{item.eyebrow}</span>
        </div>
        <h3 className="gallery-title">{item.title}</h3>
        <div className="gallery-rule" />
        <p className="gallery-blurb">{item.blurb}</p>
        {/* A real anchor, and the reason it is worth having one: at the ends
            of a crossing this card is ordinary DOM, so the browser hit-tests
            this link, focuses it on Tab, and shows its href in the status
            bar. Mid-crossing it is a texture and none of that is true. */}
        <a className="gallery-cta" href={`?scene=${item.id}`}>
          {item.cta}
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 9L9 1M9 1H3M9 1v6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </a>
        <div className="gallery-foot">
          <span className="gallery-folio">munari — lab</span>
          <span className="gallery-tick">
            <i>live</i>
            {tick}s
          </span>
        </div>
      </div>
    </div>
  )
}

// ── the camera: 1 world unit = 1 CSS px ────────────────────────────────

function PixelPerfect() {
  // SAFETY: r3f types the store's camera as the base class and hands back a
  // PerspectiveCamera unless the Canvas asks for `orthographic`, which this
  // one does not — fitting the frustum to the viewport is what makes a CSS
  // pixel a world unit, and orthographic has no fov to fit.
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

// ── the page ───────────────────────────────────────────────────────────

type Slot = 0 | 1

export function GalleryApp() {
  const surfaceA = useSurfaceHandle('gallery-a')
  const surfaceB = useSurfaceHandle('gallery-b')
  const handles = useMemo(() => [surfaceA, surfaceB] as const, [surfaceA, surfaceB])

  /** Which item each handle is holding. */
  const [slots, setSlots] = useState<[number, number]>([0, 1])
  const [p, setP] = useState(0)
  const [running, setRunning] = useState(false)

  /**
   * Which handle the current crossing started from — the one the mesh is
   * drawing, and the one whose field decides where the drop opens.
   *
   * State and not a ref, because the mesh's `surface` prop is derived from
   * it. It is written only while the crossing is landed, so the handle
   * cannot change role in the middle of one; a mesh whose Surface swapped
   * mid-flight would hand the sheet back for a frame.
   */
  const [origin, setOrigin] = useState<Slot>(0)

  const drive = useRef<RefractionDrive>({ t: 0 })

  // Which handle the compositor is holding, if either. At both ends of the
  // crossing one of them is ordinary DOM — selectable, focusable, and
  // hit-tested — and the other is a resident source. In between the answer
  // is NEITHER: the mesh owns the sheet and both items feed it by handle.
  const landedAt: Slot | null = running ? null : p === 0 ? 0 : p === 1 ? 1 : null
  const lifted = landedAt === null

  // The scrub reads 0 at the handle the crossing started from, whichever
  // that is, so the law never has to know which way round the pair is.
  drive.current.t = origin === 0 ? p : 1 - p

  const current = landedAt === null ? null : slots[landedAt]

  // Whatever is not being looked at gets loaded with the next item in the
  // sequence, so a crossing can start on the very next frame. It is a
  // resident source at that moment — no mesh drawing it, no presenter — so
  // swapping an <img> in it is invisible.
  useEffect(() => {
    if (landedAt === null) return
    setSlots((s) => {
      const want = (s[landedAt] + 1) % ITEMS.length
      if (s[1 - landedAt] === want) return s
      const next: [number, number] = [s[0], s[1]]
      next[1 - landedAt] = want
      return next
    })
  }, [landedAt])

  const goTo = useCallback(
    (item: number) => {
      if (landedAt === null || item === slots[landedAt]) return
      const far: Slot = landedAt === 0 ? 1 : 0
      setSlots((s) => {
        const next: [number, number] = [s[0], s[1]]
        next[far] = item
        return next
      })
      setOrigin(landedAt)
      // One frame between loading the far handle and starting to read it.
      // The item is a resident source and keeps painting on its own, but it
      // has only just been told what to paint, and the first thing the
      // crossing samples is that texture.
      requestAnimationFrame(() => setRunning(true))
    },
    [landedAt, slots],
  )

  // The animated crossing. Driven from `requestAnimationFrame` rather than
  // the renderer's frame because it also moves the scrub input, which is
  // page DOM — the material reads `drive.current` and never waits on React.
  useEffect(() => {
    if (!running) return
    const from = p
    const to = from < 0.5 ? 1 : 0
    const span = tune.crossingMs * Math.abs(to - from)
    const start = performance.now()
    let raf = 0
    const step = () => {
      const q = span <= 0 ? 1 : Math.min(1, (performance.now() - start) / span)
      // Eased here rather than inside the law: the law is a function of the
      // scrub, and the scrub is also a slider a hand drags. Easing it there
      // would bend the hand's own timing and move where a parked scrub sits.
      setP(from + (to - from) * springEase(q, tune.crossingSpring))
      if (q < 1) raf = requestAnimationFrame(step)
      else setRunning(false)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // Deliberately not depending on `p`: the effect reads the start value
    // once and owns `p` until it finishes. Re-running on every write would
    // restart the crossing from wherever it had got to, forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  // A hand dragging the scrub away from an end starts a crossing too, and
  // it starts from the end it left.
  const onScrub = useCallback(
    (next: number) => {
      if (landedAt !== null) setOrigin(landedAt)
      setP(next)
    },
    [landedAt],
  )

  // The stage IS the holder, and the holder is the viewport. Measured on
  // every resize rather than read off `window`, because the holder is what
  // both the Surface and the mesh are sized to and a scrollbar or a zoom
  // makes those two numbers differ.
  //
  // Seeded from the window so the very first render already carries a real
  // box: a Surface that mounts at 0x0 rasterizes an empty card, and the
  // layout effect's correction arrives a frame later.
  const holderRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
    wx: 0,
    wy: 0,
  }))
  useLayoutEffect(() => {
    const el = holderRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return
      setStage((prev) => {
        const next = {
          w: Math.round(r.width),
          h: Math.round(r.height),
          wx: r.left + r.width / 2 - window.innerWidth / 2,
          wy: window.innerHeight / 2 - (r.top + r.height / 2),
        }
        // A resize fires this a lot, and every new object here re-renders
        // both Surfaces and re-rasterizes both cards.
        return prev.w === next.w && prev.h === next.h && prev.wx === next.wx && prev.wy === next.wy
          ? prev
          : next
      })
    }
    measure()
    // On the element rather than on `window`: catches a zoom and a devtools
    // dock, which do not always fire a window resize.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Decoded once, up front. An <img> whose src has just changed paints on
  // whatever frame the decode finishes, and a crossing that started in the
  // meantime would read a blank card for its first frames — visible as the
  // drop opening over nothing.
  useEffect(() => {
    for (const item of ITEMS) {
      const img = new Image()
      img.src = `/thumbs/${item.id}.jpg`
    }
  }, [])

  const box = useMemo(() => ({ w: stage.w, h: stage.h }), [stage.w, stage.h])
  const cards = useMemo(
    () =>
      slots.map((index) => (
        <Card
          key={ITEMS[index].id}
          item={ITEMS[index]}
          ordinal={String(index + 1).padStart(2, '0')}
          box={box}
        />
      )),
    [slots, box],
  )

  // ── which item a point of the sheet is showing ─────────────────────────
  //
  // The material answers this per fragment. A pointer needs the same answer
  // at one point, on the CPU, before anything can decide which card should
  // hear it. Both halves already exist: `apertureAt` is the field the
  // fragment shader samples, read back off the GPU, and `apertureEdge` is
  // the sweeping threshold it is compared against. Past the edge the drop
  // has opened there and the point shows the arriving item.
  //
  // Two presenters and not one, because who a pointer belongs to is exactly
  // who presents it (crossingPointer, decisions.md #33). Each mesh declines
  // the ray wherever the OTHER item is the one on screen, so the two
  // partition the sheet and Munari's own relay carries the event into the
  // right subtree. The alternative — one mesh forwarding into both sources
  // by hand — means a second copy of the enter/leave bookkeeping, and the
  // copy is what drifts.
  //
  // What this deliberately gets wrong: the bend. The arriving item is
  // sampled through the drop, and the approach zoom below is the part of
  // that mapping the whole sheet shares. On top of it the shader displaces
  // each fragment by up to `refractPx` — 26 CSS px here — concentrated in
  // the meniscus, and routing ignores it. So a hover within about a
  // meniscus-width of the front can land on the neighbouring line; away
  // from the front it is exact.
  const probe = useRef<((u: number, v: number) => number) | null>(null)
  const [leavingRay, arrivingRay] = useMemo(() => {
    const route = (wantArriving: boolean): THREE.Object3D['raycast'] =>
      function (this: THREE.Mesh, raycaster, intersects) {
        const shape = refractionStage(drive.current.t, tune)
        const edge = apertureEdge(shape.transmission, tune.apertureOvershoot)
        const read = probe.current
        const hits: THREE.Intersection[] = []
        THREE.Mesh.prototype.raycast.call(this, raycaster, hits)
        for (const hit of hits) {
          if (!hit.uv) continue
          // No field yet — the first frame of a lift, before the material's
          // effect has run — means the drop has not opened anywhere, which
          // is the leaving item everywhere.
          const arriving = read !== null && read(hit.uv.x, hit.uv.y) > edge
          if (arriving !== wantArriving) continue
          if (wantArriving) {
            const [u, v] = approachUv(hit.uv.x, hit.uv.y, shape.zoom)
            hit.uv.set(u, v)
          }
          intersects.push(hit)
        }
      }
    return [route(false), route(true)] as const
  }, [])

  return (
    <div className="gallery-page">
      {/* The holder is the whole viewport and the mesh covers it, so every
          control here is an overlay above the canvas rather than a sibling
          beside the stage. All of it sits OUTSIDE the capture: the card is
          what gets rasterized, and a control drawn into the texture would
          be refracted along with the photograph. */}
      <div className="gallery-caption">
        <h2>gallery</h2>
        <p>
          Five items, one sheet. A drop of glass spreads out of the item you
          are leaving, and the item you are arriving at is what you see
          inside it. Both are live layouts the whole way across — their
          clocks agree, and the moment a crossing lands you can click the
          link on the card.
        </p>
      </div>

      <div className="gallery-hud">
        <div className="gallery-rail">
          {ITEMS.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className="gallery-pick"
              data-on={current === i || undefined}
              disabled={lifted}
              onClick={() => goTo(i)}
              aria-label={item.title}
              aria-current={current === i ? 'true' : undefined}
            >
              <img src={`/thumbs/${item.id}.jpg`} alt="" draggable={false} />
              <span>{item.title}</span>
            </button>
          ))}
        </div>

        <div className="gallery-drive">
          <span className="gallery-label">scrub</span>
          <input
            className="gallery-scrub"
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={p}
            disabled={running}
            onChange={(e) => onScrub(Number(e.target.value))}
            aria-label="crossing position"
          />
          <span className="gallery-readout">{p.toFixed(2)}</span>
          <button
            type="button"
            className="gallery-cross"
            disabled={running}
            onClick={() => {
              if (landedAt !== null) setOrigin(landedAt)
              setRunning(true)
            }}
          >
            cross
          </button>
        </div>
      </div>

      <div ref={holderRef} className="gallery-holder">
        {/* The two handles trade roles at the ends. Whichever the
            compositor is holding is exclusive and carries a
            presenter; the other has neither, which makes it a resident
            source — content and a size, composited nowhere, existing to be
            sampled. Mid-crossing the leaving one goes to `'canvas'` and the
            arriving one stays resident.

            The handle that is neither requests `'none'` rather than
            `'page'`. `'page'` is a request for the DOM to take the
            hold, and the store grants it inside a draw while React
            unmounts the holder in a later commit — which showed in the
            refraction scene as the leaving document flashing for exactly
            one frame in the middle of landing on the arriving one.

            The DOM presenter on the LEAVING handle outlives the landing it
            started from, and that is what covers the start of a lift. The
            mesh stays declared through preparation and return. Unmounting
            it on `landedAt` alone left a composited frame with no card.
            Screencast of a thumbnail click, 2026-08-24: one to three
            consecutive frames of flat page background starting about 34ms
            after the click, standard deviation over the stage exactly 0
            against a 70 median. A per-frame trace of the DOM cannot see it
            — the rAF sample straddles the commit — so the measurement is
            composited frames. Keeping the presenter mounted through the
            lift costs nothing: one whose request is `'canvas'` is not the one
            being shown. */}
        {([0, 1] as const).map((i) => (
          <Surface
            key={i}
            surface={handles[i]}
            renderIn={landedAt === i ? 'page' : lifted && origin === i ? 'canvas' : 'none'}
            timing={{ settleMs: 0, durationMs: 1 }}
            size={[stage.w, stage.h]}
            source={cards[i]}
          >
            {(landedAt === i || (lifted && origin === i)) && (
              <Surface.DOM>{cards[i]}</Surface.DOM>
            )}
          </Surface>
        ))}
      </div>

      <SurfaceCanvas
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0 }}
        gl={{ alpha: true, antialias: true }}
        frameloop={lifted ? 'always' : 'demand'}
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => {
          state.gl.setClearAlpha(0)
          window.__r3f = state
        }}
      >
        <PixelPerfect />
        {/* The gallery controls this custom subtree from its interaction
            state; each declared mesh manages its own presenter lifetime. */}
        {lifted && (
          <Surface.Scene surface={handles[origin]}>
          <group position={[stage.wx, stage.wy, 0]}>
            <Surface.Mesh
              surface={handles[origin]}
              placement="manual"
              alpha="source"
              frustumCulled={false}
              raycast={leavingRay}
              geometry={<planeGeometry args={[stage.w, stage.h]} />}
              material={
                <RefractionMaterial
                  incoming={handles[1 - origin]}
                  drive={drive}
                  tune={tune}
                  stageW={stage.w}
                  stageH={stage.h}
                  fieldW={GALLERY_REF_W}
                  fieldH={GALLERY_REF_H}
                  probe={probe}
                />
              }
            />
            {/* The arriving item's ear. The sheet above already has its
                pixels, sampled as a texture; this mesh exists only so the
                arriving source has a presenter of its own, which is what
                makes a pointer over it that source's to hear.

                An opaque material draws before the transparent sheet does,
                so both writes are turned off: `colorWrite` leaves no pixels
                and `depthWrite` leaves nothing for the sheet's own fragments
                to be tested against. */}
            <Surface.Mesh
              surface={handles[1 - origin]}
              placement="manual"
              frustumCulled={false}
              raycast={arrivingRay}
              geometry={<planeGeometry args={[stage.w, stage.h]} />}
              material={<meshBasicMaterial colorWrite={false} depthWrite={false} />}
            />
          </group>
          </Surface.Scene>
        )}
      </SurfaceCanvas>

      {showChrome && <GalleryTweaks />}
    </div>
  )
}
