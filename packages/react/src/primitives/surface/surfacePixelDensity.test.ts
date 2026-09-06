// Display-density contracts: default output follows native pixels, including CSS scale.
import { expect, it } from 'vitest'
import { matchedSurfaceDensity, surfaceCanvasPixelRatio } from './surfacePixelDensity'
it('uses native DPR without the inherited two-times ceiling and preserves explicit choices',()=>{
 expect(surfaceCanvasPixelRatio(undefined,3,1)).toBe(3)
 expect(surfaceCanvasPixelRatio(undefined,2,1.2)).toBe(2.4)
 expect(surfaceCanvasPixelRatio(1,3,1)).toBe(1)
 expect(surfaceCanvasPixelRatio([1,2],3,1)).toBe(2)
})
it('measures each axis instead of exaggerating the diagonal of a wide quad',()=>{
 expect(matchedSurfaceDensity([440,280],{left:20,top:30,width:440,height:280},{left:0,top:0,width:1100,height:900},[2200,1800])).toBe(2)
 expect(matchedSurfaceDensity([440,280],{left:20,top:30,width:528,height:238},{left:0,top:0,width:816,height:391},[1632,1104])).toBeCloseTo(2.4)
})
