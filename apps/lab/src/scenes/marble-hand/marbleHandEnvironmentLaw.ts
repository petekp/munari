// Marble-hand environment law — native colour fields in their real direction.
//
// The law: the page stands at world z=0, below the hand. A ray can sample
// it only after travelling toward -Z, and only inside the visible viewport.
// The 2026-08-30 native-page revision removes the unrelated HDR room and
// the page presenter; this map supplies reflections without owning page pixels.
//
// Ownership: the DOM supplies a small flat colour raster. These functions
// project it from the hand's position and add the room's indirect light.

export interface MarblePageField {
  pixels: Uint8ClampedArray
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
}

export interface MarbleEnvironmentOrigin {
  x: number
  y: number
  z: number
}

// Keep fractional frame time: resetting the clock to now after each draw
// can turn a 60 fps setting into 30 fps when a frame arrives just early.
// After an idle period or slow frame, start fresh instead of catching up.
export function nextMarbleReflectionTime(now: number, due: number, fps: number): number {
  const interval = 1000 / fps
  return Number.isFinite(due) && now - due < interval ? due + interval : now + interval
}

const LINEAR_FROM_BYTE = Float64Array.from({ length: 256 }, (_, byte) => {
  const value = byte / 255
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
})
// Knobs' four-byte dark-room floor, expressed as radiance before any gain.
const ROOM_FLOOR = LINEAR_FROM_BYTE[4]

function encodedByte(linear: number): number {
  return 255 * (linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055)
}

export function marblePageSample(
  dx: number,
  dy: number,
  dz: number,
  origin: MarbleEnvironmentOrigin,
  field: MarblePageField,
): number {
  if (dz >= 0 || origin.z <= 0 || field.viewportWidth <= 0 || field.viewportHeight <= 0) return -1
  const distance = -origin.z / dz
  const u = (origin.x + dx * distance) / field.viewportWidth + 0.5
  const v = 0.5 - (origin.y + dy * distance) / field.viewportHeight
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return -1
  return (Math.floor(v * field.height) * field.width + Math.floor(u * field.width)) * 4
}

/** Canvas row zero is the zenith; CanvasTexture's default flipY keeps it there. */
export function marbleEnvironmentRays(width: number, height: number): Float32Array {
  const rays = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const latitude = (0.5 - (y + 0.5) / height) * Math.PI
    const ring = Math.cos(latitude)
    for (let x = 0; x < width; x++) {
      const longitude = ((x + 0.5) / width - 0.5) * Math.PI * 2
      const offset = (y * width + x) * 4
      rays[offset] = ring * Math.cos(longitude)
      rays[offset + 1] = Math.sin(latitude)
      rays[offset + 2] = ring * Math.sin(longitude)
      rays[offset + 3] = ring
    }
  }
  return rays
}

function pageBounce(pixels: Uint8ClampedArray): readonly [number, number, number] {
  let red = 0
  let green = 0
  let blue = 0
  let total = 0
  for (let index = 0; index < pixels.length; index += 4) {
    const r = LINEAR_FROM_BYTE[pixels[index]]
    const g = LINEAR_FROM_BYTE[pixels[index + 1]]
    const b = LINEAR_FROM_BYTE[pixels[index + 2]]
    const weight = pixels[index + 3] / 255 *
      (0.2126 * r + 0.7152 * g + 0.0722 * b)
    red += r * weight
    green += g * weight
    blue += b * weight
    total += weight
  }
  return total > 0 ? [red / total, green / total, blue / total] : [0, 0, 0]
}

export function paintMarbleEnvironment(
  field: MarblePageField,
  origin: MarbleEnvironmentOrigin,
  roomBounce: number,
  rays: Float32Array,
  target: Uint8ClampedArray,
  includePage = true,
): void {
  let pageArea = 0
  let rearArea = 0
  for (let index = 0; index < rays.length; index += 4) {
    if (rays[index + 2] >= 0) continue
    rearArea += rays[index + 3]
    const source = marblePageSample(rays[index], rays[index + 1], rays[index + 2], origin, field)
    if (source >= 0) pageArea += rays[index + 3] * field.pixels[source + 3] / 255
  }
  const spill = pageBounce(field.pixels)
  const gain = Math.max(0, roomBounce) * (rearArea > 0 ? pageArea / rearArea : 0)
  for (let index = 0; index < rays.length; index += 4) {
    const source = marblePageSample(rays[index], rays[index + 1], rays[index + 2], origin, field)
    const alpha = includePage && source >= 0 ? field.pixels[source + 3] / 255 : 0
    // Knobs keeps a dim room floor and a broad neutral ceiling. The page
    // occludes this room where the ray reaches an opaque native field.
    const overhead = Math.pow(Math.max(0, (rays[index + 1] - 0.55) / 0.45), 2) * 0.9
    for (let channel = 0; channel < 3; channel++) {
      if (alpha === 1) {
        target[index + channel] = field.pixels[source + channel]
        continue
      }
      // The CanvasTexture decodes sRGB on upload. Multiplying encoded bytes
      // by bounce first applied a second darkening curve: half white became
      // 128 instead of 188. Average, gain and mix radiance before encoding.
      const room = Math.min(1, ROOM_FLOOR + spill[channel] * gain)
      const studio = room + (1 - room) * overhead
      const radiance = source >= 0
        ? LINEAR_FROM_BYTE[field.pixels[source + channel]] * alpha + studio * (1 - alpha)
        : studio
      target[index + channel] = encodedByte(radiance)
    }
    target[index + 3] = 255
  }
}
