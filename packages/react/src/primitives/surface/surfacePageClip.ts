// Page preparation clipping — the visible capture must obey the page's overflow.
// On 2026-09-06, Chrome showed capture pixels 30px below an overflow edge (#45).
// The page binding owns this clip only while preparing; the scene owns its later shape.
type Point = readonly [number, number]
type Insets = readonly [number,number,number,number]
interface Box { left:number; top:number; right:number; bottom:number; width:number; height:number }
const EPSILON=1e-7 // Intersection roundoff, below the 0.1 device-pixel curve budget (#45).
const CURVE_ERROR=0.1 // Device pixels; smaller than the clipping probe's edge tolerance (#45).

function rectangle(box:Box):Point[] {return [[box.left,box.top],[box.right,box.top],[box.right,box.bottom],[box.left,box.bottom]]}
function intersect(subject:Point[],clip:Point[]):Point[] {
  for(let edge=0;edge<clip.length&&subject.length;edge++){
    const a=clip[edge]!,b=clip[(edge+1)%clip.length]!
    const distance=(p:Point)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
    const output:Point[]=[]
    let previous=subject[subject.length-1]!,before=distance(previous)
    for(const point of subject){
      const after=distance(point),wasInside=before>=-EPSILON,isInside=after>=-EPSILON
      if(wasInside!==isInside){const t=before/(before-after);output.push([previous[0]+t*(point[0]-previous[0]),previous[1]+t*(point[1]-previous[1])])}
      if(isInside)output.push(point)
      previous=point;before=after
    }
    subject=output
  }
  return subject
}
const pixels=(value:string)=>Number.parseFloat(value)||0
function fixedContainer(style:CSSStyleDeclaration):boolean {
  return style.display!=='contents'&&style.display!=='inline'&&(
    ['transform','translate','scale','rotate','perspective','filter','backdrop-filter'].some(name=>{const value=style.getPropertyValue(name);return !!value&&value!=='none'})||style.transformStyle==='preserve-3d'||
    /(?:^|\s)(?:paint|layout|strict|content)(?:\s|$)/.test(style.contain)||
    /(?:transform|perspective|filter)/.test(style.willChange)||style.contentVisibility==='auto'
  )
}
function clips(value:string):boolean {return ['hidden','clip','auto','scroll'].includes(value)}
function radius(value:string,width:number,height:number):Point {
  const [x='0',y=x]=value.split(/\s+/)
  return [pixels(x)*(x.endsWith('%')?width/100:1),pixels(y)*(y.endsWith('%')?height/100:1)]
}
function borderInsets(style:CSSStyleDeclaration,sx:number,sy:number):Insets {
  return [pixels(style.borderTopWidth)*sy,pixels(style.borderRightWidth)*sx,pixels(style.borderBottomWidth)*sy,pixels(style.borderLeftWidth)*sx]
}
function overflowClipInsets(style:CSSStyleDeclaration,sx:number,sy:number):Insets {
  const value=style.overflowClipMargin,margin=Math.max(0,...value.split(/\s+/).map(pixels))
  const border=value.includes('border-box')?[0,0,0,0] as const:borderInsets(style,sx,sy)
  const content=value.includes('content-box')
  return [border[0]+(content?pixels(style.paddingTop)*sy:0)-margin*sy,border[1]+(content?pixels(style.paddingRight)*sx:0)-margin*sx,border[2]+(content?pixels(style.paddingBottom)*sy:0)-margin*sy,border[3]+(content?pixels(style.paddingLeft)*sx:0)-margin*sx]
}
function roundedClip(box:Box,style:CSSStyleDeclaration,scaleX:number,scaleY:number,borders:Insets,dpr:number):Point[] {
  const outer=[style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomRightRadius,style.borderBottomLeftRadius].map(value=>{
    const [x,y]=radius(value,box.width/scaleX,box.height/scaleY);return [x*scaleX,y*scaleY] as const
  })
  const factor=Math.min(1,box.width/(outer[0]![0]+outer[1]![0]),box.width/(outer[3]![0]+outer[2]![0]),box.height/(outer[0]![1]+outer[3]![1]),box.height/(outer[1]![1]+outer[2]![1]))
  const left=box.left+borders[3]!,right=box.right-borders[1]!,top=box.top+borders[0]!,bottom=box.bottom-borders[2]!
  const corners=outer.map(([x,y],i)=>[Math.max(0,x*factor-borders[i===0||i===3?3:1]!),Math.max(0,y*factor-borders[i<2?0:2]!)] as const)
  const points:Point[]=[]
  corners.forEach(([rx,ry],i)=>{
    const cx=i===0||i===3?left+rx:right-rx,cy=i<2?top+ry:bottom-ry
    // Bound the chord error to 0.1 display pixels; ordinary square clips use four points.
    const radius=Math.max(rx,ry)*dpr
    const steps=radius>0?Math.max(1,Math.ceil((Math.PI/2)/(2*Math.acos(Math.max(-1,1-CURVE_ERROR/radius))))):1
    for(let n=0;n<=steps;n++){const angle=Math.PI+i*Math.PI/2+n*Math.PI/2/steps;points.push([cx+rx*Math.cos(angle),cy+ry*Math.sin(angle)])}
  })
  return points
}

function clipAxes(node:HTMLElement,style:CSSStyleDeclaration,rootStyle:CSSStyleDeclaration) {
  // Root overflow, including overflow propagated from body, clips the viewport.
  const body=node===node.ownerDocument.body
  return {
    x:clips(style.overflowX)&&!(body&&(!rootStyle.overflowX||rootStyle.overflowX==='visible')),
    y:clips(style.overflowY)&&!(body&&(!rootStyle.overflowY||rootStyle.overflowY==='visible')),
  }
}
function clipAtElement(points:Point[],box:Box,node:HTMLElement,style:CSSStyleDeclaration,x:boolean,y:boolean):Point[] {
  const bounds=node.getBoundingClientRect()
  const bordersX=pixels(style.borderLeftWidth)+pixels(style.borderRightWidth),bordersY=pixels(style.borderTopWidth)+pixels(style.borderBottomWidth)
  const localWidth=pixels(style.width)+(style.boxSizing==='border-box'?0:bordersX+pixels(style.paddingLeft)+pixels(style.paddingRight))||node.offsetWidth
  const localHeight=pixels(style.height)+(style.boxSizing==='border-box'?0:bordersY+pixels(style.paddingTop)+pixels(style.paddingBottom))||node.offsetHeight
  if(localWidth<=0||localHeight<=0)return []
  const sx=bounds.width/localWidth,sy=bounds.height/localHeight
  const edge=overflowClipInsets(style,sx,sy)
  const scrollLeft=bounds.left+node.clientLeft*sx,scrollTop=bounds.top+node.clientTop*sy
  const horizontal=style.overflowX==='clip'?[bounds.left+edge[3],bounds.right-edge[1]]:[scrollLeft,scrollLeft+node.clientWidth*sx]
  const vertical=style.overflowY==='clip'?[bounds.top+edge[0],bounds.bottom-edge[2]]:[scrollTop,scrollTop+node.clientHeight*sy]
  const left=x?horizontal[0]!:box.left,right=x?horizontal[1]!:box.right
  const top=y?vertical[0]!:box.top,bottom=y?vertical[1]!:box.bottom
  let clipped=intersect(points,rectangle({left,right,top,bottom,width:right-left,height:bottom-top}))
  if(x&&y&&[style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomRightRadius,style.borderBottomLeftRadius].some(value=>pixels(value)>0)){
    const insets=style.overflowX==='clip'&&style.overflowY==='clip'?edge:borderInsets(style,sx,sy)
    clipped=intersect(clipped,roundedClip(bounds,style,sx,sy,insets,node.ownerDocument.defaultView?.devicePixelRatio??1))
  }
  return clipped
}
function polygonPath(points:Point[],box:Box,width:number,height:number):string {
  if(points.length<3)return 'polygon(0px 0px, 0px 0px, 0px 0px)'
  const original=rectangle(box)
  if(points.length===4&&points.every(point=>original.some(corner=>Math.abs(point[0]-corner[0])<EPSILON&&Math.abs(point[1]-corner[1])<EPSILON)))return ''
  const local=points.map(([x,y])=>`${Number(((x-box.left)*width/box.width).toFixed(5))}px ${Number(((y-box.top)*height/box.height).toFixed(5))}px`)
  return `polygon(${local.join(', ')})`
}
export function surfacePageClipPath(canvas:HTMLCanvasElement,holder:HTMLElement):string {
  const view=holder.ownerDocument.defaultView
  if(!view)return ''
  const styles=new Map<Element,CSSStyleDeclaration>()
  const styleOf=(element:Element)=>{let style=styles.get(element);if(!style){style=view.getComputedStyle(element);styles.set(element,style)}return style}
  let containingBlock:Element|null=null
  for(let node=canvas.parentElement;node;node=node.parentElement)if(fixedContainer(styleOf(node))){containingBlock=node;break}
  const box=canvas.getBoundingClientRect(),width=pixels(canvas.style.width),height=pixels(canvas.style.height)
  if(box.width<=0||box.height<=0||width<=0||height<=0)return polygonPath([],box,width,height)
  let points=rectangle(box)
  const root=holder.ownerDocument.documentElement,rootStyle=styleOf(root)
  // At and above the fixed containing block, the browser already applies clipping.
  for(let node:HTMLElement|null=holder;node&&node!==containingBlock&&node!==root;node=node.parentElement){
    const style=styleOf(node),{x,y}=clipAxes(node,style,rootStyle)
    if(style.display==='contents'||style.display==='inline'||(!x&&!y))continue
    points=clipAtElement(points,box,node,style,x,y)
  }
  return polygonPath(points,box,width,height)
}

export function createSurfacePageClip(canvas:HTMLCanvasElement,holder:HTMLElement) {
  let original:string|null=null,written:string|null=null
  const read=()=>surfacePageClipPath(canvas,holder)
  return {
    read,
    apply(){original??=canvas.style.clipPath;const value=read()||original;if(value!==written){canvas.style.clipPath=value;written=value}},
    restore(){if(original!==null)canvas.style.clipPath=original;original=null;written=null},
  }
}
