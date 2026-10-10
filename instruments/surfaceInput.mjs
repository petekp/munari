// A mounted mesh can still be preparing its first visible frame.
// Wait for its public raycast to accept input before sending a real click.
// On timeout, the error says what the page held, because a hosted runner's
// failure cannot be reproduced on demand.
//
// The deadline bounds a page that never becomes ready. It does not judge
// startup time. On software WebGPU, the Knobs panel first accepted input after
// 13 frames, 15-18 s after load (2-CPU Linux container, 2026-10-09). A hosted
// runner had drawn only 12 frames when a 10 s deadline expired. A Mac needs
// 30 frames and 1.8 s.
const INPUT_DEADLINE_MS = 30_000

export async function waitForSurfaceInput(page,name) {
 try {
  await page.waitForFunction(name=>{
   const state=window.__r3f,mesh=state?.scene.getObjectByName(name)
   if(!mesh)return false
   const point=mesh.position.clone().set(0,0,0).applyMatrix4(mesh.matrixWorld).project(state.camera)
   state.raycaster.setFromCamera(point,state.camera)
   const hits=[];mesh.raycast(state.raycaster,hits)
   return hits.length>0
  },{timeout:INPUT_DEADLINE_MS},name)
 } catch (error) {
  const seen=await page.evaluate(name=>{
   const state=window.__r3f,mesh=state?.scene.getObjectByName(name)
   if(!state)return {r3f:false}
   const canvas=state.gl.domElement
   return {
    mesh:Boolean(mesh),visible:mesh?.visible,
    world:mesh?.matrixWorld.elements.slice(12,15),
    aspect:state.camera.aspect,size:state.size,
    canvas:{width:canvas.width,height:canvas.height,display:getComputedStyle(canvas).display},
    backend:state.gl.backend?.constructor.name,frames:state.gl.info?.frame,
   }
  },name).catch(cause=>({unreadable:String(cause)}))
  throw new Error(`${name} never accepted a raycast: ${JSON.stringify(seen)}`,{cause:error})
 }
}
