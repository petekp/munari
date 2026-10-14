// Raster flush diagnostic — an extra CPU readback before source composition.
// It moves queued paint work; it does not remove it. The 2026-10-14 Controls
// probe moved 154.7 ms into readback while preserving all four screenshots
// (docs/performance-diagnosis.md). This plugin owns only the served experiment.
import assert from 'node:assert/strict'
import path from 'node:path'

export function fullCacheFlushDiagnostic(root) {
  return {
    name:'munari-full-cache-flush-diagnostic',
    enforce:'pre',
    transform(source,id) {
      if (new URLSearchParams(id.split('?')[1]??'').has('raw')) return null
      const file=path.relative(root,id.split('?')[0]).replaceAll(path.sep,'/')
      if(file!=='packages/react/src/snapdomInputRegions.ts')return null
      const marker="window.__munariPerf.record('captureStage',{...window.__munariPerf.identityFor(root),stage:'fullCacheDrawSync',ms:performance.now()-started}) }"
      const at=source.indexOf(marker)
      assert.ok(at>=0,'Full-cache flush diagnostic requires the existing fullCacheDrawSync observation')
      assert.equal(source.indexOf(marker,at+marker.length),-1,'Full-cache flush observation must be unique')
      return source.replace(marker,marker+`
      if (context.getContextAttributes().willReadFrequently === true) {
        const diagnosticFlushStarted=performance.now()
        const diagnosticPixels=context.getImageData(0,0,canvas.width,canvas.height)
        const diagnosticFlushMs=performance.now()-diagnosticFlushStarted
        window.__munariPerf.record('captureStage',{...window.__munariPerf.identityFor(root),stage:'diagnosticFlushReadbackSync',ms:diagnosticFlushMs,bytes:diagnosticPixels.data.byteLength,width:canvas.width,height:canvas.height})
      }`)
    },
  }
}
