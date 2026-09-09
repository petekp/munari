// A mounted mesh can still be preparing its first visible frame.
// Wait for its public raycast to accept input before sending a real click.
export async function waitForSurfaceInput(page,name) {
 await page.waitForFunction(name=>{
  const state=window.__r3f,mesh=state?.scene.getObjectByName(name)
  if(!mesh)return false
  const point=mesh.position.clone().set(0,0,0).applyMatrix4(mesh.matrixWorld).project(state.camera)
  state.raycaster.setFromCamera(point,state.camera)
  const hits=[];mesh.raycast(state.raycaster,hits)
  return hits.length>0
 },{timeout:10000},name)
}
