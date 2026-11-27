# registry/materials

Ownable TypeGPU materials compiled ahead of time via `munari compile` into
zero-dependency `*.material.gen.ts` manifests for `@petepetrash/munari/gpu`.

Install any preset into your own project with:

```sh
npx munari init
npx munari add flight-card foil glass-refract
```

Edit the copied `*.material.ts` source freely and re-run `npx munari compile`
(or `npx munari check` in CI) to regenerate its static WGSL + DataView packer.
