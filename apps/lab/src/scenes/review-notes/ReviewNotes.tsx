// Review notes (`?scene=review-notes`) — a design-review thread whose
// notes stick to the thing they are about. Drag a note from the thread onto
// the teapot and it presses onto the glaze; turn the banding wheel and it
// rides along; type into it on the body; tick "Resolved" and it peels off
// and flies home to the thread.
//
// The law: a note lives where it is about, and resolving it means peeling
// it off. Each note is one retained HTML form for its whole life, so its
// text, checkbox and caret survive both trips.
//
// Ownership: this page owns content and intent; the board carries motion
// to the scene (reviewNotesBoard.ts); the presenter owns each pose
// (ReviewNotesNoteMesh.tsx); the teapot owns the wheel.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { createSurface, Surface, SurfaceCanvas, useSurfaceStatus, useSurfaceSupport, type SurfaceHandle } from '@petepetrash/munari'
import { readSurfaceFrameState } from '@petepetrash/munari/advanced'
import { DemoHost } from '../../components/DemoHost'
import { BodyFinder, Teapot, StudioLights } from './ReviewNotesTeapot'
import { NOTE_H, NOTE_W, ReviewNoteMesh } from './ReviewNotesNoteMesh'
import { createBoard, enterPhase, noteMotion, type Board } from './reviewNotesBoard'
import { bodyAt, clampAnchor, type BodyAnchor, onBody } from './reviewNotesLaw'
import './reviewNotes.css'

const FOV = 30
// The teapot model is 388 units across its belly and the real one is 194 mm.
const PX_PER_MM = 2
const SPOUT_THETA = Math.PI / 2
const LID_HEIGHT = 300

interface NoteSpec {
  id: string
  author: string
  initials: string
  time: string
  text: string
  placeholder?: string
  mention: string
  pinAt: BodyAnchor | null
  delay: number
}

const NOTES: readonly NoteSpec[] = [
  {
    id: 'spout', author: 'Mara Ilves', initials: 'MI', time: 'Tue 09:14',
    text: 'Glaze pools where the spout meets the body and drips on the pour. Thin it to 0.3 mm here.',
    mention: '@Tomás Reyes', pinAt: { theta: 1.02, s: 196 }, delay: 0.25,
  },
  {
    id: 'belly', author: 'Tomás Reyes', initials: 'TR', time: 'Tue 11:02',
    text: 'Pinholes across the belly after the glaze firing. Slow the cool through 1,000 °C.',
    mention: '@Mara Ilves', pinAt: { theta: -0.52, s: 112 }, delay: 0.6,
  },
  {
    id: 'draft', author: 'You', initials: 'YO', time: 'now',
    text: '', placeholder: 'Write a note, then drag it onto the teapot by its header.',
    mention: '@Mara Ilves', pinAt: null, delay: 0,
  },
]

interface NoteState { text: string; resolved: boolean; inScene: boolean; anchor: BodyAnchor | null }

export function ReviewNotesApp() {
  return <DemoHost className="rn-host"><ReviewNotesPage /></DemoHost>
}

function KeepDomFocus() {
  const gl = useThree(s => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const noSteal = (event: MouseEvent) => event.preventDefault()
    el.addEventListener('mousedown', noSteal)
    return () => el.removeEventListener('mousedown', noSteal)
  }, [gl])
  return null
}

/** A camera at the distance where one world unit is one CSS px at z = 0,
 *  so the page note and its flat pose in the scene share every pixel. */
function CameraRig() {
  // SAFETY: SurfaceCanvas creates a PerspectiveCamera; this canvas does not ask for an orthographic one.
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera
  const size = useThree(s => s.size)
  useFrame(() => {
    const distance = size.height / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    if (camera.fov !== FOV || camera.position.z !== distance) {
      camera.fov = FOV
      camera.position.set(0, 0, distance)
      camera.near = distance - 900
      camera.far = distance + 1200
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
    }
  })
  return null
}

/** Stands the teapot in the middle of the stage column, tipped toward the
 *  viewer so the lid and the wheel's degree ring read. */
function Stand({ stageRef, children }: { stageRef: React.RefObject<HTMLElement | null>; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null)
  const canvas = useThree(s => s.gl.domElement)
  useFrame(() => {
    const stage = stageRef.current
    if (!stage || !group.current) return
    const r = stage.getBoundingClientRect(), c = canvas.getBoundingClientRect()
    const cx = r.left + r.width / 2 - c.left - c.width / 2
    const cy = c.height / 2 - (r.top + r.height * 0.6 - c.top)
    group.current.position.set(cx, cy - 40, 0)
  })
  return <group ref={group} rotation-x={0.22}>{children}</group>
}

function bodyReadout(anchor: BodyAnchor): string {
  const fromSpout = Math.round(THREE.MathUtils.radToDeg(Math.atan2(Math.sin(SPOUT_THETA - anchor.theta), Math.cos(SPOUT_THETA - anchor.theta))))
  const below = Math.round((LID_HEIGHT - bodyAt(anchor.s).y) / PX_PER_MM)
  const side = fromSpout >= 0 ? 'left of' : 'right of'
  return `${Math.abs(fromSpout)}° ${side} the spout · ${below} mm below the lid`
}

function NoteCard({ spec, state, onText, onResolved, onGrab }: {
  spec: NoteSpec
  state: NoteState
  onText: (text: string) => void
  onResolved: (resolved: boolean) => void
  onGrab: (event: React.PointerEvent) => void
}) {
  const textId = useId()
  return (
    <article className="rn-note" data-resolved={state.resolved || undefined}>
      <header className="rn-note-head" onPointerDown={onGrab}>
        <span className="rn-avatar" aria-hidden>{spec.initials}</span>
        <span className="rn-who">{spec.author}</span>
        <time className="rn-time">{spec.time}</time>
        <span className="rn-grip" aria-hidden />
      </header>
      <label className="rn-sr" htmlFor={textId}>Note by {spec.author}</label>
      <textarea
        id={textId}
        className="rn-note-text"
        value={state.text}
        placeholder={spec.placeholder}
        rows={3}
        spellCheck={false}
        onChange={event => onText(event.target.value)}
      />
      <footer className="rn-note-foot">
        <span className="rn-mention">{spec.mention}</span>
        <label className="rn-resolve">
          <input type="checkbox" checked={state.resolved} onChange={event => onResolved(event.target.checked)} />
          Resolved
        </label>
      </footer>
    </article>
  )
}

function ReviewNotesPage() {
  const canvasId = useId()
  const supported = useSurfaceSupport()
  const board = useMemo<Board>(() => {
    const b = createBoard()
    for (const spec of NOTES) b.notes.set(spec.id, noteMotion(spec.pinAt, spec.delay))
    return b
  }, [])
  const handles = useMemo(() => new Map(NOTES.map(spec => [spec.id, createSurface(`review-${spec.id}`)] as const)), [])
  const [notes, setNotes] = useState<Record<string, NoteState>>(() => Object.fromEntries(NOTES.map(spec => [spec.id, {
    text: spec.text, resolved: false, inScene: spec.pinAt !== null, anchor: null,
  }])))
  const slots = useRef(new Map<string, HTMLDivElement>())
  const holders = useRef(new Map<string, HTMLDivElement>())
  const stageRef = useRef<HTMLElement>(null)
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const update = (id: string, change: Partial<NoteState>) => setNotes(current => ({ ...current, [id]: { ...current[id], ...change } }))

  const engine = useSurfaceStatus(handleOf(handles, 'draft')).engine
  useEffect(() => {
    // Browser probes read the board to find a note on the curved body.
    if (import.meta.env.DEV) Object.assign(window, { __reviewNotes: board })
  }, [board])
  const wheel = useWheelDegrees(board)

  const grab = (id: string, event: React.PointerEvent) => {
    const motion = board.notes.get(id)
    const surface = handles.get(id)
    if (!event.isTrusted || event.button !== 0 || !motion || !surface || motion.phase !== 'page' || !supported) return
    if (readSurfaceFrameState(surface).presentation !== 'page') return
    event.preventDefault()
    const startX = event.clientX, startY = event.clientY
    const holder = holders.current.get(id)
    const host = canvasHostRef.current
    let held = false
    const move = (e: PointerEvent) => {
      const dx = e.clientX - startX, dy = e.clientY - startY
      if (!held) {
        if (Math.hypot(dx, dy) < 5) return
        held = true
        enterPhase(motion, 'held')
        update(id, { inScene: true })
      }
      motion.dx = dx
      motion.dy = dy
      // The body is found under the note's centre, not under the hand on its header.
      const c = host?.getBoundingClientRect()
      const slot = slots.current.get(id)?.getBoundingClientRect()
      if (slot) {
        board.pointer.x = slot.left + slot.width / 2 + dx - (c?.left ?? 0)
        board.pointer.y = slot.top + slot.height / 2 + dy - (c?.top ?? 0)
      }
      if (holder && readSurfaceFrameState(surface).presentation === 'page') holder.style.translate = `${dx}px ${dy}px`
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (!held) return
      const inScene = readSurfaceFrameState(surface).presentation === 'scene'
      if (inScene && board.hit && motion.anchor) {
        motion.anchor = clampAnchor(motion.anchor, onBody(NOTE_H))
        motion.layer = ++board.landings
        enterPhase(motion, 'landing')
      } else if (inScene) {
        enterPhase(motion, 'returning')
      } else {
        // Let go before the scene took the note: it never left the page.
        motion.dx = motion.dy = 0
        enterPhase(motion, 'page')
        if (holder) holder.style.translate = ''
        update(id, { inScene: false })
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const resolve = (id: string, resolved: boolean) => {
    update(id, { resolved })
    const motion = board.notes.get(id)
    if (resolved && motion?.phase === 'stuck') enterPhase(motion, 'peeling')
  }

  // ── the turntable ──
  /** Turns the wheel the short way round until the note faces the viewer. */
  const faceNote = (id: string) => {
    const anchor = board.notes.get(id)?.anchor
    if (!anchor) return
    const spin = board.spin
    const facing = -anchor.theta
    spin.target = spin.angle + Math.atan2(Math.sin(facing - spin.angle), Math.cos(facing - spin.angle))
  }
  const spinStart = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    const spin = board.spin
    spin.target = null
    spin.dragging = true
    spin.velocity = 0
    let lastX = event.clientX, lastT = performance.now()
    const move = (e: PointerEvent) => {
      const now = performance.now()
      const d = (e.clientX - lastX) * 0.0065
      spin.angle += d
      const dt = Math.max(1, now - lastT) / 1000
      spin.velocity = spin.velocity * 0.6 + (d / dt) * 0.4
      lastX = e.clientX
      lastT = now
    }
    const up = () => {
      spin.dragging = false
      if (performance.now() - lastT > 90) spin.velocity = 0
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onBodyCount = NOTES.filter(spec => notes[spec.id].anchor !== null && !notes[spec.id].resolved).length
  const resolvedCount = NOTES.filter(spec => notes[spec.id].resolved).length

  return (
    <div className="rn-page">
      <aside className="rn-thread" aria-label="Review thread">
        <header className="rn-thread-head">
          <p className="rn-kicker">Design review 3 · 23 Nov</p>
          <h1 className="rn-thread-title">Teapot No. 7</h1>
          <p className="rn-meta">Stoneware, kaki glaze, cone 10 reduction<br />1.4 L · Ø 194 mm</p>
        </header>
        <ol className="rn-list">
          {NOTES.map(spec => {
            const state = notes[spec.id]
            const surface = handleOf(handles, spec.id)
            const card = <NoteCard spec={spec} state={state} onText={text => update(spec.id, { text })} onResolved={r => resolve(spec.id, r)} onGrab={event => grab(spec.id, event)} />
            return (
              <li key={spec.id} className="rn-item">
                <div className="rn-slot" ref={el => { if (el) slots.current.set(spec.id, el); else slots.current.delete(spec.id) }}>
                  <button
                    type="button"
                    className="rn-placeholder"
                    hidden={!state.anchor}
                    onClick={() => faceNote(spec.id)}
                    aria-label={`Turn the wheel to ${spec.author === 'You' ? 'your' : `${spec.author}’s`} note`}
                  >
                    <span className="rn-placeholder-dot" />
                    <span className="rn-placeholder-kicker">On the teapot</span>
                    <span className="rn-placeholder-who">{spec.author === 'You' ? 'Your note' : spec.author}</span>
                    <span className="rn-placeholder-where">{state.anchor ? bodyReadout(state.anchor) : ''}</span>
                  </button>
                  <div className="rn-holder" ref={el => { if (el) holders.current.set(spec.id, el); else holders.current.delete(spec.id) }}>
                    {supported ? (
                      <Surface.Root
                        surface={surface}
                        canvasId={canvasId}
                        inScene={state.inScene}
                        onPresentationChange={presentation => {
                          const holder = holders.current.get(spec.id)
                          if (presentation === 'scene' && holder) holder.style.translate = ''
                        }}
                      >
                        <Surface.HTML size={[NOTE_W, NOTE_H]} pageClassName="rn-note-page">{card}</Surface.HTML>
                      </Surface.Root>
                    ) : card}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
        <p className="rn-hint">
          {supported
            ? 'Drag your note onto the teapot by its header. Click a note’s place here to turn the wheel to it. Tick Resolved to peel it off.'
            : 'This browser cannot draw HTML into the scene, so the notes stay in the thread.'}
        </p>
      </aside>
      <section ref={stageRef} className="rn-stage" aria-label="Teapot on a banding wheel" onPointerDown={spinStart}>
        <div className="rn-statement">
          <h2>{statement(onBodyCount, resolvedCount)}</h2>
        </div>
        <p className="rn-readout">
          <span>Wheel {wheel}°</span>
          <span>Notes {NOTES.length}</span>
          <span>On the body {onBodyCount}</span>
          <span>Resolved {resolvedCount}</span>
          <span>{engine === 'snapdom' ? 'snapDOM · no caret on the body' : engine === 'html-in-canvas' ? 'HTML-in-canvas' : 'Page only'}</span>
        </p>
      </section>
      <div ref={canvasHostRef} className="rn-canvas">
        <SurfaceCanvas
          id={canvasId}
          pointerMode="surfaces"
          frameloop="always"
          shadows
          gl={{ alpha: true }}
          camera={{ fov: FOV, position: [0, 0, 1600] }}
          onCreated={state => state.gl.setClearAlpha(0)}
        >
          <KeepDomFocus />
          <CameraRig />
          <StudioLights />
          <Stand stageRef={stageRef}>
            <Teapot board={board} />
          </Stand>
          <BodyFinder board={board} noteWidth={NOTE_W} noteHeight={NOTE_H} />
          {NOTES.map(spec => (
            <Surface.Scene key={spec.id} surface={handleOf(handles, spec.id)}>
              <ReviewNoteMesh
                id={spec.id}
                surface={handleOf(handles, spec.id)}
                board={board}
                slotRef={{ get current() { return slots.current.get(spec.id) ?? null } }}
                onStuck={anchor => update(spec.id, { anchor })}
                onReturned={() => update(spec.id, { inScene: false, anchor: null })}
              />
            </Surface.Scene>
          ))}
        </SurfaceCanvas>
      </div>
    </div>
  )
}

function handleOf(handles: ReadonlyMap<string, SurfaceHandle>, id: string): SurfaceHandle {
  const handle = handles.get(id)
  if (!handle) throw new Error(`No Surface handle for review note "${id}"`)
  return handle
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three']
function statement(onBody: number, resolved: number): string {
  const open = `${COUNT_WORDS[onBody] ?? onBody} ${onBody === 1 ? 'note' : 'notes'} on the body`
  return resolved ? `${open}, ${COUNT_WORDS[resolved]?.toLowerCase() ?? resolved} resolved` : open
}

/** The wheel's reading at the index mark, polled a few times a second. */
function useWheelDegrees(board: Board): number {
  const [degrees, setDegrees] = useState(0)
  useEffect(() => {
    const read = () => {
      const d = Math.round(THREE.MathUtils.radToDeg(-board.spin.angle))
      setDegrees(((d % 360) + 360) % 360)
    }
    read()
    const timer = window.setInterval(read, 120)
    return () => window.clearInterval(timer)
  }, [board])
  return degrees
}
