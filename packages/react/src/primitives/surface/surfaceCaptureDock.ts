// Capture dock — where a Surface parks its capture host, and which runtime
// belongs to the capture root it holds.
//
// The law: the dock uses insertBefore, never moveBefore (platform.md #35).
//
// Ownership: Surface.HTML decides when to dock; this module only moves.

import { insertRetained } from '../retainedMove'
import type { SurfacePartPublication, SurfaceSourceRuntime } from './surfaceSourceRuntime'

export function matchingRuntime(publication: SurfacePartPublication | null, element: HTMLElement | null): SurfaceSourceRuntime | null {
  return publication?.captureRoot === element ? publication?.runtime ?? null : null
}

// Chrome's renderer crashes when `moveBefore` puts two fixed-position
// elements, such as these parked capture canvases, inside an absolutely
// positioned size container and a font face arrives in the same task;
// `insertBefore` does not crash (platform.md #35). The insert
// restarts the CSS animations of whatever the host holds, so the caller puts
// the held copy back at the live node's pose.
export function dockCaptureHost(host: HTMLElement, dock: HTMLElement): boolean {
  if (host.parentElement === dock) return false
  insertRetained(host, dock)
  return true
}
