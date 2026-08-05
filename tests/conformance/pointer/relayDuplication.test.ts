// The relay duplication test — the relay brand lives in the global
// symbol registry, so two module instances recognize each other's
// relays; a module-local Symbol() must fail exactly this.
//
// The measured condition (2026-08-01): after a dev-server restart, a
// tab held two instances of a pre-bundled dependency — toast() fired
// in one, <Toaster> subscribed in the other, nothing errored, toasts
// simply never appeared. The same split-brain aimed at the relay would
// mean one instance's relays are invisible to the other's
// isRelayed, and every provenance guard silently inverts. relay()
// is hardened with a Symbol.for brand — registry-global, HMR-proof —
// and keeps the symbol PRIVATE (one door: nothing can brand an event
// except relay). This contract pins the property behaviorally, since
// the brand itself must never be exported.
import { describe, expect, it, vi } from 'vitest'

/**
 * vitest's module reset manufactures the two-instances condition the
 * incident measured (2026-08-01: a dev-server restart leaving a tab with
 * two live instances of one module), without leaving the test process.
 */
async function loadRelayModule() {
  vi.resetModules()
  return await import('@munari/core')
}

describe('the relay duplication test', () => {
  it('a relay from one module instance satisfies the other instance', async () => {
    const a = await loadRelayModule()
    const b = await loadRelayModule()
    // The test is vacuous unless these really are two instances.
    expect(a.relay).not.toBe(b.relay)

    const target = new EventTarget()
    const ev = new Event('pointermove')
    a.relay(target, ev)
    expect(a.isRelayed(ev)).toBe(true)
    expect(b.isRelayed(ev)).toBe(true)
  })

  it('nothing is relayed until relay says so', async () => {
    const { isRelayed } = await loadRelayModule()
    const ev = new Event('pointermove')
    new EventTarget().dispatchEvent(ev)
    // Dispatching does not brand; only relay() does. The predicate is
    // complete because the brand has exactly one writer.
    expect(isRelayed(ev)).toBe(false)
  })

  it('demonstrates the law: a module-local Symbol() cannot cross instances', () => {
    // Self-contained counterfactual, no kernel involved: simulate two
    // module instances each building the brand both ways. The
    // registry-keyed symbol is the same symbol in both; the local
    // symbol is not, and its cross-instance predicate fails — which is
    // why the kernel's brand MUST be Symbol.for, not Symbol.
    const instance = () => ({
      registryBrand: Symbol.for('munari.contract-demo.relayed'),
      localBrand: Symbol('munari.contract-demo.relayed'),
    })
    const a = instance()
    const b = instance()
    expect(a.registryBrand).toBe(b.registryBrand)
    expect(a.localBrand).not.toBe(b.localBrand)

    const branded: Record<symbol, true> = {}
    branded[a.localBrand] = true
    expect(b.localBrand in branded).toBe(false)
    branded[a.registryBrand] = true
    expect(b.registryBrand in branded).toBe(true)
  })
})
