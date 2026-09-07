// Example gallery — familiar interactions first, implementation links second.
// Top-level links leave the scene iframe so navigation never nests the shell.
import { FEATURED_EXAMPLES } from '../../components/sceneCatalog'

export function ExamplesSection() {
  return (
    <section className="home-section" id="examples" aria-labelledby="examples-title">
      <div className="home-section-heading">
        <div><p className="home-eyebrow">Explore the examples</p><h2 id="examples-title">What would you make with it?</h2></div>
        <p>Each example starts with live page content and explores a different way to render it.</p>
      </div>
      <div className="home-examples">
        {FEATURED_EXAMPLES.map((example) => (
          <a key={example.id} className="home-example" href={`/?scene=${example.id}`} target="_top">
            <div className="home-example-image" data-relief="raised">
              <img src={`/thumbs/${example.id}.jpg`} alt="" loading="lazy" width={640} height={360} />
              <span>Open example <span aria-hidden>↗</span></span>
            </div>
            <div className="home-example-meta"><span>{example.category}</span><span>{example.title}</span></div>
            <h3>{example.headline}</h3>
            <p>{example.description}</p>
          </a>
        ))}
      </div>
      <p className="home-more-examples">More to explore: <a className="home-text-link" href="/?scene=logo" target="_top">the Munari wordmark <span aria-hidden>↗</span></a></p>
    </section>
  )
}
