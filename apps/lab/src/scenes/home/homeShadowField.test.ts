// Distance-field contracts: subpixel coverage, holes, and portable packed sampling.
import {describe,expect,it} from 'vitest'
import {packShadowDistances,shadowDistances,SHADOW_DISTANCE_RANGE} from './homeShadowField'

const unpack=(r:number,g:number)=>((r*256+g)/65535-.5)*2*SHADOW_DISTANCE_RANGE
describe('shadow geometry fields',()=>{
  it('keeps filled interiors negative and empty counters positive',()=>{
    const width=9,height=9,pixels=new Uint8ClampedArray(width*height*4)
    for(let y=1;y<8;y++)for(let x=1;x<8;x++)if(x<3||x>5||y<3||y>5)pixels[(y*width+x)*4+3]=255
    const distances=shadowDistances(pixels,width,height,1)
    expect(distances[4*width+1]).toBeLessThan(0)
    expect(distances[4*width+4]).toBeGreaterThan(0)
    expect(distances[0]).toBeGreaterThan(0)
    const scaled=shadowDistances(pixels,width,height,2)
    expect(scaled[0]).toBeCloseTo(distances[0]/2)
  })
  it('preserves fractional edge coverage rather than thresholding it',()=>{
    const pixels=new Uint8ClampedArray([0,0,0,64,0,0,0,192])
    const distances=shadowDistances(pixels,2,1,1)
    expect(distances[0]).toBeCloseTo(.5-64/255)
    expect(distances[1]).toBeCloseTo(.5-192/255)
  })
  it('packs independent fields and linearly interpolates through byte carries',()=>{
    const values=new Float32Array([-20,-.1,0,.1,20])
    const bytes=packShadowDistances(values,new Float32Array([7,8,9,10,11]))
    values.forEach((value,i)=>{
      expect(Math.abs(unpack(bytes[i*4],bytes[i*4+1])-value)).toBeLessThan(.004)
      expect(Math.abs(unpack(bytes[i*4+2],bytes[i*4+3])-(i+7))).toBeLessThan(.004)
    })
    const mid=unpack((bytes[4]+bytes[12])/2,(bytes[5]+bytes[13])/2)
    expect(Math.abs(mid)).toBeLessThan(.004)
  })
  it('represents an empty field as empty at every point',()=>{
    const distances=shadowDistances(new Uint8ClampedArray(100*4),10,10,1)
    const bytes=packShadowDistances(distances)
    for(let i=0;i<100;i++)expect(unpack(bytes[i*4],bytes[i*4+1])).toBe(SHADOW_DISTANCE_RANGE)
  })
})
