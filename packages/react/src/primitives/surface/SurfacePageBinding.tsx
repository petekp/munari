// Page binding — the page slot of a Surface.HTML, measured and held.
//
// The law: the slot's size is read in the block's own px, never from its
// rect, and the page copy is hidden, inert and out of the accessibility
// tree exactly while the scene holds it (store.pagePresents()).
//
// Ownership: Surface.HTML renders this inside its part; the part owns the
// size it reports, and the store owns the hold.

import { use, useEffect, useLayoutEffect, useRef } from 'react'
import { SurfacePartContext, SurfaceRootContext } from './surfaceContext'
import { boxInHostSpace, markerSpace } from './surfaceHostSpace'

export function PageBinding({page,marker,layout,inScene,pageContent}:{page:HTMLElement;marker:HTMLElement;pageContent:()=>HTMLElement|null;layout:'preserve'|'reflow';inScene:boolean}) {
  const root=use(SurfaceRootContext)!
  const part=use(SurfacePartContext)!
  const last=useRef<readonly[number,number]|null>(null)
  const setPageRoot=part.setPageRoot,setMeasuredSize=part.setMeasuredSize
  useLayoutEffect(()=>{setPageRoot(page);return()=>setPageRoot(null)},[page,setPageRoot])
  useLayoutEffect(()=>{
    // The slot's size in the block's own px, never its rect: a turned block
    // inflates every rect it reports, and a Surface sized from one would ask
    // for a texture bigger than the content it is drawing.
    const read=()=>{const space=markerSpace(marker);const box=space&&boxInHostSpace(pageContent() ?? page, space);if(!box)return;const w=box.width,h=box.height;if(last.current?.[0]!==w||last.current[1]!==h){last.current=[w,h];setMeasuredSize([w,h])}root.host?.invalidate()}
    read();const observer=new ResizeObserver(read);observer.observe(page)
    let measured:HTMLElement|null=null
    const watch=()=>{const next=pageContent();if(next!==measured){if(measured)observer.unobserve(measured);measured=next;if(measured)observer.observe(measured)}read()}
    watch();const mutations=new MutationObserver(watch);mutations.observe(page,{subtree:true,childList:true})
    const subscriptions = new AbortController()
    window.addEventListener('scroll',read,{capture:true,passive:true,signal:subscriptions.signal});window.addEventListener('resize',read,{passive:true,signal:subscriptions.signal})
    return()=>{observer.disconnect();mutations.disconnect();subscriptions.abort()}
  },[page,marker,setMeasuredSize,root.host,pageContent])
  useEffect(()=>{
    const apply=()=>{const released=!root.store.pagePresents();page.style.visibility=released?'hidden':'';page.style.display=layout==='reflow'&&released&&inScene?'none':'';page.inert=released;if(released)page.setAttribute('aria-hidden','true');else page.removeAttribute('aria-hidden')}
    apply();return root.store.subscribeHold(apply)
  },[page,root.store,layout,inScene])
  return null
}
