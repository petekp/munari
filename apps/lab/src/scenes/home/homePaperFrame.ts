// Paper draw frame — the drawn mesh projected into the page's light coordinates.
// Geometry, pointer hits and shadows must describe the same bend. This snapshot
// is published inside Surface's pre-draw callback, never through React (#51).
import * as THREE from 'three'
import { PAPER_COLUMNS, PAPER_ROWS } from './homePaperLaw'
import { POSTCARD_STANDOFF } from './homeLightLaw'

export interface PaperDrawFrame {
  /** Viewport x/y, height above the page, and projection w, per vertex. */
  vertices: Float32Array
  corners: Float32Array
  height: number
  anchor: { x: number; y: number; width: number; height: number }
}

export function createPaperDrawFrame(): PaperDrawFrame {
  return { vertices: new Float32Array((PAPER_COLUMNS+1)*(PAPER_ROWS+1)*4), corners: new Float32Array(12), height: POSTCARD_STANDOFF, anchor: {x:0,y:0,width:0,height:0} }
}

const world = new THREE.Vector3(), clip = new THREE.Vector4(), projection = new THREE.Matrix4()
const cornerIndices = [0,PAPER_COLUMNS,(PAPER_ROWS+1)*(PAPER_COLUMNS+1)-1,PAPER_ROWS*(PAPER_COLUMNS+1)]

export function writePaperDrawFrame(frame: PaperDrawFrame, mesh: THREE.Mesh, group: THREE.Group, camera: THREE.Camera, canvas: HTMLCanvasElement, holder: HTMLElement, height: number) {
  const position = mesh.geometry.getAttribute('position')
  if (!(position instanceof THREE.BufferAttribute) || position.count*4!==frame.vertices.length) throw new Error('Postcard geometry must use the paper grid')
  group.updateWorldMatrix(true,false)
  projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
  const box = canvas.getBoundingClientRect(), anchor = holder.getBoundingClientRect()
  frame.height = height
  Object.assign(frame.anchor,{x:anchor.left,y:anchor.top,width:anchor.width,height:anchor.height})
  for(let index=0;index<position.count;index++) {
    world.fromBufferAttribute(position,index).applyMatrix4(group.matrixWorld)
    clip.set(world.x,world.y,world.z,1).applyMatrix4(projection)
    frame.vertices[index*4]=box.left+(clip.x/clip.w+1)*box.width/2
    frame.vertices[index*4+1]=box.top+(1-clip.y/clip.w)*box.height/2
    frame.vertices[index*4+2]=world.z+height
    frame.vertices[index*4+3]=clip.w
  }
  cornerIndices.forEach((index,corner)=>frame.corners.set(frame.vertices.subarray(index*4,index*4+3),corner*3))
}

/** Map a content UV to the actual projected triangle, including perspective. */
export function paperFramePoint(frame: PaperDrawFrame, u: number, v: number) {
  const column=Math.min(PAPER_COLUMNS-1,Math.floor(u*PAPER_COLUMNS)), row=Math.min(PAPER_ROWS-1,Math.floor(v*PAPER_ROWS))
  const x=u*PAPER_COLUMNS-column,y=v*PAPER_ROWS-row,a=row*(PAPER_COLUMNS+1)+column,b=a+PAPER_COLUMNS+1
  const points=x+y<=1?[[a,1-x-y],[b,y],[a+1,x]]:[[b,1-x],[b+1,x+y-1],[a+1,1-y]]
  let px=0,py=0,pz=0,total=0
  for(const [index,weight] of points){
    const w=frame.vertices[index!*4+3]!*weight!
    px+=frame.vertices[index!*4]!*w;py+=frame.vertices[index!*4+1]!*w;pz+=frame.vertices[index!*4+2]!*weight!;total+=w
  }
  return {x:px/total,y:py/total,z:pz}
}
