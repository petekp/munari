import { describe, expect, it } from 'vitest'

import { DENSITY_BAND, storeForBox, uploadNeedsRealloc, type TextureStore } from '@anamorph/core'

// GL texture storage is IMMUTABLE. three allocates it at first-upload
// dimensions (texStorage2D) and texSubImage2Ds every upload after, so the
// moment a source canvas's backing store changes size, every subsequent
// upload is writing into an allocation that no longer fits it. A grow is
// rejected outright — GL_INVALID_VALUE, "Offset overflows texture dimensions"
// — and the texture silently keeps its stale texels. Nothing throws in JS.
//
// This was found by a lab that resizes a Surface EVERY FRAME (a card whose
// layout width is swept from a tile's box to an article's box). The shipped
// policy deferred the reallocation until "the first upload after the
// post-resize paint lands", which is correct for an occasional resize and
// unreachable for a continuous one: the mark was re-armed on every commit, so
// it chased the paint counter forever and the dispose fired three times in a
// flight of a hundred and twenty. Traced at the GL boundary: one
// `ALLOC 308x324` followed by uploads at 400x372, 520x468, 811x498 — all
// rejected, all invisible.
//
// The law below is deliberately not a schedule. It compares the allocation to
// the store and answers about THIS upload, so there is no mark to be re-armed
// and no way for a fast resize to outrun it.

describe('uploadNeedsRealloc', () => {
  it('is false when the allocation already matches the store', () => {
    expect(uploadNeedsRealloc({ width: 512, height: 256 }, { width: 512, height: 256 })).toBe(false)
  })

  it('is true on a grow — the sub-image would overflow and be rejected', () => {
    expect(uploadNeedsRealloc({ width: 308, height: 324 }, { width: 400, height: 372 })).toBe(true)
  })

  it('is true on a shrink — the re-raster would land in one corner (the LOD ghost)', () => {
    // A shrink does not fail GL: it succeeds, writing the smaller image into
    // the top-left of the larger allocation and leaving the rest of the old
    // texels on screen around it.
    expect(uploadNeedsRealloc({ width: 800, height: 600 }, { width: 400, height: 300 })).toBe(true)
  })

  it('is true on a change to either axis alone', () => {
    expect(uploadNeedsRealloc({ width: 512, height: 256 }, { width: 512, height: 257 })).toBe(true)
    expect(uploadNeedsRealloc({ width: 512, height: 256 }, { width: 513, height: 256 })).toBe(true)
  })

  it('is true when nothing has been allocated yet', () => {
    expect(uploadNeedsRealloc(null, { width: 64, height: 64 })).toBe(true)
  })

  it('cannot be outrun by a source that resizes every frame', () => {
    // The regression, as a loop. A hundred and twenty frames of a flight, the
    // box growing on every one of them, and the invariant is that after each
    // upload the allocation is EXACTLY the store it just uploaded — never one
    // frame behind, whatever order the resizes and paints arrive in.
    let alloc: { width: number; height: number } | null = null
    let uploads = 0
    let reallocs = 0
    for (let f = 0; f < 120; f++) {
      const store = { width: 308 + Math.round(f * 4.2), height: 324 + Math.round(f * 1.4) }
      if (uploadNeedsRealloc(alloc, store)) {
        reallocs++
        alloc = { ...store }
      }
      uploads++
      expect(alloc).toEqual(store)
    }
    expect(uploads).toBe(120)
    // Every frame really did change size here, so every frame really does
    // need storage. The point is not that it is cheap — it is that it is
    // never WRONG. (A Surface that is not being resized asks and is told no.)
    expect(reallocs).toBe(120)
  })

  // The hole this predicate CANNOT see on its own, and the law that closes it.
  //
  // `uploadNeedsRealloc` compares the allocation to the store, so it is only
  // ever as truthful as the allocation it is handed — and the allocation is
  // not made by the upload path. It is made by the RENDERER, the first time it
  // draws a material whose map has `needsUpdate` set, at whatever the canvas
  // measures in that instant. A Surface sets `needsUpdate` twice before any
  // upload runs (the filter policy at texture birth, and the mirror effect),
  // and r3f draws from its own loop, so the immutable `texStorage2D` routinely
  // lands BEFORE the first `upload()` — and if the canvas has been re-cut in
  // between, the first upload records a baseline that was never allocated.
  //
  // After that the ledger and the driver agree with each other forever about a
  // size neither of them is using. Traced at the GL boundary 2026-08-04 on the
  // passage scene's live counter: `texStorage2D 308x43` once, then
  // `texSubImage2D 940x106` returning 1281 on every frame of the flight, with
  // the predicate below answering `false` to all of them — correctly, from a
  // baseline that was a lie. On screen: a mesh that is present, visible,
  // correctly placed, holding a texture whose canvas demonstrably has ink in
  // it, and drawing nothing at all.
  //
  // So the baseline has to be seeded where the allocation is ARMED, not where
  // the first upload happens to observe it.
  it('is only as truthful as the baseline it is seeded from', () => {
    const birth = { width: 308, height: 43 } // what texStorage2D really took
    const grown = { width: 940, height: 106 } // the canvas by the first upload

    // Seeded at first upload: the ledger adopts the grown store as though it
    // were the allocation, and never disagrees with itself again.
    let late: TextureStore | null = null
    let lateReallocs = 0
    for (let f = 0; f < 60; f++) {
      if (uploadNeedsRealloc(late, grown)) {
        lateReallocs++
        late = { ...grown }
      }
    }
    expect(lateReallocs).toBe(1) // one bookkeeping entry, zero real storage
    expect(uploadNeedsRealloc(late, grown)).toBe(false) // ...and silence, forever

    // Seeded at birth: the very first upload sees the mismatch that the driver
    // is about to reject, and disposes ahead of it.
    let early: TextureStore | null = { ...birth }
    let earlyReallocs = 0
    for (let f = 0; f < 60; f++) {
      if (uploadNeedsRealloc(early, grown)) {
        earlyReallocs++
        early = { ...grown }
      }
    }
    expect(earlyReallocs).toBe(1)
    expect(early).toEqual(grown)
  })

  it('costs nothing on a Surface that is merely repainting', () => {
    const store = { width: 640, height: 480 }
    let alloc: { width: number; height: number } | null = null
    let reallocs = 0
    for (let f = 0; f < 600; f++) {
      if (uploadNeedsRealloc(alloc, store)) {
        reallocs++
        alloc = { ...store }
      }
    }
    expect(reallocs).toBe(1)
  })
})

// Writing `canvas.width` clears the backing store, and the repaint that
// refills it belongs to the compositor's schedule, not to the frame that
// asked. So a store cut to the box EXACTLY, on a Surface whose box moves
// every frame, is blank at every upload — measured on the passage flight as
// coverage 0/576 on 38 of 40 frames. The two exceptions are the tell: both
// were frames whose width happened to repeat, and on those the canvas was
// full. The store has to stop tracking the box.

describe('storeForBox', () => {
  it('cuts exactly when there is no store yet', () => {
    expect(storeForBox(308, 324, 2, null)).toEqual({ width: 616, height: 648 })
  })

  it('keeps the store while the density it implies stays in the band', () => {
    const store = { width: 616, height: 648 }
    // The box grew by a fifth; the store now supplies 1.67 px/px against a
    // target of 2. Inside ±40%, so nothing is cleared.
    expect(storeForBox(370, 389, 2, store)).toBe(store)
  })

  it('re-cuts once the box has outgrown the band', () => {
    const store = { width: 616, height: 648 }
    // 616/450 = 1.37 px/px, below 2/1.4 = 1.43.
    expect(storeForBox(450, 470, 2, store)).toEqual({ width: 900, height: 940 })
  })

  it('re-cuts when the box shrinks far enough to be oversupplied', () => {
    const store = { width: 1878, height: 996 }
    expect(storeForBox(308, 324, 2, store)).toEqual({ width: 616, height: 648 })
  })

  it('is decided by whichever axis leaves the band first', () => {
    const store = { width: 616, height: 648 }
    // Width is comfortably inside; height alone has drifted out. Both axes
    // are re-cut, because writing either attribute clears the whole canvas —
    // there is no such thing as re-cutting one axis cheaply.
    expect(storeForBox(320, 500, 2, store)).toEqual({ width: 640, height: 1000 })
  })

  it('re-cuts on a density change the band cannot absorb, box unmoved', () => {
    const store = { width: 616, height: 648 }
    expect(storeForBox(308, 324, 2, store)).toBe(store)
    expect(storeForBox(308, 324, 2.5, store)).toBe(store) // 2 is within 2.5/1.4
    expect(storeForBox(308, 324, 3, store)).toEqual({ width: 924, height: 972 })
  })

  it('turns a per-frame clear into a handful — the passage flight', () => {
    // The real sweep: a card growing from a tile's box to an article's box
    // over 120 frames at dpr 2. Count how many frames would have cleared the
    // canvas under the exact-fit rule, and how many do under the band.
    let store: { width: number; height: number } | null = null
    let cuts = 0
    let exactCuts = 0
    let prevExact: string | null = null
    for (let f = 0; f < 120; f++) {
      const t = f / 119
      const w = 308 + (939 - 308) * t
      const h = 324 + (498 - 324) * t
      const next = storeForBox(w, h, 2, store)
      if (next !== store) cuts++
      store = next
      const exact = `${Math.round(w * 2)}x${Math.round(h * 2)}`
      if (exact !== prevExact) exactCuts++
      prevExact = exact
    }
    expect(exactCuts).toBe(120)
    expect(cuts).toBeLessThanOrEqual(5)
    // And the store the card lands on still supplies a real density.
    expect(store!.width / 939).toBeGreaterThan(2 / DENSITY_BAND)
  })

  it('never returns a degenerate store', () => {
    expect(storeForBox(0, 0, 2, null)).toEqual({ width: 1, height: 1 })
    expect(storeForBox(0.2, 0.2, 0.1, null)).toEqual({ width: 1, height: 1 })
  })
})
