// Genie film context-loss gate — the focused stressed fallback boundary.
//
// The fast film gate checks state and receipt recovery. This one adds the
// stricter compositor sequence: after the first matching native frame, no
// later captured frame may regress to stale WebGL pixels.

process.env.ROUNDS ??= '1'
process.env.SLOWCPU ??= '6'
process.env.CAPTURE_FORMAT ??= 'jpeg'
process.env.CHECK_CONTEXT_PIXELS ??= '1'
process.env.DEADLINE_MS ??= '90000'

await import('./film-window.mjs')
