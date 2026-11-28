// Capture engine status — displays whether Surface capture runs through native
// Chrome HTML-in-canvas or the automatic snapDOM fallback (`@petepetrash/munari/gpu`).

import { detectHtmlInCanvas, supportsCapture } from '@petepetrash/munari/gpu'
import { CAPTURE_MODE } from '../captureMode'
import { Status } from './system'

export function CaptureEngineStatus() {
  if (!supportsCapture()) {
    return <Status status="unavailable">Standard HTML</Status>
  }
  const native = CAPTURE_MODE !== 'snapdom' && detectHtmlInCanvas().drawElementImage
  if (native) {
    return <Status status="live">HTML-in-canvas</Status>
  }
  return <Status status="fallback">snapDOM</Status>
}
