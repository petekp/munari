import { readSurfaceFrameState } from '@petepetrash/munari/advanced'
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
  useSurfaceStatus,
  type SurfaceDestination,
  type SurfaceHandle,
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

/** The retained source owns its canvas even when it is docked inside the page tree. */
function parkedCanvas(): HTMLCanvasElement | null {
  return document.querySelector('[data-api-live]')?.closest('canvas') ?? null
}
let rendering: import('@react-three/fiber').RootState | null = null
let displayed: import('three').Mesh | null = null

interface PointerObservation {presented:string|null;isChanging:boolean;ready:boolean}
function initialState(): PointerObservation { return {presented:null,isChanging:false,ready:false} }
const probe = {
  capable: detectHtmlInCanvas().drawElementImage,
  ready: false,
  clicks,
  state: initialState(),
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
    if (probe.state.presented !== 'scene' || probe.riding() || !displayed || !rendering) return { x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height }
    const source = parkedCanvas()?.firstElementChild?.getBoundingClientRect()
    if (!source) return null
    const point = displayed.position.clone().set((r.left+r.width/2-source.left)/source.width-0.5,0.5-(r.top+r.height/2-source.top)/source.height,0)
    displayed.updateWorldMatrix(true,false);displayed.localToWorld(point).project(rendering.camera)
    const canvas=rendering.gl.domElement.getBoundingClientRect()
    return {x:canvas.left+(point.x+1)*canvas.width/2,y:canvas.top+(1-point.y)*canvas.height/2,w:r.width,h:r.height}
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
    const element = document.elementFromPoint(x, y)
    return element?.id || element?.tagName || null
  },
}

declare global {
  interface Window {
    __nativePointer: typeof probe
  }
}
window.__nativePointer = probe

function Card({ value, onChange, surface }: { value: string; onChange: (value: string) => void; surface:SurfaceHandle }) {
  const record = (id: string) => (e: React.MouseEvent) => {
    probe.clicks.push({ instance:readSurfaceFrameState(surface).presentation ?? 'waiting', id, trusted: e.nativeEvent.isTrusted, t: performance.now() })
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
      <style>{`button#btn:hover { background: #2da44e; color: #fff; }`}</style>
      <button
        id="btn"
        style={{ height: 56, fontSize: 17, cursor: 'pointer' }}
        onClick={record('btn')}
      >
        target
      </button>
      <input
        id="field"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="type here"
        style={{ height: 36, fontSize: 15, padding: '0 10px' }}
        onClick={record('field')}
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
  const st = useSurfaceStatus(surface)
  probe.setRenderIn = setRenderIn
  probe.setRoute = setRoute
  probe.setTilt = setTilt
  probe.state = { presented: st.presentation, isChanging: st.isTransitioning, ready: st.sceneReady }
  useEffect(() => {
    probe.ready = true
  }, [])

  const content = <Card surface={surface} value={value} onChange={setValue} />
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
        <Surface.Root
          surface={surface}
          inScene={view === 'scene'}
          timing={{ settleMs: 120, durationMs: 200 }}
        >
          <Surface.HTML pageClassName="page-slot" size={[W,H]}>{content}</Surface.HTML>
        </Surface.Root>
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
        onCreated={(state) => { rendering=state;state.gl.setClearAlpha(0) }}
      >
        <Surface.Mesh ref={mesh=>{displayed=mesh}}
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
