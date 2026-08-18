// @vitest-environment happy-dom
//
// Provenance through React's wrapper — `isRelayedEvent`.
//
// The brand is written on the event the library DISPATCHED. React hands a
// component a synthetic wrapper instead, and does not copy unknown
// properties onto it, so `isRelayed` given a wrapper answers `false` for
// every relay. A component guarding with the wrong one is guarding nothing,
// and the symptom is not a crash: it is the library's own retellings being
// processed as the hand, at parked-source coordinates, in the corner of
// whatever the listener controls.
import { describe, expect, it } from 'vitest'
import { isRelayedEvent, relay } from '@munari/core'

/** What React hands a handler: a wrapper carrying the platform event. */
const synthetic = (nativeEvent: Event) => ({ nativeEvent })

const relayed = () => {
  const target = document.createElement('div')
  const ev = new Event('pointermove')
  relay(target, ev)
  return ev
}

describe('relay provenance through a synthetic wrapper', () => {
  it('reads the brand off the wrapped platform event', () => {
    const ev = relayed()
    expect(isRelayedEvent(synthetic(ev))).toBe(true)
  })

  it('consults the wrapped event, not the wrapper', () => {
    // The wrapper is fresh every time and carries no brand of its own, so
    // the only thing that can make this answer true is the event inside it.
    const ev = relayed()
    expect(isRelayedEvent({ nativeEvent: ev })).toBe(true)
    expect(isRelayedEvent({ nativeEvent: new Event('pointermove') })).toBe(false)
  })

  it('answers for a bare platform event too, so one guard covers both', () => {
    expect(isRelayedEvent(relayed())).toBe(true)
    expect(isRelayedEvent(new Event('pointermove'))).toBe(false)
  })

  it('an unbranded wrapper is the hand', () => {
    expect(isRelayedEvent(synthetic(new Event('pointermove')))).toBe(false)
  })
})
