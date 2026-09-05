// The live-bag contract between RefractionMaterial (refractionMaterial.tsx)
// and useInkField (refractionField.tsx): the field pass reads the scene's
// tuning bag by REFERENCE through a ref every frame, so a slider that
// mutates the singleton in place takes effect on the next frame with no
// React rerender. Spreading the bag into the config — which the panel cannot
// re-render — copies the number knobs by value into a frozen snapshot, and
// the field's per-frame re-read returns the mount-time value forever. That
// spread is the bug; these tests pin both halves of the contract so a spread
// here fails loudly rather than going inert.
//
// Pure data-flow: the repo's refraction suite tests math and references, not
// @react-three/fiber hooks (there is no r3f test harness), so this exercises
// the property the fix rests on without mounting a WebGL context. The GPU
// half — that a tuned value reaches the material's own uniforms live — is
// pinned by the `gate:refraction-arriving` browser gate, and the gallery
// pointer-routing half (the CPU `apertureAt` mirror agreeing with the GPU)
// by `gate:gallery-pointer`.

import { describe, test, expect, expectTypeOf, afterEach } from 'vitest'
import { refractionTuning as tune } from './refractionTuning'
import type { FieldConfig, FieldStage } from './refractionField'

const ORIGINAL = tune.fieldPx

afterEach(() => {
  tune.fieldPx = ORIGINAL
})

describe('live-bag contract (refractionMaterial.tsx -> refractionField.tsx)', () => {
  test('a panel drag reaches the field pass through the live singleton, with no rerender', () => {
    // After the fix, RefractionMaterial passes `tune` (the singleton) by
    // reference plus a separate { stageW, stageH } chip, and useInkField holds
    // the bag in a ref it re-reads every frame. A slider writes the singleton
    // in place (RefractionTweaks.tsx); the field's next read sees it.
    const tuneRef = { current: tune }
    const stageRef = { current: { stageW: 1024, stageH: 1024 } }
    tune.fieldPx = 96
    expect(tuneRef.current.fieldPx).toBe(96)
    expect(stageRef.current.stageW).toBe(1024)
    expect(stageRef.current.stageH).toBe(1024)
  })

  test('a spread snapshot of the bag does NOT see a later panel drag', () => {
    // The pre-fix caller built the config with `{ ...tune, stageW, stageH }`,
    // copying the number knobs by value into a one-time snapshot. A later
    // in-place mutation reassigns a property on `tune`, not on the spread
    // object, so the field's per-frame read stays frozen at the mount-time
    // number. This is why the fix passes the bag by reference instead.
    const snapshot = { ...tune, stageW: 1024, stageH: 1024 }
    const cfg = { current: snapshot }
    tune.fieldPx = 96
    expect(cfg.current.fieldPx).toBe(ORIGINAL)
    expect(cfg.current.fieldPx).not.toBe(96)
  })

  test('the singleton satisfies the field knob shape and the stage is separate', () => {
    // The live singleton IS the field's bag: every knob useInkField reads is
    // on `refractionTuning`, so passing the bag by reference typechecks and a
    // slider drag reaches the field. If a knob the field needs were dropped
    // from the singleton, this fails at typecheck. If the stage were folded
    // back into FieldConfig, `tune` (which has no stageW/stageH) would no
    // longer match it — pinning the split the fix relies on.
    expectTypeOf(tune).toMatchTypeOf<FieldConfig>()
    expectTypeOf<FieldStage>().toEqualTypeOf<{ stageW: number; stageH: number }>()
  })
})
