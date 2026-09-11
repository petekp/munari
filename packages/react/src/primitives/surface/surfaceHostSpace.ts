// The parked host's CSS coordinate space, measured without restyling the live host.
//
// The pose the rig writes is a transform, and a transform composes with
// whatever containing block the host sits in. A marker docked beside the
// page slot reports that block's origin and scale, so the pose can be
// expressed in it. Measuring the marker rather than the host is the point:
// reading the host's own rect while it wears a pose would return the posed
// box, and the next frame's pose would be computed from the last one's.
const spaces = new WeakMap<HTMLElement, HTMLElement>()
export function registerHostSpace(host: HTMLElement, marker: HTMLElement) {
  spaces.set(host, marker)
  return () => { if (spaces.get(host) === marker) spaces.delete(host) }
}
export function hostSpace(host: HTMLElement | null) {
  const marker = host ? spaces.get(host) : null
  if (!marker) return { left: 0, top: 0, scaleX: 1, scaleY: 1 }
  const rect = marker.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { left: rect.left, top: rect.top, scaleX: rect.width / 100, scaleY: rect.height / 100 }
}
