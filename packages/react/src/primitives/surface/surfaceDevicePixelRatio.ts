// Native display density — one subscription shared by renderers and capture owners.
// A window moved between displays or zoomed must not retain its previous raster size.
import { useSyncExternalStore } from 'react'
const listeners=new Set<()=>void>()
let stop:(()=>void)|null=null
export function readSurfaceDevicePixelRatio():number { return 'window' in globalThis ? window.devicePixelRatio : 1 }
export function subscribeSurfaceDevicePixelRatio(listener:()=>void):()=>void {
 listeners.add(listener)
 if(!stop&&'window' in globalThis){
  let query:MediaQueryList|null=null
  const changed=()=>{
   query?.removeEventListener('change',changed)
   query=window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
   query.addEventListener('change',changed)
   for(const notify of [...listeners])notify()
  }
  changed();window.addEventListener('resize',changed)
  stop=()=>{query?.removeEventListener('change',changed);window.removeEventListener('resize',changed)}
 }
 return()=>{listeners.delete(listener);if(!listeners.size){stop?.();stop=null}}
}
export function useSurfaceDevicePixelRatio():number {
 return useSyncExternalStore(subscribeSurfaceDevicePixelRatio,readSurfaceDevicePixelRatio,()=>1)
}
