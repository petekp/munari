// The LOD schedule — the phase budget a scene of N presenters is spread over.
//
// `SurfacePresenter` evaluates dynamic LOD every LOD_EVERY-th frame,
// phase-offset per presenter so a scene of many panels spreads the projection
// math and never re-rasters a cohort on the same frame. The phase and the
// presenter's tier-ledger key are INDEPENDENT: the key only needs to be
// unique, while the phase must take one slot per presenter across all of
// LOD_EVERY. Sharing one counter folded the budget to its even residues —
// ten slots collapsed to five, and from the sixth presenter on pairs
// collided and ran stepLod on the same frame — so the two draw from
// separate sequences.

export function createLodSchedule(every: number) {
  let phaseSeq = 0
  let keySeq = 0
  return {
    /** The frame residue this presenter runs LOD on; one per presenter. */
    nextPhase: () => phaseSeq++ % every,
    /** This presenter's unique name in the source's tier ledger. */
    nextKey: () => keySeq++,
  }
}
