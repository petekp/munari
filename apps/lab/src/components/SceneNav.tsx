// Scene navigation — one bar above a demo's own viewport: the wordmark home,
// what the demo is and what to try, and the neighbouring demos in catalog
// order. The demo frame below keeps the rest of the window.

import { MunariLogo } from './MunariLogo'
import { DEMOS, demoFor, sourceFor } from './sceneCatalog'
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
    <header className="site-bar">
      <a href={sceneUrl('home')} className="site-bar-logo" aria-label="Munari home">
        <span aria-hidden><MunariLogo ground="light" /></span>
      </a>
      <div className="site-bar-demo">
        <h1>{demo?.title ?? active}</h1>
        {demo && <p>{demo.instruction}</p>}
      </div>
      <nav className="site-bar-links" aria-label="Demos">
        {previous && <a href={sceneUrl(previous.id)} onClick={go(previous.id)}>Previous<span className="sr-only">: {previous.title}</span></a>}
        {next && <a href={sceneUrl(next.id)} onClick={go(next.id)}>Next<span className="sr-only">: {next.title}</span></a>}
        <a href={sourceFor(active)} target="_blank" rel="noreferrer">Source</a>
      </nav>
    </header>
  )
}
