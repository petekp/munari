// Example guide — visitor instructions outside the scene's rendering area.
// Keeping this in the shell preserves each scene's own viewport coordinates.

import { exampleFor, sourceFor } from './sceneCatalog'

export function SceneGuide({ scene }: { scene: string }) {
  const example = exampleFor(scene)
  return (
    <header className="site-scene-guide">
      <div className="site-scene-intro">
        <span className="site-scene-category">{example?.category ?? 'Study'}</span>
        <h1>{example?.title ?? scene}</h1>
        <p>{example?.description ?? 'An experimental example from the Munari lab.'}</p>
      </div>
      <div className="site-scene-actions">
        {example && (
          <details className="site-scene-help">
            <summary>What to try</summary>
            <div>
              <p>{example.instruction}</p>
              <p>{example.takeaway}</p>
            </div>
          </details>
        )}
        <a href={sourceFor(scene)} target="_blank" rel="noreferrer">View source</a>
      </div>
    </header>
  )
}
