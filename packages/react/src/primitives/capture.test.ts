// @vitest-environment happy-dom
// Each capture reader owns its subscription, even when a canvas shares invalidate.
import { expect, it } from 'vitest'
import { createCapture, inspectCapture, setCaptureUnavailable, subscribeCaptureFrames } from './capture'

it('keeps the surviving same-canvas reader subscribed after another reader unmounts', () => {
 const capture=createCapture(),observed:string[]=[]
 const invalidate=()=>observed.push(inspectCapture(capture).status.status)
 const first=subscribeCaptureFrames(capture,invalidate),second=subscribeCaptureFrames(capture,invalidate)
 try {
  expect(inspectCapture(capture).consumers).toBe(2)
  first();expect(inspectCapture(capture).consumers).toBe(1)
  observed.length=0
  setCaptureUnavailable(capture,'error','capture failed')
  expect(observed).toEqual(['error'])
 } finally {first();second()}
 expect(inspectCapture(capture).consumers).toBe(0)
 observed.length=0;setCaptureUnavailable(capture,'waiting')
 expect(observed).toEqual([])
})
