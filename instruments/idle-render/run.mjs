// Idle-render probe — what a SurfaceCanvas costs while nothing on the page
// changes, and which lab scenes stop updating when its idle frame loop is
// "demand" instead of "always".
//
// The quality probe (2026-11-26) timed a 12-card frame at 1.2–2.3 ms of GPU
// work on m2 and read SurfaceCanvas.tsx's `frameloop ?? 'always'` as a page
// that pays that on every display refresh. Whether a page pays it depends on
// the frame loop each canvas actually runs, so this probe counts frames drawn
// rather than inferring them.
//
// The idle mode reaches the library through a Vite transform of
// SurfaceCanvas.tsx at serve time; the package source is not edited.
//   authored         each canvas keeps what its scene passes (today's behavior)
//   default-demand   a canvas that passes no frameloop gets "demand" (the proposal)
//   all-demand       every canvas gets "demand", whatever it passes
//   all-always       every canvas gets "always", whatever it passes
//
// Modes (MODE=…):
// - cost: each page in PAGES, idle for WINDOW_MS after SETTLE_MS, per mode.
//   Counts frames presented per canvas (GPUCanvasContext.getCurrentTexture
//   calls), queue submits, and animation-frame callbacks; reads main-thread
//   task time (CDP Performance.getMetrics) and CPU time per Chrome process
//   (CDP SystemInfo.getProcessInfo). GPU time is the sum of every
//   SurfaceCanvas pass's timestamp-query duration (three's trackTimestamp,
//   switched on by the same transform), resolved every 250 ms; it covers
//   SurfaceCanvas renderers only, not a scene's own renderer or Chrome's
//   compositor. PROFILE=1 adds a 3 s CPU profile per row, after the window.
//   Rounds interleave modes and pages; every load is a new browser context.
//   about:blank is the floor.
// - activity: every lab scene with `bare`, per mode. Screenshots before and after an
//   idle window, after a pointer sweep, and after a click at the centre,
//   plus frames drawn in each phase. A scene that changes while idle under
//   all-always but not under a demand mode has stopped updating; a settled
//   frame that differs from all-always (beyond the all-always repeat) is a
//   missed final frame.
// - fixture: instruments/idle-render/fixture, a canvas with 12 cards and an
//   author's own useFrame animation, under the default and "demand".
//
// Limits: one machine (m2) and its GPU; headless Chrome, whose frame rate is
// reported rather than assumed; timestamp queries add a little GPU work of
// their own and miss work outside render and compute passes; the activity sweep drives one pointer path and one click, so a
// scene can still stall on an interaction it does not exercise.
//
//   MODE=cost OUT=<dir> node instruments/idle-render/run.mjs


import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { MODE, OUT } from './probeConfig.mjs'
import { costMode } from './costMode.mjs'
import { activityMode } from './activityMode.mjs'
import { fixtureMode } from './fixtureMode.mjs'

const modes = { cost: costMode, activity: activityMode, fixture: fixtureMode }
if (!modes[MODE]) throw new Error('Set MODE to one of ' + Object.keys(modes).join(', '))
const result = await modes[MODE]()
if (result.transformed === 0) throw new Error('idle-render: SurfaceCanvas was never transformed, so the idle mode did not reach the library')
writeFileSync(path.join(OUT, MODE + '.json'), JSON.stringify(result, null, 2))
console.log('wrote ' + path.join(OUT, MODE + '.json'))
