// The kernel's vector vocabulary. @anamorph/core is zero-dep, so it
// cannot import three — instead every API that touches vectors speaks
// in structural shapes that THREE.Vector3 satisfies for free, and the
// few places core must ALLOCATE a vector use the minimal class below
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
  set(x: number, y: number, z: number): unknown
}

/** What a surface sample writes into. THREE.Vector3 qualifies. */
export interface SampleVec extends Vec3Like {
  normalize(): unknown
}

/**
 * Core's own allocation, used only where an API must create a vector
 * (a sample with no caller-provided target). Deliberately small: the
 * methods below are the ones conformance suites and kernel internals
 * actually read — this is interop plumbing, not a math library.
 */
export class Vec3 implements SampleVec {
  x = 0
  y = 0
  z = 0

  set(x: number, y: number, z: number): this {
    this.x = x
    this.y = y
    this.z = z
    return this
  }

  clone(): Vec3 {
    return new Vec3().set(this.x, this.y, this.z)
  }

  length(): number {
    return Math.hypot(this.x, this.y, this.z)
  }

  normalize(): this {
    const l = this.length()
    if (l > 0) {
      this.x /= l
      this.y /= l
      this.z /= l
    }
    return this
  }

  dot(v: Vec3Readonly): number {
    return this.x * v.x + this.y * v.y + this.z * v.z
  }

  distanceTo(v: Vec3Readonly): number {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z)
  }
}
