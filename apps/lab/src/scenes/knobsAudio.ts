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

/** One strike: an oscillator with an exponential decay envelope. */
function strike(ac: AudioContext, type: OscillatorType, freq: number, gain: number, decay: number) {
  const now = ac.currentTime
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

/** A bat lever landing: a low body thump under a small metallic tick. */
export function thunkToggle() {
  const ac = ensure()
  if (!ac) return
  strike(ac, 'sine', 150, 0.1, 0.09)
  strike(ac, 'triangle', 1000, 0.02, 0.012)
}
