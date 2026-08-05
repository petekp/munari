import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Surface, useSurfaceTexture } from '@petekp/munari'
import { explodePaint, measureBleed, type Plate } from './paintPlates'

// The exploded-paint inspector — a live element taken apart into its OWN
// paint layers, laid out in CSS paint order, as matter.
//
// What is on the table: ONE `<div>` with no children at all. It has a
// shadow, a background, a border, an outline, text and a text-shadow — six
// separate things to look at, and not one of them has an element behind it.
// Every "exploded DOM" demo on the web explodes the element TREE, so at this
// div they stop: there is nothing below it to separate. Here the div comes
// apart into six sheets you can orbit around, because the decomposition is
// done in the PAINT, by rendering the same box once per feature with the
// others neutralized (see paintPlates.ts for the mechanism and the
// measurements behind each step).
//
// The live element is never touched. It sits in the page the whole time,
// selectable, restyleable, exactly as it was — the plates are clones, which
// the platform enforces rather than the code promising: only an immediate
// child of a trial canvas can be drawn (platform.md #10).
//
// The plates are laid out along Z in CSS 2.1 Appendix E order, back to
// front: box-shadow, background, border, text-shadow, glyphs, outline. Slide
// the spread to zero and they stack back into the card — the same pixels in
// the same place, which is the claim the layout is making and the collapse
// is the proof of.
//
// `window.__explode` drives everything from a console or an automation
// harness: `setSpread(0..1)`, `plates()`, `subject()`.

const PX = 260
/** Depth between neighboring plates at full spread, world units. */
const GAP = 0.42
/** The stack's center — the camera's orbit target in App.tsx. */
const CENTER_Y = 1.4

// The view that makes the point. Head-on, a stack of coplanar sheets is a
// set of concentric rectangles — the depth is real and completely invisible,
// which is the failure mode this whole scene exists to avoid. Off-axis, the
// same stack reads as sheets standing in a room. So the scene claims the
// camera on arrival (the other scenes leave it where App put it, and App's
// default is nearly head-on).
const VIEW = { distance: 6.0, azimuth: 0.92, elevation: 0.22 }

// ── the live subject, and the plates built from it ───────────────────────
//
// The specimen is page DOM (rendered by ExplodeHud) and the plates are
// scene objects, and React context does not cross the r3f reconciler
// boundary. So the two halves meet at a module-level store rather than
// through a provider. It holds exactly what the scene cannot compute for
// itself: the element, once it has been laid out and measured.

interface ExplodeSnapshot {
  subject: HTMLElement | null
  plates: Plate[]
}

let snapshot: ExplodeSnapshot = { subject: null, plates: [] }
const listeners = new Set<() => void>()

function publish(next: ExplodeSnapshot) {
  snapshot = next
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

function useExplodeSnapshot(): ExplodeSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot)
}

// Spread is a mutable cell rather than React state on purpose: it moves
// every frame while a slider is dragged, and the scene reads it inside
// useFrame. Routing it through a re-render would rebuild six Surfaces'
// props for a number only the transform cares about.
const control = { spread: 1, target: 1 }

// ── the page half ────────────────────────────────────────────────────────

/**
 * The live element, in the page, plus the controls.
 *
 * This is deliberately real page DOM and not a picture of one: it lays out
 * in normal flow, it can be selected, and it is the thing the plates are
 * clones OF. Its presence on screen while the plates float is the whole
 * "the live page is never touched" claim, stated where it can be checked.
 */
export function ExplodeHud() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [spread, setSpread] = useState(1)
  const { subject, plates } = useExplodeSnapshot()

  useEffect(() => {
    const el = hostRef.current?.querySelector<HTMLElement>('.paint-specimen')
    if (!el) return
    let live = true
    // Wait for fonts before measuring. A plate is a photograph: if the web
    // font lands after the clone, the glyph plate keeps the fallback metrics
    // and stops registering with the collapse — a mismatch that looks like a
    // math bug and is a timing one.
    void document.fonts.ready.then(() => {
      if (!live) return
      publish({ subject: el, plates: explodePaint(el) })
    })
    return () => {
      live = false
      publish({ subject: null, plates: [] })
    }
  }, [])

  return (
    <div className="explode-hud" ref={hostRef}>
      <div className="specimen-stage">
        <div className="paint-specimen">munari</div>
      </div>
      <p className="specimen-caption">
        live element — never cloned out of the page, never restyled
      </p>
      <dl className="specimen-facts">
        <div>
          <dt>children</dt>
          <dd>{subject ? subject.childElementCount : '—'}</dd>
        </div>
        <div>
          <dt>plates</dt>
          <dd>{plates.length || '—'}</dd>
        </div>
        <div>
          <dt>bleed</dt>
          <dd>{subject ? `${measureBleed(subject)}px` : '—'}</dd>
        </div>
      </dl>
      <label className="spread-control">
        <span>spread</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={spread}
          onChange={(e) => {
            const v = Number(e.target.value)
            setSpread(v)
            control.spread = v
            control.target = v
          }}
        />
      </label>
    </div>
  )
}

// ── the scene half ───────────────────────────────────────────────────────

/**
 * An unlit quad wearing one plate's capture.
 *
 * Unlit and un-tone-mapped by choice: this scene's entire job is to show
 * what the browser painted, and a light rig editorializes. It is also the
 * only correct option — decisions.md #5 puts lit standard materials on
 * partially-transparent Surfaces explicitly out of contract, and a plate is
 * mostly transparent by construction. `premultipliedAlpha` is the other half
 * of that contract: the texture arrives premultiplied because a 2D canvas's
 * backing store already is.
 */
function PlateMaterial() {
  const texture = useSurfaceTexture()
  return (
    <meshBasicMaterial
      map={texture ?? undefined}
      transparent
      premultipliedAlpha
      toneMapped={false}
      depthWrite={false}
      side={THREE.DoubleSide}
    />
  )
}

/** The faint frame that says "there is a sheet here" when the ink is sparse. */
function PlateFrame({ w, h }: { w: number; h: number }) {
  const geometry = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)), [w, h])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#7c8798" transparent opacity={0.34} toneMapped={false} />
    </lineSegments>
  )
}

function PlateSheet({ plate, index, count }: { plate: Plate; index: number; count: number }) {
  const group = useRef<THREE.Group>(null)
  const w = plate.width / PX
  const h = plate.height / PX
  // Back to front in paint order, centered on the stack.
  const rank = index - (count - 1) / 2

  useFrame(() => {
    if (!group.current) return
    group.current.position.z = rank * GAP * control.spread
  })

  return (
    <group ref={group} position={[0, CENTER_Y, rank * GAP]}>
      <Surface
        html={plate.node}
        label={`plate-${plate.feature.id}`}
        width={plate.width}
        height={plate.height}
        material="none"
        // A plate is ink and holes; the holes must let the plates behind
        // through, which is the entire picture.
        transparent
        hitTest="content"
      >
        <planeGeometry args={[w, h]} />
        <PlateMaterial />
      </Surface>
      <PlateFrame w={w} h={h} />
      {/* A placard, at its plate's own depth and offset down the stack so
       * six of them fan out instead of stacking into one illegible pile.
       * The step is in the plate's local frame, so it survives orbiting. */}
      <Surface
        html={labelMarkup(plate)}
        label={`label-${plate.feature.id}`}
        width={LABEL_W}
        height={LABEL_H}
        material="none"
        transparent
        hitTest="content"
        position={[
          w / 2 + LABEL_W / PX / 2 + 0.14,
          h / 2 - LABEL_H / PX / 2 - index * LABEL_H * 0.62 / PX,
          0,
        ]}
      >
        <planeGeometry args={[LABEL_W / PX, LABEL_H / PX]} />
        <PlateMaterial />
      </Surface>
    </group>
  )
}

const LABEL_W = 300
const LABEL_H = 96

function labelMarkup(plate: Plate): string {
  return (
    `<div class="plate-label">` +
    `<code>${plate.feature.label}</code>` +
    `<p>${plate.feature.note}</p>` +
    `</div>`
  )
}

/**
 * The light table.
 *
 * Ink is any color; a scene background is one color. Dark glyphs on a dark
 * room are a plate that reads as empty, which would be the inspector lying
 * about the most ordinary case there is. A neutral card behind the stack
 * gives every feature something to be seen against, and it is obviously
 * scene furniture rather than something the DOM painted.
 */
function LightTable({ w, h, z }: { w: number; h: number; z: number }) {
  return (
    <mesh position={[0, CENTER_Y, z]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial color="#aeb4bf" toneMapped={false} />
    </mesh>
  )
}

/**
 * Point the shared camera at the stack from an angle, once, on arrival.
 *
 * Deliberately a one-shot rather than a per-frame constraint: after this the
 * view belongs to whoever is orbiting it, and a scene that kept re-asserting
 * its opinion would fight the hand on the mouse.
 */
function ObliqueArrival() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3; update?: () => void } | null
  useEffect(() => {
    const { distance: d, azimuth: a, elevation: e } = VIEW
    camera.position.set(d * Math.cos(e) * Math.sin(a), CENTER_Y + d * Math.sin(e), d * Math.cos(e) * Math.cos(a))
    controls?.target?.set(0, CENTER_Y, 0)
    camera.lookAt(0, CENTER_Y, 0)
    controls?.update?.()
  }, [camera, controls])
  return null
}

export function Explode() {
  const { plates } = useExplodeSnapshot()

  // The console/automation seam, matching the other scenes' house style.
  useEffect(() => {
    ;(window as unknown as { __explode?: unknown }).__explode = {
      plates: () => snapshot.plates.map((p) => ({ id: p.feature.id, w: p.width, h: p.height })),
      subject: () => snapshot.subject,
      spread: () => control.spread,
      setSpread: (v: number) => {
        control.spread = Math.min(1, Math.max(0, v))
        control.target = control.spread
      },
    }
  }, [])

  if (!plates.length) return null
  const back = (0 - (plates.length - 1) / 2) * GAP
  const w = plates[0].width / PX
  const h = plates[0].height / PX

  return (
    <group>
      <ObliqueArrival />
      <LightTable w={w * 1.55} h={h * 1.45} z={back - 0.34} />
      {plates.map((plate, i) => (
        <PlateSheet key={plate.feature.id} plate={plate} index={i} count={plates.length} />
      ))}
    </group>
  )
}
