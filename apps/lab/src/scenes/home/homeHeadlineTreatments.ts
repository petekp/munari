// Headline treatments — native text anchors beveled geometry and shader colour.
// One renderer follows the masthead's frame; the DOM retains layout and selection.
// Crop to the visible viewport before allocating zoomed pixels (decision #54).
import * as THREE from 'three'
import {FontLoader} from 'three/addons/loaders/FontLoader.js'
import {HEADLINE_GLYPHS} from './homeHeadlineGlyphs'
import {HEADLINE_VERTEX,HEADLINE_FRAGMENT} from './homeHeadlineShaders'
import {lampPixelRatio,readEnclosingViewport} from './homeLampViewport'
import {GLYPH_STANDOFF} from './homeLightLaw'
import type {HomeLightMaterial} from './homeLight'

// Room for the bevel and tilted side faces at the largest heading size (#56).
const PADDING=24

function visibleHeading(heading:HTMLElement,solid:HTMLElement,shaded:HTMLElement){
  const box=heading.getBoundingClientRect(),{viewport,left,top}=readEnclosingViewport()
  const solidBox=solid.getBoundingClientRect(),word=shaded.getBoundingClientRect()
  const x=Math.max(Math.min(solidBox.left,word.left)-PADDING,(viewport?.offsetLeft??0)-left)
  const y=Math.max(Math.min(solidBox.top,word.top)-PADDING,(viewport?.offsetTop??0)-top)
  const right=Math.min(Math.max(solidBox.right,word.right)+PADDING,(viewport?.offsetLeft??0)+(viewport?.width??innerWidth)-left)
  const bottom=Math.min(Math.max(solidBox.bottom,word.bottom)+PADDING,(viewport?.offsetTop??0)+(viewport?.height??innerHeight)-top)
  return {box,solidBox,word,x,y,right,bottom}
}

export function createHeadlineTreatments(heading:HTMLElement,lighting:HomeLightMaterial,wake:()=>void){
  const solid=heading.querySelector<HTMLElement>('.home-headline-3d')
  const shaded=heading.querySelector<HTMLElement>('.home-headline-shaders')
  if(!solid||!shaded)return null
  const inkCanvas=document.createElement('canvas'),context=inkCanvas.getContext('2d')
  if(!context)return null
  const canvas=document.createElement('canvas')
  canvas.className='home-headline-canvas';canvas.setAttribute('aria-hidden','true')
  let renderer:THREE.WebGLRenderer
  try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true})}catch{return null}
  renderer.setClearColor(0,0);renderer.toneMapping=THREE.ACESFilmicToneMapping
  renderer.outputColorSpace=THREE.SRGBColorSpace
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
  const face=new THREE.MeshStandardMaterial({color:0x252720,roughness:.32,metalness:.28})
  const side=new THREE.MeshStandardMaterial({color:0x777b69,roughness:.28,metalness:.45})
  const letters=new THREE.Mesh(geometry,[face,side]);scene.add(letters)
  const lamp=new THREE.PointLight(0xfff5dd,120000,0,2)
  scene.add(lamp,new THREE.HemisphereLight(0xfff9e8,0x303b42,1.1))

  const ink=new THREE.CanvasTexture(inkCanvas)
  ink.generateMipmaps=false;ink.minFilter=THREE.LinearFilter;ink.magFilter=THREE.LinearFilter
  const uniforms={uInk:new THREE.Uniform(ink),uLight:new THREE.Uniform(new THREE.Vector3()),uTime:new THREE.Uniform(0),uAspect:new THREE.Uniform(1),uPointer:new THREE.Uniform(new THREE.Vector2(.5,.5)),uRippleAge:new THREE.Uniform(1000)}
  const material=new THREE.ShaderMaterial({vertexShader:HEADLINE_VERTEX,fragmentShader:HEADLINE_FRAGMENT,uniforms,transparent:true,premultipliedAlpha:true,depthWrite:false,toneMapped:false})
  const plane=new THREE.PlaneGeometry(1,1),shaderWord=new THREE.Mesh(plane,material);scene.add(shaderWord)
  let alive=true,fontsReady=false,inkKey='',viewKey='',previous=0,tiltX=0,tiltY=0
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
    uniforms.uPointer.value.set((event.clientX-box.x)/box.width,1-(event.clientY-box.y)/box.height)
    if(performance.now()-rippleAt>160)rippleAt=performance.now()
    wake()
  }
  solid.addEventListener('pointermove',move);solid.addEventListener('pointerleave',leave)
  shaded.addEventListener('pointermove',ripple);shaded.addEventListener('pointerdown',ripple)
  void document.fonts.ready.then(()=>{if(alive){fontsReady=true;wake()}})
  const lost=(event:Event)=>{event.preventDefault();delete heading.dataset.headlineReady}
  const restored=()=>{viewKey=inkKey='';wake()}
  canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored)

  return {
    render(reduced:boolean){
      if(!fontsReady||renderer.getContext().isContextLost())return false
      const {box,solidBox,word,...visible}=visibleHeading(heading,solid,shaded),ratio=lampPixelRatio()
      const x=Math.floor(visible.x*ratio)/ratio,y=Math.floor(visible.y*ratio)/ratio
      const right=Math.ceil(visible.right*ratio)/ratio,bottom=Math.ceil(visible.bottom*ratio)/ratio
      if(right<=x||bottom<=y)return true
      const key=`${x},${y},${right},${bottom},${box.x},${box.y},${ratio}`
      if(key!==viewKey){
        viewKey=key;renderer.setPixelRatio(ratio);renderer.setSize(right-x,bottom-y,false)
        Object.assign(canvas.style,{left:`${x-box.x}px`,top:`${y-box.y}px`,width:`${right-x}px`,height:`${bottom-y}px`})
        camera.left=x;camera.right=right;camera.top=-y;camera.bottom=-bottom;camera.updateProjectionMatrix()
      }
      const style=getComputedStyle(solid)
      const elevation=GLYPH_STANDOFF*lighting.uniforms.uGlyphScale.value
      letters.scale.setScalar(Math.min(parseFloat(style.fontSize)/100,solidBox.width/size.x))
      letters.position.set(solidBox.x+solidBox.width/2,-solidBox.y-solidBox.height/2,elevation)
      const now=performance.now(),dt=Math.min(.05,(now-previous)/1000);previous=now
      tiltX=THREE.MathUtils.damp(tiltX,reduced?0:pointer.y*.12,10,dt)
      tiltY=THREE.MathUtils.damp(tiltY,reduced?0:pointer.x*.18,10,dt)
      letters.rotation.set(-.08+tiltX,-.35+tiltY,-.025)
      const light=lighting.uniforms
      lamp.position.set(light.uLight.value.x+light.uFrameOrigin.value.x,-light.uLight.value.y-light.uFrameOrigin.value.y,light.uLightHeight.value)
      uniforms.uLight.value.copy(lamp.position);uniforms.uTime.value=reduced?0:now*.00018
      uniforms.uRippleAge.value=reduced?1000:(now-rippleAt)/1000

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
      uniforms.uAspect.value=word.width/word.height
      renderer.render(scene,camera)
      if(!heading.dataset.headlineReady)heading.dataset.headlineReady='true'
      return true
    },
    dispose(){
      alive=false;delete heading.dataset.headlineReady
      solid.removeEventListener('pointermove',move);solid.removeEventListener('pointerleave',leave)
      shaded.removeEventListener('pointermove',ripple);shaded.removeEventListener('pointerdown',ripple)
      canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored)
      geometry.dispose();face.dispose();side.dispose();plane.dispose();material.dispose();ink.dispose()
      renderer.dispose();renderer.forceContextLoss();canvas.remove()
    },
  }
}
