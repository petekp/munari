// The kernel's vector vocabulary. @anamorph/core is zero-dep, so it
// cannot import three — instead every API that touches vectors speaks
// in structural shapes that THREE.Vector3 satisfies for free, and the
// few places core must ALLOCATE a vector use the minimal class below
// (decisions.md #4). Callers who hand in their own vector get their
// own type back: out-params are generic, never widened.
//
// The physics layer (archive#45, #49) grew this file's method list:
// a plate's grab point has to be rotated into the world and damped
// against a hand, which is exactly the vocabulary a spring-damper over
// a lever arm needs. `applyQuaternion` is the one method that reaches
// outside this file's own vocabulary — it takes `QuatReadonly` from
// `./quat`, a type-only import, so the two files can cite each other's
// shapes without either owning a runtime dependency on the other.

import type { QuatReadonly } from './quat'

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

  copy(v: Vec3Readonly): this {
    this.x = v.x
    this.y = v.y
    this.z = v.z
    return this
  }

  add(v: Vec3Readonly): this {
    this.x += v.x
    this.y += v.y
    this.z += v.z
    return this
  }

  sub(v: Vec3Readonly): this {
    this.x -= v.x
    this.y -= v.y
    this.z -= v.z
    return this
  }

  /** Componentwise product — NOT the cross product. Used to apply a diagonal tensor. */
  multiply(v: Vec3Readonly): this {
    this.x *= v.x
    this.y *= v.y
    this.z *= v.z
    return this
  }

  multiplyScalar(s: number): this {
    this.x *= s
    this.y *= s
    this.z *= s
    return this
  }

  addScaledVector(v: Vec3Readonly, s: number): this {
    this.x += v.x * s
    this.y += v.y * s
    this.z += v.z * s
    return this
  }

  cross(v: Vec3Readonly): this {
    const ax = this.x
    const ay = this.y
    const az = this.z
    this.x = ay * v.z - az * v.y
    this.y = az * v.x - ax * v.z
    this.z = ax * v.y - ay * v.x
    return this
  }

  /**
   * Rotate this vector by `q`, in place. Matches
   * `THREE.Vector3.prototype.applyQuaternion`'s optimized tx/ty/tz form —
   * see decisions.md #4: three's own `Vector3Like`/`QuaternionLike`
   * parameter types are already this file's `Vec3Readonly`/`QuatReadonly`
   * shape, so this reads a real `THREE.Quaternion` for free.
   */
  applyQuaternion(q: QuatReadonly): this {
    const vx = this.x
    const vy = this.y
    const vz = this.z
    const qx = q.x
    const qy = q.y
    const qz = q.z
    const qw = q.w

    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (qy * vz - qz * vy)
    const ty = 2 * (qz * vx - qx * vz)
    const tz = 2 * (qx * vy - qy * vx)

    // v + q.w * t + cross(q.xyz, t)
    this.x = vx + qw * tx + (qy * tz - qz * ty)
    this.y = vy + qw * ty + (qz * tx - qx * tz)
    this.z = vz + qw * tz + (qx * ty - qy * tx)
    return this
  }
}
