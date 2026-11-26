// The export map plugin — serves readExportMap's result to the architecture
// guide as the virtual module `virtual:munari-export-map`.
//
// It reads at dev-server load and at build, watches every file it read, and
// throws when a layer in architectureLayers.ts names an export or a file the
// source does not have, so drift stops the build.

import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { readExportMap } from './architectureExportMap.ts'
import { ARCHITECTURE_LAYERS, architectureLayerProblems } from './architectureLayers.ts'

export const EXPORT_MAP_MODULE = 'virtual:munari-export-map'
const RESOLVED_EXPORT_MAP_MODULE = `\0${EXPORT_MAP_MODULE}`

export function architectureExportMap(repoRoot: string): Plugin {
  return {
    name: 'munari-export-map',
    resolveId(id) {
      return id === EXPORT_MAP_MODULE ? RESOLVED_EXPORT_MAP_MODULE : null
    },
    load(id) {
      if (id !== RESOLVED_EXPORT_MAP_MODULE) return null
      const { map, files } = readExportMap(repoRoot)
      for (const file of files) this.addWatchFile(file)
      const problems = architectureLayerProblems(ARCHITECTURE_LAYERS, map, (repositoryPath) =>
        existsSync(path.join(repoRoot, repositoryPath)),
      )
      if (problems.length > 0) {
        throw new Error(`The architecture guide names what the source does not have:\n${problems.join('\n')}`)
      }
      return `export default ${JSON.stringify(map)}`
    },
  }
}
