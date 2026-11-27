#!/usr/bin/env node
// Entry executable for `munari`. Installs the unplugin-typegpu Node loader hook
// only for commands (`compile`, `check`) that import TypeGPU *.material.ts files.

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const command = process.argv[2] ?? ''
const needsTypeGpuLoader = command === 'compile' || command === 'check'

if (needsTypeGpuLoader && !process.env.MUNARI_CLI_PRELOADED) {
  const preloadPath = join(import.meta.dirname, '..', 'src', 'preload.mjs')
  const cliPath = join(import.meta.dirname, '..', 'src', 'cli.mjs')
  try {
    execFileSync(process.execPath, ['--import', preloadPath, cliPath, ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'development', MUNARI_CLI_PRELOADED: '1' },
    })
  } catch (err) {
    const code = err && 'status' in err && Number.isInteger(err.status) ? err.status : 1
    process.exit(code)
  }
  process.exit(0)
}

const { runCli } = await import('../src/cli.mjs')
await runCli(process.argv.slice(2))
