// A first Surface — the parent owns the count shared by both React instances.
import { useId, useState } from 'react'
import { Surface, SurfaceCanvas, useSurfaceSupport } from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

export function HomeStarter() {
  const canvas = useId()
  const supported = useSurfaceSupport()
  const [in3D, setIn3D] = useState(false)
  const [count, setCount] = useState(0)
  const [presented, setPresented] = useState('page')
  const panel = (
    <div style={{
      boxSizing: 'border-box', width: 260, height: 172, padding: 24,
      display: 'grid', alignContent: 'center', gap: 16,
      background: '#f2695c', color: '#14140f',
      font: '16px/1.4 system-ui, sans-serif', textAlign: 'center',
    }}>
      <p style={{ margin: 0 }}>Still counting.</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}
        style={{ padding: 12, border: 0, background: '#14140f', color: '#fff', font: 'inherit', cursor: 'pointer' }}>
        Press me · {count}
      </button>
    </div>
  )

  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 16, font: '14px/1.5 system-ui, sans-serif' }}>
      {supported && (
        <SurfaceCanvas id={canvas} flat frameloop="demand" pointerMode="surfaces"
          camera={{ position: [0, 0, 6], fov: 45 }}
          style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
      )}
      {supported ? (
        <Surface canvas={canvas} source={panel} renderIn={in3D ? 'canvas' : 'page'}
          onPresentationChange={setPresented}>
          <Surface.DOM />
          <Surface.Mesh alpha="source" />
        </Surface>
      ) : panel}
      <button type="button" disabled={!supported} data-relief="raised" onClick={() => setIn3D((value) => !value)}
        style={{ padding: '12px 18px', border: '1px solid #14140f', borderRadius: 0,
          background: '#14140f', color: '#f4f2e7', font: 'inherit', fontWeight: 600, cursor: supported ? 'pointer' : 'default' }}>
        {in3D ? 'Return to page' : 'Show in 3D'}
      </button>
      <span aria-live="polite" style={{ color: '#45443a' }}>
        {supported ? `Drawn by the ${presented === 'canvas' ? 'scene' : 'page'}` : '3D needs HTML-in-canvas support'}
      </span>
    </div>
  )
}
