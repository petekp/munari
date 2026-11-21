// Which capture engine this lab window runs.
//
// `?capture=snapdom` forces snapDOM even in a flagged Chrome, which is what
// makes a side-by-side comparison possible in ONE browser: the two engines
// are not supersets of each other, and a parity check that had to swap
// browsers would be comparing renderers as well as engines.
// `?capture=auto` takes the fallback rule an app would ship — native where
// the trial exists, snapDOM everywhere else. No param leaves the library's
// own default in place.
//
// Read once at module load, like `?bare`: the URL is authoritative, a reader
// cannot change it without a reload, and an engine installed after a Surface
// mounts does not reach it.

export type CaptureMode = 'snapdom' | 'auto'

const requested = new URLSearchParams(window.location.search).get('capture')

/** The engine this window was asked for, or null for the library default. */
export const CAPTURE_MODE: CaptureMode | null =
  requested === 'snapdom' || requested === 'auto' ? requested : null

const SHELL_PARAMS = new Set(['scene', 'capture', 'framed', 'bare'])

// A destination installs its capture engine before mounting any Surface.
// Preserve the selection across full-page links, history changes, and frames,
// along with any extra query parameters targeting the same scene.
export function sceneUrl(scene: string, options: { framed?: boolean; bare?: boolean; capture?: CaptureMode } = {}): string {
  const current = new URLSearchParams(window.location.search)
  const query = new URLSearchParams({ scene })
  if (current.get('scene') === scene) {
    for (const [key, value] of current) {
      if (!SHELL_PARAMS.has(key)) query.append(key, value)
    }
  }
  const capture = options.capture ?? CAPTURE_MODE
  if (capture) query.set('capture', capture)
  if (options.framed) query.set('framed', '')
  if (options.bare) query.set('bare', '')
  return `/?${query}`
}
