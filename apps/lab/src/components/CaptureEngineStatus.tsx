// Capture engine status — displays whether Surface capture runs through native
// Chrome HTML-in-canvas or the automatic snapDOM fallback.

import { useSurfaceSupport } from '@petepetrash/munari'
import { captureEngine } from '@petepetrash/munari/advanced'
import { Status } from './system'

export function CaptureEngineStatus() {
  const supported = useSurfaceSupport()
  const engine = captureEngine()

  if (!supported) {
    return <Status status="unavailable">Standard HTML</Status>
  }
  if (engine.native) {
    return <Status status="live">HTML-in-canvas</Status>
  }
  return <Status status="fallback">snapDOM</Status>
}
