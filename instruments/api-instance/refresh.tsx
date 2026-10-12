// Source pixels verify refresh; renderer upload and presentation remain separate evidence.
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useLayoutEffect, useRef, useState } from 'react'
import {
  Surface, SceneSurface, createSurface, useSurfaceRefresh, useSurfaceStatus, useSurfaceTextureOf,
  type SurfaceHandle,
} from '@petepetrash/munari'
import { paintStats } from '@petepetrash/munari/advanced'
import { enableSnapdomCapture } from '@petepetrash/munari/snapdom'

if (new URLSearchParams(location.search).get('engine') === 'snapdom') enableSnapdomCapture({ always: true })

const handles = { page: createSurface('refresh-page'), scene: createSurface('refresh-scene') }
type SourceName = keyof typeof handles
const drawings = new Map<SourceName, HTMLCanvasElement>()
const textures = new Map<SourceName, ReturnType<typeof useSurfaceTextureOf>>()
const states = new Map<SourceName, ReturnType<typeof useSurfaceStatus>>()
const refreshers = new Map<string, () => void>()
let unmount = () => {}

function Drawing({ name }: { name: SourceName }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) throw new Error('The refresh fixture needs a canvas and its 2D context')
    drawings.set(name, canvas)
    context.fillStyle = 'red'
    context.fillRect(0, 0, canvas.width, canvas.height)
    return () => { drawings.delete(name) }
  }, [name])
  return <canvas ref={ref} width={60} height={60} />
}

function RefreshControl({ name, surface }: { name: string; surface?: SurfaceHandle }) {
  const refresh = useSurfaceRefresh(surface)
  useLayoutEffect(() => {
    refreshers.set(name, refresh)
    return () => { refreshers.delete(name) }
  }, [name, refresh])
  return null
}

function SourceReader({ name }: { name: SourceName }) {
  const texture = useSurfaceTextureOf(handles[name])
  const status = useSurfaceStatus(handles[name])
  useLayoutEffect(() => { textures.set(name, texture); states.set(name, status) }, [name, texture, status])
  return null
}

function App() {
  const [mounted, setMounted] = useState(true)
  unmount = () => flushSync(() => setMounted(false))
  return <>
    {mounted && <>
      <Surface.Root surface={handles.page} inScene={false}>
        <Surface.HTML size={[60, 60]}><Drawing name="page" /></Surface.HTML>
        <RefreshControl name="page" />
      </Surface.Root>
      <SceneSurface.Root surface={handles.scene}>
        <SceneSurface.HTML size={[60, 60]}><Drawing name="scene" /></SceneSurface.HTML>
        <RefreshControl name="scene" />
      </SceneSurface.Root>
    </>}
    <RefreshControl name="explicit" surface={handles.page} />
    <SourceReader name="page" /><SourceReader name="scene" />
  </>
}

function pixel(name: SourceName): readonly number[] | null {
  if (!paintStats().some(source => source.label === `refresh-${name}` && source.paints > 0)) return null
  const image = textures.get(name)?.image
  if (!(image instanceof HTMLCanvasElement)) return null
  const context = image.getContext('2d')
  return context ? Array.from(context.getImageData(10, 10, 1, 1).data) : null
}

Object.assign(window, { __refresh: {
  read: () => ({
    pixels: { page: pixel('page'), scene: pixel('scene') },
    markup: { page: drawings.get('page')?.outerHTML ?? null, scene: drawings.get('scene')?.outerHTML ?? null },
    state: { page: states.get('page'), scene: states.get('scene') },
    sources: paintStats().filter(source => source.label.startsWith('refresh-')),
  }),
  redraw(name: SourceName) {
    const canvas = drawings.get(name)
    const context = canvas?.getContext('2d')
    if (!canvas || !context) throw new Error('The requested drawing is not mounted')
    context.fillStyle = 'blue'
    context.fillRect(0, 0, canvas.width, canvas.height)
  },
  refresh(name: string) {
    const refresh = refreshers.get(name)
    if (!refresh) throw new Error('The requested refresh control is not mounted')
    refresh()
  },
  unmount: () => unmount(),
} })
createRoot(document.getElementById('root')!).render(<App />)
