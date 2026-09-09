// Invalid authored data must never masquerade as an unmeasured source.
import { expect, it } from 'vitest'
import { validateSurfaceSize } from './surfaceSize'
it('rejects zero, negative, and non-finite authored dimensions',()=>{
 for(const value of [0,-1,Number.NaN,Infinity,-Infinity]) {
  expect(()=>validateSurfaceSize([value,100])).toThrow('positive, finite')
  expect(()=>validateSurfaceSize([100,value])).toThrow('positive, finite')
 }
 expect(()=>validateSurfaceSize([0.5,320])).not.toThrow()
})
