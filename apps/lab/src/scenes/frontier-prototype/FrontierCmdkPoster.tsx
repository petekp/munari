// Curated editorial & dark-studio specimen behind the optical Cmd+K bar (`FrontierCmdk.tsx`).
//
// Designed with bold modernist color geometry, precision coordinate hairlines,
// and clean two-column selectable typography positioned directly behind the
// 16 px crystal meniscus so refraction, magnification, and frosted diffusion
// read effortlessly on cold load.

import type { Ref } from 'react'

export function FrontierCmdkPoster({
  articleRef,
  docTheme,
  notes,
  onScroll,
}: {
  readonly articleRef: Ref<HTMLElement>
  readonly docTheme: 'folio' | 'studio'
  readonly notes: readonly string[]
  readonly onScroll: () => void
}) {
  return (
    <article
      ref={articleRef}
      onScroll={onScroll}
      className={`cmdk-backdrop cmdk-backdrop--${docTheme}`}
    >
      <header className="cmdk-folio-top">
        <span className="cmdk-folio-kicker">QUADERNI DI OTTICA · FOLIO 04</span>
        <span className="cmdk-folio-meta">SELECTABLE NATIVE HTML · 0 FPS IDLE</span>
      </header>

      {/* Modernist color-field composition positioned directly behind the resting glass bezel */}
      <div className="cmdk-art-band" aria-hidden="true">
        <div className="cmdk-art-block cmdk-art-block--coral">
          <span className="cmdk-art-disc cmdk-art-disc--ivory" />
        </div>
        <div className="cmdk-art-block cmdk-art-block--cobalt">
          <span className="cmdk-art-ring" />
        </div>
        <div className="cmdk-art-block cmdk-art-block--amber">
          <span className="cmdk-art-diamond" />
        </div>
        <div className="cmdk-art-block cmdk-art-block--emerald">
          <span className="cmdk-art-stripes" />
        </div>
      </div>

      <div className="cmdk-editorial-body">
        <div className="cmdk-editorial-lead">
          <h2 className="cmdk-editorial-h2">
            Refractive glass over a live document.
          </h2>
          <p className="cmdk-editorial-sub">
            Slide the command palette across the color blocks above. Its 16 px convex crystal
            meniscus bends and disperses the page in CSS-pixel Snell space while its frosted
            well diffuses high-frequency ink via hardware trilinear mipmaps.
          </p>
        </div>

        <div className="cmdk-editorial-cols">
          <section className="cmdk-editorial-col">
            <h3>Meniscus &amp; Borrowed Edge</h3>
            <p>
              Real optical glass has no white sticker outline. Near the perimeter, grazing
              Fresnel reflections borrow the exact hue of whatever stands beside the rim while
              transmitted light concentrates into a 1.5 px piped hairline.
            </p>
          </section>

          <section className="cmdk-editorial-col">
            <h3>Native Page Underneath</h3>
            <p>
              Everything in this folio remains ordinary selectable HTML. Drag to highlight
              these sentences, scroll the sheet, or press Enter in the palette to append live
              notes directly underneath the lens.
            </p>
          </section>
        </div>

        {notes.length > 0 && (
          <div className="cmdk-notes-stack">
            {notes.map((note) => (
              <p key={note} className="cmdk-note-pill">
                <span className="cmdk-note-dot" aria-hidden="true" />
                <span>{note}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}
