# Next.js and server rendering

Every built module that imports React starts with `'use client'`, so a Next.js
server component can import `Surface`, `SurfaceCanvas` and the hooks. The entry
files themselves carry no directive. `Surface` and `SurfaceCanvas` render on the
client only.

This was tested with Next 16 under Turbopack. A server component that imports
`Surface` and `SurfaceCanvas` from the packed package builds, renders and
hydrates. Webpack mode and a handoff into the scene have not been tested under
Next.js. A
component that calls a hook still needs its own `'use client'`, and `Surface`
needs an `inScene` boolean prop.

`useSurfaceSupport()` is `false` on the server and on the first client render,
then reports the browser. Gate the canvas on it, as the first example does, and
the server and client markup match.

`@petepetrash/munari/snapdom` has no directive. Call `enableSnapdomCapture()` at
the top level of a client module that loads before the first `Surface` mounts.
The call is safe during server render:

```tsx
'use client'
import { enableSnapdomCapture } from '@petepetrash/munari/snapdom'
import { Example } from './Example'

enableSnapdomCapture()

export function ExampleWithSnapdom() {
  return <Example />
}
```
