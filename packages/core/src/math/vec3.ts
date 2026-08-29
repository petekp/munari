// The kernel's vector vocabulary. @munari/core is zero-dep, so it
// cannot import three — instead every API that touches vectors speaks
// in structural shapes that THREE.Vector3 satisfies for free
// (decisions.md #4). Callers who hand in their own vector get their
// own type back: out-params are generic, never widened.

/** The read half: anything with x/y/z. THREE.Vector3 qualifies. */
export interface Vec3Readonly {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** The write half: mutable fields plus `set`. THREE.Vector3 qualifies. */
export interface Vec3Like {
  x: number
  y: number
  z: number
  /** Called for effect; core ignores what it hands back. `void` is what
   *  core needs, and a method returning `this` (THREE's does) satisfies
   *  it — so this stays the loosest contract that still says something. */
  set(x: number, y: number, z: number): void
}
