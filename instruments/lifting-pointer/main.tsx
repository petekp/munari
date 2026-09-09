import { readSurfaceFrameState } from '@petepetrash/munari/advanced'
// The page half of the lifting-pointer gate: one retained button records
// clicks and the presentation at event time. Decision #33 keeps input on
// the visible presentation throughout preparation and return. The original
// two-copy binding misrouted 3/3 preparation clicks (2026-08-19); the current
// fixture keeps the click, hover, page visibility and scene-lifetime checks.
//
// The run.mjs side drives real (trusted) clicks; nothing here dispatches
// events. It records the retained button's event-time presentation, public
// status, canvas input blocking, and page visibility.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useFrame } from '@react-three/fiber'
import {
  Surface,
  SurfaceCanvas,
  useSurfaceHandle,
  useSurfaceStatus,
  type SurfaceDestination,
  type SurfaceHandle,
} from '@petepetrash/munari'
import { detectHtmlInCanvas } from '@munari/core'

const W = 320
const H = 160

interface ClickRecord {
  presentationAtClick: string
  t: number
  state: { presentation: string | null; isTransitioning: boolean }
  canvasSolid: boolean | null
  pageVisible: boolean | null
}

interface EventRecord {
  t: number
  label?: string
  presentation?: string | null
  isTransitioning?: boolean
  sceneReady?: boolean
}

const clicks: ClickRecord[] = []
const events: EventRecord[] = []

type PointerObservation = Pick<ReturnType<typeof useSurfaceStatus>, 'presentation' | 'isTransitioning' | 'sceneReady'>
function initialState(): PointerObservation { return {presentation:null,isTransitioning:false,sceneReady:false} }
const probe = {
  capable: detectHtmlInCanvas().drawElementImage,
  ready: false,
  clicks,
  events,
  scene: { active: 0, frames: 0, lastFrameAt: 0 },
  state: initialState(),
  setRenderIn: (_: SurfaceDestination) => {},
  mark(label: string) {
    probe.events.push({ t: performance.now(), label })
  },
  buttonCenter() {
    const el = document.getElementById('btn')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  },
  canvasSolid() {
    const c = [...document.querySelectorAll('canvas')].find(canvas=>!canvas.firstElementChild)
    return c ? getComputedStyle(c).pointerEvents !== 'none' : null
  },
  pageVisible() {
    const el = document.querySelector('.page-slot')
    return el ? getComputedStyle(el).visibility !== 'hidden' : null
  },
  hoverState() {
    const button = document.getElementById('btn')
    return {realHover:button?.matches(':hover')??false,dataHover:button?.hasAttribute('data-hover')??false}
  },
}

declare global {
  interface Window {
    __probe: typeof probe
  }
}
window.__probe = probe

function TargetButton({surface}:{surface:SurfaceHandle}) {
  return (
    <div
      style={{
        width: W,
        height: H,
        background: '#e8e8f0',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <button
        id="btn"
        style={{ width: 220, height: 64, fontSize: 18 }}
        onClick={() => {
          probe.clicks.push({
            presentationAtClick:readSurfaceFrameState(surface).presentation ?? 'waiting',
            t: performance.now(),
            state: { presentation: probe.state.presentation, isTransitioning: probe.state.isTransitioning },
            canvasSolid: probe.canvasSolid(),
            pageVisible: probe.pageVisible(),
          })
        }}
      >
        target
      </button>
    </div>
  )
}

// A custom scene contributes a frame subscription outside its mesh. Its
// cleanup proves that Surface.Scene retains and releases the entire subtree.
function TrackedPresenter() {
  useFrame(() => {
    probe.scene.frames++
    probe.scene.lastFrameAt = performance.now()
  })
  useEffect(() => {
    probe.scene.active++
    return () => {
      probe.scene.active--
    }
  }, [])
  return <Surface.Mesh placement="match-dom" />
}

function App() {
  const surface = useSurfaceHandle('lifting-pointer')
  const [view, setRenderIn] = useState<SurfaceDestination>(() =>
    new URLSearchParams(window.location.search).get('initial') === 'scene' ? 'scene' : 'page',
  )
  const st = useSurfaceStatus(surface)
  probe.setRenderIn = setRenderIn
  probe.state = { presentation: st.presentation, isTransitioning: st.isTransitioning, sceneReady: st.sceneReady }
  useEffect(() => {
    probe.events.push({
      t: performance.now(),
      presentation: st.presentation,
      isTransitioning: st.isTransitioning,
      sceneReady: st.sceneReady,
    })
  }, [st])
  useEffect(() => {
    probe.ready = true
  }, [])

  const content = <TargetButton surface={surface} />
  return (
    <>
      <div style={{ position: 'fixed', left: 60, top: 60, width: W, height: H }}>
        <Surface.Root
          surface={surface}
          inScene={view === 'scene'}
          // A long settle so the lifting window is wide enough to click into
          // at several offsets. Nothing here animates, so the dwell is pure
          // window: proof lands in the first frames, then ~700ms of lifting.
          timing={{ settleMs: 700, durationMs: 500 }}
        >
          <Surface.HTML pageClassName="page-slot" size={[W,H]}>{content}</Surface.HTML>
        </Surface.Root>
      </div>
      <SurfaceCanvas
        pointerMode="surfaces"
        style={{ position: 'fixed', inset: 0 }}
        gl={{ alpha: true }}
        frameloop="demand"
        dpr={1}
        camera={{ fov: 40, position: [0, 0, 10] }}
        onCreated={(s) => s.gl.setClearAlpha(0)}
      >
        <Surface.Scene surface={surface}>
          <TrackedPresenter />
        </Surface.Scene>
      </SurfaceCanvas>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
