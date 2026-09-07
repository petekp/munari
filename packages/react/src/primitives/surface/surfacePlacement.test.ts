// @vitest-environment happy-dom
// Position-only moves wake a demand host; stable boxes and the last release do no work.
import { afterEach, expect, it, vi } from 'vitest'
import { watchSurfacePlacement } from './surfacePlacement'
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
it('shares element reads and stops its frame observer with its last subscriber', async()=>{
 vi.useFakeTimers()
 const element=document.createElement('div'),changed=vi.fn()
 let top=20
 const read=vi.spyOn(element,'getBoundingClientRect').mockImplementation(()=>new DOMRect(10,top,120,80))
 const first=watchSurfacePlacement([()=>element],changed),second=watchSurfacePlacement([()=>element],changed)
 await vi.advanceTimersToNextFrame()
 expect(read).toHaveBeenCalledTimes(1);expect(changed).toHaveBeenCalledTimes(2)
 await vi.advanceTimersToNextFrame()
 expect(read).toHaveBeenCalledTimes(2);expect(changed).toHaveBeenCalledTimes(2)
 top=70
 await vi.advanceTimersToNextFrame()
 expect(changed).toHaveBeenCalledTimes(4)
 first();second()
 expect(vi.getTimerCount()).toBe(0)
})

it('keeps one frame loop when a callback registers another observer', async () => {
 vi.useFakeTimers()
 const element=document.createElement('div')
 const read=vi.spyOn(element,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,10,10))
 let second:(()=>void)|undefined
 const first=watchSurfacePlacement([()=>element],()=>{second??=watchSurfacePlacement([()=>element],()=>{})})
 try {
  await vi.advanceTimersToNextFrame()
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersToNextFrame()
  expect(read).toHaveBeenCalledTimes(2)
 } finally {first();second?.()}
 expect(vi.getTimerCount()).toBe(0)
})

it('detects clipping changes without a change to the content rectangle',async()=>{
 vi.useFakeTimers()
 const element=document.createElement('div'),changed=vi.fn()
 let clip=''
 const stop=watchSurfacePlacement([()=>element],changed,()=>clip)
 try {
  await vi.advanceTimersToNextFrame();changed.mockClear()
  clip='polygon(0px 0px, 10px 0px, 10px 5px, 0px 5px)'
  await vi.advanceTimersToNextFrame();expect(changed).toHaveBeenCalledTimes(1)
  await vi.advanceTimersToNextFrame();expect(changed).toHaveBeenCalledTimes(1)
 }finally{stop()}
})
