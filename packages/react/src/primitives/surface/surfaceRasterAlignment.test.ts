// A render correction sharpens the image without changing a scene's trajectory.
import { expect, it } from 'vitest'
import { Group, Mesh, OrthographicCamera, PlaneGeometry, Scene } from 'three'
import { createSurfaceRasterAlignment } from './surfaceRasterAlignment'
function fixture(){
 const scene=new Scene(),mesh=new Mesh(new PlaneGeometry(100,50)),child=new Group()
 child.position.x=10;mesh.add(child);mesh.position.set(200.25,300.25,0);scene.add(mesh);scene.updateMatrixWorld()
 const camera=new OrthographicCamera(0,1000,1000,0,0.1,100);camera.position.z=10;camera.updateMatrixWorld()
 const input={mesh,camera,target:null,viewportWidth:1000,viewportHeight:1000,sourceWidth:100,sourceHeight:50,density:1,densityY:1,textureWidth:100,textureHeight:50,requestDensity:()=>{}}
 return {scene,mesh,child,input}
}
it('corrects only the drawn matrix, keeps children aligned, and restores normal updates',()=>{
 const {scene,mesh,child,input}=fixture(),raster=createSurfaceRasterAlignment()
 const restore=raster.prepare(input)
 expect(restore).not.toBeNull()
 expect(mesh.position.x).toBe(200.25)
 expect(mesh.matrixWorld.elements[12]).toBeCloseTo(200)
 expect(child.matrixWorld.elements[12]).toBeCloseTo(210)
 scene.updateMatrixWorld()
 expect(mesh.matrixWorld.elements[12]).toBeCloseTo(200)
 restore?.();scene.updateMatrixWorld()
 expect(mesh.matrixWorld.elements[12]).toBe(200.25)
})
it('does not quantize a moving pose or stretch an oversupplied image to fake 1:1',()=>{
 const {scene,mesh,input}=fixture(),raster=createSurfaceRasterAlignment()
 raster.prepare(input)?.()
 mesh.position.x+=0.1;scene.updateMatrixWorld()
 expect(raster.prepare(input)).toBeNull()
 expect(mesh.matrixWorld.elements[12]).toBeCloseTo(200.35)
 expect(raster.prepare({...input,textureWidth:200,textureHeight:100,density:2})).toBeNull()
})
it('declines a planar geometry whose UV mapping was warped',()=>{
 const {mesh,input}=fixture(),uv=mesh.geometry.getAttribute('uv')
 uv.setX(0,0.25);uv.needsUpdate=true
 expect(createSurfaceRasterAlignment().prepare(input)).toBeNull()
})

it('rechecks replaced attributes whose version restarts at zero',()=>{
 const {scene,mesh,input}=fixture(),raster=createSurfaceRasterAlignment()
 raster.prepare(input)?.();scene.updateMatrixWorld()
 const uv=mesh.geometry.getAttribute('uv').clone()
 uv.setX(0,.25);mesh.geometry.setAttribute('uv',uv)
 expect(raster.prepare(input)).toBeNull()
})

it('matches both axes when a source is stretched non-uniformly',()=>{
 const {scene,mesh,input}=fixture()
 mesh.scale.set(1.2,.85,1);scene.updateMatrixWorld()
 const restore=createSurfaceRasterAlignment().prepare({...input,density:1.2,densityY:.85,textureWidth:120,textureHeight:43})
 expect(restore).not.toBeNull()
 expect(mesh.scale.toArray()).toEqual([1.2,.85,1])
 restore?.()
})
