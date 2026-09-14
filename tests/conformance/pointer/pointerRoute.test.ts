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
  type PointerRouteConditions,
  type PointerRouteRequest,
} from '@munari/core'

const REQUESTS: PointerRouteRequest[] = ['auto', 'relay']

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
  it('selects the exact route for all 128 condition sets', () => {
    for (const conditions of everyCondition()) {
      const native = conditions.request === NATIVE.request && FLAGS.every(flag => conditions[flag])
      const expected = !conditions.hearing ? 'page' : native ? 'native' : 'relay'
      expect(routeFor(conditions), JSON.stringify(conditions)).toBe(expected)
    }
  })
})

describe('the duties', () => {
  it('gives each route only the input duty it owns', () => {
    expect(pointerRouteDuties('page')).toEqual({ relays: false, rides: false })
    expect(pointerRouteDuties('relay')).toEqual({ relays: true, rides: false })
    expect(pointerRouteDuties('native')).toEqual({ relays: false, rides: true })
  })
})

describe('the handoff', () => {
  it.each([
    ['page', 'page', []],
    ['native', 'native', []],
    ['relay', 'relay', []],
    ['page', 'native', ['lift']],
    ['page', 'relay', ['rearmRelay']],
    ['native', 'page', ['park', 'bridgePage']],
    ['relay', 'page', ['closeRelay', 'bridgePage']],
    ['native', 'relay', ['park', 'rearmRelay']],
    ['relay', 'native', ['closeRelay', 'lift']],
  ] as const)('%s → %s performs only the required handoff duties', (from, to, duties) => {
    const handoff = pointerRouteHandoff(from, to)
    expect(handoff.from).toBe(from)
    expect(handoff.to).toBe(to)
    expect(handoff.moved).toBe(from !== to)
    const active = (['closeRelay', 'park', 'lift', 'rearmRelay', 'bridgePage'] as const)
      .filter(duty => handoff[duty])
    expect(active).toEqual(duties)
  })
})
