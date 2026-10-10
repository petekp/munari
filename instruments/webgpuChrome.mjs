// Chrome flags every browser runner needs for SurfaceCanvas's WebGPURenderer.

/**
 * `--enable-unsafe-webgpu` exposes WebGPU where headless Chrome would not.
 * Chrome 155 on macOS exposes it without the flag; the flag is kept for other
 * builds. `MUNARI_BACKEND=webgl2` instead turns off the WebGPU service, so
 * `requestAdapter()` returns null and Three starts its WebGL 2 fallback, the
 * path a browser without WebGPU takes. `--disable-blink-features=WebGPU` and
 * `--disable-webgpu` left an adapter available (measured 2026-10-08).
 *
 * Linux Chrome also needs the other three, or it cannot allocate a WebGPU
 * canvas's texture: the GPU process logs "Could not find
 * SharedImageBackingFactory" and the device is lost on the first frame.
 * Removing any one of the three still fails. Measured 2026-10-08, Chrome 155
 * on Debian amd64 with no GPU and on a GitHub hosted runner. They force
 * software rendering on any Linux machine.
 */
export const WEBGPU_CHROME_ARGS =
  process.env.MUNARI_BACKEND === 'webgl2'
    ? ['--disable-features=WebGPUService']
    : [
        '--enable-unsafe-webgpu',
        ...(process.platform === 'linux'
          ? ['--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-angle=swiftshader']
          : []),
      ]
