// Paper contracts — exact landing, low stretch, and frame-independent settling.
import { describe, expect, it } from 'vitest'
import { curlPaper, paperPoint, stepPaperSpring, type PaperShape } from './homePaperLaw'

describe('postcard paper', () => {
  it('returns exactly to the native plane regardless of pending motion', () => {
    const shape: PaperShape={amount:0,bow:1,curlA:.95,curlB:.8,twist:1,ripple:1,time:3}
    for(const [x,y] of [[0,0],[210,135],[420,270]])expect(paperPoint(x!,y!,shape)).toEqual({x,y,z:0})
  })
  it('rolls a 80px strip without stretching its printed content', () => {
    let length=0,previous=curlPaper({x:0,y:0,z:0},1,0,0,.95,80)
    for(let x=.25;x<=80;x+=.25){const p=curlPaper({x,y:0,z:0},1,0,0,.95,80);length+=Math.hypot(p.x-previous.x,p.y-previous.y,p.z-previous.z);previous=p}
    expect(length).toBeCloseTo(80,3)
    expect(previous.z).toBeGreaterThan(30)
    expect(previous.x).toBeLessThan(70)
  })
  it('settles identically at 30, 60, 120 and 240Hz', () => {
    const samples=[30,60,120,240].map(hz=>{const spring={value:0,velocity:4};for(let i=0;i<hz;i++)stepPaperSpring(spring,.5,1/hz);return spring})
    for(const result of samples){expect(result.value).toBeCloseTo(samples[0]!.value,10);expect(result.velocity).toBeCloseTo(samples[0]!.velocity,10)}
  })
  it('keeps the strongest composed shape finite and below the light', () => {
    const shape:PaperShape={amount:1,bow:1,curlA:2.85,curlB:1.1,twist:1,ripple:1,time:2}
    for(let y=0;y<=270;y+=9)for(let x=0;x<=420;x+=10){const p=paperPoint(x,y,shape);expect(Number.isFinite(p.x+p.y+p.z)).toBe(true);expect(p.z).toBeLessThan(120)}
  })
  it('keeps composed local lengths within 4% of the printed sheet', () => {
    const shape:PaperShape={amount:1,bow:1,curlA:2.85,curlB:1.1,twist:1,ripple:1,time:2}
    for(let y=1;y<269;y+=9)for(let x=1;x<419;x+=10){
      const a=paperPoint(x,y,shape)
      for(const [dx,dy] of [[.1,0],[0,.1]]){
        const b=paperPoint(x+dx!,y+dy!,shape)
        const ratio=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)/.1
        expect(ratio).toBeGreaterThan(.96)
        expect(ratio).toBeLessThan(1.04)
      }
    }
  })
})
