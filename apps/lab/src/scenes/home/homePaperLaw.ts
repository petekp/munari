// Postcard paper — a bowed sheet with two independent cylindrical edge curls.
// Bending changes the silhouette as well as height; printed content follows the
// same vertices the pointer hits. All modes flatten at the handoff (#51).
// This module owns shape and springs; HomePostcardMesh owns flight, HomeHero input.

export const PAPER_COLUMNS = 48
export const PAPER_ROWS = 32
export const PAPER_WIDTH = 420
export const PAPER_HEIGHT = 270

export interface PaperSpring { value: number; velocity: number }
export interface PaperShape { bow: number; curlA: number; curlB: number; twist: number; ripple: number; time: number; amount: number }
export interface PaperInteraction { impulses: number }

export function createPaperInteraction(): PaperInteraction {
  return { impulses: 0 }
}

/** Exact damped response to a fixed target, so a slower frame adds no energy. */
export function stepPaperSpring(spring: PaperSpring, target: number, dt: number) {
  // Stiff stock yields once and settles; #51 records the motion checks.
  const frequency = 18, damping = 12
  const w = Math.sqrt(frequency*frequency-damping*damping)
  const displacement = spring.value-target
  const e = Math.exp(-damping*dt), c = Math.cos(w*dt), s = Math.sin(w*dt)
  const velocity = spring.velocity
  spring.value = target+e*(displacement*c+(velocity+damping*displacement)/w*s)
  spring.velocity = e*(velocity*c-(damping*velocity+frequency*frequency*displacement)/w*s)
}

interface PaperPoint { x: number; y: number; z: number }

/** Wrap a strip around a cylinder. Its arc length is its original length. */
export function curlPaper(point: PaperPoint, ax: number, ay: number, hinge: number, angle: number, width: number): PaperPoint {
  const s = point.x*ax+point.y*ay-hinge
  if (s<=0 || angle<0.00001) return point
  const k = angle/width, theta = s*k, radius = 1/k
  const along = (radius-point.z)*Math.sin(theta)
  return { x: point.x+ax*(along-s), y: point.y+ay*(along-s), z: radius-(radius-point.z)*Math.cos(theta) }
}

export function paperPoint(x: number, y: number, shape: PaperShape): PaperPoint {
  if (shape.amount===0) return { x, y, z: 0 }
  const cx = x-PAPER_WIDTH/2, cy = y-PAPER_HEIGHT/2
  const bow = 0.00025*shape.bow*shape.amount
  let point: PaperPoint = { x: cx, y: cy, z: 0 }
  // Opposite corners occupy separate strips; a broad bow ties them together.
  point = curlPaper(point,0.8,-0.6,119,Math.max(0,Math.min(2.85,shape.curlA))*shape.amount,130)
  point = curlPaper(point,-0.8,0.6,119,Math.max(0,Math.min(1.1,shape.curlB))*shape.amount,130)
  // Apply the broad, large-radius bend last. Reversing this order compressed
  // corner lettering by 19%; this order stays within the metric contract (#51).
  if (bow>0.000001) {
    const radius=1/bow, theta=point.x*bow
    point={x:(radius-point.z)*Math.sin(theta),y:point.y,z:radius-(radius-point.z)*Math.cos(theta)}
  }
  const u=x/PAPER_WIDTH, v=y/PAPER_HEIGHT
  const twist = shape.twist*6*(2*u-1)*(2*v-1)
  const wave = shape.ripple*4*Math.sin(Math.PI*u)*Math.sin(Math.PI*v)*Math.sin(u*9+v*7-shape.time*15)
  return { x: point.x+PAPER_WIDTH/2, y: point.y+PAPER_HEIGHT/2, z: point.z+(twist+wave)*shape.amount }
}
