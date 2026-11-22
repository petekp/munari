// Which capture engine this lab window runs.
//
// By default (`auto`), the lab behaves like a real cross-browser app: native
// HTML-in-canvas where Chrome exposes `drawElementImage`, and automatic
// fallback to snapDOM everywhere else — with no URL parameter required.
//
// `?capture=snapdom` forces snapDOM even in Chrome 157+, enabling side-by-side
// engine parity checks in one browser. `?capture=none` omits snapDOM so
// degradation instruments can verify native-HTML fallback when no capture
// engine is installed.

export type CaptureMode = 'snapdom' | 'auto' | 'none'

const requested = new URLSearchParams(window.location.search).get('capture')

/** The engine policy for this window (`auto` by default). */
export const CAPTURE_MODE: CaptureMode =
  requested === 'snapdom' || requested === 'none' ? requested : 'auto'

const SHELL_PARAMS = new Set(['scene', 'capture', 'framed', 'bare'])

// Preserve explicit non-default capture overrides (`snapdom` / `none`) across
// links, history updates, and frames while keeping default URLs clean.
export function sceneUrl(
  scene: string,
  options: { framed?: boolean; bare?: boolean; capture?: CaptureMode } = {},
): string {
  const current = new URLSearchParams(window.location.search)
  const query = new URLSearchParams({ scene })
  if (current.get('scene') === scene) {
    for (const [key, value] of current) {
      if (!SHELL_PARAMS.has(key)) query.append(key, value)
    }
  }
  const capture = options.capture ?? CAPTURE_MODE
  if (capture !== 'auto') query.set('capture', capture)
  if (options.framed) query.set('framed', '')
  if (options.bare) query.set('bare', '')
  return `/?${query}`
}
