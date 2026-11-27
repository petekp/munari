// Node preload hook for `munari compile` and `munari check`:
// installs unplugin-typegpu/node plus extensionless .ts/.tsx resolution inside local files.

import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, extname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import installTypeGpu from 'unplugin-typegpu/node'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      extname(specifier) === '' &&
      context.parentURL?.startsWith('file://')
    ) {
      const parentDir = dirname(fileURLToPath(context.parentURL))
      const tsPath = resolvePath(parentDir, `${specifier}.ts`)
      if (existsSync(tsPath)) return nextResolve(pathToFileURL(tsPath).href, context)
      const tsxPath = resolvePath(parentDir, `${specifier}.tsx`)
      if (existsSync(tsxPath)) return nextResolve(pathToFileURL(tsxPath).href, context)
    }
    return nextResolve(specifier, context)
  },
})

installTypeGpu()
