// Getting started — the displayed source is the component running beside it.
// Pin setup links to the same API revision until the npm release includes it.
import { GUIDE_URL, SOURCE_ARCHIVE, SOURCE_ROOT } from '../../components/sceneCatalog'
import { HomeStarter } from './HomeStarter'
import starterCode from './HomeStarter.tsx?raw'
import { CodeBlock } from './homeCode'

export function TutorialSection() {
  return (
    <section className="home-section home-start-section" id="get-started" aria-labelledby="start-title">
      <div className="home-section-heading">
        <p className="home-eyebrow">Build with Munari</p>
        <h2 id="start-title">Start with a component you know.</h2>
        <p>Write your content in React. A <code>Surface</code> gives it a page presentation and a mesh. Change <code>inScene</code> to choose where it appears.</p>
      </div>
      <div className="home-start-grid">
        <div className="home-start-copy">
          <h3>One counter, two ways to draw it.</h3>
          <p>Press the counter, switch it to 3D, and press it again. The layout stays the same so you can see that the content still works.</p>
          <p>The counter stays mounted as one React instance. Its state stays with it when the scene draws it and when it returns to the page.</p>
          <a className="home-text-link" href={GUIDE_URL} target="_blank" rel="noreferrer">Read the developer guide <span aria-hidden>↗</span></a>
        </div>
        <div className="home-starter-demo" data-relief="well"><HomeStarter /></div>
      </div>
      <details className="home-disclosure home-source-disclosure">
        <summary>See and copy the complete React example</summary>
        <CodeBlock code={starterCode} title="HomeStarter.tsx" />
      </details>
      <div className="home-development-note">
        <div>
          <b>Development API</b>
          <p>This example uses the API in <a href={`${SOURCE_ROOT}/pull/32`} target="_blank" rel="noreferrer">PR #32</a>. The current npm release uses an earlier API. Download the matching source, then run these commands from its folder with Node 24+.</p>
          <a className="home-text-link" href={SOURCE_ARCHIVE}>Download the source snapshot <span aria-hidden>↓</span></a>
        </div>
        <CodeBlock code={'npm ci\nnpm run lab'} title="Run locally" />
      </div>
    </section>
  )
}
