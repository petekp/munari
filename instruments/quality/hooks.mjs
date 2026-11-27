// Quality probe hooks — temporary edits that let run.mjs set each quality
// cost from the page: the canvas pixel ratio and MSAA, the environment bake
// size, the glass tap count, the capture resolution, and finish overrides.
//
// None of these is a public setting yet, so the probe patches the lab and
// two library constants in a measurement checkout, reads each value from
// globalThis.__quality where the library uses it, and restores the files
// afterwards. Never commit an applied tree (README.md).
//
//   node instruments/quality/hooks.mjs apply     # edits the files below
//   node instruments/quality/hooks.mjs restore   # git restore, removes the bench
//
// Each anchor must match exactly once, unless marked 'all'. A missing anchor
// in a required file stops the run, so a probe never measures an unpatched
// tree. The glass files exist only on commits that carry the transmission
// layer.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..', '..')
const Q = '((globalThis as any).__quality ?? {})'
const SCENE = 'apps/lab/src/scenes/material-finishes'
const BENCH = path.join(SCENE, 'qualityBench.tsx')
const BT = String.fromCharCode(96)
const mark = (phase) => 'performance.mark(' + BT + 'munari:bake:@{kind}:' + phase + BT + ')'

const CANVAS = [
  ['dpr={[1, 2]}', 'dpr={' + Q + '.dpr ?? [1, 2]}'],
  ['gl={{ alpha: true, antialias: false, depth: false }}', 'gl={{ alpha: true, antialias: ' + Q + '.msaa ?? false, depth: false }}'],
]

const FILES = [
  {
    file: 'packages/react/src/primitives/surface/finishRig.tsx',
    required: true,
    edits: [[
      'const target = generator.fromScene(scene, STUDIO_BLUR)',
      mark('start') + '\n' +
        '        const target = generator.fromScene(scene, STUDIO_BLUR, 0.1, 100, { size: ' + Q + '.pmremSize ?? 256 })\n' +
        '        ' + mark('cpu') + '\n' +
        '        void (renderer.backend as any).device?.queue.onSubmittedWorkDone().then(() => ' + mark('gpu') + ')',
    ]],
  },
  {
    file: 'packages/react/src/primitives/surface/finishTransmission.ts',
    required: false,
    edits: [
      ['const TAPS = 8', 'const TAPS: number = ' + Q + '.taps ?? 8'],
      ['const ONE_TAP_BLUR_PX = 0.35', 'const ONE_TAP_BLUR_PX: number = ' + Q + '.oneTapBlurPx ?? 0.35'],
    ],
  },
  {
    file: path.join(SCENE, 'MaterialFinishes.tsx'),
    required: true,
    edits: [
      ...CANVAS,
      ['const worn = useMemo(() => ({ ...live, text }), [live, text])', 'const worn = useMemo(() => ({ ...live, text, ...' + Q + '.finish }), [live, text])'],
      ["{tilt === 'pointer' && <PointerTracker />}", "{tilt === 'pointer' && <PointerTracker />}<QualityBench />"],
      ["import './materialFinishes.css'", "import './materialFinishes.css'\nimport { QualityBench } from './qualityBench'"],
    ],
  },
  {
    file: path.join(SCENE, 'MaterialFinishesSurface.tsx'),
    required: true,
    edits: [['<Surface.HTML>', '<Surface.HTML resolution={' + Q + '.resolution}>']],
  },
  {
    file: path.join(SCENE, 'MaterialFinishesGlass.tsx'),
    required: false,
    edits: [
      ...CANVAS,
      ['finish: { ...finishes[look.preset], color: look.tint }', 'finish: { ...finishes[look.preset], color: look.tint, ...' + Q + '.finish }'],
      ['finish: finishes[finish], ink', 'finish: { ...finishes[finish], ...' + Q + '.finish }, ink'],
      ['<Surface.HTML>', '<Surface.HTML resolution={' + Q + '.resolution}>', 'all'],
    ],
  },
]

// Reports the renderer's MSAA samples and drawing buffer to run.mjs.
const BENCH_SOURCE = [
  "import { useEffect } from 'react'",
  "import { useThree } from '@react-three/fiber'",
  "import { WebGPURenderer } from 'three/webgpu'",
  '',
  'export function QualityBench() {',
  '  const gl = useThree((state) => state.gl)',
  '  useEffect(() => {',
  '    if (!(gl instanceof WebGPURenderer)) return',
  '    const w = window as any',
  '    w.__qualityRenderer = () => ({ samples: (gl as any).samples, pixelRatio: gl.getPixelRatio(), width: gl.domElement.width, height: gl.domElement.height })',
  '    return () => {',
  '      delete w.__qualityRenderer',
  '    }',
  '  }, [gl])',
  '  return null',
  '}',
  '',
].join('\n')

function apply() {
  for (const { file, required, edits } of FILES) {
    const full = path.join(root, file)
    if (!existsSync(full)) {
      if (required) throw new Error('hooks: missing ' + file)
      continue
    }
    let text = readFileSync(full, 'utf8')
    for (const [anchor, raw, mode] of edits) {
      const next = raw.replaceAll('@{', '$' + '{')
      const count = text.split(anchor).length - 1
      if (count === 0 || (count > 1 && mode !== 'all')) throw new Error('hooks: ' + file + ' has ' + count + ' of ' + JSON.stringify(anchor))
      text = text.split(anchor).join(next)
    }
    writeFileSync(full, text)
    console.log('hooks: patched ' + file)
  }
  writeFileSync(path.join(root, BENCH), BENCH_SOURCE)
}

function restore() {
  const files = FILES.map(({ file }) => file).filter((file) => existsSync(path.join(root, file)))
  execFileSync('git', ['restore', '--source=HEAD', '--', ...files], { cwd: root, stdio: 'inherit' })
  rmSync(path.join(root, BENCH), { force: true })
  console.log('hooks: restored')
}

const command = process.argv[2]
if (command === 'apply') apply()
else if (command === 'restore') restore()
else throw new Error('usage: node instruments/quality/hooks.mjs apply|restore')
