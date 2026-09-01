// Scene nav — the lab's console: a black litho-ink panel down the left
// edge, one row per advertised scene, in the bench language's
// black-cluster-on-card grammar (app.css preamble).
//
// App.tsx owns which scenes are advertised and how a selection reaches
// the URL; this module owns only the markup. It is a plain flex child of
// the shell — the scene renders in its own frame beside it, so nothing
// here overlays a scene. The previous nav was a floating card rail over
// the scenes, and its z-order once swallowed a tuning panel's buttons
// mid-click (2026-08-31); a panel in layout flow cannot reproduce that
// class of fault.
//
// `active` is a plain string rather than one of `scenes`: unlisted scenes
// are still routable by URL, and the nav simply shows no lit row then.

const GITHUB_SCENES = 'https://github.com/petekp/munari/tree/main/apps/lab/src/scenes'

// One line per row, written for a visitor who has not opened the scene
// yet: the subject, not the mechanism. Falls back to the raw id so an
// advertised scene without an entry still gets a row instead of a crash.
const ROWS = {
  flight: { title: 'Flight', blurb: 'Task cards peel off a live page and fly.' },
  genie: { title: 'Genie', blurb: 'The 2001 minimize, graspable mid-flight.' },
  knobs: { title: 'Knobs', blurb: 'An instrument slab lit by its own artwork.' },
  selection: { title: 'Selection', blurb: 'Selected lines lift as strips of glass.' },
  logo: { title: 'Logo', blurb: 'A restless wordmark, one letter per beat.' },
  'marble-hand': { title: 'Marble hand', blurb: 'A classical marble hand as the pointer.' },
  plume: { title: 'Plume', blurb: 'Written ink leaves the field as weather.' },
} satisfies Record<string, { title: string; blurb: string }>

function GitHubMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

interface SceneNavProps<T extends string> {
  scenes: readonly T[]
  active: string
  onSelect: (id: T) => void
  /** Rendered at the panel's foot — App passes the capability lamps. */
  footer?: React.ReactNode
}

export function SceneNav<T extends string>({ scenes, active, onSelect, footer }: SceneNavProps<T>) {
  return (
    // hidden below md: a 280px column halves a phone's width, so phones
    // get the scene full-bleed and keep the roster reachable by URL.
    <nav className="hidden h-full w-[280px] flex-none flex-col bg-[#17170f] text-[#f4f2e7] md:flex">
      <header className="px-5 pb-5 pt-6">
        <h1 className="masthead">
          mun<em>ari</em>
        </h1>
        <p className="lbl mt-2 !text-[#f4f2e7]/45">html-in-canvas demos</p>
      </header>
      <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
        {scenes.map((id) => {
          // SAFETY: the indexed access is guarded by hasOwn over ROWS's
          // literal keys; unknown ids take the fallback row.
          const row = Object.hasOwn(ROWS, id) ? ROWS[id as keyof typeof ROWS] : { title: id, blurb: '' }
          const lit = active === id
          return (
            <li key={id} className="border-t border-[#2b2b1f]">
              <div className={`relative flex items-start gap-3 py-3 pl-5 pr-4 ${lit ? 'bg-[#2b2b1f]' : 'hover:bg-[#2b2b1f]/50'}`}>
                {/* The one lit position (app.css: coded colour). The lit
                    variant of signal red, not the printed one — the printed
                    swatch reads as switched off on this black ground. */}
                {lit && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[#ff5c3f]" />}
                <button
                  type="button"
                  onClick={() => onSelect(id)}
                  aria-current={lit ? 'page' : undefined}
                  className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 border-0 bg-transparent p-0 text-left text-inherit"
                >
                  {/* An inset box-shadow on the <img> itself would paint
                      beneath the image content, so the edge line is a
                      separate overlay. */}
                  <span className="relative block w-[64px] flex-none">
                    <img src={`/thumbs/${id}.jpg`} alt="" className="block aspect-video w-full object-cover" />
                    <span aria-hidden className="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(244,242,231,0.18)]" />
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block font-(family-name:--label) text-[11px] font-semibold uppercase tracking-[0.16em] ${lit ? 'text-[#ff5c3f]' : 'text-[#f4f2e7]'}`}
                    >
                      {row.title}
                    </span>
                    <span className="mt-1 block text-[11px] leading-[1.5] text-[#f4f2e7]/50">{row.blurb}</span>
                  </span>
                </button>
                <a
                  href={`${GITHUB_SCENES}/${id}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${row.title} source on github`}
                  className="mt-0.5 text-[#f4f2e7]/30 hover:text-[#f4f2e7]"
                >
                  <GitHubMark />
                </a>
              </div>
            </li>
          )
        })}
      </ul>
      {footer && <footer className="border-t border-[#2b2b1f] px-5 py-4">{footer}</footer>}
    </nav>
  )
}
