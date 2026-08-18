// Genie film soak — the slow, repeated stress form of film-window.mjs.
//
// The ordinary gate proves the handoff contract quickly. This keeps the
// original 24 cycles, 6x CPU stress, compact screencast transport, and
// 240-second watchdog for deliberate overnight or pre-release use.

process.env.ROUNDS ??= '24'
process.env.SLOWCPU ??= '6'
process.env.CAPTURE_FORMAT ??= 'jpeg'
process.env.CHECK_CONTEXT_PIXELS ??= '1'
process.env.DEADLINE_MS ??= '240000'

await import('./film-window.mjs')
