// Compare contrast with the same native content, not a standalone "sharp-looking" image.
export async function textureClarity(page,before,after) {
 return page.evaluate(async({before,after})=>{
  const decode=async data=>{const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(data),ch=>ch.charCodeAt(0))],{type:'image/png'}));const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();return {width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data}}
  const a=await decode(before),b=await decode(after)
  if(a.width!==b.width||a.height!==b.height)throw new Error('The native and mesh comparison must use the same crop')
  let error=0,ea=0,eb=0
  for(let y=1;y<a.height;y++)for(let x=1;x<a.width;x++){
   const i=(y*a.width+x)*4,left=i-4,up=i-a.width*4
   for(let c=0;c<3;c++){error+=Math.abs(a.data[i+c]-b.data[i+c]);ea+=(a.data[i+c]-a.data[left+c])**2+(a.data[i+c]-a.data[up+c])**2;eb+=(b.data[i+c]-b.data[left+c])**2+(b.data[i+c]-b.data[up+c])**2}
  }
  if(ea===0)throw new Error('The reference crop has no contrast to measure')
  return {meanError:error/(a.width*a.height*3),edgeEnergyRatio:eb/ea,dimensions:[a.width,a.height]}
 },{before,after})
}
