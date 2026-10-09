// Headline treatments — native text anchors beveled geometry and shader colour.
// One renderer follows the masthead's frame; the DOM retains layout and selection.
// Crop to the visible viewport before allocating zoomed pixels (decision #54).
import * as THREE from 'three'
import {DirectRenderPipeline,MeshStandardNodeMaterial,WebGPURenderer} from 'three/webgpu'
import {output,toneMapping} from 'three/tsl'
import {FontLoader} from 'three/addons/loaders/FontLoader.js'
import {HEADLINE_GLYPHS} from './homeHeadlineGlyphs'
import {createHeadlineMaterial,createHeadlineValues} from './homeHeadlineNodes'
import {lampPixelRatio,readEnclosingViewport} from './homeLampViewport'
import {GLYPH_STANDOFF} from './homeLightLaw'
import type {HomeLightMaterial} from './homeLight'

// Room for the bevel and tilted side faces at the largest heading size (#56).
const PADDING=24

function visibleHeading(heading:HTMLElement,solid:HTMLElement,shaded:HTMLElement,page:HTMLElement){
  const box=heading.getBoundingClientRect(),{viewport,left,top}=readEnclosingViewport()
  const solidBox=solid.getBoundingClientRect(),word=shaded.getBoundingClientRect(),bounds=page.getBoundingClientRect()
  const x=Math.max(Math.min(solidBox.left,word.left)-PADDING,(viewport?.offsetLeft??0)-left,bounds.left)
  const y=Math.max(Math.min(solidBox.top,word.top)-PADDING,(viewport?.offsetTop??0)-top,bounds.top)
  const right=Math.min(Math.max(solidBox.right,word.right)+PADDING,(viewport?.offsetLeft??0)+(viewport?.width??innerWidth)-left,bounds.right)
  const bottom=Math.min(Math.max(solidBox.bottom,word.bottom)+PADDING,(viewport?.offsetTop??0)+(viewport?.height??innerHeight)-top,bounds.bottom)
  return {box,solidBox,word,x,y,right,bottom}
}

export function createHeadlineTreatments(heading:HTMLElement,lighting:HomeLightMaterial,wake:()=>void,page:HTMLElement,onLost:()=>void){
  const solid=heading.querySelector<HTMLElement>('.home-headline-3d')
  const shaded=heading.querySelector<HTMLElement>('.home-headline-shaders')
  if(!solid||!shaded)return null
  const inkCanvas=document.createElement('canvas'),context=inkCanvas.getContext('2d')
  if(!context)return null
  const canvas=document.createElement('canvas')
  canvas.className='home-headline-canvas';canvas.setAttribute('aria-hidden','true')
  let renderer:WebGPURenderer
  try{renderer=new WebGPURenderer({canvas,antialias:true,alpha:true})}catch{return null}
  // Renderer tone mapping stays off: the pipeline would apply it to every
  // material, so only the letters apply ACES themselves (decisions.md #69).
  renderer.setClearColor(0,0)
  renderer.outputColorSpace=THREE.SRGBColorSpace
  // Converts each fragment as it lands on the canvas, as WebGL did (decisions.md #72).
  const pipeline=new DirectRenderPipeline(renderer)
  heading.append(canvas)
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(0,1,1,0,1,2000)
  camera.position.z=1000
  const font=new FontLoader().parse(HEADLINE_GLYPHS)
  const geometry=new THREE.ExtrudeGeometry(font.generateShapes('3D',100),{
    depth:24,bevelEnabled:true,bevelThickness:1.2,bevelSize:1.2,bevelSegments:3,curveSegments:12,steps:1,
  })
  geometry.computeBoundingBox()
  const bounds=geometry.boundingBox!,size=bounds.getSize(new THREE.Vector3())
  geometry.translate(-(bounds.min.x+bounds.max.x)/2,-(bounds.min.y+bounds.max.y)/2,-bounds.max.z)
  const face=new MeshStandardNodeMaterial({color:0x252720,roughness:.32,metalness:.28})
  const side=new MeshStandardNodeMaterial({color:0x777b69,roughness:.28,metalness:.45})
  // ACESFilmic at exposure 1, the tone mapping the letters are tuned under (decisions.md #69).
  face.outputNode=toneMapping(THREE.ACESFilmicToneMapping,1,output)
  side.outputNode=toneMapping(THREE.ACESFilmicToneMapping,1,output)
  const letters=new THREE.Mesh(geometry,[face,side]);scene.add(letters)
  const lamp=new THREE.PointLight(0xfff5dd,120000,0,2)
  scene.add(lamp,new THREE.HemisphereLight(0xfff9e8,0x303b42,1.1))

  const ink=new THREE.CanvasTexture(inkCanvas)
  ink.generateMipmaps=false;ink.minFilter=THREE.LinearFilter;ink.magFilter=THREE.LinearFilter
  const values=createHeadlineValues()
  const material=createHeadlineMaterial(ink,values)
  const plane=new THREE.PlaneGeometry(1,1),shaderWord=new THREE.Mesh(plane,material);scene.add(shaderWord)
  let alive=true,started=false,failed=false,lost=false,fontsReady=false,inkKey='',viewKey='',previous=0,tiltX=0,tiltY=0
  const pointer={x:0,y:0}
  let rippleAt=-1000000
  const move=(event:PointerEvent)=>{
    const box=solid.getBoundingClientRect()
    pointer.x=THREE.MathUtils.clamp((event.clientX-box.x)/box.width*2-1,-1,1)
    pointer.y=THREE.MathUtils.clamp((event.clientY-box.y)/box.height*2-1,-1,1)
    wake()
  }
  const leave=()=>{pointer.x=pointer.y=0;wake()}
  const ripple=(event:PointerEvent)=>{
    const box=shaded.getBoundingClientRect()
    values.pointer.value.set((event.clientX-box.x)/box.width,1-(event.clientY-box.y)/box.height)
    if(performance.now()-rippleAt>160)rippleAt=performance.now()
    wake()
  }
  solid.addEventListener('pointermove',move);solid.addEventListener('pointerleave',leave)
  shaded.addEventListener('pointermove',ripple);shaded.addEventListener('pointerdown',ripple)
  void document.fonts.ready.then(()=>{if(alive){fontsReady=true;wake()}})
  // A lost device or context never draws again on either backend; the
  // masthead replaces this renderer along with its own.
  const report=renderer.onDeviceLost
  renderer.onDeviceLost=info=>{report.call(renderer,info);if(!alive)return;lost=true;delete heading.dataset.headlineReady;onLost()}
  // render() throws until init resolves. A failed start leaves the native
  // headline, as a renderer that could not be created did.
  const init=renderer.init()
  void init.then(()=>{if(alive){started=true;wake()}},()=>{if(alive){failed=true;canvas.remove();wake()}})

  return {
    render(reduced:boolean){
      if(failed)return true
      if(!fontsReady||!started||lost)return false
      const {box,solidBox,word,...visible}=visibleHeading(heading,solid,shaded,page),ratio=lampPixelRatio()
      const x=Math.floor(visible.x*ratio)/ratio,y=Math.floor(visible.y*ratio)/ratio
      const right=Math.ceil(visible.right*ratio)/ratio,bottom=Math.ceil(visible.bottom*ratio)/ratio
      // Out of view, the canvas keeps the box of its last layout. Hidden, that
      // box cannot widen the page after a resize (390 px page measured 514).
      if(right<=x||bottom<=y){canvas.style.display='none';viewKey='';return true}
      const key=`${x},${y},${right},${bottom},${box.x},${box.y},${ratio}`
      if(key!==viewKey){
        viewKey=key;canvas.style.display='';renderer.setPixelRatio(ratio);renderer.setSize(right-x,bottom-y,false)
        Object.assign(canvas.style,{left:`${x-box.x}px`,top:`${y-box.y}px`,width:`${right-x}px`,height:`${bottom-y}px`})
        camera.left=x;camera.right=right;camera.top=-y;camera.bottom=-bottom;camera.updateProjectionMatrix()
      }
      const style=getComputedStyle(solid)
      const elevation=GLYPH_STANDOFF*lighting.values.glyphScale.value
      letters.scale.setScalar(Math.min(parseFloat(style.fontSize)/100,solidBox.width/size.x))
      letters.position.set(solidBox.x+solidBox.width/2,-solidBox.y-solidBox.height/2,elevation)
      const now=performance.now(),dt=Math.min(.05,(now-previous)/1000);previous=now
      tiltX=THREE.MathUtils.damp(tiltX,reduced?0:pointer.y*.12,10,dt)
      tiltY=THREE.MathUtils.damp(tiltY,reduced?0:pointer.x*.18,10,dt)
      letters.rotation.set(-.08+tiltX,-.35+tiltY,-.025)
      const light=lighting.values
      lamp.position.set(light.light.value.x+light.frameOrigin.value.x,-light.light.value.y-light.frameOrigin.value.y,light.lightHeight.value)
      values.light.value.copy(lamp.position);values.time.value=reduced?0:now*.00018
      values.rippleAge.value=reduced?1000:(now-rippleAt)/1000

      const css=getComputedStyle(shaded),pad=6
      const inkLeft=Math.floor((word.x-pad)*ratio)/ratio,inkTop=Math.floor((word.y-pad)*ratio)/ratio
      const inkWidth=Math.ceil((word.right+pad)*ratio)/ratio-inkLeft,inkHeight=Math.ceil((word.bottom+pad)*ratio)/ratio-inkTop
      const fontCss=`${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`
      const nextInk=`${inkWidth},${inkHeight},${word.x-inkLeft},${word.y-inkTop},${ratio},${fontCss},${css.letterSpacing}`
      if(nextInk!==inkKey){
        inkKey=nextInk
        inkCanvas.width=Math.round(inkWidth*ratio);inkCanvas.height=Math.round(inkHeight*ratio)
        context.scale(ratio,ratio);context.font=fontCss;context.letterSpacing=css.letterSpacing
        context.fillStyle='#fff';context.textBaseline='alphabetic'
        const metrics=context.measureText(shaded.textContent??'')
        const baseline=(word.height+metrics.fontBoundingBoxAscent-metrics.fontBoundingBoxDescent)/2
        context.fillText(shaded.textContent??'',word.x-inkLeft,word.y-inkTop+baseline)
        ink.dispose();ink.needsUpdate=true
      }
      shaderWord.position.set(inkLeft+inkWidth/2,-inkTop-inkHeight/2,elevation)
      shaderWord.scale.set(inkWidth,inkHeight,1)
      values.aspect.value=word.width/word.height
      pipeline.render(scene,camera)
      if(!heading.dataset.headlineReady)heading.dataset.headlineReady='true'
      return true
    },
    dispose(){
      alive=false;delete heading.dataset.headlineReady
      solid.removeEventListener('pointermove',move);solid.removeEventListener('pointerleave',leave)
      shaded.removeEventListener('pointermove',ripple);shaded.removeEventListener('pointerdown',ripple)
      renderer.onDeviceLost=report
      geometry.dispose();face.dispose();side.dispose();plane.dispose();material.dispose();ink.dispose();pipeline.dispose()
      // dispose() skips the backend while init is pending, so wait for it. After
      // a failed init, dispose() re-awaits the rejected init without handling it,
      // so a renderer that never started is left alone.
      void init.then(()=>{void renderer.dispose()},()=>{});canvas.remove()
    },
  }
}
