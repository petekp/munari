// Idle-render probe configuration — the environment settings, paths and Chrome
// launch flags every mode shares.

import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

export const here = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(here, '..', '..')
export const labRoot = path.join(repoRoot, 'apps', 'lab')
export const MODE = process.env.MODE
export const OUT = process.env.OUT
export const ROUNDS = Number(process.env.ROUNDS ?? 3)
export const SETTLE_MS = Number(process.env.SETTLE_MS ?? 8000)
export const WINDOW_MS = Number(process.env.WINDOW_MS ?? 5000)
export const HEADLESS = process.env.HEADED !== '1'
if (!OUT) throw new Error('Set OUT to an output directory')
mkdirSync(OUT, { recursive: true })
export const chromePath = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync)
if (!chromePath) throw new Error('No Chrome executable found (set CHROME_PATH)')
// Developer features turn off WebGPU's 100 µs timestamp quantization.
export const ARGS = [...WEBGPU_CHROME_ARGS, '--enable-webgpu-developer-features', '--enable-features=CanvasDrawElement', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const only = (name, list) => (process.env[name] ? list.filter((item) => process.env[name].split(',').includes(item.id ?? item)) : list)
