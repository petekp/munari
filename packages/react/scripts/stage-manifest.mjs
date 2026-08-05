// Write the PUBLISHED manifest into dist/, and publish from there.
//
// Why staging instead of just pointing `exports` at dist: the lab resolves
// `munari` through the workspace with no alias standing in for the
// library, which is what makes a missing barrel export fail the build
// instead of slipping past on a relative path (apps/lab/vite.config.ts
// says so, tests/boundary.test.ts enforces it). Repointing exports at
// dist would either break that or force a rebuild between every edit.
// So the workspace manifest keeps pointing at source and stays private,
// and the thing we publish is assembled here:
//
//   npm run build -w munari && npm publish packages/react/dist
//
// The workspace package staying `private: true` is therefore a feature —
// a stray `npm publish` at the root cannot ship raw source by accident.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = resolve(here, '..')
const repoRoot = resolve(pkgDir, '..', '..')
const dist = join(pkgDir, 'dist')

if (!existsSync(join(dist, 'index.js'))) {
  console.error('stage-manifest: dist/index.js is missing — run the build first.')
  process.exit(1)
}

const src = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))

// Paths are relative to dist/, which IS the package root once published.
const staged = {
  name: src.name,
  version: src.version,
  description: src.description,
  license: src.license,
  author: src.author,
  homepage: src.homepage,
  repository: src.repository,
  bugs: src.bugs,
  keywords: src.keywords,
  type: 'module',
  sideEffects: ['*.css'],
  exports: {
    '.': { types: './index.d.ts', default: './index.js' },
    './style.css': './style.css',
  },
  types: './index.d.ts',
  peerDependencies: src.peerDependencies,
  engines: src.engines,
}

// The kernel must be INSIDE the bundle, not imported from it. `@munari/core`
// resolves only inside this workspace, so a surviving import is an install
// failure for every consumer — and a silent one here, because the workspace
// itself resolves it fine. Check the emitted artifact, not the intent.
const emitted = readFileSync(join(dist, 'index.js'), 'utf8')
if (/from\s*['"]@munari\/core['"]/.test(emitted)) {
  console.error('stage-manifest: dist/index.js still imports @munari/core — it was not bundled.')
  console.error('Check `noExternal` in tsdown.config.ts.')
  process.exit(1)
}

writeFileSync(join(dist, 'package.json'), `${JSON.stringify(staged, null, 2)}\n`)

// `munari/style.css` is declared surface and is not in the entry graph,
// so nothing else would put it in the package.
copyFileSync(join(pkgDir, 'src', 'style.css'), join(dist, 'style.css'))

for (const file of ['README.md', 'LICENSE']) {
  const from = existsSync(join(pkgDir, file)) ? join(pkgDir, file) : join(repoRoot, file)
  if (existsSync(from)) copyFileSync(from, join(dist, file))
  else console.warn(`stage-manifest: no ${file} to include`)
}

console.log(`stage-manifest: staged ${staged.name}@${staged.version} in packages/react/dist`)
