// Lamp viewport — native pixels for the visible portion of a zoomed page.
// An iframe reports visualViewport.scale=1 while its parent is pinch-zoomed.
// Reading the enclosing viewport avoids stretching the lamp's bitmap (#54).
import * as THREE from 'three'
import {fitBulbCamera} from './homeLightBulb'

export function readEnclosingViewport(){
  let owner:Window=window,left=0,top=0
  const viewports:VisualViewport[]=[]
  if(owner.visualViewport)viewports.push(owner.visualViewport)
  try{
    while(owner.parent!==owner&&owner.frameElement){
      const parent=owner.parent,viewport=parent.visualViewport,box=owner.frameElement.getBoundingClientRect()
      left+=box.left;top+=box.top;owner=parent
      if(viewport)viewports.push(viewport)
    }
  }catch{
    // Cross-origin hosts do not expose their viewport; use the accessible one.
  }
  return {viewport:owner.visualViewport,left,top,viewports}
}

export function lampPixelRatio(){return window.devicePixelRatio*(readEnclosingViewport().viewport?.scale??1)}

export function watchLampViewport(changed:()=>void){
  const {viewports}=readEnclosingViewport()
  for(const viewport of viewports){viewport.addEventListener('resize',changed);viewport.addEventListener('scroll',changed)}
  return()=>{for(const viewport of viewports){viewport.removeEventListener('resize',changed);viewport.removeEventListener('scroll',changed)}}
}

export function createLampViewportUpdater(renderer:THREE.WebGLRenderer,camera:THREE.PerspectiveCamera,page:HTMLElement){
  let previous=''
  return()=>{
    const box=page.getBoundingClientRect()
    const width=page.clientWidth,height=page.clientHeight,{viewport,left,top}=readEnclosingViewport(),ratio=lampPixelRatio()
    const x=Math.max(0,(viewport?.offsetLeft??0)-left-box.left),y=Math.max(0,(viewport?.offsetTop??0)-top-box.top)
    const right=Math.min(width,(viewport?.offsetLeft??0)+(viewport?.width??width)-left-box.left)
    const bottom=Math.min(height,(viewport?.offsetTop??0)+(viewport?.height??height)-top-box.top)
    const visible=right>x&&bottom>y
    renderer.domElement.style.visibility=visible?'visible':'hidden'
    if(!visible)return
    const key=`${width},${height},${x},${y},${right},${bottom},${ratio}`
    if(key===previous)return
    previous=key
    const viewWidth=right-x,viewHeight=bottom-y
    renderer.setPixelRatio(ratio);renderer.setSize(viewWidth,viewHeight,false)
    Object.assign(renderer.domElement.style,{position:'absolute',left:`${x}px`,top:`${y}px`,width:`${viewWidth}px`,height:`${viewHeight}px`})
    fitBulbCamera(camera,width,height)
    camera.setViewOffset(width,height,x,y,viewWidth,viewHeight)
  }
}
