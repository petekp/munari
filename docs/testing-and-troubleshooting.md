# Testing and troubleshooting

## DOM shape and testing

A Surface can put two copies of its content in the DOM. One is live. The other
is `inert` and `aria-hidden`:

- While the Surface is in the scene, an inert copy stays at the page position to
  hold layout, and the live content sits inside the canvas.
- In page mode, a hidden `data-munari-source-host` element in a parked canvas
  also holds an inert copy.

`document.querySelector('[data-testid="count"]')` can return the inert copy, and
`querySelectorAll('input')` can return two elements. Role-based queries, such as
Testing Library's `getByRole`, skip `aria-hidden` content and find the live one.
For a CSS selector, exclude the copy:

```ts
const live = [...document.querySelectorAll('[data-testid="count"]')]
  .filter(element => !element.closest('[inert]'))
```

## Known console output

- `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.`
  comes from `@react-three/fiber` 9.8.1, which constructs a `THREE.Clock`.
  Munari does not. It is harmless.
- Where the browser has no WebGPU adapter, Three logs that WebGPU is not
  available and that it runs under the WebGL 2 backend, with a few related
  warnings. These are Three's own messages for the fallback.
