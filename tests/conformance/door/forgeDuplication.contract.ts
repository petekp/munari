// CONFORMANCE CONTRACT — door (typechecked, not yet run)
// New contract (owed by seed manifest): the door duplication test — the forge brand lives in the global symbol registry, so two module instances recognize each other's forgeries; a module-local Symbol() must fail exactly this (archive#50)
//
// The measured condition (2026-08-01): after a dev-server restart, a
// tab held two instances of a pre-bundled dependency — toast() fired
// in one, <Toaster> subscribed in the other, nothing errored, toasts
// simply never appeared. The same split-brain aimed at the door would
// mean one instance's forgeries are invisible to the other's
// isForgedEvent, and every provenance guard silently inverts. The
// oracle hardened forge() with a Symbol.for brand — registry-global,
// HMR-proof — and keeps the symbol PRIVATE (one door: nothing can
// brand an event except forge). This contract pins the property
// behaviorally, since the brand itself must never be exported.
import { describe, expect, it } from 'vitest'

// ---- CONTRACT HOLES ------------------------------------------------
type DoorModule = {
  /** Brand ev and dispatch it on target; returns dispatchEvent's verdict. */
  forge: (target: EventTarget, ev: Event) => boolean
  isForgedEvent: (ev: Event) => boolean
}
/**
 * At the flip this becomes, inline:
 *   vi.resetModules(); return await import('@anamorph/core')
 * — vitest's module reset manufactures the two-instances condition the
 * incident measured, without leaving the test process.
 */
declare function loadDoorModule(): Promise<DoorModule>
// --------------------------------------------------------------------

describe('the door duplication test', () => {
  it('a forgery from one module instance satisfies the other instance', async () => {
    const a = await loadDoorModule()
    const b = await loadDoorModule()
    // The test is vacuous unless these really are two instances.
    expect(a.forge).not.toBe(b.forge)

    const target = new EventTarget()
    const ev = new Event('pointermove')
    a.forge(target, ev)
    expect(a.isForgedEvent(ev)).toBe(true)
    expect(b.isForgedEvent(ev)).toBe(true)
  })

  it('nothing is forged until forge says so', async () => {
    const { isForgedEvent } = await loadDoorModule()
    const ev = new Event('pointermove')
    new EventTarget().dispatchEvent(ev)
    // Dispatching does not brand; only the door does. The predicate is
    // complete because the brand has exactly one writer (archive#50).
    expect(isForgedEvent(ev)).toBe(false)
  })

  it('demonstrates the law: a module-local Symbol() cannot cross instances', () => {
    // Self-contained counterfactual, no kernel involved: simulate two
    // module instances each building the brand both ways. The
    // registry-keyed symbol is the same symbol in both; the local
    // symbol is not, and its cross-instance predicate fails — which is
    // why the kernel's brand MUST be Symbol.for, not Symbol.
    const instance = () => ({
      registryBrand: Symbol.for('anamorph.contract-demo.forged'),
      localBrand: Symbol('anamorph.contract-demo.forged'),
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
