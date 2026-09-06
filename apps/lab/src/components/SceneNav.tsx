// Scene navigation — shared labels and links for desktop and mobile visitors.
// The shell owns navigation; each example keeps its own rendering viewport.

import { MunariLogo } from './MunariLogo'
import { exampleFor, GUIDE_URL, SOURCE_ROOT } from './sceneCatalog'
import './lit.css'
import './siteShell.css'

interface SceneNavProps<T extends string> {
  scenes: readonly T[]
  active: string
  onSelect: (id: T) => void
  supported: boolean
}

function titleFor(id: string): string {
  return id === 'home' ? 'Overview' : exampleFor(id)?.title ?? id
}

export function SceneNav<T extends string>({ scenes, active, onSelect, supported }: SceneNavProps<T>) {
  return (
    <>
      <nav className="site-sidebar" aria-label="Example sidebar">
        <div className="site-brand">
          <a href="/?scene=home" className="site-brand-link" aria-label="Munari overview">
            <div aria-hidden className="site-wordmark"><MunariLogo /></div>
          </a>
          <p>HTML, 3D and shaders, unified.<br />An experimental React library.</p>
        </div>
        <ul className="site-nav-list">
          {scenes.map((id) => {
            const example = exampleFor(id)
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onSelect(id)}
                  aria-current={active === id ? 'page' : undefined}
                >
                  {id === 'home'
                    ? <span className="site-overview-icon" aria-hidden>●</span>
                    : <img src={`/thumbs/${id}.jpg`} alt="" />}
                  <span>
                    <b>{titleFor(id)}</b>
                    <small>{id === 'home' ? 'Start here' : example?.category ?? 'Experimental study'}</small>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="site-nav-footer">
          <a href={GUIDE_URL} target="_blank" rel="noreferrer">Developer guide</a>
          <a href={SOURCE_ROOT} target="_blank" rel="noreferrer">GitHub</a>
          <a href="/?scene=home#support" className="site-support" data-supported={supported}>
            {supported ? 'Capture available' : 'Standard rendering'}
          </a>
        </div>
      </nav>
      <nav className="site-mobile-nav" aria-label="Example picker">
        <a className="site-mobile-brand" href="/?scene=home">munari</a>
        <label className="sr-only" htmlFor="site-example">Choose an example</label>
        <select
          id="site-example"
          value={active}
          onChange={(event) => {
            const selected = scenes.find((id) => id === event.target.value)
            if (selected) onSelect(selected)
          }}
        >
          {!scenes.some((id) => id === active) && <option value={active}>{titleFor(active)}</option>}
          {scenes.map((id) => <option key={id} value={id}>{titleFor(id)}</option>)}
        </select>
        <a href={GUIDE_URL} target="_blank" rel="noreferrer">Guide</a>
      </nav>
    </>
  )
}
