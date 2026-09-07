// Raster alignment — apply the existing pixel-grid law to a stationary, flat Surface.
// Density alone did not fix the 0.75-pixel phase error measured on September 6:
// edge energy was 0.755 of native HTML, and a grid-aligned draw restored 1.000.
// Only rendered matrices change. Scene transforms and physics remain the caller's.
import { pixelGridSnap } from '@munari/core'
import { Camera, Matrix4, Mesh, PlaneGeometry, Vector3, type BufferAttribute, type InterleavedBufferAttribute, type WebGLRenderTarget } from 'three'

interface Rectangle { left:number; top:number; width:number; height:number }
interface PassHistory { screen:Rectangle|null; targets:WeakMap<WebGLRenderTarget,Rectangle> }
interface GeometryRecord { position:BufferAttribute|InterleavedBufferAttribute; uv:BufferAttribute|InterleavedBufferAttribute; version:number; uvVersion:number; flat:boolean }
const geometryRecords = new WeakMap<PlaneGeometry,GeometryRecord>()
const PRECISION = 1e-4 // Projected-pixel roundoff, below the phase budget in decision #44.
function flatPlane(mesh:Mesh):PlaneGeometry|null {
 const geometry=mesh.geometry
 if(!(geometry instanceof PlaneGeometry))return null
 const positions=geometry.getAttribute('position')
 const uv=geometry.getAttribute('uv')
 if(!('version' in positions)||!uv||!('version' in uv))return null
 const known=geometryRecords.get(geometry)
 if(known?.position===positions&&known.uv===uv&&known.version===positions.version&&known.uvVersion===uv.version)return known.flat?geometry:null
 geometry.computeBoundingBox()
 const bounds=geometry.boundingBox
 let flat=!!bounds&&bounds.min.z===bounds.max.z
 if(flat&&bounds){
  const w=bounds.max.x-bounds.min.x,h=bounds.max.y-bounds.min.y,tolerance=Math.max(w,h)*1e-6
  for(let i=0;i<positions.count;i++)if(Math.abs(positions.getX(i)-bounds.min.x-uv.getX(i)*w)>tolerance||Math.abs(positions.getY(i)-bounds.min.y-uv.getY(i)*h)>tolerance){flat=false;break}
 }
 geometryRecords.set(geometry,{position:positions,uv,version:positions.version,uvVersion:uv.version,flat})
 return flat?geometry:null
}
function sameRectangle(a:Rectangle,b:Rectangle):boolean {
 return Math.abs(a.left-b.left)<PRECISION&&Math.abs(a.top-b.top)<PRECISION&&Math.abs(a.width-b.width)<PRECISION&&Math.abs(a.height-b.height)<PRECISION
}
function projectedRectangle(tl:Vector3,tr:Vector3,bl:Vector3,br:Vector3):Rectangle|null {
 if(tl.z < -1||tl.z>1||Math.abs(tl.y-tr.y)>PRECISION||Math.abs(bl.y-br.y)>PRECISION||Math.abs(tl.x-bl.x)>PRECISION||Math.abs(tr.x-br.x)>PRECISION)return null
 const box={left:tl.x,top:tl.y,width:tr.x-tl.x,height:bl.y-tl.y}
 return box.width>0&&box.height>0?box:null
}
export interface SurfaceRasterInput {
 mesh:Mesh; camera:Camera; target:WebGLRenderTarget|null
 viewportWidth:number; viewportHeight:number
 sourceWidth:number; sourceHeight:number; density:number; densityY:number
 textureWidth:number; textureHeight:number
 requestDensity:(x:number,y:number)=>void
}
export function createSurfaceRasterAlignment() {
 const history=new WeakMap<Camera,PassHistory>()
 const matrix=new Matrix4(),local=new Matrix4(),centre=new Vector3(),destination=new Vector3()
 const tl=new Vector3(),tr=new Vector3(),bl=new Vector3(),br=new Vector3()
 let displayed:Matrix4|null=null
 return {
  renderedMatrix:()=>displayed,
  rememberPose(mesh:Mesh){displayed??=new Matrix4();displayed.copy(mesh.matrixWorld)},
  prepare(input:SurfaceRasterInput):(()=>void)|null {
   const {mesh,camera,target,viewportWidth:vw,viewportHeight:vh,sourceWidth:sw,sourceHeight:sh}=input
   displayed??=new Matrix4();displayed.copy(mesh.matrixWorld)
   const geometry=flatPlane(mesh),bounds=geometry?.boundingBox
   if(!geometry||!bounds||sw<=0||sh<=0||vw<=0||vh<=0)return null
   const project=(point:Vector3)=>{point.applyMatrix4(mesh.matrixWorld).project(camera);point.set((point.x+1)*vw/2,(1-point.y)*vh/2,point.z)}
   tl.set(bounds.min.x,bounds.max.y,bounds.min.z);tr.set(bounds.max.x,bounds.max.y,bounds.min.z)
   bl.set(bounds.min.x,bounds.min.y,bounds.min.z);br.set(bounds.max.x,bounds.min.y,bounds.min.z)
   project(tl);project(tr);project(bl);project(br)
   const box=projectedRectangle(tl,tr,bl,br)
   if(!box)return null
   let passes=history.get(camera)
   if(!passes){passes={screen:null,targets:new WeakMap()};history.set(camera,passes)}
   const previous=target?passes.targets.get(target):passes.screen
   if(target)passes.targets.set(target,box);else passes.screen=box
   if(previous&&!sameRectangle(previous,box))return null
   const mx=box.width/sw,my=box.height/sh
   input.requestDensity(mx,my)
   // An explicit pin or a shared larger presenter can supply a different pitch.
   // Do not resize the object to make that texture pretend to be a 1:1 image.
   if(Math.abs(input.textureWidth-box.width)>1||Math.abs(input.textureHeight-box.height)>1)return null
   const x=(box.left+box.width/2-vw/2)/mx,y=(vh/2-box.top-box.height/2)/my
   const horizontal=pixelGridSnap({x,y:0,width:sw,height:sh,mag:mx,viewW:vw,viewH:vh,dpr:1,density:input.density})
   const vertical=pixelGridSnap({x:0,y,width:sw,height:sh,mag:my,viewW:vw,viewH:vh,dpr:1,density:input.densityY})
   bounds.getCenter(centre)
   destination.copy(centre).applyMatrix4(mesh.matrixWorld)
   const worldCentre=destination.clone()
   destination.project(camera)
   destination.x+=horizontal.dx*mx*2/vw
   destination.y+=vertical.dy*my*2/vh
   destination.unproject(camera).sub(worldCentre)
   matrix.copy(mesh.matrixWorld)
   local.makeTranslation(centre.x,centre.y,centre.z);matrix.multiply(local)
   local.makeScale(horizontal.sx,vertical.sy,1);matrix.multiply(local)
   local.makeTranslation(-centre.x,-centre.y,-centre.z);matrix.multiply(local)
   matrix.elements[12]!+=destination.x;matrix.elements[13]!+=destination.y;matrix.elements[14]!+=destination.z
   const automatic=mesh.matrixWorldAutoUpdate
   mesh.matrixWorldAutoUpdate=false;mesh.matrixWorld.copy(matrix);displayed.copy(matrix)
   for(const child of mesh.children)child.updateMatrixWorld(true)
   return()=>{mesh.matrixWorldAutoUpdate=automatic}
  },
 }
}
