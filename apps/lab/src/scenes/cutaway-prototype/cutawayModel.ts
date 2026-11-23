// Cutaway model — the dimensions of the camera that the spec sheet cuts
// through, in millimetres, one world unit per millimetre.
//
// The law: every depth the sheet names comes from here. The sheet's section
// depths, the lens's focal plane and the parts' positions must agree, or a
// paragraph arrives at a part that is not there.
//
// The product is original: a fixed-lens APS-C compact with no brand.
// The figures are typical of that class, not copied from one model.

import type { ThinLens } from './cutawayDepthLaw'

export const BODY = { width: 112, height: 66, depth: 36, radius: 5, wall: 2.5 } as const
export const BODY_FRONT_Z = BODY.depth / 2
export const TOP_PLATE_Y = 21

/** The cavity inside the casing walls. */
export const CAVITY = {
  halfWidth: BODY.width / 2 - BODY.wall,
  halfHeight: BODY.height / 2 - BODY.wall,
  halfDepth: BODY.depth / 2 - BODY.wall,
} as const

export const OPTICAL_AXIS = { x: 24, y: -2 } as const

/** The battery stands in its own compartment, left of a divider wall. */
export const DIVIDER = { x: -37.25, thickness: 1.5 } as const

/** The spec sheet spans the cavity from the divider to the right wall. */
export const SHEET = {
  minX: DIVIDER.x + DIVIDER.thickness / 2,
  maxX: CAVITY.halfWidth,
  minY: -CAVITY.halfHeight,
  maxY: CAVITY.halfHeight,
} as const
export const SHEET_WIDTH = SHEET.maxX - SHEET.minX
export const SHEET_HEIGHT = SHEET.maxY - SHEET.minY
export const SHEET_PX_PER_MM = 8
export const SHEET_PX = [SHEET_WIDTH * SHEET_PX_PER_MM, SHEET_HEIGHT * SHEET_PX_PER_MM] as const

/** The sensor's cover glass. The lens focuses at infinity here. */
export const SENSOR_Z = 3.5
export const SENSOR_SIZE = [23.5, 15.6] as const
/** Pixel pitch in mm: 23.5 mm across 6048 pixels, 3.92 µm apart. */
export const PIXEL_PITCH = 23.5 / 6048
export const SENSOR_BOARD = { width: 50, height: 44, thickness: 1.6, z: 2.2 } as const
export const FILTER = { width: 30, height: 22, thickness: 0.8, z: 5.4 } as const
export const MAIN_BOARD = { width: 46, height: 50, thickness: 1.6, z: -5.5 } as const

/** f/2 at 26 mm focal length, principal plane 26 mm in front of the sensor. */
export const LENS: ThinLens = { principalZ: SENSOR_Z + 26, focalLength: 26, apertureRadius: 26 / 4 }

/** Where the sheet starts and stops: just inside the front wall, and just in front of the rear display. */
export const SHEET_FRONT_Z = CAVITY.halfDepth - 0.4
export const SHEET_BACK_Z = -CAVITY.halfDepth + 2.8

export interface LensElement {
  readonly z: number
  readonly radius: number
  readonly thickness: number
  /** How far each face's centre stands proud of its rim; positive is convex, negative concave. */
  readonly frontSag: number
  readonly backSag: number
  /** Positive converges, negative diverges; sets how much the element magnifies the sheet behind it. */
  readonly focalLength: number
}

/** Seven elements in six groups; the fourth group is a cemented pair. */
export const LENS_ELEMENTS: readonly LensElement[] = [
  { z: 33, radius: 13, thickness: 4, frontSag: 2.4, backSag: 0.5, focalLength: 110 },
  { z: 29.4, radius: 11.5, thickness: 1.8, frontSag: 1.2, backSag: -1.8, focalLength: -70 },
  { z: 26.5, radius: 10, thickness: 3.2, frontSag: 1.2, backSag: 1, focalLength: 80 },
  { z: 21.6, radius: 9, thickness: 2.6, frontSag: 1, backSag: 0.3, focalLength: 60 },
  { z: 19.4, radius: 9, thickness: 1.8, frontSag: -0.3, backSag: 0.8, focalLength: -50 },
  { z: 17, radius: 10, thickness: 2.4, frontSag: -0.5, backSag: 1.2, focalLength: -75 },
  { z: 13.8, radius: 10.5, thickness: 2.6, frontSag: 1.1, backSag: 0.5, focalLength: 65 },
]

/** The leaf shutter and its six-blade aperture sit between the front and rear groups. */
export const SHUTTER = { z: 24, outerRadius: 12.5, apertureRadius: LENS.apertureRadius } as const

/**
 * The window opposite the camera, in radians off the optical axis. It stands
 * to the camera's left, so its upside-down image lands left of the axis,
 * where the lens elements do not hide it from this viewpoint. It is tall and
 * narrow so its image fills the strip of sheet the lens leaves visible.
 * Rooftops fill its lower part, about 28 to the radian.
 */
export const STUDIO_WINDOW = {
  center: [0.42, 0],
  half: [0.16, 0.42],
  mullion: 0.024,
  horizon: -0.07,
  roofsPerRadian: 28,
  roofSpread: 0.07,
} as const
