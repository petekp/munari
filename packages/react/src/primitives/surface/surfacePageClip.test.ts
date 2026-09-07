// @vitest-environment happy-dom
// Preparation clips include nested overflow and restore ownership at handoff.
import {afterEach,expect,it} from 'vitest'
import {createSurfacePageClip,surfacePageClipPath} from './surfacePageClip'

afterEach(()=>{document.body.innerHTML='';document.body.style.cssText='';document.documentElement.style.cssText=''})
function box(element:HTMLElement,left:number,top:number,width:number,height:number){
 element.style.width=`${width}px`;element.style.height=`${height}px`
 element.getBoundingClientRect=()=>new DOMRect(left,top,width,height)
 Object.defineProperties(element,{clientWidth:{value:width,configurable:true},clientHeight:{value:height,configurable:true},clientLeft:{value:0,configurable:true},clientTop:{value:0,configurable:true}})
 return element
}
function fixture(){
 const outer=box(document.createElement('div'),20,30,180,140),inner=box(document.createElement('div'),50,50,100,80),holder=document.createElement('div'),canvas=document.createElement('canvas')
 box(canvas,0,0,240,180);outer.append(inner);inner.append(holder,canvas);document.body.append(outer)
 return {outer,inner,holder,canvas}
}
function points(path:string){return [...path.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map(match=>[Number(match[1]),Number(match[2])])}
it('intersects clipping ancestors by axis even when the content box stays fixed',()=>{
 const {outer,inner,holder,canvas}=fixture()
 outer.style.overflowX='hidden';inner.style.overflowY='hidden'
 const clipped=points(surfacePageClipPath(canvas,holder))
 expect(Math.min(...clipped.map(p=>p[0]!))).toBe(20)
 expect(Math.max(...clipped.map(p=>p[0]!))).toBe(200)
 expect(Math.min(...clipped.map(p=>p[1]!))).toBe(50)
 expect(Math.max(...clipped.map(p=>p[1]!))).toBe(130)
 box(inner,50,50,100,50)
 const resized=points(surfacePageClipPath(canvas,holder))
 expect(Math.max(...resized.map(p=>p[1]!))).toBe(100)
})
it('keeps rounded overflow corners and cancels the current canvas display scale',()=>{
 const {inner,holder,canvas}=fixture()
 inner.style.overflowX=inner.style.overflowY='hidden';inner.style.borderRadius='20px'
 canvas.style.width='480px';canvas.style.height='360px'
 const clipped=points(surfacePageClipPath(canvas,holder))
 expect(clipped.length).toBeGreaterThan(8)
 expect(clipped.some(([x,y])=>x===100&&y===100)).toBe(false)
 expect(Math.min(...clipped.map(p=>p[0]!))).toBe(100)
 expect(Math.max(...clipped.map(p=>p[0]!))).toBe(300)
})
it('leaves clipping already applied by a fixed containing block to the browser',()=>{
 const {outer,inner,holder,canvas}=fixture()
 outer.style.overflowX=outer.style.overflowY='hidden';inner.style.transform='translateX(0px)'
 expect(surfacePageClipPath(canvas,holder)).toBe('')
 holder.style.overflowX='hidden';box(holder,80,60,40,30)
 expect(points(surfacePageClipPath(canvas,holder))).toHaveLength(4)
})
it('does not mistake body overflow propagated to the viewport for a zero-height clip',()=>{
 const {holder,canvas}=fixture();document.body.style.overflowX=document.body.style.overflowY='hidden'
 expect(surfacePageClipPath(canvas,holder)).toBe('')
})
it('restores the pre-existing canvas clip when preparation releases it',()=>{
 const {inner,holder,canvas}=fixture();inner.style.overflowX=inner.style.overflowY='hidden';canvas.style.clipPath='inset(2px)'
 const clip=createSurfacePageClip(canvas,holder)
 clip.apply();expect(canvas.style.clipPath).toContain('polygon(')
 clip.restore();expect(canvas.style.clipPath).toBe('inset(2px)')
 clip.restore();expect(canvas.style.clipPath).toBe('inset(2px)')
})

it('honors an explicit overflow clip margin',()=>{
 const {inner,holder,canvas}=fixture()
 inner.style.overflowX=inner.style.overflowY='clip';inner.style.overflowClipMargin='20px'
 const clipped=points(surfacePageClipPath(canvas,holder))
 expect(Math.min(...clipped.map(p=>p[0]!))).toBe(30)
 expect(Math.max(...clipped.map(p=>p[0]!))).toBe(170)
 expect(Math.min(...clipped.map(p=>p[1]!))).toBe(30)
 expect(Math.max(...clipped.map(p=>p[1]!))).toBe(150)
})

it('does not apply overflow from a non-container inline element',()=>{
 const {inner,holder,canvas}=fixture()
 inner.style.display='inline';inner.style.overflowX=inner.style.overflowY='hidden'
 expect(surfacePageClipPath(canvas,holder)).toBe('')
})

it('recognizes individual transform properties as fixed containing blocks',()=>{
 const {outer,inner,holder,canvas}=fixture()
 outer.style.overflowX=outer.style.overflowY='hidden';inner.style.setProperty('scale','1.2')
 expect(surfacePageClipPath(canvas,holder)).toBe('')
})
