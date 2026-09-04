// The page half of the lifting-pointer gate: one exclusive Surface whose
// two DOM instances (page copy, parked source) count their own clicks, so a
// real browser click fired during each crossing phase tells us which copy
// heard it. The contract is decisions.md #33: during 'lifting' the page
// copy is the presented one, and input follows the eye — the registered
// mesh must not route the click to the hidden parked copy, which is
// exactly what it did before the law (measured 2026-08-19, 3/3).
//
// The run.mjs side drives real (trusted) clicks; nothing here dispatches
// events. This page only records: which instance's onClick ran, what the
// public SurfaceState said at that moment, whether the shared canvas was
// solid to input, and whether the page copy was the visible one.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useFrame } from '@react-three/fiber'
import {
  Surface,
  SurfaceCanvas,
  useSurfaceHandle,
  useSurfaceInstance,
  useSurfaceState,
  type SurfacePresentation,
} from '@petepetrash/munari'
import { detectHtmlInCanvas } from '@munari/core'

const W = 320
const H = 160

interface ClickRecord {
  instance: string
  t: number
  state: { presented: string; isChanging: boolean }
  canvasSolid: boolean | null
  pageVisible: boolean | null
}

interface EventRecord {
  t: number
  label?: string
  presented?: string
  isChanging?: boolean
  ready?: boolean
}

const clicks: ClickRecord[] = []
const events: EventRecord[] = []

const probe = {
  capable: detectHtmlInCanvas().drawElementImage,
  ready: false,
  clicks,
  events,
  scene: { active: 0, frames: 0, lastFrameAt: 0 },
  state: { presented: 'page', isChanging: false, ready: false },
  setRenderIn: (_: SurfacePresentation) => {},
  mark(label: string) {
    probe.events.push({ t: performance.now(), label })
  },
  buttonCenter() {
    const el = document.getElementById('btn-page')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  },
  canvasSolid() {
    const c = document.querySelector('canvas')
    return c ? getComputedStyle(c).pointerEvents !== 'none' : null
  },
  pageVisible() {
    const el = document.getElementById('btn-page')
    return el ? getComputedStyle(el).visibility !== 'hidden' : null
  },
  hoverState() {
    const page = document.getElementById('btn-page')
    const source = document.getElementById('btn-source')
    return {
      pageRealHover: page ? page.matches(':hover') : null,
      pageDataHover: page ? page.hasAttribute('data-hover') : null,
      sourceDataHover: source ? source.hasAttribute('data-hover') : null,
    }
  },
}

declare global {
  interface Window {
    __probe: typeof probe
  }
}
window.__probe = probe

function TargetButton() {
  const instance = useSurfaceInstance()
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
        id={`btn-${instance}`}
        style={{ width: 220, height: 64, fontSize: 18 }}
        onClick={() => {
          probe.clicks.push({
            instance,
            t: performance.now(),
            state: { presented: probe.state.presented, isChanging: probe.state.isChanging },
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
  const [view, setRenderIn] = useState<SurfacePresentation>(() =>
    new URLSearchParams(window.location.search).get('initial') === 'canvas' ? 'canvas' : 'page',
  )
  const st = useSurfaceState(surface)
  probe.setRenderIn = setRenderIn
  probe.state = { presented: st.presented, isChanging: st.isChanging, ready: st.ready }
  useEffect(() => {
    probe.events.push({
      t: performance.now(),
      presented: st.presented,
      isChanging: st.isChanging,
      ready: st.ready,
    })
  }, [st])
  useEffect(() => {
    probe.ready = true
  }, [])

  const content = <TargetButton />
  return (
    <>
      <div style={{ position: 'fixed', left: 60, top: 60, width: W, height: H }}>
        <Surface
          surface={surface}
          renderIn={view}
          // A long settle so the lifting window is wide enough to click into
          // at several offsets. Nothing here animates, so the dwell is pure
          // window: proof lands in the first frames, then ~700ms of lifting.
          timing={{ settleMs: 700, durationMs: 500 }}
          size={[W, H]}
          source={content}
        >
          <Surface.DOM />
        </Surface>
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
