// WebGPU command observation — a bounded S0 diagnostic.
// Native commands and bound allocations do not establish Surface presentation authority.
// On 2026-10-05, a prewarmed borrowed draw returned [255, 0, 0, 255] with unknown pipeline and binding metadata.
// This page owns controlled resources and temporary instance hooks; run.mjs owns setup and evidence.

import * as THREE from 'three/webgpu'
import { texture, vec4, wgslFn } from 'three/tsl'

const result={browser:navigator.userAgent,threeRevision:THREE.REVISION,secureContext:isSecureContext,cases:{},prototypeChanges:false,gateSelected:false}
const releases=[],textureMeta=new WeakMap(),viewMeta=new WeakMap(),groupMeta=new WeakMap(),pipelineMeta=new WeakMap(),bufferMeta=new WeakMap()
let nextId=0,owner=null,activeArgs=null,submissions=[]
let watchedObject=null
let renderer,device,target,external,geometry
const methods=['createTexture','createBindGroup','createRenderPipeline','createCommandEncoder']
const prototypes=methods.map(name=>globalThis.GPUDevice?.prototype[name])
const queuePrototype=globalThis.GPUQueue?.prototype.submit
function forward(object,name,handler){
 const descriptor=Object.getOwnPropertyDescriptor(object,name),original=object[name]
 const replacement=function(...args){return handler(original.bind(object),args)}
 Object.defineProperty(object,name,{configurable:true,writable:true,value:replacement})
 releases.push(()=>{if(object[name]!==replacement)return;if(descriptor)Object.defineProperty(object,name,descriptor);else delete object[name]})
}
function trackTexture(texture,metadata){
 textureMeta.set(texture,metadata)
 forward(texture,'createView',(original,args)=>{const view=original(...args);viewMeta.set(view,{...metadata,view:{...(args[0]??{})}});return view})
 return texture
}
function observer(native){
 forward(native,'createTexture',(original,args)=>trackTexture(original(...args),{id:++nextId,descriptor:{...args[0]}}))
 forward(native,'createBindGroup',(original,args)=>{
  const group=original(...args)
  groupMeta.set(group,args[0].entries.filter(entry=>viewMeta.has(entry.resource)).map(entry=>({binding:entry.binding,texture:viewMeta.get(entry.resource).id})))
  return group
 })
 forward(native,'createRenderPipeline',(original,args)=>{
  const pipeline=original(...args)
  pipelineMeta.set(pipeline,{targets:args[0].fragment?.targets?.map(value=>({format:value?.format,writeMask:value?.writeMask??GPUColorWrite.ALL})),depthWrite:args[0].depthStencil?.depthWriteEnabled??false})
  return pipeline
 })
 forward(native,'createCommandEncoder',(original,args)=>{
  const encoder=original(...args),passes=[]
  forward(encoder,'beginRenderPass',(begin,values)=>{
   const descriptor=values[0],pass=begin(...values),draws=[],bindings=new Map()
   const row={attachments:descriptor.colorAttachments.map(value=>value?{texture:viewMeta.get(value.view)?.id??null,resolve:viewMeta.get(value.resolveTarget)?.id??null,loadOp:value.loadOp,storeOp:value.storeOp}:null),draws}
   passes.push(row)
   let pipeline=null
   forward(pass,'setPipeline',(set,values)=>{const output=set(...values);pipeline=values[0];return output})
   forward(pass,'setBindGroup',(set,values)=>{const output=set(...values);bindings.set(values[0],groupMeta.get(values[1])??[]);return output})
   for(const name of ['draw','drawIndexed'])forward(pass,name,(draw,values)=>{
    const output=draw(...values)
    draws.push({command:name,count:values[0],instances:values[1]??1,owner:owner?.name??null,watched:owner===watchedObject,pipeline:pipelineMeta.get(pipeline)??null,bindings:[...bindings.values()].flat().map(value=>({...value}))})
    return output
   })
   return pass
  })
  forward(encoder,'finish',(finish,values)=>{const buffer=finish(...values);bufferMeta.set(buffer,passes);return buffer})
  return encoder
 })
 forward(native.queue,'submit',(submit,values)=>{
  const buffers=[...values[0]],output=submit(buffers)
  submissions.push(...buffers.flatMap(buffer=>bufferMeta.get(buffer)??[]))
  return output
 })
}
async function run(label,scene,camera){
 submissions=[]
 device.pushErrorScope('validation')
 renderer.render(scene,camera)
 const error=await device.popErrorScope()
 const copied=JSON.parse(JSON.stringify(submissions))
 result.cases[label]={validation:error?.message??null,submissions:copied,hasKnownSourceCommand:!error&&copied.some(pass=>pass.draws.some(draw=>draw.watched&&draw.count>0&&draw.instances>0&&draw.bindings.some(binding=>binding.texture===result.sourceAllocation)))}
 const pixels=await renderer.readRenderTargetPixelsAsync(target,4,4,1,1)
 result.cases[label].pixel=Array.from(pixels.slice(0,4))
}

async function observeEarlyDispose(){
 const canvas=document.createElement('canvas')
 const early=new THREE.WebGPURenderer({canvas,forceWebGL:true,alpha:true,antialias:false})
 const row={beforeInitialized:early.initialized,initRequested:false,initOutcome:null,observedInitialization:false,backend:null,pixel:null}
 result.cases.preInitDispose=row
 let sampleTarget,sampleGeometry,sampleMaterial,requestedInit
 const originalInit=early.init
 const observedInit=function(...args){row.initRequested=true;requestedInit=originalInit.apply(this,args);return requestedInit}
 early.init=observedInit
 try{
  await early.dispose()
  if(requestedInit){
   let deadline
   try{
    await Promise.race([requestedInit,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Dispose-triggered initialization did not settle within 2 seconds')),2000)})])
    row.initOutcome='fulfilled'
   }catch(error){row.initOutcome='failed-or-unverified';throw error}
   finally{clearTimeout(deadline)}
  }
  row.observedInitialization=early.initialized
  if(!early.initialized)return
  if(!early.backend.isWebGLBackend)throw Error('Early-dispose control did not select WebGL 2')
  row.backend='webgl2'
  early.setSize(8,8);early.setClearColor(0x0000ff,1);early.toneMapping=THREE.NoToneMapping
  sampleTarget=new THREE.RenderTarget(8,8,{type:THREE.UnsignedByteType})
  sampleGeometry=new THREE.PlaneGeometry(2,2)
  sampleMaterial=new THREE.MeshBasicNodeMaterial({color:0xff00ff,toneMapped:false})
  const scene=new THREE.Scene();scene.add(new THREE.Mesh(sampleGeometry,sampleMaterial))
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=3
  early.setRenderTarget(sampleTarget)
  // No init call follows dispose: real pixels establish whether disposal made this renderer usable.
  early.render(scene,camera)
  const pixels=await early.readRenderTargetPixelsAsync(sampleTarget,4,4,1,1)
  row.pixel=Array.from(pixels.slice(0,4))
 }finally{
  early.setRenderTarget(null);sampleTarget?.dispose();sampleGeometry?.dispose();sampleMaterial?.dispose()
  // A second dispose while still uninitialized could request another initialization; do not mask the observed cause.
  if(early.initialized)await early.dispose()
  if(early.init===observedInit)early.init=originalInit
 }
}

try{
 if(!navigator.gpu||!globalThis.GPUDevice||!globalThis.GPUQueue)throw Error('Native WebGPU API is required; this diagnostic cannot fall back')
 const adapter=await navigator.gpu.requestAdapter()
 if(!adapter)throw Error('Actual WebGPU adapter required')
 result.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,isFallbackAdapter:adapter.info.isFallbackAdapter??null}
 device=await adapter.requestDevice()
 observer(device)
 renderer=new THREE.WebGPURenderer({device,alpha:true,antialias:false})
 await renderer.init()
 if(!renderer.backend.isWebGPUBackend)throw Error('Requested WebGPU fell back')
 result.backend='webgpu'
 renderer.setSize(8,8);renderer.setClearColor(0x0000ff,1);renderer.toneMapping=THREE.NoToneMapping
 const renderObject=renderer.renderObject
 renderer.renderObject=function(...args){const previous=owner,previousArgs=activeArgs;owner=args[0];activeArgs=args;try{return renderObject.apply(this,args)}finally{owner=previous;activeArgs=previousArgs}}
 releases.push(()=>{renderer.renderObject=renderObject})
 target=new THREE.RenderTarget(8,8,{type:THREE.UnsignedByteType})
 renderer.setRenderTarget(target)
 const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8
 const context=canvas.getContext('2d');context.fillStyle='red';context.fillRect(0,0,8,8)
 const nativeTexture=device.createTexture({size:[8,8],format:'rgba8unorm',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT})
 result.sourceAllocation=textureMeta.get(nativeTexture).id
 device.pushErrorScope('validation')
 device.queue.copyExternalImageToTexture({source:canvas},{texture:nativeTexture,premultipliedAlpha:true},[8,8])
 const copyError=await device.popErrorScope()
 if(copyError)throw Error(copyError.message)
 external=new THREE.ExternalTexture(nativeTexture);external.image={width:8,height:8};external.colorSpace=THREE.NoColorSpace;external.generateMipmaps=false;external.minFilter=THREE.LinearFilter;external.needsUpdate=true
 geometry=new THREE.PlaneGeometry(2,2)
 const material=new THREE.MeshBasicNodeMaterial({map:external,toneMapped:false})
 const watched=new THREE.Mesh(geometry,material);watched.name='watched';watchedObject=watched
 const scene=new THREE.Scene();scene.add(watched)
 const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=3
 await run('ordinary',scene,camera)
 geometry.setDrawRange(0,0)
 await run('empty',scene,camera)
 geometry.setDrawRange(0,6)
 const bad=new THREE.MeshBasicNodeMaterial();bad.fragmentNode=vec4(texture(external).rgb,wgslFn('fn badAlpha() -> f32 { return DOES_NOT_EXIST; }')())
 watched.material=bad
 await run('invalid',scene,camera)
 await new Promise(resolve=>requestAnimationFrame(resolve))
 await run('invalidSettled',scene,camera)
 bad.dispose();watched.material=material
 const unrelated=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicNodeMaterial({color:0x00ff00,toneMapped:false}));unrelated.name='unrelated'
 watched.onBeforeRender=function(){this.onBeforeRender=()=>{};renderer.renderObject(unrelated,scene,camera,unrelated.geometry,unrelated.material,null,activeArgs[6],activeArgs[7])}
 await run('nested',scene,camera)
 geometry.setDrawRange(0,0)
 watched.onBeforeRender=function(){this.onBeforeRender=()=>{};renderer.renderObject(unrelated,scene,camera,unrelated.geometry,unrelated.material,null,activeArgs[6],activeArgs[7])}
 await run('nestedOnly',scene,camera)
 unrelated.geometry.dispose();unrelated.material.dispose();material.dispose()
 // The second renderer has already populated its native caches when observation begins.
 const borrowedAdapter=await navigator.gpu.requestAdapter()
 if(!borrowedAdapter)throw Error('A second native adapter request is required')
 const borrowedDevice=await borrowedAdapter.requestDevice()
 let borrowedRenderer,borrowedTarget,borrowedExternal,borrowedGeometry,borrowedMaterial,borrowedTexture
 const releaseStart=releases.length,priorWatched=watchedObject
 try {
  borrowedRenderer=new THREE.WebGPURenderer({device:borrowedDevice,alpha:true,antialias:false})
  await borrowedRenderer.init()
  if(!borrowedRenderer.backend.isWebGPUBackend)throw Error('Borrowed control fell back')
  borrowedRenderer.setSize(8,8);borrowedRenderer.setClearColor(0x0000ff,1);borrowedRenderer.toneMapping=THREE.NoToneMapping
  borrowedTarget=new THREE.RenderTarget(8,8,{type:THREE.UnsignedByteType})
  borrowedRenderer.setRenderTarget(borrowedTarget)
  borrowedTexture=borrowedDevice.createTexture({size:[8,8],format:'rgba8unorm',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT})
  borrowedDevice.pushErrorScope('validation')
  borrowedDevice.queue.copyExternalImageToTexture({source:canvas},{texture:borrowedTexture,premultipliedAlpha:true},[8,8])
  const error=await borrowedDevice.popErrorScope()
  if(error)throw Error(error.message)
  borrowedExternal=new THREE.ExternalTexture(borrowedTexture);borrowedExternal.image={width:8,height:8};borrowedExternal.colorSpace=THREE.NoColorSpace;borrowedExternal.generateMipmaps=false;borrowedExternal.minFilter=THREE.LinearFilter;borrowedExternal.needsUpdate=true
  borrowedGeometry=new THREE.PlaneGeometry(2,2)
  borrowedMaterial=new THREE.MeshBasicNodeMaterial({map:borrowedExternal,toneMapped:false})
  const borrowedObject=new THREE.Mesh(borrowedGeometry,borrowedMaterial);borrowedObject.name='cached-borrowed'
  const borrowedScene=new THREE.Scene();borrowedScene.add(borrowedObject)
  borrowedDevice.pushErrorScope('validation')
  borrowedRenderer.render(borrowedScene,camera)
  const initialError=await borrowedDevice.popErrorScope()
  const beforePixels=await borrowedRenderer.readRenderTargetPixelsAsync(borrowedTarget,4,4,1,1)
  const beforePixel=Array.from(beforePixels.slice(0,4))
  observer(borrowedDevice)
  // Public source ownership identifies this handle, but cannot recover earlier views/groups.
  const adoptedAllocation=++nextId
  trackTexture(borrowedTexture,{id:adoptedAllocation,descriptor:{size:[8,8],format:'rgba8unorm',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING}})
  const borrowedRenderObject=borrowedRenderer.renderObject
  borrowedRenderer.renderObject=function(...args){const previous=owner,previousArgs=activeArgs;owner=args[0];activeArgs=args;try{return borrowedRenderObject.apply(this,args)}finally{owner=previous;activeArgs=previousArgs}}
  releases.push(()=>{borrowedRenderer.renderObject=borrowedRenderObject})
  watchedObject=borrowedObject;submissions=[]
  borrowedDevice.pushErrorScope('validation')
  borrowedRenderer.render(borrowedScene,camera)
  const afterError=await borrowedDevice.popErrorScope(),copied=JSON.parse(JSON.stringify(submissions))
  const afterPixels=await borrowedRenderer.readRenderTargetPixelsAsync(borrowedTarget,4,4,1,1)
  const draws=copied.flatMap(pass=>pass.draws).filter(draw=>draw.watched)
  result.cases.cachedBorrowed={beforeValidation:initialError?.message??null,beforePixel,validation:afterError?.message??null,pixel:Array.from(afterPixels.slice(0,4)),sourceAllocation:adoptedAllocation,submissions:copied,nonemptyCommands:draws.filter(draw=>draw.count>0&&draw.instances>0).length,knownPipeline:draws.some(draw=>draw.pipeline!==null),knownSourceBinding:draws.some(draw=>draw.bindings.some(binding=>binding.texture===adoptedAllocation)),hasKnownSourceCommand:!afterError&&draws.some(draw=>draw.count>0&&draw.instances>0&&draw.pipeline!==null&&draw.bindings.some(binding=>binding.texture===adoptedAllocation))}
 } finally {
  watchedObject=priorWatched
  borrowedRenderer?.setRenderTarget(null);borrowedTarget?.dispose();borrowedExternal?.dispose();borrowedGeometry?.dispose();borrowedMaterial?.dispose()
  for(const release of releases.splice(releaseStart).reverse())release()
  if(borrowedRenderer?.initialized)await borrowedRenderer.dispose();borrowedTexture?.destroy();borrowedDevice.destroy()
 }
 await observeEarlyDispose()
 result.completed=true
}catch(error){result.failure=String(error);result.stack=error.stack}
finally{
 result.prototypeChanges=methods.some((name,index)=>globalThis.GPUDevice?.prototype[name]!==prototypes[index])||globalThis.GPUQueue?.prototype.submit!==queuePrototype
 renderer?.setRenderTarget(null);target?.dispose();external?.dispose();geometry?.dispose()
 for(const release of releases.reverse())release()
 if(renderer?.initialized)await renderer.dispose();device?.destroy()
 window.__nativeObservationS0=result
 document.querySelector('#result').textContent=JSON.stringify(result,null,2)
}
