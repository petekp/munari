// The other thing that bakes at allocation.
//
// `filterPolicyTransition` answers when the MIP COUNT invalidates GL
// storage. This answers when the DIMENSIONS do. Both exist because
// texStorage2D is immutable: three allocates once at first-upload
// size and texSubImage2Ds every upload after, forever, without ever
// re-reading the source's dimensions.
//
// So a source canvas that changes size silently desynchronizes from
// its own texture. A grow is rejected by the driver
// (`GL_INVALID_VALUE: glTexSubImage2DRobustANGLE: Offset overflows
// texture dimensions`) and the texture keeps its stale texels; a
// shrink SUCCEEDS, writing the new image into one corner of the old
// allocation and leaving the previous raster on screen around it.
// Neither raises in JS. Both look like a paint bug.
//
// The predicate is deliberately not a schedule. An earlier policy
// deferred the reallocation to "the first upload after the resize's
// paint lands" — correct for the occasional resize it was written
// for, unreachable for a continuous one, because the deferral mark
// was re-armed by the resize commit every frame and chased the paint
// counter forever. Comparing the allocation to the store at upload
// time has no mark to re-arm and cannot be outrun.

export interface TextureStore {
  width: number
  height: number
}

/**
 * Whether this upload needs fresh GL storage: true unless the current
 * allocation is exactly the source's backing store. `null` means
 * nothing has been allocated yet.
 *
 * Ask on every upload — it is a comparison, and a Surface that is not
 * resizing is told no.
 */
export function uploadNeedsRealloc(
  allocated: TextureStore | null,
  store: TextureStore,
): boolean {
  if (!allocated) return true
  return allocated.width !== store.width || allocated.height !== store.height
}

/**
 * How far the raster density may drift from the one that was asked for
 * before the backing store is re-cut. ±40%: at the low end a card is
 * carrying about half the texels per axis it wants, which is the point
 * where measured text goes visibly soft; at the high end it is oversupplied,
 * which costs memory and nothing else.
 */
export const DENSITY_BAND = 1.4

/**
 * The backing store to raster a `width × height` CSS-px box into at a target
 * density of `density` device px per CSS px — given the store there is now.
 *
 * Returns `current` UNCHANGED whenever the density it already implies
 * (`store / box`, per axis) is inside the band. Only a drift outside it cuts
 * a new store, exactly sized.
 *
 * **Why the store stops tracking the box.** Writing `canvas.width` CLEARS
 * the backing store, and the repaint that refills it is the compositor's to
 * schedule — it lands after the frame that asked. A Surface resized on every
 * frame therefore has a *blank* canvas at every upload: measured on the
 * passage flight as coverage 0/576 on 38 of 40 frames, the two exceptions
 * being the two frames whose width happened to repeat. (This is what the
 * immutable-storage bug above was hiding: the uploads GL rejected were
 * blank, so the stale texels it kept were the only thing on screen.)
 *
 * A canvas is not a framebuffer that has to match its box. The replay is
 * auto-scaled by the backing/CSS ratio (platform.md #8), so a store that is
 * merely CLOSE to the box rasters the same content at a slightly different
 * density — and density is a budget this library already spends deliberately
 * (the LOD ladder). Letting it float inside a band converts a per-frame
 * clear into a handful of them, and the element keeps its pixels across
 * every frame in between.
 *
 * Note what does NOT drift: the box. The subtree still lays out at exactly
 * the CSS size it was given, every frame, which is the whole point of a
 * resizable Surface. Only the number of texels spent on the answer floats.
 */
export function storeForBox(
  width: number,
  height: number,
  density: number,
  current: TextureStore | null,
): TextureStore {
  const exact = {
    width: Math.max(1, Math.round(width * density)),
    height: Math.max(1, Math.round(height * density)),
  }
  if (!current) return exact
  const dx = current.width / Math.max(1, width)
  const dy = current.height / Math.max(1, height)
  const lo = density / DENSITY_BAND
  const hi = density * DENSITY_BAND
  const inBand = dx >= lo && dx <= hi && dy >= lo && dy <= hi
  return inBand ? current : exact
}
