// Surface pixel density — compare the displayed image with its actual backing pixels.
// A scaled canvas and a wide quad defeated DPR-only and sphere-diagonal estimates
// in the September 6 sharpness probe. The binding owns these display measurements.
import type { CanvasProps } from '@react-three/fiber'
import type { RectLike } from '@munari/core'
import type { SurfaceSize } from './surfaceSourceRuntime'

export function surfaceCanvasPixelRatio(dpr: CanvasProps['dpr'], native: number, scale: number): number {
  const requested = dpr === undefined ? native : Array.isArray(dpr) ? Math.min(dpr[1], Math.max(dpr[0], native)) : dpr
  return requested * scale
}

export function surfaceCanvasDisplayScale(canvas: HTMLCanvasElement): number {
  if (!canvas.clientWidth || !canvas.clientHeight) return 1
  const rect = canvas.getBoundingClientRect()
  return Math.max(1, rect.width / canvas.clientWidth, rect.height / canvas.clientHeight)
}

export function matchedSurfaceDensity(size: SurfaceSize, page: RectLike, canvas: RectLike, buffer: SurfaceSize): number {
  if (size[0] <= 0 || size[1] <= 0 || canvas.width <= 0 || canvas.height <= 0) return 0
  return Math.max(page.width / size[0] * buffer[0] / canvas.width, page.height / size[1] * buffer[1] / canvas.height)
}

/** Keep a display-sized R3F canvas from receiving its container's scale twice. */
export function counterSurfaceCanvasScale(canvas:HTMLCanvasElement) {
 const transform=canvas.style.transform,origin=canvas.style.transformOrigin
 let written=false
 const update=()=>{
  const parent=canvas.parentElement
  if(!parent||!parent.clientWidth||!parent.clientHeight||(transform&&transform!=='none'))return
  const rect=parent.getBoundingClientRect(),style=getComputedStyle(parent)
  const width=parseFloat(style.width)||parent.clientWidth,height=parseFloat(style.height)||parent.clientHeight
  const x=rect.width/width,y=rect.height/height
  if(x<=0||y<=0)return
  const next=Math.abs(x-1)<1e-6&&Math.abs(y-1)<1e-6?transform:`scale(${1/x}, ${1/y})`
  if(canvas.style.transform===next)return
  canvas.style.transform=next;canvas.style.transformOrigin='0 0';written=true
 }
 return {update,dispose(){if(written){canvas.style.transform=transform;canvas.style.transformOrigin=origin}}}
}
