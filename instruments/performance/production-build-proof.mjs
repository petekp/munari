// Production build proof — React runtime and asset identity for timed bundles.
// A production label must agree with the React runtime emitted in the bundle.
// The probe owns measurement evidence; the lab config owns compilation.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export function productionBuildProof(evidence) {
  const reactRuntime = /\/node_modules\/(?:react|react-dom|react-reconciler|scheduler)\/cjs\/[^/]+\.(?:production|development)(?:\.min)?\.js$/
  const rendered = new Set()
  return {
    name: 'munari-production-build-proof',
    configResolved(config) {
      evidence.mode = config.mode
      evidence.isProduction = config.isProduction
      evidence.nodeEnv = process.env.NODE_ENV
      evidence.configFile = config.configFile
      evidence.configLoader = 'native'
      evidence.cacheDir = config.cacheDir
      evidence.outDir = config.build.outDir
      evidence.minify = config.build.minify
      evidence.sourcemap = config.build.sourcemap
      assert.equal(config.mode, 'production')
      assert.equal(config.isProduction, true)
      assert.equal(process.env.NODE_ENV, 'production')
    },
    generateBundle(_options, bundle) {
      evidence.javascript = []
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        evidence.javascript.push({fileName:chunk.fileName,bytes:Buffer.byteLength(chunk.code),sha256:createHash('sha256').update(chunk.code).digest('hex')})
        for (const [id, info] of Object.entries(chunk.modules)) {
          if (reactRuntime.test(id) && info.renderedLength > 0) rendered.add(id)
        }
      }
      evidence.reactRuntimeModules = [...rendered].sort()
      assert.ok(evidence.reactRuntimeModules.some(id => id.includes('/react/cjs/react.production.')), 'Production React runtime must be rendered')
      assert.ok(evidence.reactRuntimeModules.some(id => id.includes('/react-dom/cjs/react-dom-client.production.')), 'Production React DOM runtime must be rendered')
      assert.ok(evidence.reactRuntimeModules.every(id => !id.includes('.development.')), 'Development React runtime must not be rendered')
    },
  }
}
