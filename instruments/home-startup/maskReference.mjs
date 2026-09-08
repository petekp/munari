// Frozen dense distance transform from before the startup optimization.
// Test oracle only: real browser rasters must produce identical packed bytes.
// Keeping it separate prevents an optimized transform from testing itself.
const SHADOW_DISTANCE_RANGE = 256
const FAR = 1e12

// Every indexed read stays inside the allocated grid or the active parabola stack.
function transformLine(values, sites, cuts, result, length) {
  let last = 0
  sites[0] = 0
  cuts[0] = -Infinity
  cuts[1] = Infinity
  for (let q = 1; q < length; q++) {
    let crossing = 0
    do {
      const p = sites[last]
      crossing = ((values[q] + q * q) - (values[p] + p * p)) / (2 * (q - p))
      if (crossing > cuts[last]) break
      last--
    } while (last >= 0)
    last++
    sites[last] = q
    cuts[last] = crossing
    cuts[last + 1] = Infinity
  }
  last = 0
  for (let q = 0; q < length; q++) {
    while (cuts[last + 1] < q) last++
    const p = sites[last]
    result[q] = (q - p) ** 2 + values[p]
  }
}

function squaredDistance(grid, width, height) {
  const length = Math.max(width, height)
  const line = new Float64Array(length)
  const sites = new Int32Array(length)
  const cuts = new Float64Array(length + 1)
  const result = new Float64Array(length)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) line[y] = grid[y * width + x]
    transformLine(line, sites, cuts, result, height)
    for (let y = 0; y < height; y++) grid[y * width + x] = result[y]
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) line[x] = grid[y * width + x]
    transformLine(line, sites, cuts, result, width)
    for (let x = 0; x < width; x++) grid[y * width + x] = result[x]
  }
}

/** Signed CSS-pixel distance: negative inside, positive outside the alpha contour. */
export function referenceDistances(alpha, width, height, ratio) {
  const count = width * height
  const outside = new Float64Array(count)
  const inside = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const coverage = alpha[i * 4 + 3] / 255
    outside[i] = coverage === 0 ? FAR : Math.max(0, 0.5 - coverage) ** 2
    inside[i] = coverage === 1 ? FAR : Math.max(0, coverage - 0.5) ** 2
  }
  squaredDistance(outside, width, height)
  squaredDistance(inside, width, height)
  const result = new Float32Array(count)
  for (let i = 0; i < count; i++) result[i] = (Math.sqrt(outside[i]) - Math.sqrt(inside[i])) / ratio
  return result
}

/** Pack two independent signed fields into RG and BA. Linear sampling stays linear. */
export function referencePack(first, second) {
  const bytes = new Uint8Array(first.length * 4)
  const encode = (distance) => Math.round(Math.max(0, Math.min(1, 0.5 + distance / (2 * SHADOW_DISTANCE_RANGE))) * 65535)
  for (let i = 0; i < first.length; i++) {
    const a = encode(first[i])
    const b = encode(second?.[i] ?? SHADOW_DISTANCE_RANGE)
    bytes[i * 4] = a >> 8
    bytes[i * 4 + 1] = a & 255
    bytes[i * 4 + 2] = b >> 8
    bytes[i * 4 + 3] = b & 255
  }
  return bytes
}
