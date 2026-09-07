// The arbitration law: which of the two canvas-side routes hears the pointer.
//
// Pure — no DOM, no matrices, no clock. Everything here is a function of one
// request and six observed booleans, and the whole point of writing it that
// way is that the
// truth table can be enumerated rather than sampled. A route decided by flags
// scattered across a presenter cannot be enumerated, which is how two of them
// end up true at once.
//
// The contract has three parts and they are not interchangeable:
//   1. the verdict     — `routeFor`, total over every combination
//   2. the duties      — what a route does while it owns input, and the
//                        exclusivity that makes "exactly one owner" checkable
//   3. the handoff     — the difference of two routes' duties, in call order

import { describe, expect, it } from 'vitest'
import {
  pointerRouteDuties,
  pointerRouteHandoff,
  routeFor,
  type PointerRoute,
  type PointerRouteConditions,
  type PointerRouteRequest,
} from '@munari/core'

const REQUESTS: PointerRouteRequest[] = ['auto', 'relay']
const ROUTES: PointerRoute[] = ['page', 'native', 'relay']

/** Every condition true — the one combination that yields the native route. */
const NATIVE: PointerRouteConditions = {
  request: 'auto',
  capable: true,
  exclusiveSource: true,
  hearing: true,
  planar: true,
  facing: true,
  onScreen: true,
}

/** The six booleans, so a case can name the one it turns off. */
const FLAGS = ['capable', 'hearing', 'planar', 'facing', 'onScreen', 'exclusiveSource'] as const

/** All 2⁶ × 2 condition sets. */
function everyCondition(): PointerRouteConditions[] {
  const out: PointerRouteConditions[] = []
  for (const request of REQUESTS) {
    for (let bits = 0; bits < 64; bits++) {
      out.push({
        request,
        capable: (bits & 1) !== 0,
        hearing: (bits & 2) !== 0,
        planar: (bits & 4) !== 0,
        facing: (bits & 8) !== 0,
        onScreen: (bits & 16) !== 0,
        exclusiveSource: (bits & 32) !== 0,
      })
    }
  }
  return out
}

describe('the verdict', () => {
  it('is total — every combination of conditions names a route', () => {
    // A law with a hole in it is a frame with no pointer owner at all, and
    // nothing downstream can tell that apart from "the content ignored you".
    for (const conditions of everyCondition()) {
      expect(ROUTES).toContain(routeFor(conditions))
    }
  })

  it('takes the native route only when every condition allows it', () => {
    expect(routeFor(NATIVE)).toBe('native')
    // Each condition is individually necessary. Stated as a sweep rather than
    // six hand-written cases so a seventh condition added to the type cannot be
    // added to the law without a case here to match.
    for (const flag of FLAGS) {
      expect(routeFor({ ...NATIVE, [flag]: false })).not.toBe('native')
    }
    expect(routeFor({ ...NATIVE, request: 'relay' })).toBe('relay')
  })

  it('leaves the pointer with the page whenever the canvas is not hearing', () => {
    // `crossingPointer` (decisions.md #33) already settled page-or-canvas per
    // phase. This law refines the canvas side and never overrules it: a
    // Surface drawn by the page hears nothing on either canvas route, however
    // capable and however planar.
    for (const conditions of everyCondition()) {
      if (conditions.hearing) continue
      expect(routeFor(conditions)).toBe('page')
    }
  })

  it('falls back to the relay for every canvas case the native route declines', () => {
    // The relay has no preconditions of its own on purpose. A fallback that
    // could also decline would leave combinations where the canvas hears the
    // pointer and neither route delivers it.
    for (const conditions of everyCondition()) {
      if (!conditions.hearing) continue
      const route = routeFor(conditions)
      expect(route === 'native' || route === 'relay').toBe(true)
    }
  })

  it('is a pure function of the conditions', () => {
    // No memo, no last-frame state, no hysteresis. A route that remembered
    // would answer differently for the same pose depending on how it arrived,
    // and the handoff duties would then run against the wrong "before".
    for (const conditions of everyCondition()) {
      expect(routeFor(conditions)).toBe(routeFor({ ...conditions }))
    }
  })
})

describe('the duties', () => {
  it('never gives one route both duties', () => {
    // This is "exactly one route owns input", written where it can fail. The
    // fault it guards is decision #33's at a smaller scale: one press heard
    // twice by the same copy, so a counter counts two and a toggle returns to
    // where it started (measured 2026-08-19, gate:lifting-pointer — 3/3 clicks
    // to the wrong copy when two paths were live at once).
    for (const route of ROUTES) {
      const duties = pointerRouteDuties(route)
      expect(duties.relays && duties.rides).toBe(false)
    }
  })

  it('gives the page route no duties at all', () => {
    expect(pointerRouteDuties('page')).toEqual({ relays: false, rides: false })
  })

  it('gives exactly one route each duty', () => {
    expect(ROUTES.filter((r) => pointerRouteDuties(r).relays)).toEqual(['relay'])
    expect(ROUTES.filter((r) => pointerRouteDuties(r).rides)).toEqual(['native'])
  })
})

describe('the handoff', () => {
  it('is empty when the route did not move', () => {
    for (const route of ROUTES) {
      const handoff = pointerRouteHandoff(route, route)
      expect(handoff.moved).toBe(false)
      expect(handoff.closeRelay).toBe(false)
      expect(handoff.park).toBe(false)
      expect(handoff.lift).toBe(false)
      expect(handoff.rearmRelay).toBe(false)
      expect(handoff.bridgePage).toBe(false)
    }
  })

  it('never pairs a route\'s outgoing duty with its own incoming one', () => {
    // The ordering law, as a shape rather than a convention. Both routes speak
    // through the same DOM and the relay reads the drawn root's UNTRANSFORMED
    // layout box, so a handoff that re-armed the relay while the rig still
    // held its transform would read the transformed AABB and land the arrival
    // hover somewhere else entirely — which looks exactly like a rounding bug
    // and is not one.
    for (const from of ROUTES) {
      for (const to of ROUTES) {
        const handoff = pointerRouteHandoff(from, to)
        expect(handoff.closeRelay && handoff.rearmRelay).toBe(false)
        expect(handoff.park && handoff.lift).toBe(false)
      }
    }
  })

  it('hands the relay off to the rig, and back', () => {
    expect(pointerRouteHandoff('relay', 'native')).toEqual({
      from: 'relay',
      to: 'native',
      closeRelay: true,
      park: false,
      lift: true,
      rearmRelay: false,
      bridgePage: false,
      moved: true,
    })
    expect(pointerRouteHandoff('native', 'relay')).toEqual({
      from: 'native',
      to: 'relay',
      closeRelay: false,
      park: true,
      lift: false,
      rearmRelay: true,
      bridgePage: false,
      moved: true,
    })
  })

  it('bridges the hover to the page copy from either canvas route', () => {
    // A landing hands the pixels back to the page, and the page copy has no
    // :hover until the user moves again — so both canvas routes owe the same
    // arrival stamp. Missing it on one route is a panel that lands unhovered
    // only under the origin trial.
    expect(pointerRouteHandoff('relay', 'page').bridgePage).toBe(true)
    expect(pointerRouteHandoff('native', 'page').bridgePage).toBe(true)
    expect(pointerRouteHandoff('page', 'page').bridgePage).toBe(false)
  })

  it('parks the rig on the way to the page, and lifts it on the way back', () => {
    expect(pointerRouteHandoff('native', 'page').park).toBe(true)
    expect(pointerRouteHandoff('page', 'native').lift).toBe(true)
    expect(pointerRouteHandoff('page', 'native').closeRelay).toBe(false)
  })

  it('closes the relay on the way to the page, and re-arms it on the way back', () => {
    expect(pointerRouteHandoff('relay', 'page').closeRelay).toBe(true)
    expect(pointerRouteHandoff('page', 'relay').rearmRelay).toBe(true)
    expect(pointerRouteHandoff('page', 'relay').park).toBe(false)
  })

  it('leaves no duty owned by nobody', () => {
    // Every duty a departing route was performing is cancelled, and every duty
    // the arriving route needs is started. Derived from the two duty sets so a
    // new duty cannot be added to the handoff without a rule that assigns it.
    for (const from of ROUTES) {
      for (const to of ROUTES) {
        const before = pointerRouteDuties(from)
        const after = pointerRouteDuties(to)
        const handoff = pointerRouteHandoff(from, to)
        expect(handoff.closeRelay).toBe(before.relays && !after.relays)
        expect(handoff.rearmRelay).toBe(!before.relays && after.relays)
        expect(handoff.park).toBe(before.rides && !after.rides)
        expect(handoff.lift).toBe(!before.rides && after.rides)
      }
    }
  })
})
