// The page half of the texture-uploads probe — one Surface whose color and
// size the runner changes, and the paint count the runner reads.
//
// The law: the fixture goes through the published entries, so the uploads the
// runner counts are the ones a consumer's Surface makes.
//
// The fault: measured 2026-09-29, each changed image was uploaded twice on
// both engines. The second upload covers a draw that resolves late on the
// HTML-in-canvas engine. snapDOM draws before it counts the paint, so its
// second upload sent the same image again (decisions.md #60).
//
// Ownership: this page owns the fixture. run.mjs owns the browser, the upload
// count, the steps, the screenshots, and the verdict.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SceneSurface, SurfaceCanvas } from '@petepetrash/munari'
import { paintStats } from '@petepetrash/munari/advanced'
import '@petepetrash/munari/style.css'

interface FixtureState {
  blue: boolean
  big: boolean
}

interface UploadFixture {
  paints: () => number
  set: (next: FixtureState) => void
}

declare global {
  interface Window {
    __uploadFixture: UploadFixture
  }
}

const fixture: UploadFixture = {
  paints: () => paintStats().reduce((sum, source) => sum + source.paints, 0),
  set: () => {},
}
window.__uploadFixture = fixture

const params = new URLSearchParams(location.search)
const asked = params.get('resolution') ?? 'auto'
const resolution = asked === 'auto' ? 'auto' : Number(asked)

function Fixture() {
  const [state, setState] = useState<FixtureState>({ blue: false, big: false })
  useEffect(() => {
    fixture.set = setState
  }, [])
  const width = state.big ? 300 : 240
  const height = state.big ? 180 : 120
  return (
    <SurfaceCanvas frameloop="demand" style={{ width: 600, height: 400 }}>
      <SceneSurface.Root>
        <SceneSurface.HTML size={[width, height]} resolution={resolution} live>
          <div style={{ width, height, background: state.blue ? 'rgb(0,0,255)' : 'rgb(255,0,0)' }} />
        </SceneSurface.HTML>
        <SceneSurface.Mesh scale={[2, 1, 1]} />
      </SceneSurface.Root>
    </SurfaceCanvas>
  )
}

async function start() {
  if (params.get('engine') === 'snapdom') {
    const { enableSnapdomCapture } = await import('@petepetrash/munari/snapdom')
    // `always` keeps snapDOM installed in a browser that has HTML-in-canvas.
    enableSnapdomCapture({ always: true })
  }
  const root = document.getElementById('root')
  if (!root) throw new Error('texture-uploads: the page has no #root')
  createRoot(root).render(<Fixture />)
}

void start()
