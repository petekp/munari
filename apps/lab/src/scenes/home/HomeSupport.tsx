// Browser guidance — measured capability and a next step, without a forecast.
import { useSurfaceSupport } from '@petepetrash/munari'
import { BROWSER_GUIDE } from '../../components/sceneCatalog'

export function SupportSection() {
  const supported = useSurfaceSupport()
  return (
    <section className="home-section home-support-section" id="support" aria-labelledby="support-title">
      <div>
        <p className="home-eyebrow">Browser support</p>
        <h2 id="support-title">An experiment you can use today.</h2>
        <p>Munari uses Chrome’s experimental HTML-in-Canvas API. Availability depends on your browser and how the site enables the experiment. There is no confirmed cross-browser release date.</p>
      </div>
      <div className="home-support-detail">
        <p className="home-support-result" data-supported={supported}>
          <span aria-hidden />{supported ? 'HTML capture is available in this browser.' : 'You’re seeing the standard HTML version.'}
        </p>
        <p>{supported
          ? 'You can try the live 3D interactions on this page.'
          : 'The postcard and buttons still work. Play the recorded preview to see the 3D effect, or try a compatible Chrome build.'}</p>
        <a className="home-text-link" href={BROWSER_GUIDE} target="_blank" rel="noreferrer">Chrome setup and origin-trial details</a>
        <details className="home-disclosure">
          <summary>What should I plan for in a real project?</summary>
          <p>Keep a usable page presentation and provide a fallback for gestures that need the scene. A canvas-only presentation cannot create a page fallback for you.</p>
          <p>A Surface keeps one live React instance through the handoff. Its supported content keeps local state, focus, and input values; unsupported content stays on the page.</p>
          <p>Custom materials, deformations, focus, and selection need testing in the browser you intend to support. Treat these examples as a starting point for an interaction.</p>
        </details>
      </div>
    </section>
  )
}
