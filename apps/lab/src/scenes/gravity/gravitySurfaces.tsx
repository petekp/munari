// Gravity's Surface presentation keeps each word's React instance while the
// paragraph reflows. Physics and hit testing use the existing gravity law.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { DoubleSide, type Group } from 'three'
import { Surface, SurfaceCanvas, useSurfaceDriver, useSurfaceTexture, type SurfacePresentation } from '@petepetrash/munari'
import { boundsFromViewport, clampToBounds, hitTestBody, settleInstant, spawnBody, stepWorld, type GravityBody } from './gravityLaw'

interface WordFlight {
  body: GravityBody
  width: number
  height: number
  presented: boolean
  returning: boolean
}
interface GravitySceneState {
  flights: Map<number, WordFlight>
  wake: () => void
  held: number | null
  reduced: boolean
}

function GravityWorld({ state }: { state: GravitySceneState }) {
  const invalidate = useThree(root => root.invalidate)
  const camera = useThree(root => root.camera)
  const size = useThree(root => root.size)
  useEffect(() => {
    state.wake = invalidate
    return () => { state.wake = () => {} }
  }, [state, invalidate])
  useEffect(() => {
    if ('isOrthographicCamera' in camera) {
      Object.assign(camera, { left: 0, right: size.width, top: 0, bottom: size.height })
      camera.updateProjectionMatrix()
    }
    clampToBounds([...state.flights.values()].map(flight => flight.body), boundsFromViewport(size.width, size.height))
    invalidate()
  }, [camera, size, state, invalidate])
  useFrame((_, dt) => {
    const bodies = [...state.flights.values()].filter(flight => flight.presented && !flight.returning).map(flight => flight.body)
    if (!state.reduced) stepWorld(bodies, boundsFromViewport(size.width, size.height), dt)
    if (bodies.some(body => !body.asleep)) invalidate()
  }, -2)
  return null
}

function WordMaterial() {
  const texture = useSurfaceTexture()
  return <meshBasicMaterial map={texture} side={DoubleSide} transparent premultipliedAlpha depthTest={false} depthWrite={false} toneMapped={false} />
}

function FallingWord({ flight }: { flight: WordFlight }) {
  const group = useRef<Group>(null)
  useSurfaceDriver(({ target }) => target === 'scene' ? 1 : 0)
  useFrame(() => {
    const body = flight.body
    group.current?.position.set(body.x, body.y, 0)
    if (group.current) group.current.rotation.z = body.angle
  }, -1)
  return <group ref={group} position={[flight.body.x, flight.body.y, 0]}>
    <Surface.Mesh
      placement="manual"
      scale={[1, -1, 1]}
      alpha="source"
      pointerEvents="none"
      geometry={<planeGeometry args={[flight.width, flight.height]} />}
      material={<WordMaterial />}
    />
  </group>
}

export function GravitySurfaces({ words }: { words: readonly string[] }) {
  const state = useMemo<GravitySceneState>(() => ({ flights: new Map(), wake: () => {}, held: null, reduced: false }), [])
  const [requested, setRequested] = useState<ReadonlySet<number>>(() => new Set())
  const elements = useRef(new Map<number, HTMLSpanElement>())
  const pointer = useRef({ x: 0, y: 0, vx: 0, vy: 0, t: 0, dx: 0, dy: 0 })
  const justPulled = useRef<number | null>(null)
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => { state.reduced = query.matches }
    sync(); query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [state])
  useEffect(() => {
    // Only the gesture that pulls a word suppresses its resulting click.
    // Moving the node can suppress that click in the browser altogether.
    const down = () => { justPulled.current = null }
    const move = (event: MouseEvent) => {
      const p = pointer.current
      const now = performance.now(), dt = (now - p.t) / 1000
      if (dt > 0 && dt < 0.2) {
        p.vx = p.vx * 0.7 + (event.clientX - p.x) / dt * 0.3
        p.vy = p.vy * 0.7 + (event.clientY - p.y) / dt * 0.3
      }
      p.x = event.clientX; p.y = event.clientY; p.t = now
      const flight = state.held === null ? null : state.flights.get(state.held)
      if (!flight) return
      flight.body.x = event.clientX - p.dx; flight.body.y = event.clientY - p.dy
      flight.body.vx = p.vx; flight.body.vy = p.vy
      state.wake()
    }
    const up = () => {
      const flight = state.held === null ? null : state.flights.get(state.held)
      state.held = null
      if (!flight) return
      flight.body.held = false
      // Same throw limits as the native renderer in Gravity.tsx.
      flight.body.vx = Math.max(-1400, Math.min(1400, flight.body.vx))
      flight.body.vy = Math.max(-1400, Math.min(1400, flight.body.vy))
      flight.body.angularVelocity = (Math.random() - 0.5) * 2.5
      state.wake()
    }
    const click = (event: MouseEvent) => {
      const skip = justPulled.current
      justPulled.current = null
      for (const [id, flight] of state.flights) {
        if (id === skip || !flight.body.asleep || !flight.presented || flight.returning) continue
        if (!hitTestBody(flight.body, event.clientX, event.clientY)) continue
        event.preventDefault(); event.stopPropagation()
        flight.returning = true
        setRequested(current => { const next = new Set(current); next.delete(id); return next })
        return
      }
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('click', click)
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('click', click) }
  }, [state])
  const pull = (id: number, event: React.MouseEvent) => {
    if (state.flights.has(id)) return
    const element = elements.current.get(id)
    if (!element) return
    const rect = element.getBoundingClientRect()
    const body = spawnBody(id, { x: rect.left, y: rect.top, w: rect.width, h: rect.height }, { vx: 0, vy: 0 }, 0)
    if (state.reduced) settleInstant(body, boundsFromViewport(innerWidth, innerHeight), [...state.flights.values()].map(flight => flight.body))
    else { body.held = true; state.held = id; pointer.current.dx = event.clientX - body.x; pointer.current.dy = event.clientY - body.y; event.preventDefault() }
    state.flights.set(id, { body, width: rect.width, height: rect.height, presented: false, returning: false })
    justPulled.current = id
    setRequested(current => new Set([...current, id]))
  }
  const presented = (id: number, hold: SurfacePresentation) => {
    const flight = state.flights.get(id)
    if (!flight) return
    flight.presented = hold === 'scene'
    if (hold === 'page' && flight.returning) state.flights.delete(id)
    state.wake()
  }
  useEffect(() => {
    Object.assign(window, { __gravityApi: { flights: () => [...state.flights.values()].map(flight => ({ ...flight.body, presented: flight.presented, returning: flight.returning })), elements: () => [...elements.current.values()] } })
    return () => { Reflect.deleteProperty(window, '__gravityApi') }
  }, [state])
  return <div className="gv-page">
    <p className="gv-poem">
      {words.map((word, id) => <Fragment key={id}>
        {id > 0 ? ' ' : null}
        <Surface.Root name={`gravity-word-${id}`} inScene={requested.has(id)} timing={{ settleMs: 0, durationMs: 1 }} onPresentationChange={hold => presented(id, hold)}>
          <Surface.HTML as="span" layout="reflow">
            <span ref={element => { if (element) elements.current.set(id, element); else elements.current.delete(id) }} className="gv-word" onMouseDown={event => pull(id, event)}>{word}</span>
          </Surface.HTML>
          <Surface.Scene>{state.flights.has(id) && <FallingWord flight={state.flights.get(id)!} />}</Surface.Scene>
        </Surface.Root>
      </Fragment>)}
    </p>
    <p className="gv-hint">Drag a word out and drop it. Click a fallen word to put it back.</p>
    <SurfaceCanvas pointerMode="surfaces" className="gv-overlay" orthographic camera={{ position: [0, 0, 1], near: 0.01, far: 10 }} gl={{ alpha: true, antialias: true, depth: false }} frameloop="demand" dpr={[1, 2]} style={{ position: 'fixed', inset: 0 }}>
      <GravityWorld state={state} />
    </SurfaceCanvas>
  </div>
}
