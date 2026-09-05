// @vitest-environment happy-dom
//
// The crystal's parking key: `p` parks the glass so the tweak panel becomes
// reachable. The handler is a `window` keydown listener (see
// crystalParkingKey.ts); this suite drives it as DOM against the REAL
// attach — the same pattern as flightGestures.test.ts. No jsdom is
// configured in this workspace, and the lab never renders React in unit
// tests, so the listener is exercised in isolation, not through CrystalApp.
//
// The fault this pins: a held `p` is one physical press, so it must leave
// `parked` in ONE stable state — toggle once and stay. The OS auto-repeats
// the keydown (~30 Hz, OS- and user-settings-dependent) with
// `KeyboardEvent.repeat === true`; acting on those would flip `parked` once
// per repeat and land on whichever parity the count reaches. The decisive
// case is the 6th keydown flipping `parked` to false — a single held press
// should never unpark the crystal. Only the initial keydown toggles.

import { afterEach, describe, expect, it } from 'vitest'
import { attachCrystalParking } from './crystalParkingKey'

/**
 * A `p` keydown stamped `repeat` to model the OS auto-repeat train.
 *
 * happy-dom's `KeyboardEvent` constructor reads `repeat` straight off the
 * init (the platform default is `false`, so omitting it is the initial
 * press). The real OS mints `repeat === true` for every auto-repeat; here
 * we stand in for the platform, the same way flightGestures.test.ts shadows
 * `isTrusted`.
 */
function pressP(repeat: boolean, key: string = 'p'): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, repeat, bubbles: true })
}

let detach: (() => void) | null = null
afterEach(() => {
  detach?.()
  detach = null
})

/** Attach the parking key to a toggle that flips `parked` and counts it. */
function attachParked() {
  const state = { parked: false, toggles: 0 }
  detach = attachCrystalParking({
    onToggle: () => {
      state.parked = !state.parked
      state.toggles += 1
    },
  })
  return state
}

describe('the parking key', () => {
  it('a single tap of p parks the crystal', () => {
    const state = attachParked()
    window.dispatchEvent(pressP(false))
    expect(state.parked).toBe(true)
    expect(state.toggles).toBe(1)
  })

  it('a second separate tap unparks it (the checkbox is not the only way out)', () => {
    const state = attachParked()
    window.dispatchEvent(pressP(false))
    window.dispatchEvent(pressP(false))
    expect(state.parked).toBe(false)
    expect(state.toggles).toBe(2)
  })

  it('a held p toggles at most once: auto-repeat does not oscillate parked', () => {
    // One real press (repeat=false) parks, then the OS auto-repeat train
    // (repeat=true) fires while the key is held. With the bug, each repeat
    // flipped parked: true -> false -> true -> false -> true. The decisive
    // case is the 6th keydown flipping parked to false — a single held
    // press should never unpark the crystal. With the fix the repeats are
    // dropped and parked stays where the initial press left it.
    const state = attachParked()
    window.dispatchEvent(pressP(false))
    for (let i = 0; i < 6; i++) window.dispatchEvent(pressP(true))
    expect(state.parked).toBe(true)
    expect(state.toggles).toBe(1)
  })

  it('a long hold stays parked across thirty repeats (it is not a parity race)', () => {
    // The default OS cadence is ~30 Hz; holding `p` for a full second is a
    // plausible developer gesture while tuning. With the bug this is ~30
    // flips, and the resting parity depends only on the count.
    const state = attachParked()
    window.dispatchEvent(pressP(false))
    for (let i = 0; i < 30; i++) window.dispatchEvent(pressP(true))
    expect(state.parked).toBe(true)
    expect(state.toggles).toBe(1)
  })

  it('the repeat guard is total: a repeat keydown never toggles, even first', () => {
    // An auto-repeat that arrives without a preceding initial press (a
    // window that gained focus mid-hold, or a synthesized test) must still
    // be a no-op: the guard is `repeat`-first, so it never reaches the key
    // check or the toggle.
    const state = attachParked()
    window.dispatchEvent(pressP(true))
    expect(state.parked).toBe(false)
    expect(state.toggles).toBe(0)
  })

  it('a press after release toggles again: two physical presses both count', () => {
    // The repeat guard is about a single HELD press. Separate presses — an
    // initial keydown, a keyup, then another initial keydown — each start
    // with `repeat === false`, so each toggles. Parking is a toggle, not a
    // one-shot.
    const state = attachParked()
    window.dispatchEvent(pressP(false))
    window.dispatchEvent(pressP(false))
    window.dispatchEvent(pressP(false))
    expect(state.toggles).toBe(3)
    expect(state.parked).toBe(true)
  })

  it('Shift-P still parks: shift is not in the modifier guard', () => {
    // The key match is case-insensitive on purpose, and shift is not a
    // guarded modifier, so an uppercase `P` is the same gesture as `p`. Its
    // own auto-repeat still sets `repeat === true`, so only the initial
    // press toggles.
    const state = attachParked()
    const e = new KeyboardEvent('keydown', { key: 'P', repeat: false, bubbles: true, shiftKey: true })
    window.dispatchEvent(e)
    expect(state.parked).toBe(true)
    expect(state.toggles).toBe(1)
  })

  it('a held Shift-P toggles at most once', () => {
    const state = attachParked()
    const shiftP = (repeat: boolean) =>
      new KeyboardEvent('keydown', { key: 'P', repeat, bubbles: true, shiftKey: true })
    window.dispatchEvent(shiftP(false))
    for (let i = 0; i < 5; i++) window.dispatchEvent(shiftP(true))
    expect(state.parked).toBe(true)
    expect(state.toggles).toBe(1)
  })

  it('Cmd-P, Ctrl-P and Alt-P are not parking gestures', () => {
    const state = attachParked()
    const withMod = (mod: 'metaKey' | 'ctrlKey' | 'altKey') =>
      new KeyboardEvent('keydown', {
        key: 'p',
        repeat: false,
        bubbles: true,
        [mod]: true,
      })
    window.dispatchEvent(withMod('metaKey'))
    window.dispatchEvent(withMod('ctrlKey'))
    window.dispatchEvent(withMod('altKey'))
    expect(state.parked).toBe(false)
    expect(state.toggles).toBe(0)
  })

  it('a modifier-held repeat keydown does not toggle either', () => {
    // The guard order is repeat, then key, then modifiers; a Cmd-P that
    // also auto-repeats is dropped by `repeat` first, here confirmed not
    // to leak through the modifier check.
    const state = attachParked()
    const e = new KeyboardEvent('keydown', {
      key: 'p',
      repeat: true,
      bubbles: true,
      metaKey: true,
    })
    window.dispatchEvent(e)
    expect(state.toggles).toBe(0)
  })

  it('other keys do not park the crystal', () => {
    const state = attachParked()
    for (const key of ['o', ' ', 'Enter', 'ArrowDown', 'Backspace']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: false, bubbles: true }))
    }
    expect(state.parked).toBe(false)
    expect(state.toggles).toBe(0)
  })

  it('a repeat of an unrelated key is a no-op', () => {
    const state = attachParked()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', repeat: true, bubbles: true }))
    expect(state.toggles).toBe(0)
  })

  it('detach removes the listener: a later p does not toggle', () => {
    const state = { parked: false, toggles: 0 }
    detach = attachCrystalParking({
      onToggle: () => {
        state.parked = !state.parked
        state.toggles += 1
      },
    })
    detach()
    window.dispatchEvent(pressP(false))
    expect(state.parked).toBe(false)
    expect(state.toggles).toBe(0)
  })

  it('re-attaching after detach works again (scene remount)', () => {
    // The effect returns the detach; React calls it on unmount and re-runs
    // on remount, so a second attach must hear the key. This pins the
    // add/remove contract that keeps the listener from leaking or going
    // deaf across a remount.
    const first = attachParked()
    window.dispatchEvent(pressP(false))
    expect(first.parked).toBe(true)
    detach!()
    const second = attachParked()
    second.parked = false
    window.dispatchEvent(pressP(false))
    expect(second.parked).toBe(true)
    expect(second.toggles).toBe(1)
  })
})
