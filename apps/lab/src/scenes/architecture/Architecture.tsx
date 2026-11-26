// Architecture guide — Munari's six layers as a map you select from, with
// each layer's public API, source, guides and a live demo, and every name
// each package entry exports.
//
// The law: the export lists come from the package source at build time
// (architectureExportMap.ts), and every name, file and guide a layer cites is
// checked against that source before the page can build.
//
// Ownership: App.tsx mounts ArchitectureApp at `?scene=architecture`;
// architectureLayers.ts holds the hand-written layer prose.

import { useEffect, useState } from 'react'
import exportMap from 'virtual:munari-export-map'
import { MunariLogo } from '../../components/MunariLogo'
import { demoFor, GUIDE_URL, SOURCE_REF, SOURCE_ROOT, type DemoId } from '../../components/sceneCatalog'
import { sceneUrl } from '../../captureMode'
import type { PublicEntry, PublicExport } from './architectureExportMap'
import { ARCHITECTURE_LAYERS, entriesExporting, type ArchitectureLayer, type ArchitectureLayerId } from './architectureLayers'
import './architecture.css'

const LAYER_PARAM = 'layer'
const FIRST_LAYER = ARCHITECTURE_LAYERS[0]

function sourceUrl(repositoryPath: string, anchor?: string): string {
  const isFolder = !/\.[a-z]+$/.test(repositoryPath)
  const hash = anchor ? `#${anchor}` : ''
  return `${SOURCE_ROOT}/${isFolder ? 'tree' : 'blob'}/${SOURCE_REF}/${repositoryPath}${hash}`
}

function shortPath(repositoryPath: string): string {
  return repositoryPath.replace(/^packages\/(react|core)\/src\//, '$1/')
}

function entryLabel(entry: PublicEntry): string {
  return entry.specifier === exportMap.packageName ? 'root' : entry.specifier.slice(exportMap.packageName.length + 1)
}

function layerFromUrl(): ArchitectureLayer {
  const requested = new URLSearchParams(window.location.search).get(LAYER_PARAM)
  return ARCHITECTURE_LAYERS.find((layer) => layer.id === requested) ?? FIRST_LAYER
}

function writeLayerToUrl(id: ArchitectureLayerId) {
  const url = new URL(window.location.href)
  url.searchParams.set(LAYER_PARAM, id)
  window.history.replaceState(window.history.state, '', url)
}

function ApiName({ name }: { name: string }) {
  const entries = entriesExporting(exportMap, name)
  const declaration = entries[0]?.exports.find((candidate) => candidate.name === name)
  if (!declaration) return <code className="arch-api">{name}</code>
  const labels = entries.map(entryLabel).filter((label) => label !== 'root')
  const exportedFrom = entries.map((entry) => entry.specifier).join(' and ')
  return (
    <a className="arch-api" href={sourceUrl(declaration.source)} target="_blank" rel="noreferrer" title={`Exported from ${exportedFrom}`}>
      <code>{name}</code>
      {labels.length > 0 && <span className="arch-api-entry">/{labels.join(', /')}</span>}
    </a>
  )
}

function LiveExample({ demos }: { demos: readonly DemoId[] }) {
  const [demoId, setDemoId] = useState<DemoId>(demos[0])
  const [running, setRunning] = useState(false)
  const demo = demoFor(demoId)
  const title = demo?.title ?? demoId

  return (
    <div className="arch-live">
      <div className="arch-live-choices" role="group" aria-label="Demo">
        {demos.map((id) => (
          <button
            key={id}
            type="button"
            className="m-button m-button--compact m-button--outline"
            aria-pressed={id === demoId}
            onClick={() => {
              setDemoId(id)
              setRunning(false)
            }}
          >
            {demoFor(id)?.title ?? id}
          </button>
        ))}
      </div>
      <div className="arch-live-stage">
        {running ? (
          <iframe key={demoId} src={sceneUrl(demoId, { framed: true, bare: true })} title={`${title} demo`} />
        ) : (
          <>
            <img src={`/thumbs/${demoId}.jpg`} alt="" />
            <button type="button" className="m-button arch-live-run" onClick={() => setRunning(true)}>
              Run {title} here
            </button>
          </>
        )}
      </div>
      <p className="m-small m-quiet">
        {demo?.headline}.{' '}
        <a className="m-link" href={sceneUrl(demoId)}>
          Open {title}
        </a>
      </p>
    </div>
  )
}

function LayerDetail({ layer, position }: { layer: ArchitectureLayer; position: number }) {
  return (
    <section className="arch-detail" id="arch-detail" aria-labelledby="arch-detail-title">
      <p className="m-small m-quiet">
        Layer {position} of {ARCHITECTURE_LAYERS.length}
      </p>
      <h2 id="arch-detail-title" className="m-title">
        {layer.title}
      </h2>
      <p className="m-lead">{layer.summary}</p>
      {layer.detail.map((paragraph) => (
        <p key={paragraph} className="m-body">
          {paragraph}
        </p>
      ))}

      <h3 className="arch-detail-label">Public API</h3>
      <div className="arch-api-list">
        {layer.api.map((name) => (
          <ApiName key={name} name={name} />
        ))}
      </div>

      <h3 className="arch-detail-label">Code</h3>
      <ul className="arch-links">
        {layer.code.map((path) => (
          <li key={path}>
            <a className="m-link arch-path" href={sourceUrl(path)} target="_blank" rel="noreferrer">
              {shortPath(path)}
            </a>
          </li>
        ))}
      </ul>

      <h3 className="arch-detail-label">Guides</h3>
      <ul className="arch-links">
        {layer.guides.map((guide) => (
          <li key={guide.label}>
            <a className="m-link" href={sourceUrl(guide.path, guide.anchor)} target="_blank" rel="noreferrer">
              {guide.label}
            </a>
          </li>
        ))}
      </ul>

      <h3 className="arch-detail-label">Live example</h3>
      <LiveExample key={layer.id} demos={layer.demos} />
    </section>
  )
}

function LayerMap({ selected, onSelect }: { selected: ArchitectureLayer; onSelect: (layer: ArchitectureLayer) => void }) {
  return (
    <div className="arch-map">
      <ol className="arch-stack" aria-label="Layers, from your HTML to the screen">
        {ARCHITECTURE_LAYERS.map((layer, index) => (
          <li key={layer.id}>
            <button
              type="button"
              className="arch-layer"
              aria-pressed={layer.id === selected.id}
              aria-controls="arch-detail"
              onClick={() => onSelect(layer)}
            >
              <span className="arch-layer-number">{index + 1}</span>
              <span>
                <span className="arch-layer-title">{layer.title}</span>
                <span className="arch-layer-summary">{layer.summary}</span>
              </span>
            </button>
            {layer.handsOn && <p className="arch-flow m-small">↓ {layer.handsOn}</p>}
          </li>
        ))}
      </ol>
      <p className="arch-return m-small">↑ input goes back to the element</p>
    </div>
  )
}

interface ExportGroup {
  readonly section: string | null
  readonly exports: PublicExport[]
}

function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? '' : 's'}`
}

function groupBySection(exports: readonly PublicExport[]): ExportGroup[] {
  const groups: ExportGroup[] = []
  for (const declaration of exports) {
    const last = groups.at(-1)
    if (last && last.section === declaration.section) last.exports.push(declaration)
    else groups.push({ section: declaration.section, exports: [declaration] })
  }
  return groups
}

function EntryExports({ entry }: { entry: PublicEntry }) {
  const values = entry.exports.filter((declaration) => declaration.kind === 'value').length
  const types = entry.exports.length - values
  return (
    <section className="arch-entry" aria-labelledby={`arch-entry-${entryLabel(entry)}`}>
      <h3 id={`arch-entry-${entryLabel(entry)}`} className="arch-entry-name">
        <code>{entry.specifier}</code>
      </h3>
      <p className="m-small m-quiet">
        <a className="m-link arch-path" href={sourceUrl(entry.file)} target="_blank" rel="noreferrer">
          {shortPath(entry.file)}
        </a>
        {' · '}
        {entry.stylesheet ? 'Stylesheet. Import it once.' : `${count(values, 'value')}, ${count(types, 'type')}`}
      </p>
      {groupBySection(entry.exports).map((group, index) => (
        <div key={`${group.section ?? 'ungrouped'}-${index}`} className="arch-entry-group">
          {group.section && <h4 className="m-small arch-entry-section">{group.section}</h4>}
          <ul className="arch-entry-names">
            {group.exports.map((declaration) => (
              <li key={declaration.name} data-kind={declaration.kind}>
                <a href={sourceUrl(declaration.source)} target="_blank" rel="noreferrer">
                  {declaration.name}
                </a>
                {declaration.kind === 'type' && <span className="arch-type-tag">type</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

export function ArchitectureApp({ onReady }: { onReady?: () => void }) {
  const [selected, setSelected] = useState<ArchitectureLayer>(layerFromUrl)
  const position = ARCHITECTURE_LAYERS.findIndex((layer) => layer.id === selected.id) + 1

  useEffect(() => {
    let alive = true
    const ready = document.fonts?.ready ?? Promise.resolve()
    void ready.then(() => {
      if (alive) requestAnimationFrame(() => onReady?.())
    })
    return () => {
      alive = false
    }
  }, [onReady])

  return (
    <div className="arch-page">
      <header className="arch-header">
        <a href={sceneUrl('home')} className="arch-logo" aria-label="Munari home">
          <span aria-hidden>
            <MunariLogo />
          </span>
        </a>
        <nav aria-label="Project" className="m-ui">
          <a className="m-link m-link--nav" href={sceneUrl('home')}>
            Demos
          </a>
          <a className="m-link m-link--nav" href={sceneUrl('architecture')} aria-current="page">
            Architecture
          </a>
          <a className="m-link m-link--nav" href={GUIDE_URL} target="_blank" rel="noreferrer">
            Guide
          </a>
          <a className="m-link m-link--nav" href={SOURCE_ROOT} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </header>

      <main>
        <div className="arch-intro">
          <h1 className="m-display">How Munari is built</h1>
          <p className="m-lead">
            Six layers carry one piece of HTML into a Three.js scene, and carry input back to it. Select a layer to
            see what it owns, the public API that exposes it, its code, and a live demo.
          </p>
        </div>

        <div className="arch-explorer">
          <LayerMap
            selected={selected}
            onSelect={(layer) => {
              setSelected(layer)
              writeLayerToUrl(layer.id)
            }}
          />
          <LayerDetail layer={selected} position={position} />
        </div>

        <section className="arch-entries" aria-labelledby="arch-entries-heading">
          <h2 id="arch-entries-heading" className="m-heading">
            Package entry points
          </h2>
          <p className="m-ui m-quiet">
            Every name each entry of <code className="m-code">{exportMap.packageName}</code> exports, read from the
            package source when the lab builds. Each name links to the file that declares it.
          </p>
          <div className="arch-entry-grid">
            {exportMap.entries.map((entry) => (
              <EntryExports key={entry.specifier} entry={entry} />
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
