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

/**
 * The query string that carries this window's engine to another one.
 *
 * The shell opens every scene but Home in an iframe, and an iframe is a
 * separate document with its own installed engine. Without this the shell
 * would compare engines by URL while every framed scene quietly ran the
 * default — a comparison that agrees with itself and with nothing else.
 */
export const captureParam = CAPTURE_MODE ? `&capture=${CAPTURE_MODE}` : ''
