// Runner for the WebGPU-only micro-probe across Step 1–Step 4 checks.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { createServer } from 'vite'
import typegpu from 'unplugin-typegpu/vite'
import { diffPngPair, runFisheyeCheck, runFlightCheck } from './sliceChecks.mjs'
import {
  runDeviceLostRecoveryCheck,
  runDpr2SnapCheck,
  runFallbackProbe,
  runGlassBackdropCheck,
  runOverlapCheck,
  runStep1,
} from './substrateChecks.mjs'

const here = import.meta.dirname
const repoRoot = path.resolve(here, '..', '..')
const coreEntry = path.join(repoRoot, 'packages', 'core', 'src', 'index.ts')

const server = await createServer({
  configFile: false,
  root: here,
  logLevel: 'warn',
  plugins: [typegpu()],
  resolve: {
    alias: [{ find: /^@munari\/core$/, replacement: coreEntry }],
  },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [repoRoot] } },
})
await server.listen()
const address = server.httpServer.address()
const baseUrl = `http://127.0.0.1:${address.port}`

try {
  const step1 = await runStep1(baseUrl)
  const fallback = await runFallbackProbe(baseUrl)
  const flight = await runFlightCheck(baseUrl, 'wgsl')
  const fisheye = await runFisheyeCheck(baseUrl, 'wgsl')
  const flightTypegpuFull = await runFlightCheck(baseUrl, 'typegpu', true)
  const fisheyeTypegpuFull = await runFisheyeCheck(baseUrl, 'typegpu', true)
  const flightManifestFull = await runFlightCheck(baseUrl, 'manifest', true)
  const fisheyeManifestFull = await runFisheyeCheck(baseUrl, 'manifest', true)

  const flightManifestParity = await diffPngPair(flightTypegpuFull.screenshot, flightManifestFull.screenshot)
  const fisheyeManifestParity = await diffPngPair(fisheyeTypegpuFull.screenshot, fisheyeManifestFull.screenshot)
  assert.ok(flightManifestParity.maxDelta <= 2, `Flight TypeGPU vs Manifest parity failed: ${JSON.stringify(flightManifestParity)}`)
  assert.ok(fisheyeManifestParity.maxDelta <= 2, `Fisheye TypeGPU vs Manifest parity failed: ${JSON.stringify(fisheyeManifestParity)}`)

  const { screenshot: _ftShot, ...flightTypegpu } = flightTypegpuFull
  const { screenshot: _fmShot, ...flightManifest } = flightManifestFull
  const { screenshot: _etShot, ...fisheyeTypegpu } = fisheyeTypegpuFull
  const { screenshot: _emShot, ...fisheyeManifest } = fisheyeManifestFull

  const overlapCards = await runOverlapCheck(baseUrl)
  const dpr2Snap = await runDpr2SnapCheck(baseUrl)
  const glassBackdrop = await runGlassBackdropCheck(baseUrl)
  const deviceLostRecovery = await runDeviceLostRecoveryCheck(baseUrl)
  await server.close()
  const payloadRaw = execFileSync(process.execPath, [path.join(here, 'measurePayload.mjs')], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8',
  })
  const payload = JSON.parse(payloadRaw)
  console.log(
    JSON.stringify(
      {
        step1,
        fallback,
        flight,
        fisheye,
        flightTypegpu,
        fisheyeTypegpu,
        flightManifest,
        fisheyeManifest,
        flightManifestParity,
        fisheyeManifestParity,
        overlapCards,
        dpr2Snap,
        glassBackdrop,
        deviceLostRecovery,
        payload,
      },
      null,
      2,
    ),
  )
} finally {
  await server.close().catch(() => {})
}
