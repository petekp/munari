// Native HTML poster specimen behind the refractive Cmd+K lens (`FrontierCmdk.tsx`).

import type { Ref } from 'react'

export function FrontierCmdkPoster({
  articleRef,
  docTheme,
  notes,
  onScroll,
}: {
  readonly articleRef: Ref<HTMLElement>
  readonly docTheme: 'poster' | 'grid'
  readonly notes: readonly string[]
  readonly onScroll: () => void
}) {
  return (
    <article
      ref={articleRef}
      onScroll={onScroll}
      className={`frontier-spec-article frontier-spec-article--${docTheme}`}
    >
      <div className="frontier-poster-bars" aria-hidden="true">
        <span className="frontier-poster-bar frontier-poster-bar--coral" />
        <span className="frontier-poster-bar frontier-poster-bar--sky" />
        <span className="frontier-poster-bar frontier-poster-bar--amber" />
        <span className="frontier-poster-bar frontier-poster-bar--ink" />
      </div>

      <h2 className="frontier-poster-headline">Optical Transport Over Live HTML.</h2>

      <div className="frontier-poster-rule-band" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <p className="frontier-poster-copy">
        Watch the bold stripes, display serifs, and 1 px rules bend around the 30 px curved acrylic rim and separate
        into red, green, and blue wavelengths. Select this paragraph or scroll this pane—the document underneath is
        untouched native HTML, and WebGPU drops to 0 fps when still.
      </p>

      <div className="frontier-spec-grid">
        <div className="frontier-spec-card">
          <b>Crystal bevel (6% opacity)</b>
          <p>Rays refract inward along the rounded-box SDF gradient with aspect-true chromatic dispersion.</p>
        </div>
        <div className="frontier-spec-card">
          <b>Frosted well (60% opacity)</b>
          <p>Five-tap optical scatter calms the interior so live command typography reads above 10:1 contrast.</p>
        </div>
      </div>

      {notes.map((note) => (
        <p key={note} className="frontier-spec-callout">
          {note}
        </p>
      ))}
    </article>
  )
}
