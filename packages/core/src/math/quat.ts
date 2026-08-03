// The kernel's quaternion vocabulary — decisions.md #4's other half. Core
// still cannot import three, so an orientation is either read structurally
// (`QuatReadonly`, below — it happens to be exactly three.js's own
// `QuaternionLike`) or allocated from the minimal class below, exactly as
// `Vec3` does for positions. The physics layer (archive#45, #49) is what
// asked for this file: a held plate composes rotations, inverts one to find
// an error, and measures the angle between two — that is the entire
// quaternion vocabulary this kernel needs, so that is all this file has.
//
// The method BODIES below match three.js's own formulas exactly. Not
// because this file secretly depends on three, but because a correct
// quaternion implementation and three's agree up to floating-point noise —
// and several conformance suites compare a `Quat` directly against a real
// `THREE.Quaternion` (`plate.q.angleTo(FLAT)`, where `FLAT` is
// `new THREE.Quaternion()`). Cross-type reads (three's own methods reading
// this file's `x/y/z/w`) need no agreement at all: three only ever reads
// raw fields off whatever it's handed.

import type { Vec3Readonly } from './vec3'

/** The read half: anything with x/y/z/w. THREE.Quaternion qualifies. */
export interface QuatReadonly {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly w: number
}

/**
 * Core's own allocation, used only where an API must create an orientation
 * (`makePlate`'s identity quaternion, and the scratch quaternions the plate
 * integrator reuses frame to frame). Deliberately small — this is interop
 * plumbing for the physics layer, not a math library.
 */
export class Quat implements QuatReadonly {
  x = 0
  y = 0
  z = 0
  w = 1

  set(x: number, y: number, z: number, w: number): this {
    this.x = x
    this.y = y
    this.z = z
    this.w = w
    return this
  }

  copy(q: QuatReadonly): this {
    this.x = q.x
    this.y = q.y
    this.z = q.z
    this.w = q.w
    return this
  }

  clone(): Quat {
    return new Quat().copy(this)
  }

  length(): number {
    return Math.hypot(this.x, this.y, this.z, this.w)
  }

  /** Degenerate input snaps to identity — three.js's own fallback. */
  normalize(): this {
    let l = this.length()
    if (l === 0) {
      this.x = 0
      this.y = 0
      this.z = 0
      this.w = 1
    } else {
      l = 1 / l
      this.x *= l
      this.y *= l
      this.z *= l
      this.w *= l
    }
    return this
  }

  dot(q: QuatReadonly): number {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w
  }

  /**
   * This ⊗ q, in place — Hamilton product, matching
   * `THREE.Quaternion.prototype.multiply`: applies `q`'s rotation first,
   * then the ORIGINAL `this`'s.
   */
  multiply(q: QuatReadonly): this {
    const ax = this.x
    const ay = this.y
    const az = this.z
    const aw = this.w
    const bx = q.x
    const by = q.y
    const bz = q.z
    const bw = q.w
    this.x = ax * bw + aw * bx + ay * bz - az * by
    this.y = ay * bw + aw * by + az * bx - ax * bz
    this.z = az * bw + aw * bz + ax * by - ay * bx
    this.w = aw * bw - ax * bx - ay * by - az * bz
    return this
  }

  /** Conjugate as inverse — exact for the unit quaternions this file only ever holds. */
  invert(): this {
    this.x *= -1
    this.y *= -1
    this.z *= -1
    return this
  }

  /** Angle (radians) between two orientations. Sign-blind: q and −q are the same rotation. */
  angleTo(q: QuatReadonly): number {
    return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1)))
  }

  setFromAxisAngle(axis: Vec3Readonly, angle: number): this {
    const half = angle / 2
    const s = Math.sin(half)
    this.x = axis.x * s
    this.y = axis.y * s
    this.z = axis.z * s
    this.w = Math.cos(half)
    return this
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
