// Handoff explanation — a diagram usable without HTML-in-canvas support.
// Its layers are separated for inspection; the real transfer aligns them.
import { useState } from 'react'

const STEPS = [
  { title: 'Start on the page', body: 'HTML and CSS draw the content in the page. React owns its behavior.' },
  { title: 'Prepare the scene', body: 'Munari captures the content as a live texture and places it on a mesh, aligned with the page.' },
  { title: 'Wait for a real frame', body: 'The page stays visible while the scene prepares and draws the matching content.' },
  { title: 'Let the scene take over', body: 'The scene becomes visible. You can move the mesh, bend its geometry, or change its material.' },
]

export function HandoffSection() {
  const [step, setStep] = useState(0)
  return (
    <section className="home-section home-how-section" id="how-it-works" aria-labelledby="how-title">
      <div className="home-section-heading">
        <p className="home-eyebrow">How it works</p>
        <h2 id="how-title">HTML supplies the content.<br />Three.js gives it another form.</h2>
        <p>Chrome draws live HTML into a texture. Three.js uses that texture in the scene. Munari keeps it current, routes input to the content, and coordinates the switch between page and canvas.</p>
      </div>
      <div className="home-handoff" data-step={step}>
        <div className="home-handoff-list" role="group" aria-label="Steps in the page-to-scene handoff">
          {STEPS.map((item, index) => (
            <button key={item.title} type="button" className="home-handoff-item"
              aria-pressed={step === index} onClick={() => setStep(index)}>
              <span className="home-step-number" aria-hidden>{index + 1}</span>
              <span><b>{item.title}</b><span>{item.body}</span></span>
            </button>
          ))}
        </div>
        <figure className="home-handoff-figure">
          <div className="home-iso" aria-hidden>
            <div className="home-iso-stack">
              <div className="home-iso-sheet home-iso-sheet--scene"><span>Live texture</span><b>Scene</b><i /></div>
              <div className="home-iso-sheet home-iso-sheet--page"><span>HTML + CSS</span><b>Page</b><i /></div>
            </div>
          </div>
          <figcaption>Layers shown apart. At the handoff, their size and position match.</figcaption>
        </figure>
      </div>
      <p className="home-handoff-return">To return, the example brings the mesh back into alignment before asking Munari to show the page again.</p>
    </section>
  )
}
