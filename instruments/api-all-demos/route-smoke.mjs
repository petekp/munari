// Load every current route and Candidate study, verifying its actual selected content.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { capability, evidenceDirectory, fixtureServer, runBrowserCases } from '../apiBrowser.mjs'

const output = await evidenceDirectory('route-smoke')
const repo = path.resolve(import.meta.dirname, '../..')
const router = await readFile(path.join(repo, 'apps/lab/src/App.tsx'), 'utf8')
const roster = router.match(/const SCENES = \[([\s\S]*?)\] as const/)
assert.ok(roster, 'The route roster must be discovered before coverage runs')
const routes = [...roster[1].matchAll(/'([^']+)'/g)].map(match => match[1])
assert.ok(routes.length > 0)
const candidateSource = await readFile(path.join(repo, 'apps/lab/src/scenes/candidates/Candidates.tsx'), 'utf8')
const studies = [...candidateSource.matchAll(/\{ id: '([^']+)', label:/g)].map(match => match[1])
assert.ok(studies.length > 0, 'No Candidate studies were discovered')
const markers = {
  home: '.home-page[data-home-ready="true"]', workspace: '[data-munari-surface^="workspace-"]', glass: '[data-glass-root]',
  flight: '.l14-board', explode: '.specimen-stage', genie: '.gen-desk', fisheye: '.fisheye-page', slider: '.lslider-page',
  veil: '.veil-page', knobs: '.knb-page', optics: '.opt-page', logo: '.logo-page .logo-word', selection: '.sel-prose',
  candidates: '.cand-rail', refraction: '.refraction-page', gallery: '.gallery-page', crystal: '.crystal-page',
  controls: '.controls-page', 'marble-hand': '.mh-app', plume: '.plume-page', gravity: '.gv-poem', lamp: '.lamp-page',
  rain: '.rain-page', wordmark: '.wordmark-page',
}
for (const scene of routes) assert.ok(markers[scene], `Add an actual-content marker for new route ${scene}`)
const server = await fixtureServer('apps/lab', 'API_LAB_URL', output)
try {
  const cases = [...routes.map(scene => ({ id: scene, scene })), ...studies.map(candidate => ({ id: `candidate-${candidate}`, scene: 'candidates', candidate }))]
    .map(entry => ({ id: entry.id, async run(page) {
      const scene = process.env.ROUTE_FORCE_HOME === '1' ? 'home' : entry.scene
      await page.goto(`${server.url}/?scene=${scene}&framed${entry.candidate ? `&candidate=${entry.candidate}` : ''}`, { waitUntil: 'load' })
      await capability(page, true)
      await page.waitForSelector(markers[entry.scene])
      await page.evaluate(() => document.fonts.ready)
      const selected = await page.evaluate(async ({ scene, candidate }) => {
        const { exampleFor } = await import('/src/components/sceneCatalog.ts')
        const expectedTitle = scene === 'home' ? 'Munari · Live HTML in 3D' : `${exampleFor(scene)?.title ?? scene} · Munari`
        return {
          title: document.title, expectedTitle,
          candidate: document.querySelector('.cand-rail [aria-current="page"] strong')?.textContent?.toLowerCase() ?? null,
          expectedCandidate: candidate ?? null,
          sceneError: document.querySelector('.scene-error')?.textContent ?? null,
          graphics: [...document.querySelectorAll('canvas')].filter(canvas => !canvas.layoutSubtree).length,
          sources: [...document.querySelectorAll('canvas')].filter(canvas => canvas.layoutSubtree).length,
        }
      }, entry)
      assert.equal(selected.title, selected.expectedTitle, 'The requested route must be selected, not Home fallback')
      assert.equal(selected.sceneError, null)
      if (entry.candidate) assert.equal(selected.candidate, entry.candidate)
      return { scene: entry.scene, ...selected, limit: 'Route selection and load only; no visual-quality or gesture claim.' }
    } }))
  await runBrowserCases(cases, output)
} finally { await server.close() }
