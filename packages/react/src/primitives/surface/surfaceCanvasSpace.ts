// The capture canvas's CSS coordinate space, measured without restyling the live canvas.
const spaces = new WeakMap<HTMLCanvasElement,HTMLElement>()
export function registerCanvasSpace(canvas:HTMLCanvasElement,marker:HTMLElement) {
  spaces.set(canvas,marker)
  return()=>{if(spaces.get(canvas)===marker)spaces.delete(canvas)}
}
export function canvasSpace(canvas:HTMLCanvasElement|null) {
  const marker=canvas?spaces.get(canvas):null
  if(!marker)return {left:0,top:0,scaleX:1,scaleY:1}
  const rect=marker.getBoundingClientRect()
  if(rect.width<=0||rect.height<=0)return null
  return {left:rect.left,top:rect.top,scaleX:rect.width/100,scaleY:rect.height/100}
}
