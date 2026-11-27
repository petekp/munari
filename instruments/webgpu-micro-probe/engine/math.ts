// Zero-allocation WebGPU [0, 1] clip-space math and indexed-mesh raycaster.
// UV convention matches @munari/core: u in [0, 1] left->right, v in [0, 1] bottom->top.

export type Mat4 = Float32Array<ArrayBuffer>
export type Vec3 = [number, number, number]

export function mat4Identity(out: Mat4 = new Float32Array(16)): Mat4 {
  out.fill(0)
  out[0] = 1
  out[5] = 1
  out[10] = 1
  out[15] = 1
  return out
}

export function mat4Multiply(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
  const a00 = a[0]!, a01 = a[1]!, a02 = a[2]!, a03 = a[3]!
  const a10 = a[4]!, a11 = a[5]!, a12 = a[6]!, a13 = a[7]!
  const a20 = a[8]!, a21 = a[9]!, a22 = a[10]!, a23 = a[11]!
  const a30 = a[12]!, a31 = a[13]!, a32 = a[14]!, a33 = a[15]!

  for (let col = 0; col < 4; col++) {
    const i = col * 4
    const b0 = b[i]!, b1 = b[i + 1]!, b2 = b[i + 2]!, b3 = b[i + 3]!
    out[i] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3
    out[i + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3
    out[i + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3
    out[i + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3
  }
  return out
}

/** WebGPU right-handed perspective matrix with [0, 1] depth clip range. */
export function mat4PerspectiveZeroToOne(
  fovDeg: number,
  aspect: number,
  near: number,
  far: number,
  out: Mat4 = new Float32Array(16),
): Mat4 {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360)
  const nf = 1 / (near - far)
  out.fill(0)
  out[0] = f / Math.max(aspect, 1e-6)
  out[5] = f
  out[10] = far * nf
  out[11] = -1
  out[14] = far * near * nf
  return out
}

export function mat4FromPositionEulerScale(
  px: number,
  py: number,
  pz: number,
  rx: number,
  ry: number,
  rz: number,
  sx: number,
  sy: number,
  sz: number,
  out: Mat4 = new Float32Array(16),
): Mat4 {
  const cx = Math.cos(rx), sinX = Math.sin(rx)
  const cy = Math.cos(ry), sinY = Math.sin(ry)
  const cz = Math.cos(rz), sinZ = Math.sin(rz)
  const m00 = cy * cz
  const m01 = cz * sinX * sinY - cx * sinZ
  const m02 = cx * cz * sinY + sinX * sinZ
  const m10 = cy * sinZ
  const m11 = cx * cz + sinX * sinY * sinZ
  const m12 = cx * sinY * sinZ - cz * sinX
  const m20 = -sinY
  const m21 = cy * sinX
  const m22 = cx * cy

  out[0] = m00 * sx
  out[1] = m10 * sx
  out[2] = m20 * sx
  out[3] = 0
  out[4] = m01 * sy
  out[5] = m11 * sy
  out[6] = m21 * sy
  out[7] = 0
  out[8] = m02 * sz
  out[9] = m12 * sz
  out[10] = m22 * sz
  out[11] = 0
  out[12] = px
  out[13] = py
  out[14] = pz
  out[15] = 1
  return out
}

export function mat4Invert(m: Mat4, out: Mat4 = new Float32Array(16)): boolean {
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!

  const b00 = a00 * a11 - a01 * a10
  const b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11
  const b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30
  const b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31
  const b11 = a22 * a33 - a23 * a32

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (Math.abs(det) < 1e-12) return false
  det = 1 / det

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det
  return true
}

export function transformPoint(m: Mat4, x: number, y: number, z: number): Vec3 {
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!
  const invW = w !== 0 ? 1 / w : 1
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) * invW,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) * invW,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) * invW,
  ]
}

export function transformDir(m: Mat4, x: number, y: number, z: number): Vec3 {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z,
    m[1]! * x + m[5]! * y + m[9]! * z,
    m[2]! * x + m[6]! * y + m[10]! * z,
  ]
}

export interface Aabb {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

export function computeAabb(positions: Float32Array): Aabb {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  return { minX, minY, minZ, maxX, maxY, maxZ }
}

function axisInterval(o: number, d: number, bmin: number, bmax: number): readonly [number, number] | null {
  if (Math.abs(d) < 1e-12) return o < bmin || o > bmax ? null : [-Infinity, Infinity]
  const a = (bmin - o) / d
  const b = (bmax - o) / d
  return a <= b ? [a, b] : [b, a]
}

function rayHitsAabb(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, box: Aabb): boolean {
  const ix = axisInterval(ox, dx, box.minX, box.maxX)
  const iy = axisInterval(oy, dy, box.minY, box.maxY)
  const iz = axisInterval(oz, dz, box.minZ, box.maxZ)
  if (!ix || !iy || !iz) return false
  const tmin = Math.max(ix[0], iy[0], iz[0])
  const tmax = Math.min(ix[1], iy[1], iz[1])
  return tmin <= tmax && tmax >= 0
}

export interface RayHit {
  readonly distance: number
  readonly u: number
  readonly v: number
  readonly point: Vec3
}

export interface CameraRayInput {
  readonly ndcX: number
  readonly ndcY: number
  readonly camPos: Vec3
  readonly invViewProj: Mat4
}

export interface Ray {
  readonly origin: Vec3
  readonly dir: Vec3
}

export function rayFromNdc(input: CameraRayInput): Ray {
  const farPt = transformPoint(input.invViewProj, input.ndcX, input.ndcY, 1)
  const dx = farPt[0] - input.camPos[0]
  const dy = farPt[1] - input.camPos[1]
  const dz = farPt[2] - input.camPos[2]
  const len = Math.hypot(dx, dy, dz) || 1
  return {
    origin: input.camPos,
    dir: [dx / len, dy / len, dz / len],
  }
}

interface TriHit {
  readonly t: number
  readonly b1: number
  readonly b2: number
}

function intersectTri(
  lo: Vec3,
  ld: Vec3,
  positions: Float32Array,
  i0: number,
  i1: number,
  i2: number,
): TriHit | null {
  const p0x = positions[i0 * 3]!, p0y = positions[i0 * 3 + 1]!, p0z = positions[i0 * 3 + 2]!
  const e1x = positions[i1 * 3]! - p0x, e1y = positions[i1 * 3 + 1]! - p0y, e1z = positions[i1 * 3 + 2]! - p0z
  const e2x = positions[i2 * 3]! - p0x, e2y = positions[i2 * 3 + 1]! - p0y, e2z = positions[i2 * 3 + 2]! - p0z

  const hx = ld[1] * e2z - ld[2] * e2y
  const hy = ld[2] * e2x - ld[0] * e2z
  const hz = ld[0] * e2y - ld[1] * e2x
  const det = e1x * hx + e1y * hy + e1z * hz
  if (Math.abs(det) < 1e-9) return null
  const invDet = 1 / det

  const sx = lo[0] - p0x, sy = lo[1] - p0y, sz = lo[2] - p0z
  const b1 = (sx * hx + sy * hy + sz * hz) * invDet
  if (b1 < -1e-6 || b1 > 1 + 1e-6) return null

  const qx = sy * e1z - sz * e1y
  const qy = sz * e1x - sx * e1z
  const qz = sx * e1y - sy * e1x
  const b2 = (ld[0] * qx + ld[1] * qy + ld[2] * qz) * invDet
  if (b2 < -1e-6 || b1 + b2 > 1 + 1e-6) return null

  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet
  return t > 0 ? { t, b1, b2 } : null
}

export function raycastIndexedMesh(
  rayOrigin: Vec3,
  rayDir: Vec3,
  worldMat: Mat4,
  invWorldMat: Mat4,
  positions: Float32Array,
  uvs: Float32Array,
  indices: Uint32Array | Uint16Array,
  bounds: Aabb,
): RayHit | null {
  const lo = transformPoint(invWorldMat, rayOrigin[0], rayOrigin[1], rayOrigin[2])
  const ld = transformDir(invWorldMat, rayDir[0], rayDir[1], rayDir[2])
  if (!rayHitsAabb(lo[0], lo[1], lo[2], ld[0], ld[1], ld[2], bounds)) return null

  let bestT = Infinity
  let bestU = 0
  let bestV = 0
  let hitLocal: Vec3 | null = null

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i]!
    const i1 = indices[i + 1]!
    const i2 = indices[i + 2]!
    const hit = intersectTri(lo, ld, positions, i0, i1, i2)
    if (!hit || hit.t >= bestT) continue
    const b0 = 1 - hit.b1 - hit.b2
    bestT = hit.t
    bestU = b0 * uvs[i0 * 2]! + hit.b1 * uvs[i1 * 2]! + hit.b2 * uvs[i2 * 2]!
    bestV = b0 * uvs[i0 * 2 + 1]! + hit.b1 * uvs[i1 * 2 + 1]! + hit.b2 * uvs[i2 * 2 + 1]!
    hitLocal = [lo[0] + ld[0] * hit.t, lo[1] + ld[1] * hit.t, lo[2] + ld[2] * hit.t]
  }

  if (!hitLocal) return null
  const worldHit = transformPoint(worldMat, hitLocal[0], hitLocal[1], hitLocal[2])
  const dist = Math.hypot(
    worldHit[0] - rayOrigin[0],
    worldHit[1] - rayOrigin[1],
    worldHit[2] - rayOrigin[2],
  )
  return { distance: dist, u: bestU, v: bestV, point: worldHit }
}
