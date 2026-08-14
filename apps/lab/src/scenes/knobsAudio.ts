// The sound of the hardware — a detent's click and a lever's thunk.
//
// Custody note: sound is presentation, like the springs. The source of
// truth is the value change itself — KnobsPanel calls these from the
// same setter every input path funnels through (drag, flick, keyboard),
// so a detent is heard exactly when a detent is crossed, whoever turned
// the knob.
//
// The context is created lazily and resumed opportunistically: the
// browser grants audio only after a real user gesture, and every one of
// these calls happens inside one (a trusted pointer or key event landed
// on the page moments before). If the platform still refuses, we stay
// silent — sound here is seasoning, never load-bearing.

import { KNOB, TOGGLE } from './knobsGeometry'
import { LEVER_SPRING, LEVER_THROW, type SpringState, stepSpring } from './knobsPhysics'
import { PANEL_MIN_W } from './knobsResize'

let ctx: AudioContext | null = null
let lastDetent = 0

/** Quietest gap between detent clicks — a fast sweep buzzes like a real
 *  ratchet instead of machine-gunning one click per value step. */
const DETENT_GAP = 0.015

/** Clicks closer than this are a sweep in progress, not single turns —
 *  the buzz plays finer (quieter, shorter, tighter grain) than a lone
 *  click, the way a real ratchet blurs at speed. */
const SWEEP_GAP = 0.09

function ensure(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx.state === 'running' ? ctx : null
}

/** One strike: an oscillator with an exponential decay envelope. `at`
 *  delays it, in seconds, for a strike the mechanism has not reached
 *  yet. */
function strike(
  ac: AudioContext,
  type: OscillatorType,
  freq: number,
  gain: number,
  decay: number,
  at = 0,
) {
  const now = ac.currentTime + at
  const osc = ac.createOscillator()
  osc.type = type
  osc.frequency.value = freq
  const env = ac.createGain()
  env.gain.setValueAtTime(gain, now)
  env.gain.exponentialRampToValueAtTime(0.0001, now + decay)
  osc.connect(env)
  env.connect(ac.destination)
  osc.start(now)
  osc.stop(now + decay + 0.01)
}

/** A tenth of a second of white noise, made once — every click plays a
 *  different slice of it at a different rate, so no two ticks share a
 *  waveform. */
let noiseBuf: AudioBuffer | null = null
function noise(ac: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, Math.ceil(ac.sampleRate * 0.1), ac.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

/** ±spread, uniform — the per-click jitter no real mechanism is without. */
function vary(spread: number): number {
  return 1 + (Math.random() - 0.5) * 2 * spread
}

/** The mechanism's voice: a slow random walk in 0..1 that colors each
 *  click's filter. Per-click jitter alone sounds like dice; a voice that
 *  DRIFTS — small steps, reflected at the ends — sounds like one real
 *  mechanism whose tone wanders as the wrist and the wear do. */
let voice = 0.5
function driftVoice(sweeping: boolean) {
  voice += (Math.random() - 0.5) * (sweeping ? 0.16 : 0.34)
  if (voice > 1) voice = 2 - voice
  if (voice < 0) voice = -voice
}

/**
 * A dial crossing one graduation. An expensive detent is not a beep —
 * it is a tiny impact: a ball bearing dropping into a machined groove.
 * Three layers, quietest first-class citizens:
 *
 *   1. the click — a few ms of noise through a bandpass: the broadband
 *      transient of the strike itself. The filter's center wears the
 *      drifting voice; rate, slice, width and level jitter per click.
 *   2. the ring — one damped high partial, barely audible: the knob's
 *      metal answering the impact. Expensive mechanisms are tight, so
 *      it dies in under 15 ms.
 *   3. the seat — a faint, brief tap of the knob settling, most of its
 *      low end cut away: the voice of this mechanism is the click up
 *      high, not the mass underneath.
 */
export function clickDetent() {
  const ac = ensure()
  if (!ac) return
  const now = ac.currentTime
  if (now - lastDetent < DETENT_GAP) return
  const sweeping = now - lastDetent < SWEEP_GAP
  lastDetent = now
  driftVoice(sweeping)
  const fine = sweeping ? 0.72 : 1

  // 1. the click
  const src = ac.createBufferSource()
  src.buffer = noise(ac)
  src.playbackRate.value = vary(0.14)
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = (3200 + voice * 1800) * vary(0.06)
  bp.Q.value = 1.8 * vary(0.2)
  // A bandpass has wide skirts; the highpass under it is what actually
  // keeps the strike out of the low mids.
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 1500
  const env = ac.createGain()
  const dur = 0.011 * fine * vary(0.18)
  env.gain.setValueAtTime(0.05 * fine * vary(0.18), now)
  env.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  src.connect(bp)
  bp.connect(hp)
  hp.connect(env)
  env.connect(ac.destination)
  src.start(now, Math.random() * 0.05)
  src.stop(now + dur + 0.01)

  // 2. the ring
  strike(ac, 'sine', (4300 + voice * 600) * vary(0.05), 0.007 * fine * vary(0.25), 0.012 * vary(0.2))

  // 3. the seat
  strike(ac, 'sine', 420 * vary(0.08), 0.0045 * fine * vary(0.2), 0.016 * vary(0.15))
}

// ── the switch's voice, derived from the switch ─────────────────────────
//
// A dial's click is a texture and can be tuned by ear. A toggle's is a
// portrait: it is the one moment the whole mechanism speaks, and a
// listener places the size, the material and the quality of the thing
// from it alone. So none of the numbers below are chosen by ear. They
// come from the bat's real dimensions in knobsGeometry and from the same
// spring the lever actually swings on, which means the sound cannot
// drift away from the motion — retune LEVER_SPRING and the strike moves
// with it.

/** The scene's scale. knobsResize states the layout rule that a rotary
 *  is 20 mm across at every panel width; KNOB.skirtRadius is the px that
 *  makes it. Everything else in knobsGeometry is px, so this one number
 *  turns the hardware into millimetres. */
export const MM_PER_PX = 20 / (KNOB.skirtRadius * 2)

/** The one empirical anchor in this file: a small steel part about 10 mm
 *  across rings near 3 kHz when struck. Every frequency below is that
 *  anchor scaled by size — geometrically similar parts of one material
 *  ring at f ∝ 1/size, which is exact — so the anchor is the only guess
 *  here, and it is a single one that can be moved in a single place. */
const REF_MM = 10
const REF_HZ = 3000

/** The note a struck part `mm` across sounds. */
export function ringHz(mm: number): number {
  return (REF_HZ * REF_MM) / mm
}

/** How long that note lasts: τ = Q / (π f). Q is damping — material and
 *  mounting together — and it is the only per-part choice made here. */
export function ringDecay(hz: number, q: number): number {
  return q / (Math.PI * hz)
}

/** The bat is tight steel seated in a collar. It barely rings at all,
 *  and that near-absence of tail is exactly what separates a machined
 *  switch from a molded one: cheap parts are the ones that sing. */
const BAT_Q = 15

/** The slab is a wide plate on soft mounts, so it keeps its note. */
const SLAB_Q = 55

/** The bat's own note, from its own length. */
export const BAT_HZ = ringHz(TOGGLE.leverLength * MM_PER_PX)

/** The slab's note, from its span. Fixed at the narrowest panel: a
 *  resized slab would really shift this, and that is not modelled. */
export const SLAB_HZ = ringHz(PANEL_MIN_W * MM_PER_PX)

export interface LeverVoice {
  /** rad/s the bat leaves at: the detent letting go. */
  release: number
  /** rad/s the bat still carries when it reaches its stop, and how many
   *  times it goes past that stop. Both are zero for a lever that
   *  arrives instead of landing. */
  arrival: number
  rattle: number
  /** Seconds from the release to the arrival. */
  travel: number
}

/**
 * The only two moments in a flip that can make a noise.
 *
 * Sound needs an impact, so the question is not "what does a switch
 * sound like" but "what in this motion actually hits something". Run the
 * lever's REAL integrator and ask it. The answer is not what it was: the
 * old spring (ζ = 0.32) reached its stop still doing the full 26 rad/s
 * and slammed past it fourteen times — a throw and then a rattle. The
 * critically damped lever reaches the same stop at 0.88 rad/s and never
 * crosses it. Thirty times quieter is not quieter; it is silent.
 *
 * So there is one impact, at the release, and the sweep that follows is
 * a bat moving through air. Nothing else is invented to fill it.
 */
export function leverVoice(): LeverVoice {
  const s: SpringState = { x: TOGGLE.throw, v: -LEVER_THROW }
  const stop = -TOGGLE.throw
  const near = 0.5 / TOGGLE.leverLength // half a pixel at the tip
  const h = 1 / 2000
  let rattle = 0
  let prev = s.x
  let arrival = 0
  let travel = 0
  for (let i = 1; i <= 4000; i++) {
    stepSpring(s, stop, LEVER_SPRING, h)
    if (Math.sign(s.x - stop) !== Math.sign(prev - stop)) rattle++
    prev = s.x
    if (!travel && Math.abs(s.x - stop) < near) {
      travel = i * h
      arrival = Math.abs(s.v)
    }
  }
  return { release: LEVER_THROW, arrival, rattle, travel }
}

/** Constant while the constants are, so it is measured once. */
const VOICE = leverVoice()

/** An arrival slower than this is buried under the release's own decay
 *  and there is nothing to play. Roughly a sixth of the release speed —
 *  about 15 dB down, under a strike that is still sounding. */
export const AUDIBLE_ARRIVAL = 4

/**
 * A bat switch thrown.
 *
 * One impact, three layers of it — a strike is one event heard through
 * every body it travels into:
 *
 *   1. the release — the detent letting go. Broadband, because an impact
 *      is broadband, shaped by a bandpass at the bat's own note.
 *   2. the bat — its single high partial, dead inside a few milliseconds
 *      at BAT_Q. Alone it is inaudible; it is what makes the release
 *      read as metal rather than as a tap.
 *   3. the slab — the counter-thunk the physics already models as
 *      PANEL_KICK: the panel taking the blow, low and brief.
 *
 * Then a fourth that does not play. The arrival is written as a real
 * branch, not deleted, because it is real: a lever that lands hard
 * SHOULD be heard landing. It is gated on the measured arrival speed, so
 * retuning LEVER_SPRING back toward a bounce buys the clack back by
 * itself, and nobody has to remember that the sound needs updating too.
 *
 * The jitter is a tenth of the dial's. A precision switch repeats: two
 * throws of one bat sound the same, and that sameness IS the quality
 * signal. The variation here is only enough to keep two fast flips from
 * phasing into a single machine noise.
 */
export function thunkToggle() {
  const ac = ensure()
  if (!ac) return
  strikeBody(ac, 1, 0)

  // The arrival — silent today at 0.88 rad/s against a threshold of 4.
  if (VOICE.arrival >= AUDIBLE_ARRIVAL) {
    strikeBody(ac, VOICE.arrival / VOICE.release, VOICE.travel)
  }
}

/** One impact of relative hardness `f`, `at` seconds from now. */
function strikeBody(ac: AudioContext, f: number, at: number) {
  const src = ac.createBufferSource()
  src.buffer = noise(ac)
  src.playbackRate.value = vary(0.04)
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = BAT_HZ * vary(0.03)
  bp.Q.value = 1.1
  // A bandpass has wide skirts; the highpass is what keeps the strike
  // out of the low mids, where the slab is meant to be the only voice.
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 900
  const env = ac.createGain()
  const dur = 0.009 * vary(0.05)
  const now = ac.currentTime + at
  env.gain.setValueAtTime(0.075 * f * vary(0.05), now)
  env.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  src.connect(bp)
  bp.connect(hp)
  hp.connect(env)
  env.connect(ac.destination)
  src.start(now, Math.random() * 0.05)
  src.stop(now + dur + 0.01)

  strike(ac, 'sine', BAT_HZ * vary(0.02), 0.02 * f, ringDecay(BAT_HZ, BAT_Q) * 4, at)
  strike(ac, 'sine', SLAB_HZ * vary(0.02), 0.09 * f, ringDecay(SLAB_HZ, SLAB_Q), at)
}
