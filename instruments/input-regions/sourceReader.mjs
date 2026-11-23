// Source canvas reader — the input-regions probe reads the source only through a fresh copy with the same storage.
// Since Chrome 156, a GPU 2D canvas that has been read once with getImageData returns translucent pixels drawn into
// it later one level off, although its stored pixels are unchanged. Measured 2026-11-23 on Chrome 156 and 157: 12
// corner pixels at alpha 204 in background-content-change; a fresh copy of the same canvas read 0 changed pixels.
// The copy holds the stored pixels, which is what a texture upload receives. Installed into the page by run.mjs.
export function installSourceReader(){
  window.regionProofSourceCopy=canvas=>{const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d',{willReadFrequently:canvas.getContext('2d').getContextAttributes().willReadFrequently}).drawImage(canvas,0,0);return copy}
  window.regionProofSourcePixels=canvas=>{const copy=window.regionProofSourceCopy(canvas);return copy.getContext('2d').getImageData(0,0,copy.width,copy.height).data}
}
