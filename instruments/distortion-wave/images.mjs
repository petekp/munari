// Wave image comparisons — motion differs from both native states; regions constrain its footprint.
export async function compareWaveImages(page, before, during, native, allowed = null) {
  return page.evaluate(async ({images, allowed}) => {
    const decode = async data => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, canvas.width, canvas.height).data
    }
    const [old, current, next] = await Promise.all(images.map(decode))
    let effectPixels = 0, changedPixels = 0, outsidePixels = 0
    const regions = allowed === null ? [] : Array.isArray(allowed) ? allowed : [allowed]
    const regionPixels = regions.map(() => 0)
    const imageWidth = Math.round(innerWidth * devicePixelRatio)
    for (let i = 0; i < current.length; i += 4) {
      const oldDelta = Math.max(Math.abs(current[i] - old[i]), Math.abs(current[i + 1] - old[i + 1]), Math.abs(current[i + 2] - old[i + 2]))
      const nextDelta = Math.max(Math.abs(current[i] - next[i]), Math.abs(current[i + 1] - next[i + 1]), Math.abs(current[i + 2] - next[i + 2]))
      if (oldDelta > 20 && nextDelta > 20) effectPixels++
      if (nextDelta > 0) changedPixels++
      if (allowed && nextDelta > 20) {
        const x = (i / 4 % imageWidth) / devicePixelRatio, y = Math.floor(i / 4 / imageWidth) / devicePixelRatio
        let inside = false
        regions.forEach((region, index) => {
          const within = x >= region.x - 1 && x <= region.x + region.width + 1 && y >= region.y - 1 && y <= region.y + region.height + 1
          if (within) { inside = true; regionPixels[index]++ }
        })
        if (!inside) outsidePixels++
      }
    }
    return { effectPixels, changedPixels, outsidePixels, regionPixels }
  }, {images: [before, during, native].map(bytes => Buffer.from(bytes).toString('base64')), allowed})
}

