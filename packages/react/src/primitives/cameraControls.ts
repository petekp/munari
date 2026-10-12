// Camera controls suspension — gestures can overlap on independent presenters.
// Releasing one gesture must not restore controls that another still holds.
interface CameraControls { enabled?: boolean }
interface Suspension { claims: number; enabled: boolean }
const suspensions = new WeakMap<CameraControls, Suspension>()

export function suspendCameraControls(controls: CameraControls | null): () => void {
  if (!controls || controls.enabled === undefined) return () => {}
  const suspension = suspensions.get(controls) ?? { claims: 0, enabled: controls.enabled }
  suspensions.set(controls, suspension)
  suspension.claims++
  controls.enabled = false
  let released = false
  return () => {
    if (released) return
    released = true
    if (--suspension.claims === 0) {
      controls.enabled = suspension.enabled
      suspensions.delete(controls)
    }
  }
}
