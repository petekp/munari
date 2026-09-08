// Read lamp frames and apply optical controls to the served copy only.
import assert from 'node:assert/strict'
import {replaceSource} from '../home-light/replaceSource.mjs'

export const lampObserver={name:'lamp-observer',enforce:'pre',transform(code,id){
  if(id.endsWith('/homeLightBulb.ts')){
    const marker='  return {\n    group,'
    assert.ok(code.includes(marker),'Lamp observation point changed')
    code=replaceSource(code,marker,'  window.__lamp={group,body,cord,uniforms};\n'+marker)
    code=replaceSource(code,'      group.visible=true;','      if(window.__freezeLamp)return;\n      group.visible=true;')
  }
  if(id.endsWith('/HomeMasthead.tsx')){
    const marker='state.bulb.renderer.render(state.bulb.scene, state.bulb.camera)'
    assert.ok(code.includes(marker),'Lamp draw observation point changed')
    code=replaceSource(code,marker,'window.__lampGpuStart?.();\n          '+marker+';\n          window.__lampGpuEnd?.();\n          window.__lampRendered?.(state.bulb.renderer.domElement)')
    code=replaceSource(code,'    pass.bulb = bulb','    window.__lampRenderer=renderer;\n    window.__lampRedraw=()=>state.draw();\n    pass.bulb = bulb')
  }
  if(id.endsWith('/homeLampBackdrop.ts'))code=replaceSource(code,'  return {\n    uniforms,','  window.__lampPaintCount=()=>source?.paintCount()??0;\n  return {\n    uniforms,')
  return code
}}
