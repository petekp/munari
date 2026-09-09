// Cord contracts: endpoints follow input, long drags stay bounded, rest loses energy.
import {describe,it,expect} from 'vitest'
import {CORD_POINTS,createLampCord,stepLampCord} from './homeLampCordLaw'

describe('lamp cord',()=>{
  it('pins the ceiling and bulb through a long drag',()=>{
    const cord=createLampCord();stepLampCord(cord,180,90,0)
    for(let i=0;i<120;i++)stepLampCord(cord,180+i*5,90+i*3,1/120)
    expect(cord.points[0]).toBe(180);expect(cord.points[1]).toBe(-100)
    expect(cord.points[(CORD_POINTS-1)*2]).toBe(775)
    expect(cord.points[(CORD_POINTS-1)*2+1]).toBe(447)
    for(const value of cord.points)expect(Number.isFinite(value)).toBe(true)
  })
  it('settles after movement stops',()=>{
    const cord=createLampCord();stepLampCord(cord,180,100,0)
    for(let i=0;i<90;i++)stepLampCord(cord,180+i*4,100+i*3,1/120)
    const energy=()=>cord.points.reduce((sum,value,i)=>sum+(value-cord.previous[i]!)**2,0)
    const moving=energy()
    for(let i=0;i<360;i++)stepLampCord(cord,536,367,1/120)
    expect(energy()).toBeLessThan(moving*.01)
  })
  it('has no retained velocity in reduced motion or after a teleport',()=>{
    const cord=createLampCord();stepLampCord(cord,180,100,0)
    stepLampCord(cord,900,800,1/60)
    expect([...cord.points]).toEqual([...cord.previous])
    stepLampCord(cord,920,780,1/60,true)
    expect([...cord.points]).toEqual([...cord.previous])
  })
})
