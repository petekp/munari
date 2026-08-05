import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The lab is a CONSUMER. `munari` and `@petekp/munari/style.css` resolve through
// the workspace exactly as they would from npm — no aliases standing in for
// the library, so anything missing from the barrel fails the build instead
// of quietly slipping past it on a relative path (tests/boundary.test.ts
// enforces the same rule statically).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // shadcn sources are vendored verbatim; they import from "@/…".
    alias: [{ find: '@', replacement: path.resolve(import.meta.dirname, 'src') }],
  },
})
