// REGISTRY — Workspace focus-orbit recipe weld.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { arcLayout } from '../../registry/focus-orbit/arcLayout'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('the vendorable files are the Workspace reference', () => {
  for (const file of ['FocusOrbitRig.tsx', 'cameraPose.ts', 'arcLayout.ts']) {
    it(`${file} is byte-identical`, () => {
      expect(read(`registry/focus-orbit/${file}`)).toBe(
        read(`apps/lab/src/scenes/workspace/recipe/${file}`),
      )
    })
  }
})

describe('the cylindrical layout', () => {
  it('makes every requested slot and keeps rows at their authored heights', () => {
    const slots = arcLayout({
      cols: 3,
      rows: 2,
      radius: 7,
      span: Math.PI,
      rowYs: [1, 3],
    })
    expect(slots).toHaveLength(6)
    expect(slots.map((slot) => slot.position[1])).toEqual([1, 1, 1, 3, 3, 3])
  })
})

// ARIA proxy-rect re-projection after an OrbitControls drag (a11y staleness
// fix, introduced by 108c575's release handler). The rig syncs at every
// camera move IT initiates (jump-cut, tween-settle) but OrbitControls moves
// had no sync trigger — proxy `getBoundingClientRect()` returned the pre-
// orbit pose until the next `focusin`. The fix arms a re-projection on
// pointerup and clears it at damping REST in useFrame (OrbitControls fires
// `end` synchronously at pointerup, BEFORE damping settles). These pins guard
// the wiring; the rig's behavior is browser-verified by gate:lab-interactions.
describe('the rig re-projects proxy rects after an OrbitControls drag', () => {
  const rig = read('registry/focus-orbit/FocusOrbitRig.tsx')

  it("types OrbitControls.update() as the boolean three-stdlib returns", () => {
    // `update()` returns true while damping / false at rest; the settle
    // detection below reads that return, so the downcast must keep it boolean
    // (the pre-fix rig typed it `() => void` — the bug's own camouflage).
    expect(rig).toMatch(/update:\s*\(\)\s*=>\s*boolean/)
  })

  it("exposes the sync flag to the browser acceptance route via __workspaceRig", () => {
    // The rig's `__workspaceRig` handle is the acceptance gate's window into
    // rig state; `pending` lets a gate confirm the post-orbit re-projection
    // fired without a wall-clock guess (false == settled/synced). It joins the
    // existing `enabled`/`tweening` exposure.
    expect(rig).toMatch(/pending: orbitPendingSync\.current/)
  })

  it("arms the re-projection and re-enables controls when an orbit drag ends", () => {
    // release() is the only arming site; it stays gated on no active tween so
    // a mid-tween pointerup does not arm (the tween's own settle syncs).
    const releaseStart = rig.indexOf('const release = () => {')
    expect(releaseStart).toBeGreaterThan(-1)
    const noTween = rig.indexOf('tween.current === null', releaseStart)
    expect(noTween).toBeGreaterThan(releaseStart)
    const enable = rig.indexOf('controls.enabled = true', noTween)
    expect(enable).toBeGreaterThan(noTween)
    const arm = rig.indexOf('orbitPendingSync.current = true', enable)
    expect(arm).toBeGreaterThan(enable)
    // pointercancel shares the release path (regression: both stay wired).
    expect(rig).toMatch(/el\.addEventListener\('pointerup', release\)/)
    expect(rig).toMatch(/el\.addEventListener\('pointercancel', release\)/)
    // Grab/wheel cancel stays wired (regression: pre-existing behavior).
    expect(rig).toMatch(/el\.addEventListener\('pointerdown', cancel\)/)
    expect(rig).toMatch(/el\.addEventListener\('wheel', cancel\)/)
  })

  it("syncs exactly once at damping rest, never per frame", () => {
    // The no-tween frame branch: gate on the flag + controls enabled, then
    // sync only when update() reports no further movement (rest).
    const gate = rig.indexOf('if (orbitPendingSync.current && controls?.enabled) {')
    expect(gate).toBeGreaterThan(-1)
    const restIf = rig.indexOf('if (!controls.update()) {', gate)
    expect(restIf).toBeGreaterThan(gate)
    const clearAtRest = rig.indexOf('orbitPendingSync.current = false', restIf)
    expect(clearAtRest).toBeGreaterThan(restIf)
    const orbitSync = rig.indexOf('focus?.syncProxyRects()', clearAtRest)
    expect(orbitSync).toBeGreaterThan(clearAtRest)
    // The orbit sync is the LAST syncProxyRects in the file — it lives in the
    // no-tween branch, AFTER the tween block's `return` (so a tween-active
    // frame never reaches it).
    const tweenSettle = rig.indexOf('if (tw.t >= 1) {')
    const tweenSync = rig.indexOf('focus?.syncProxyRects()', tweenSettle)
    expect(gate).toBeGreaterThan(tweenSync)
  })

  it("calls syncProxyRects exactly at the three sanctioned sync points", () => {
    // jump-cut (rigless instant), tween-settle, and orbit-rest. A fourth call
    // would mean a per-frame or duplicate sync; a fewer count would mean a
    // regression on a sanctioned point. Count the method-call form only.
    const calls = rig.match(/focus\?\.syncProxyRects\(\)/g) ?? []
    expect(calls).toHaveLength(3)
  })

  it("does not regress the rig's own camera-move sync points", () => {
    // Instant (reduced-motion) jump-cut still syncs and cancels a concurrent
    // orbit arm so the next frame does not re-sync redundantly.
    const instant = rig.indexOf('if (instantNow()) {')
    const instantSync = rig.indexOf('focus?.syncProxyRects()', instant)
    expect(instantSync).toBeGreaterThan(instant)
    expect(rig.indexOf('orbitPendingSync.current = false', instantSync)).toBeGreaterThan(
      instantSync,
    )
    // Tween-settle still syncs and cancels a concurrent orbit arm.
    const tweenSettle = rig.indexOf('if (tw.t >= 1) {')
    const tweenSync = rig.indexOf('focus?.syncProxyRects()', tweenSettle)
    expect(tweenSync).toBeGreaterThan(tweenSettle)
    expect(rig.indexOf('orbitPendingSync.current = false', tweenSync)).toBeGreaterThan(
      tweenSync,
    )
  })
})
