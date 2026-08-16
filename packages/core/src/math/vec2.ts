// The kernel's 2D vector vocabulary. `shadowQuadFrame`'s frame lives in a
// screen-space plane and never needs a z, so it gets its own
// minimal pair of structural interfaces — same shape as vec3.ts's, and for
// the same reason: @munari/core is zero-dep, so it cannot import three,
// but THREE.Vector2 satisfies these by shape for free (decisions.md #4).

/** The read half: anything with x/y. THREE.Vector2 qualifies. */
export interface Vec2Readonly {
  readonly x: number
  readonly y: number
}

/** The write half: mutable fields plus `set`. THREE.Vector2 qualifies. */
export interface Vec2Like {
  x: number
  y: number
  /** Called for effect; core ignores what it hands back. `void` is what
   *  core needs, and a method returning `this` (THREE's does) satisfies
   *  it — so this stays the loosest contract that still says something. */
  set(x: number, y: number): void
}

/**
 * Core's own allocation, used only where an API must create a vector with
 * no caller-provided target (`chrome/shadowQuadFrame.ts`'s `makeShadowFrame`).
 * Deliberately just a data carrier: `shadowQuadFrame`'s own internal math is
 * scalar, not vector-method calls on scratch objects (decisions.md #4), so
 * nothing here needs length/normalize/etc. — add methods only when a hole
 * demands them.
 */
export class Vec2 implements Vec2Like {
  x = 0
  y = 0

  set(x: number, y: number): this {
    this.x = x
    this.y = y
    return this
  }
}
