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
// One Surface keeps two named HTML parts for the outgoing and incoming
// items. Each crossing fills the hidden part, presents both textures through
// the refraction material, then reveals the destination's retained HTML.
// The part identities stay stable while the displayed items change.
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
// the `texel` uniform. The one box that deliberately does NOT follow the
// window is the field's texel grid — see `GALLERY_REF_W` — because those
// grids live in uv and a grid that followed the viewport would make the same
// photograph open in a different order in a different window.
//
// Ownership: this module owns time, layout and the shared handle. The sheet
// is `refractionMaterial.tsx`, shape is `refractionLaw.ts`, numbers are
// `galleryTuning.ts`.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import {
  Surface,
  SurfaceCanvas,
  useSurfaceHandle,
} from '@petepetrash/munari'
import { cameraDistance } from '@petepetrash/munari/advanced'
import { showChrome } from '../../bareMode'
import { sceneUrl } from '../../captureMode'
import { apertureEdge, approachUv, refractionStage } from '../refraction/refractionLaw'
import {
  RefractionMaterial,
  type RefractionDrive,
} from '../refraction/refractionMaterial'
import { useGalleryCrossing } from './galleryCrossing'
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
      'A card is dragged off the page, flies through the scene, and ' +
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
  revision,
  box,
}: {
  item: Item
  ordinal: string
  revision: number
  box: { w: number; h: number }
}) {
  const tick = useTenthSecond()
  return (
    // Sized in style rather than by CSS: the capture root has to declare its
    // own box (docs/authoring.md), and a root that sized itself from a
    // parent would be 0x0 inside the parked source host, which has no
    // parent to inherit from.
    <div className="gallery-card" data-item={item.id} data-gallery-edit={revision} style={{ width: box.w, height: box.h }}>
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
        <a className="gallery-cta" href={sceneUrl(item.id)} target="_top">
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

export function GalleryApp() {
  const surface = useSurfaceHandle('gallery')
  const renderer = useRef<WebGPURenderer>(null)
  const { slots, p, running, pending, origin, landedAt, lifted, current, goTo, onScrub, cross } =
    useGalleryCrossing(surface, ITEMS.length, renderer)
  const drive = useRef<RefractionDrive>({ t: 0 })
  drive.current.t = origin === 0 ? p : 1 - p

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
        // both parts and re-rasterizes both cards.
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
      slots.map(({ item: index, revision }) => (
        <Card
          key={ITEMS[index].id}
          item={ITEMS[index]}
          ordinal={String(index + 1).padStart(2, '0')}
          revision={revision}
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
            disabled={running || pending}
            onChange={(e) => onScrub(Number(e.target.value))}
            aria-label="crossing position"
          />
          <span className="gallery-readout">{p.toFixed(2)}</span>
          <button
            type="button"
            className="gallery-cross"
            disabled={running || pending}
            onClick={cross}
          >
            cross
          </button>
        </div>
      </div>

      <div ref={holderRef} className="gallery-holder">
        <Surface.Root surface={surface} inScene={lifted}>
          {/* Each card carries the tenth-second clock: content that moves on its own. */}
          {([0, 1] as const).map(i => <Surface.HTML key={i} part={`item-${i}`} hidden={landedAt !== i && !(lifted && origin === i)} size={[stage.w, stage.h]} live>{cards[i]}</Surface.HTML>)}
        </Surface.Root>
      </div>

      <SurfaceCanvas
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0 }}
        gl={{ alpha: true, antialias: false, depth: false }}
        frameloop={lifted ? 'always' : 'demand'}
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => {
          state.gl.setClearAlpha(0)
          window.__r3f = state
          if (state.gl instanceof WebGPURenderer) renderer.current = state.gl
        }}
      >
        <PixelPerfect />
        {/* The gallery controls this custom subtree from its interaction
            state; each declared mesh manages its own presenter lifetime. */}
        <Surface.Scene surface={surface}>
          <group position={[stage.wx, stage.wy, 0]}>
            <Surface.Mesh
              surface={surface}
              part={`item-${origin}`}
              sampledParts={[`item-${1 - origin}`]}
              placement="manual"
              alpha="source"
              frustumCulled={false}
              raycast={leavingRay}
              geometry={<planeGeometry args={[stage.w, stage.h]} />}
              material={
                <RefractionMaterial
                  incoming={surface}
                  incomingPart={`item-${1 - origin}`}
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
              surface={surface}
              part={`item-${1 - origin}`}
              presentation="manual"
              placement="manual"
              frustumCulled={false}
              raycast={arrivingRay}
              geometry={<planeGeometry args={[stage.w, stage.h]} />}
              material={<meshBasicMaterial colorWrite={false} depthWrite={false} />}
            />
          </group>
          </Surface.Scene>
      </SurfaceCanvas>

      {showChrome && <GalleryTweaks />}
    </div>
  )
}
