// @vitest-environment happy-dom
// Each capture reader owns its subscription, even when a canvas shares invalidate.
import { expect, it, vi } from 'vitest'
import { createCapture, inspectCapture, setCaptureUnavailable, subscribeCaptureFrames } from './capture'

it('keeps the surviving same-canvas reader subscribed after another reader unmounts', () => {
 const capture=createCapture(),invalidate=vi.fn()
 const first=subscribeCaptureFrames(capture,invalidate),second=subscribeCaptureFrames(capture,invalidate)
 try {
  expect(inspectCapture(capture).consumers).toBe(2)
  first();expect(inspectCapture(capture).consumers).toBe(1)
  invalidate.mockClear()
  // The status is already waiting, so only the frame subscription can wake it.
  setCaptureUnavailable(capture,'waiting')
  expect(invalidate).toHaveBeenCalledTimes(1)
 } finally {first();second()}
 expect(inspectCapture(capture).consumers).toBe(0)
 invalidate.mockClear();setCaptureUnavailable(capture,'waiting')
 expect(invalidate).not.toHaveBeenCalled()
})
