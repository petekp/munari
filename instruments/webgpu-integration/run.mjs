// WebGPU integration runner — strict setup for a bounded S0 diagnostic.
// Solid-color controls must pass before command metadata can inform an integration choice.
// On 2026-10-05, cached borrowed draws returned red while their pipeline and source bindings were unknown.
// The page owns temporary GPU resources; this runner owns the browser, server, and evidence files.

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createServer } from 'vite'

const execute = promisify(execFile)
const root = import.meta.dirname
const repo = path.resolve(root, '../..')
const output = process.env.WEBGPU_S0_OUTPUT ?? path.join(tmpdir(), `munari-webgpu-s0-${randomUUID()}`)
const session = `munari-wgpu-${randomUUID().slice(0, 12)}`
const commandDeadline = 30_000
const runDeadline = Date.now() + 90_000
const commandResults = []
const evidence = { status: 'starting', selectedGate: null, session, output, node: process.version, commands: commandResults }
let server
let launched = false

await mkdir(output, { recursive: true })

async function command(label, executable, args, cleanup = false) {
  const remaining = cleanup ? 15_000 : runDeadline - Date.now()
  assert.ok(remaining > 0, 'The diagnostic exceeded its bounded execution window')
  const started = Date.now()
  let stdout = '', stderr = '', failure
  try {
    const result = await execute(executable, args, { cwd: repo, timeout: Math.min(commandDeadline, remaining), maxBuffer: 16 * 1024 * 1024 })
    stdout = result.stdout
    stderr = result.stderr
  } catch (cause) {
    stdout = cause.stdout ?? ''
    stderr = cause.stderr ?? ''
    failure = cause
  }
  await writeFile(path.join(output, `${label}.stdout.log`), stdout)
  await writeFile(path.join(output, `${label}.stderr.log`), stderr)
  commandResults.push({ label, executable, args, elapsedMs: Date.now() - started, succeeded: !failure, error: failure?.message ?? null })
  if (failure) throw failure
  return stdout
}

async function browser(label, args, cleanup = false) {
  const reply = JSON.parse(await command(label, 'agent-browser', ['--session', session, '--json', ...args], cleanup))
  assert.equal(reply.success, true, `${label} failed: ${reply.error ?? 'missing success acknowledgment'}`)
  return reply.data?.result ?? reply.result ?? reply.data
}

function color(actual, expected, label) {
  assert.equal(actual?.length, 4, `${label} did not return one complete RGBA pixel`)
  actual.forEach((value, index) => {
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 255, `${label} returned an invalid 8-bit channel`)
    assert.ok(Math.abs(value - expected[index]) <= 1, `${label} returned ${actual}; expected ${expected}`)
  })
}

function validate(observation) {
  assert.equal(observation.completed, true, `The page did not complete its diagnostic: ${observation.failure ?? 'missing observations'}`)
  assert.equal(observation.backend, 'webgpu', 'Requested WebGPU cannot pass with a fallback backend')
  assert.equal(observation.secureContext, true, 'Native WebGPU requires a secure context')
  assert.equal(observation.prototypeChanges, false, 'The diagnostic changed shared native prototypes')
  assert.ok(observation.adapter, 'The native adapter identity was not recorded')
  const cases = observation.cases
  assert.deepEqual(Object.keys(cases).sort(), ['ordinary', 'empty', 'invalid', 'invalidSettled', 'nested', 'nestedOnly', 'cachedBorrowed', 'preInitDispose'].sort(), 'The intended cases were not discovered')
  color(cases.ordinary.pixel, [255, 0, 0, 255], 'Fresh bound source')
  assert.equal(cases.ordinary.validation, null, 'The fresh control had GPU validation errors')
  assert.equal(cases.ordinary.hasKnownSourceCommand, true, 'The fresh control did not observe a nonempty command using its known allocation')
  color(cases.empty.pixel, [0, 0, 255, 255], 'Empty watched draw')
  assert.equal(cases.empty.hasKnownSourceCommand, false, 'An empty draw counted as a nonempty command with a known source binding')
  assert.ok(cases.invalid.validation, 'The deliberately invalid WGSL did not reach validation')
  assert.equal(cases.invalid.hasKnownSourceCommand, false, 'Invalid shader work counted as a known-source command')
  assert.equal(cases.invalidSettled.hasKnownSourceCommand, false, 'A settled invalid pipeline counted as known-source work')
  color(cases.nested.pixel, [255, 0, 0, 255], 'Nested draw followed by the watched source')
  color(cases.nestedOnly.pixel, [0, 255, 0, 255], 'Unrelated nested draw with empty watched geometry')
  assert.equal(cases.nestedOnly.hasKnownSourceCommand, false, 'An unrelated nested draw counted for the empty watched source')
  color(cases.cachedBorrowed.beforePixel, [255, 0, 0, 255], 'Prewarmed borrowed source before observation')
  color(cases.cachedBorrowed.pixel, [255, 0, 0, 255], 'Prewarmed borrowed source after observation')
  assert.equal(cases.cachedBorrowed.beforeValidation, null, 'Borrowed setup was invalid before observation')
  assert.equal(cases.cachedBorrowed.validation, null, 'Borrowed setup was invalid after observation')
  assert.ok(cases.cachedBorrowed.nonemptyCommands > 0, 'No borrowed draw command was observed')
  // Missing cached metadata is the finding; a future complete observation remains a valid result.
  if (cases.cachedBorrowed.hasKnownSourceCommand) {
    assert.equal(cases.cachedBorrowed.knownPipeline, true)
    assert.equal(cases.cachedBorrowed.knownSourceBinding, true)
  }
  assert.equal(cases.preInitDispose.beforeInitialized, false, 'The early-dispose control was already initialized')
  if (cases.preInitDispose.initRequested) assert.equal(cases.preInitDispose.initOutcome, 'fulfilled', 'Dispose-triggered initialization did not settle successfully')
  if (cases.preInitDispose.observedInitialization) {
    assert.equal(cases.preInitDispose.backend, 'webgl2', 'The deliberate cleanup control used an unexpected backend')
    color(cases.preInitDispose.pixel, [255, 0, 255, 255], 'Renderer made usable after pre-init disposal')
  }
}

try {
  const files = ['main.js', 'index.html', 'run.mjs', 'README.md']
  evidence.sourceDigests = {}
  for (const file of files) {
    const bytes = await readFile(path.join(root, file))
    evidence.sourceDigests[file] = createHash('sha256').update(bytes).digest('hex')
    await mkdir(path.join(output, 'source'), { recursive: true })
    await writeFile(path.join(output, 'source', file), bytes)
  }
  const source = path.join(repo, 'node_modules/three/src')
  const packageBytes = await readFile(path.join(repo, 'node_modules/three/package.json'))
  evidence.three = JSON.parse(packageBytes).version
  evidence.dependencyDigests = {}
  for (const file of ['package-lock.json', 'node_modules/three/src/renderers/common/Renderer.js', 'node_modules/three/src/renderers/webgpu/WebGPUBackend.js']) {
    evidence.dependencyDigests[file] = createHash('sha256').update(await readFile(path.join(repo, file))).digest('hex')
  }
  evidence.revision = (await command('git-revision', 'git', ['rev-parse', 'HEAD'])).trim()
  evidence.dirtyFiles = (await command('git-dirty', 'git', ['status', '--short'])).trim()
  evidence.agentBrowserVersion = (await command('agent-browser-version', 'agent-browser', ['--version'])).trim()
  server = await createServer({
    configFile: false, root, cacheDir: path.join(output, '.vite'), logLevel: 'warn',
    resolve: { alias: [
      { find: /^three$/, replacement: path.join(source, 'Three.js') },
      { find: /^three\/webgpu$/, replacement: path.join(source, 'Three.WebGPU.js') },
      { find: /^three\/tsl$/, replacement: path.join(source, 'Three.TSL.js') },
    ] },
    optimizeDeps: { exclude: ['three', 'three/webgpu', 'three/tsl'] },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repo] } },
  })
  await server.listen()
  const address = server.httpServer.address()
  assert.ok(address && 'port' in address && address.port > 0, 'The fixture server did not bind a TCP port')
  const url = `http://127.0.0.1:${address.port}`
  evidence.url = url
  const launch = ['--webgpu']
  if (process.env.CHROME_PATH) launch.push('--executable-path', process.env.CHROME_PATH)
  launched = true
  await browser('browser-open', [...launch, 'open', url])
  await browser('browser-wait', ['wait', '--fn', 'window.__nativeObservationS0?.completed || window.__nativeObservationS0?.failure'])
  const observation = await browser('browser-observations', ['eval', 'window.__nativeObservationS0'])
  await writeFile(path.join(output, 'observations.json'), `${JSON.stringify(observation, null, 2)}\n`)
  validate(observation)
  evidence.status = 'setup-validated'
  evidence.findings = {
    cachedPipelineKnown: observation.cases.cachedBorrowed.knownPipeline,
    cachedSourceBindingKnown: observation.cases.cachedBorrowed.knownSourceBinding,
    initializedAfterEarlyDispose: observation.cases.preInitDispose.observedInitialization,
    disposeRequestedInitialization: observation.cases.preInitDispose.initRequested,
  }
  console.log(`WebGPU diagnostic setup validated. S0 integration gate remains unselected. Evidence: ${output}`)
} catch (cause) {
  evidence.status = 'failed-or-unverified'
  evidence.error = cause.stack ?? String(cause)
  process.exitCode = 1
  console.error(`WebGPU diagnostic failed or remains unverified: ${cause.message ?? cause}. Evidence: ${output}`)
} finally {
  if (launched) {
    try { await browser('browser-close', ['close'], true) }
    catch (cause) { evidence.cleanupError = cause.message; process.exitCode = 1 }
  }
  if (server) await server.close()
  evidence.finishedAt = new Date().toISOString()
  await writeFile(path.join(output, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
}
