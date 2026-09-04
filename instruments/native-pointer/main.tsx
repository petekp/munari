// The page half of the native-pointer gate: one exclusive Surface whose
// presenter opts into `pointerRoute="auto"` (decisions.md #39), so a real
// browser click fired while the rig rides tells us whether the browser
// itself delivered it to the parked content. The discriminator is
// `isTrusted`: the relay's synthetic dispatch can never set it, so a click
// record with `trusted: true` on the source copy is proof the native route
// owned the pointer — no in-library code has ever driven the real rig
// before this gate (the evidence behind #39 came from hand-built spikes).
//
// The run.mjs side drives real (trusted) input; nothing here dispatches
// events. This page only records clicks and answers questions about the
// parked canvas the rig dresses.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Surface,
  SurfaceCanvas,
  useSurfaceHandle,
  useSurfaceInstance,
  useSurfaceState,
  type SurfaceDestination,
} from '@petepetrash/munari'
import { detectHtmlInCanvas, type PointerRouteRequest } from '@munari/core'

const W = 320
const H = 200

interface ClickRecord {
  instance: string
  id: string
  trusted: boolean
  t: number
}

const clicks: ClickRecord[] = []

/** The parked capture canvas is the one document.body holds directly;
 * the renderer canvas lives inside the SurfaceCanvas div. */
function parkedCanvas(): HTMLCanvasElement | null {
  for (const c of document.querySelectorAll('canvas')) {
    if (c.parentElement === document.body) return c
  }
  return null
}

const probe = {
  capable: detectHtmlInCanvas().drawElementImage,
  ready: false,
  clicks,
  state: { presented: 'page', isChanging: false, ready: false },
  setRenderIn: (_: SurfaceDestination) => {},
  setRoute: (_: PointerRouteRequest) => {},
  setTilt: (_: boolean) => {},
  rig() {
    const c = parkedCanvas()
    if (!c) return null
    // SAFETY: the parked canvas's only child is the drawn root element that
    // htmlInCanvas appended, an HTMLElement (htmlInCanvas.ts appendChild).
    const root = c.firstElementChild as HTMLElement | null
    return {
      transform: c.style.transform,
      transformOrigin: c.style.transformOrigin,
      visibility: c.style.visibility,
      zIndex: c.style.zIndex,
      rootVisibility: root?.style.visibility ?? null,
    }
  },
  riding() {
    const r = probe.rig()
    return r !== null && r.transform.startsWith('matrix3d') && r.visibility === 'hidden'
  },
  rectOf(id: string) {
    const el = document.getElementById(id)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
  },
  hoverOf(id: string) {
    const el = document.getElementById(id)
    if (!el) return null
    return { realHover: el.matches(':hover'), dataHover: el.hasAttribute('data-hover') }
  },
  activeId: () => document.activeElement?.id ?? null,
  valueOf(id: string) {
    const el = document.getElementById(id)
    return el instanceof HTMLInputElement ? el.value : null
  },
  hitAt(x: number, y: number) {
    return document.elementFromPoint(x, y)?.id ?? document.elementFromPoint(x, y)?.tagName ?? null
  },
}

declare global {
  interface Window {
    __nativePointer: typeof probe
  }
}
window.__nativePointer = probe

function Card({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const instance = useSurfaceInstance()
  const record = (id: string) => (e: React.MouseEvent) => {
    probe.clicks.push({ instance, id, trusted: e.nativeEvent.isTrusted, t: performance.now() })
  }
  return (
    <div
      style={{
        width: W,
        height: H,
        boxSizing: 'border-box',
        padding: 20,
        background: '#e8e8f0',
        display: 'grid',
        alignContent: 'center',
        gap: 14,
      }}
    >
      {/* The :hover rule travels with the content so a real browser hover
          self-paints into the capture (matrix3d-hit.md: paints 2→4). */}
      <style>{`button[id^="btn-"]:hover { background: #2da44e; color: #fff; }`}</style>
      <button
        id={`btn-${instance}`}
        style={{ height: 56, fontSize: 17, cursor: 'pointer' }}
        onClick={record(`btn-${instance}`)}
      >
        target
      </button>
      <input
        id={`field-${instance}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="type here"
        style={{ height: 36, fontSize: 15, padding: '0 10px' }}
        onClick={record(`field-${instance}`)}
      />
    </div>
  )
}

function App() {
  const surface = useSurfaceHandle('native-pointer')
  const [view, setRenderIn] = useState<SurfaceDestination>('page')
  const [route, setRoute] = useState<PointerRouteRequest>('relay')
  const [tilt, setTilt] = useState(false)
  const [value, setValue] = useState('')
  const st = useSurfaceState(surface)
  probe.setRenderIn = setRenderIn
  probe.setRoute = setRoute
  probe.setTilt = setTilt
  probe.state = { presented: st.presented, isChanging: st.isChanging, ready: st.ready }
  useEffect(() => {
    probe.ready = true
  }, [])

  const content = <Card value={value} onChange={setValue} />
  return (
    <>
      <div
        style={{
          position: 'fixed',
          left: `calc(50% - ${W / 2}px)`,
          top: `calc(50% - ${H / 2}px)`,
          width: W,
          height: H,
        }}
      >
        <Surface
          surface={surface}
          renderIn={view}
          timing={{ settleMs: 120, durationMs: 200 }}
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
        // 'always', not 'demand': the route steps inside useFrame, and this
        // gate flips route and pose from outside React's own invalidations.
        frameloop="always"
        dpr={1}
        camera={{ fov: 42, position: [0, 0, 1000] }}
        onCreated={(s) => s.gl.setClearAlpha(0)}
      >
        <Surface.Mesh
          surface={surface}
          pointerRoute={route}
          placement={tilt ? 'manual' : 'match-dom'}
          // ~30°/12°, the matrix3d-hit spike's measured pose. Manual
          // placement, because match-dom drives the quaternion per frame.
          rotation={tilt ? [-0.21, 0.52, 0] : [0, 0, 0]}
          position={[0, 0, 0]}
        />
      </SurfaceCanvas>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
