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
