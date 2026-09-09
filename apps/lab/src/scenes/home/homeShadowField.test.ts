// Distance-field contracts: subpixel coverage, holes, and portable packed sampling.
import {describe,expect,it} from 'vitest'
import {packShadowDistances,shadowDistances,SHADOW_DISTANCE_RANGE} from './homeShadowField'

const unpack=(r:number,g:number)=>((r*256+g)/65535-.5)*2*SHADOW_DISTANCE_RANGE
describe('shadow geometry fields',()=>{
  it('matches the exhaustive distance definition for fractional coverage and empty columns',()=>{
    let seed=58193
    const alphaValues=[0,0,0,255,255,1,64,127,128,192,254]
    for(const [width,height] of [[1,1],[1,17],[13,1],[11,7],[7,15]])for(let sample=0;sample<8;sample++){
      const pixels=new Uint8ClampedArray(width*height*4)
      for(let i=0;i<width*height;i++){
        seed=(Math.imul(seed,1664525)+1013904223)>>>0
        pixels[i*4+3]=alphaValues[seed%alphaValues.length]!
      }
      const expected=new Float32Array(width*height)
      // Minimize over every seed, independently of the optimized algorithm.
      // Addition order preserves the original dense transform's rounding.
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        let outside=1e12,inside=1e12
        for(let qy=0;qy<height;qy++)for(let qx=0;qx<width;qx++){
          const coverage=pixels[(qy*width+qx)*4+3]!/255
          const out=coverage===0?1e12:Math.max(0,.5-coverage)**2
          const into=coverage===1?1e12:Math.max(0,coverage-.5)**2
          outside=Math.min(outside,((y-qy)**2+out)+(x-qx)**2)
          inside=Math.min(inside,((y-qy)**2+into)+(x-qx)**2)
        }
        expected[y*width+x]=(Math.sqrt(outside)-Math.sqrt(inside))/.5
      }
      expect(shadowDistances(pixels,width,height,.5)).toEqual(expected)
    }
  })
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
