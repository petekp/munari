// Lamp backdrop — native viewport paint plus the canvases already drawn behind it.
// Glass must bend actual text and images. The mirror never owns native input;
// live canvases are sampled after their frame, and the lamp excludes itself (#52).
import * as THREE from 'three'
import {createDomTextureSource,detectHtmlInCanvas,type DomTextureSource} from '@petepetrash/munari/advanced'
import {readHomeFlyer,type HomeFlyer} from './homeFlyer'
import {lampPixelRatio,watchLampViewport} from './homeLampViewport'
import {LAMP_CANVAS_LAYERS} from './homeLampGlassShaders'

const OMIT='.home-light-host,.home-light-scene,.home-light,[data-lamp-capture],script,style,link,meta'
const EVENTS=['input','change','focusin','focusout','pointerover','pointerout','pointerdown','pointerup','load','transitionend']

function copyViewport(page:HTMLElement,width:number,height:number){
  // SAFETY: cloning an HTMLElement preserves its concrete element kind.
  const clone=page.cloneNode(true) as HTMLElement
  const originals=[page,...page.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')]
  originals.forEach((original,index)=>{
    const copy=copies[index]!
    copy.removeAttribute('id');copy.removeAttribute('autofocus');copy.removeAttribute('form');copy.removeAttribute('name')
    // An inert picture must not identify itself as another live Surface.
    copy.removeAttribute('data-api-live')
    copy.toggleAttribute('data-hover',original.matches(':hover')||original.hasAttribute('data-hover'))
    copy.toggleAttribute('data-active',original.matches(':active')||original.hasAttribute('data-active'))
    copy.toggleAttribute('data-focus-visible',original.matches(':focus-visible'))
    for(const name of copy.getAttributeNames())if(name.startsWith('on'))copy.removeAttribute(name)
    if(original instanceof HTMLInputElement&&copy instanceof HTMLInputElement){copy.value=original.value;copy.checked=original.checked;copy.name=''}
    if(original instanceof HTMLTextAreaElement&&copy instanceof HTMLTextAreaElement)copy.value=original.value
    if(original instanceof HTMLSelectElement&&copy instanceof HTMLSelectElement)copy.selectedIndex=original.selectedIndex
    if(original instanceof HTMLImageElement&&copy instanceof HTMLImageElement){copy.loading='eager';copy.src=original.currentSrc||original.src}
    if(original instanceof HTMLCanvasElement||original instanceof HTMLVideoElement){
      const blank=document.createElement('div'),css=getComputedStyle(original)
      blank.style.cssText=`display:${css.display};position:${css.position};width:${css.width};height:${css.height};inset:${css.top} ${css.right} ${css.bottom} ${css.left};`
      copy.replaceWith(blank)
    }
  })
  for(const node of clone.querySelectorAll(OMIT))node.remove()
  clone.style.cssText=`position:relative;inset:auto;width:${width}px;height:${height}px;overflow:hidden;margin:0;pointer-events:none;`
  const inner=clone.querySelector<HTMLElement>('.home-inner')
  const original=page.querySelector<HTMLElement>('.home-inner')
  if(inner&&original){
    const r=original.getBoundingClientRect(),base=page.getBoundingClientRect()
    inner.style.position='absolute';inner.style.left=`${r.left-base.left}px`;inner.style.top=`${r.top-base.top}px`
    inner.style.margin='0';inner.style.width=`${original.offsetWidth}px`;inner.style.maxWidth='none';inner.style.boxSizing='border-box'
  }
  return clone
}

export function createLampBackdrop(page:HTMLElement,wake:()=>void){
  const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true
  const empty=new THREE.DataTexture(new Uint8Array(4),1,1);empty.needsUpdate=true
  const uniforms={
    uPage:new THREE.Uniform<THREE.Texture>(empty),uPageReady:new THREE.Uniform(0),
    uViewport:new THREE.Uniform(new THREE.Vector2(1,1)),
    uPageLight:new THREE.Uniform<THREE.Texture>(white),uPageLightRect:new THREE.Uniform(new THREE.Vector4()),
    uLayers:new THREE.Uniform<THREE.Texture[]>(Array.from({length:LAMP_CANVAS_LAYERS},()=>empty)),
    uLayerRects:new THREE.Uniform(Array.from({length:LAMP_CANVAS_LAYERS},()=>new THREE.Vector4())),uLayerCount:new THREE.Uniform(0),
  }
  const wrapper=document.createElement('div');wrapper.dataset.lampCapture='';wrapper.inert=true;wrapper.setAttribute('aria-hidden','true')
  wrapper.style.cssText='position:relative;display:block;visibility:visible;margin:0;padding:0;border:0;overflow:hidden;'
  let source:DomTextureSource|null=null,texture:THREE.CanvasTexture|null=null,lightTexture:THREE.CanvasTexture|null=null
  let alive=true,mirrorFrame=0,paintFrame=0,paintedWidth=0,paintedHeight=0,allocation='',stopPaint=()=>{}
  const layers=new Map<HTMLCanvasElement,THREE.CanvasTexture>()
  const allocations=new WeakMap<THREE.Texture,string>()
  let sampledFlyer:HomeFlyer|null=null
  const upload=(texture:THREE.CanvasTexture,canvas:HTMLCanvasElement)=>{
    const size=`${canvas.width}:${canvas.height}`
    if(allocations.get(texture)!==size){texture.dispose();allocations.set(texture,size)}
    texture.needsUpdate=true
  }
  const supported=detectHtmlInCanvas().drawElementImage
  const schedule=()=>{if(alive&&supported&&!mirrorFrame)mirrorFrame=requestAnimationFrame(mirror)}
  const mirror=()=>{
    mirrorFrame=0;if(!alive)return
    const width=Math.max(1,page.clientWidth),height=Math.max(1,page.clientHeight)
    wrapper.style.width=`${width}px`;wrapper.style.height=`${height}px`
    wrapper.replaceChildren(copyViewport(page,width,height))
    if(!source){
      source=createDomTextureSource(wrapper,width,height,{label:'home-lamp-backdrop',scale:lampPixelRatio(),onError:()=>{uniforms.uPageReady.value=0}})
      source.canvas.style.visibility='hidden'
      texture=new THREE.CanvasTexture(source.canvas);texture.colorSpace=THREE.NoColorSpace;texture.premultiplyAlpha=true
      texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter
      uniforms.uPage.value=texture
      stopPaint=source.subscribePaint(receipt=>{
        cancelAnimationFrame(paintFrame)
        // Chrome completes the paint after onpaint; upload on the next frame.
        paintFrame=requestAnimationFrame(()=>{
          paintFrame=0;if(!alive||!source||!texture)return
          const key=`${source.canvas.width}:${source.canvas.height}`
          if(key!==allocation){texture.dispose();allocation=key}
          texture.needsUpdate=true
          ;[paintedWidth,paintedHeight]=receipt.paintedSize
          uniforms.uPageReady.value=paintedWidth===page.clientWidth&&paintedHeight===page.clientHeight?1:0
          wake()
        })
      })
    }else{source.setSize(width,height);source.setScale(lampPixelRatio())}
    source.repaint()
  }
  const relevant=(target:EventTarget|null)=>target instanceof Element&&!target.closest(OMIT)&&!target.closest('canvas,.home-canvas')
  const mutations=new MutationObserver(records=>{if(records.some(r=>relevant(r.target instanceof Element?r.target:r.target.parentElement)))schedule()})
  const resize=new ResizeObserver(schedule)
  const event=(e:Event)=>{if(relevant(e.target))schedule()}
  let captureRatio=lampPixelRatio()
  const stopViewport=supported?watchLampViewport(()=>{
    const ratio=lampPixelRatio()
    if(ratio!==captureRatio){captureRatio=ratio;schedule()}
  }):()=>{}
  if(supported){
    mutations.observe(page,{subtree:true,childList:true,attributes:true,characterData:true});resize.observe(page)
    const inner=page.querySelector('.home-inner');if(inner)resize.observe(inner)
    for(const name of EVENTS)page.addEventListener(name,event,true)
    page.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule)
    void document.fonts.ready.then(()=>{if(alive)schedule()});schedule()
  }
  return {
    uniforms,
    update(light:HTMLCanvasElement|null){
      const width=page.clientWidth,height=page.clientHeight;uniforms.uViewport.value.set(width,height)
      if(paintedWidth!==width||paintedHeight!==height)uniforms.uPageReady.value=0
      if(uniforms.uPageReady.value<.5)return
      if(light){
        if(lightTexture?.image!==light){lightTexture?.dispose();lightTexture=new THREE.CanvasTexture(light);lightTexture.colorSpace=THREE.NoColorSpace;lightTexture.generateMipmaps=false;lightTexture.minFilter=THREE.LinearFilter;uniforms.uPageLight.value=lightTexture}
        upload(lightTexture,light)
        const r=light.getBoundingClientRect();uniforms.uPageLightRect.value.set(r.left,height-r.bottom,r.width,r.height)
      }
      const visible=[...page.querySelectorAll('canvas')].filter(canvas=>{
        if(canvas.closest(OMIT))return false
        if(canvas.closest('.home-canvas')&&readHomeFlyer()?.kind!=='scene')return false
        const r=canvas.getBoundingClientRect();if(!r.width||!r.height||r.bottom<0||r.top>height)return false
        for(let node:HTMLElement|null=canvas;node&&node!==page;node=node.parentElement){const css=getComputedStyle(node);if(css.visibility==='hidden'||css.display==='none'||css.opacity==='0')return false}
        return true
      }).slice(-LAMP_CANVAS_LAYERS)
      uniforms.uLayerCount.value=visible.length
      uniforms.uLayers.value.fill(empty)
      visible.forEach((canvas,index)=>{
        let layer=layers.get(canvas)
        if(!layer){layer=new THREE.CanvasTexture(canvas);layer.colorSpace=THREE.NoColorSpace;layer.premultiplyAlpha=true;layer.generateMipmaps=false;layer.minFilter=THREE.LinearFilter;layers.set(canvas,layer)}
        // A demand-rendered postcard can hold still while the lamp moves.
        // Keep its last completed draw; WebGL may have cleared the source buffer.
        if(!canvas.closest('.home-canvas')||sampledFlyer!==readHomeFlyer()){
          upload(layer,canvas)
          if(canvas.closest('.home-canvas'))sampledFlyer=readHomeFlyer()
        }
        uniforms.uLayers.value[index]=layer
        const r=canvas.getBoundingClientRect();uniforms.uLayerRects.value[index]!.set(r.left,height-r.bottom,r.width,r.height)
      })
      for(const [canvas,layer]of layers)if(!canvas.isConnected){layer.dispose();layers.delete(canvas)}
    },
    dispose(){
      alive=false;cancelAnimationFrame(mirrorFrame);cancelAnimationFrame(paintFrame);mutations.disconnect();resize.disconnect();stopPaint();stopViewport()
      for(const name of EVENTS)page.removeEventListener(name,event,true)
      page.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule)
      source?.dispose();texture?.dispose();lightTexture?.dispose();for(const texture of layers.values())texture.dispose();layers.clear();white.dispose();empty.dispose()
    },
  }
}

export type LampBackdrop=ReturnType<typeof createLampBackdrop>
