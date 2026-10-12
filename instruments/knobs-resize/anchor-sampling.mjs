// CPU sampling cost for identical interior queries on alternating revisions.
// This does not measure browser frame rate or capture and rendering work.
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { sampleUvPosition } from '../../packages/core/src/mapping/uvSampling.ts'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const base = process.argv[2] ?? '2c893a9'
const scratch = await mkdtemp(path.join(tmpdir(), 'munari-anchor-sampling-'))
try {
  const original = execFileSync('git', ['show', `${base}:packages/core/src/mapping/uvSampling.ts`], { cwd: repo, encoding: 'utf8' })
  const baselinePath = path.join(scratch, 'baseline.ts')
  await writeFile(baselinePath, original)
  const { sampleUvPosition: baseline } = await import(pathToFileURL(baselinePath).href)
  const divisions = 20, position = [], uv = [], index = []
  for (let y = 0; y <= divisions; y++) for (let x = 0; x <= divisions; x++) {
    position.push(x / divisions, y / divisions, Math.sin(x) * .1)
    uv.push(x / divisions, y / divisions)
  }
  for (let y = 0; y < divisions; y++) for (let x = 0; x < divisions; x++) {
    const a = y * (divisions + 1) + x
    index.push(a, a + 1, a + divisions + 1, a + divisions + 1, a + 1, a + divisions + 2)
  }
  let seed = 41
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  const samples = Array.from({ length: 15_000 }, () => [random(), random()])
  const measure = sample => {
    let checksum = 0
    const start = performance.now()
    for (const [u, v] of samples) checksum += sample(position, uv, index, u, v).x
    return { milliseconds: performance.now() - start, checksum }
  }
  measure(baseline)
  measure(sampleUvPosition)
  const runs = { baseline: [], current: [] }
  for (let round = 0; round < 7; round++) {
    for (const name of round % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
      runs[name].push(measure(name === 'baseline' ? baseline : sampleUvPosition))
    }
  }
  const median = values => values.map(value => value.milliseconds).sort((a, b) => a - b)[3]
  console.log(JSON.stringify({ base, triangles: index.length / 3, samples: samples.length, medianMilliseconds: { baseline: median(runs.baseline), current: median(runs.current) }, runs }, null, 2))
} finally {
  await rm(scratch, { recursive: true, force: true })
}
