// Scene navigation — one bar above a demo's own viewport: the wordmark home,
// what the demo is and what to try, its place in the catalog, and the
// neighbouring demos. The demo frame below keeps the rest of the window.

import { MunariLogo } from './MunariLogo'
import { DEMOS, demoFor, sourceFor } from './sceneCatalog'
import { Bar } from './system'
import { sceneUrl } from '../captureMode'
import './siteShell.css'

interface SceneNavProps {
  active: string
  onSelect: (id: string) => void
}

export function SceneNav({ active, onSelect }: SceneNavProps) {
  const demo = demoFor(active)
  const index = DEMOS.findIndex((entry) => entry.id === active)
  const previous = index > 0 ? DEMOS[index - 1] : undefined
  const next = index >= 0 && index < DEMOS.length - 1 ? DEMOS[index + 1] : undefined

  const go = (id: string) => (event: React.MouseEvent) => {
    event.preventDefault()
    onSelect(id)
  }

  return (
    <Bar
      lead={<a href={sceneUrl('home')} className="site-bar-logo" aria-label="Munari home"><span aria-hidden><MunariLogo ground="light" /></span></a>}
      title={demo?.title ?? active}
      titleTag="h1"
      instruction={demo?.instruction}
      links={<>
        {index >= 0 && <span className="m-readout m-quiet">{plateNumber(index)} / {plateNumber(DEMOS.length - 1)}</span>}
        {previous && <a className="m-link m-link--nav" href={sceneUrl(previous.id)} onClick={go(previous.id)}>Previous<span className="sr-only">: {previous.title}</span></a>}
        {next && <a className="m-link m-link--nav" href={sceneUrl(next.id)} onClick={go(next.id)}>Next<span className="sr-only">: {next.title}</span></a>}
        <a className="m-link m-link--nav" href={sourceFor(active)} target="_blank" rel="noreferrer">Source</a>
      </>}
    />
  )
}

/** The two-digit number a demo's plate carries on the overview. */
function plateNumber(index: number): string {
  return String(index + 1).padStart(2, '0')
}
